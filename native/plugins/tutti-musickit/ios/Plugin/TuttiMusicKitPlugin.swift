import Foundation
import Capacitor
import MusicKit
import StoreKit

/**
 * TuttiMusicKitPlugin — lecture Apple Music NATIVE pour la console Tutti.
 *
 * Utilise `ApplicationMusicPlayer` (MusicKit, iOS 15+). Contrairement à MusicKit
 * JS dans une WebView, la lecture full-track ne dépend PAS de la politique
 * d'autoplay du navigateur : plus de geste utilisateur à conserver, plus
 * d'extrait 30 s. Un abonnement Apple Music actif est requis pour le full-track.
 *
 * ⚠️ Non compilable hors d'un environnement Xcode/iOS. À builder sur Mac
 *    (cf. native/README.md). Prérequis Info.plist :
 *      - NSAppleMusicUsageDescription (accès à la médiathèque)
 *      - UIBackgroundModes → audio (son qui continue écran verrouillé)
 */
@objc(TuttiMusicKitPlugin)
public class TuttiMusicKitPlugin: CAPPlugin {

    private let player = ApplicationMusicPlayer.shared
    /// fix/duree-incoherente — LES DURÉES SONT PROTÉGÉES.
    /// Elles étaient écrites depuis les tâches de fond (lecture, préchargement)
    /// et lues depuis le fil principal (getStatus, appelé 4 fois par seconde) :
    /// accès concurrent, donc valeur pouvant être fausse ou instable, ce qui se
    /// voyait par une barre de progression qui sautait.
    private let verrouDurees = NSLock()
    /// Durée du morceau courant (s), mémorisée au play() pour getStatus().
    private var currentDurationSec: Double = 0
    /// feat/next-track-preload — durée du morceau PRÉCHARGÉ (prochain de la
    /// file), promue dans currentDurationSec au skipToNext().
    private var nextDurationSec: Double = 0
    /// fix/apple-connexion-sans-reponse — garde le contrôleur StoreKit vivant
    /// le temps qu'Apple réponde (sinon la demande peut rester sans suite).
    private var controleurJeton: SKCloudServiceController?

    private func lireDureeCourante() -> Double {
        verrouDurees.lock(); defer { verrouDurees.unlock() }
        return currentDurationSec
    }

    private func ecrireDurees(courante: Double?, suivante: Double?) {
        verrouDurees.lock(); defer { verrouDurees.unlock() }
        if let courante { currentDurationSec = courante }
        if let suivante { nextDurationSec = suivante }
    }

    /// Promeut la durée préchargée en durée courante. Rend `true` si promue.
    @discardableResult
    private func promouvoirDureeSuivante() -> Bool {
        verrouDurees.lock(); defer { verrouDurees.unlock() }
        guard nextDurationSec > 0 else { return false }
        currentDurationSec = nextDurationSec
        nextDurationSec = 0
        return true
    }

    /// Fetch d'un Song du catalogue par id. Factorisé play/queueNext.
    private func fetchSong(_ catalogId: String) async throws -> Song? {
        var request = MusicCatalogResourceRequest<Song>(
            matching: \.id, equalTo: MusicItemID(catalogId))
        request.limit = 1
        let response = try await request.response()
        return response.items.first
    }

    @objc func authorize(_ call: CAPPluginCall) {
        Task {
            let status = await MusicAuthorization.request()
            call.resolve(["authorized": status == .authorized])
        }
    }

    /**
     * Récupère le Music User Token (identifie le compte abonné du host) SANS
     * popup web. Remplace `MusicKit.authorize()` (JS) qui ouvre une fenêtre
     * `window.open` impossible dans la WebView native → connexion bloquée.
     *
     * Le developer token (JWT app-level) est minté par le backend et passé ici.
     * StoreKit renvoie alors le Music User Token, que le frontend persiste via
     * /api/auth/apple/connect (comme le flux web).
     */
    @objc func getUserToken(_ call: CAPPluginCall) {
        guard let developerToken = call.getString("developerToken") else {
            call.reject("developerToken requis")
            return
        }
        Task {
            // Dialogue d'autorisation natif iOS (nécessaire avant le token).
            let status = await MusicAuthorization.request()
            guard status == .authorized else {
                call.reject("Autorisation Apple Music refusée")
                return
            }
            // fix/apple-connexion-sans-reponse — LE CONTRÔLEUR EST CONSERVÉ.
            // Il était créé à la volée : libéré par le système avant la réponse
            // d'Apple, sa fonction de rappel pouvait ne jamais être appelée et
            // la connexion Apple Music restait bloquée sans message d'erreur.
            // On le garde vivant jusqu'à la réponse, et un délai de 15 s tranche
            // si Apple ne répond pas du tout.
            let controleur = SKCloudServiceController()
            self.controleurJeton = controleur
            var repondu = false
            let terminer: (@escaping () -> Void) -> Void = { action in
                DispatchQueue.main.async {
                    guard !repondu else { return }
                    repondu = true
                    self.controleurJeton = nil
                    action()
                }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 15) {
                terminer { call.reject("Apple Music n'a pas répondu (15 s)") }
            }
            controleur.requestUserToken(
                forDeveloperToken: developerToken
            ) { userToken, error in
                if let error = error {
                    terminer { call.reject("Music User Token : \(error.localizedDescription)") }
                    return
                }
                guard let userToken = userToken else {
                    terminer { call.reject("Music User Token indisponible") }
                    return
                }
                terminer { call.resolve(["userToken": userToken]) }
            }
        }
    }

    @objc func play(_ call: CAPPluginCall) {
        guard let catalogId = call.getString("catalogId") else {
            call.reject("catalogId requis")
            return
        }
        Task {
            do {
                guard let song = try await self.fetchSong(catalogId) else {
                    call.reject("Morceau introuvable pour l'id \(catalogId)")
                    return
                }
                self.ecrireDurees(courante: song.duration ?? 0, suivante: 0)
                self.player.queue = [song]
                try await self.player.play()
                call.resolve(["ok": true])
            } catch {
                call.reject("Lecture échouée : \(error.localizedDescription)")
            }
        }
    }

    /**
     * feat/next-track-preload — ajoute le morceau SUIVANT en file d'attente
     * pendant que le courant joue : ApplicationMusicPlayer le met en tampon,
     * et skipToNext() démarre alors quasi instantanément.
     */
    @objc func queueNext(_ call: CAPPluginCall) {
        guard let catalogId = call.getString("catalogId") else {
            call.reject("catalogId requis")
            return
        }
        Task {
            do {
                guard let song = try await self.fetchSong(catalogId) else {
                    call.reject("Morceau introuvable pour l'id \(catalogId)")
                    return
                }
                try await self.player.queue.insert(song, position: .tail)
                self.ecrireDurees(courante: nil, suivante: song.duration ?? 0)
                call.resolve(["ok": true])
            } catch {
                call.reject("File d'attente échouée : \(error.localizedDescription)")
            }
        }
    }

    /** feat/next-track-preload — saute sur le morceau préchargé (instantané). */
    @objc func skipToNext(_ call: CAPPluginCall) {
        Task {
            do {
                // fix/skip-sans-fuite-audio — COUPER l'ancien titre AVANT le
                // saut : si l'entrée suivante doit encore se buffériser, le
                // player continuait de jouer l'ANCIEN morceau pendant ce temps
                // (l'écran affichait déjà le nouveau → « décalage » et titre
                // révélé à l'oreille). Un blanc de quelques centaines de ms
                // est invisible ; l'ancien titre audible est inacceptable.
                self.player.pause()
                try await self.player.skipToNextEntry()
                try await self.player.play()
                self.promouvoirDureeSuivante()
                call.resolve(["ok": true])
            } catch {
                call.reject("Saut échoué : \(error.localizedDescription)")
            }
        }
    }

    @objc func pause(_ call: CAPPluginCall) {
        player.pause()
        call.resolve()
    }

    @objc func resume(_ call: CAPPluginCall) {
        Task {
            do {
                try await player.play()
                call.resolve()
            } catch {
                call.reject("Reprise échouée : \(error.localizedDescription)")
            }
        }
    }

    @objc func seek(_ call: CAPPluginCall) {
        let ms = call.getDouble("ms") ?? 0
        player.playbackTime = max(0, ms / 1000.0)
        call.resolve()
    }

    @objc func setVolume(_ call: CAPPluginCall) {
        // ApplicationMusicPlayer suit le volume système : pas d'API de volume
        // applicatif. No-op sûr pour rester symétrique avec le hook web.
        call.resolve()
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        let isPlaying = player.state.playbackStatus == .playing
        // fix/live-sync-check — identité du morceau RÉELLEMENT en lecture.
        // La console la compare en continu au morceau attendu par le jeu :
        // divergence = resynchronisation automatique.
        var nowPlayingId = ""
        if let entry = player.queue.currentEntry, let item = entry.item {
            if case let .song(song) = item {
                nowPlayingId = song.id.rawValue
            }
        }
        call.resolve([
            "isPlaying": isPlaying,
            "positionMs": player.playbackTime * 1000.0,
            "durationMs": lireDureeCourante() * 1000.0,
            "nowPlayingId": nowPlayingId,
        ])
    }
}
