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
/// fix/apple-connexion-sans-reponse — garantit qu'une demande ne reçoit qu'UNE
/// seule réponse, que ce soit celle d'Apple ou celle du délai de garde.
private final class ReponseUnique {
    private let verrou = NSLock()
    private var fait = false
    func premier() -> Bool {
        verrou.lock()
        defer { verrou.unlock() }
        if fait { return false }
        fait = true
        return true
    }
}

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
            // fix/deux-demandes-de-jeton-en-meme-temps — UNE SEULE À LA FOIS.
            // Cet emplacement est unique : une seconde demande écrasait la
            // référence de la première, dont le contrôleur système était alors
            // libéré AVANT la réponse d'Apple — exactement le défaut que ce
            // correctif visait à supprimer.
            if self.controleurJeton != nil {
                call.reject("Une connexion Apple Music est déjà en cours")
                return
            }
            let controleur = SKCloudServiceController()
            self.controleurJeton = controleur
            let unique = ReponseUnique()
            // Filet : si Apple ne répond jamais, on tranche au bout de 15 s.
            DispatchQueue.main.asyncAfter(deadline: .now() + 15) {
                guard unique.premier() else { return }
                self.controleurJeton = nil
                call.reject("Apple Music n'a pas répondu (15 s)")
            }
            controleur.requestUserToken(
                forDeveloperToken: developerToken
            ) { userToken, error in
                guard unique.premier() else { return }
                DispatchQueue.main.async { self.controleurJeton = nil }
                if let error = error {
                    call.reject("Music User Token : \(error.localizedDescription)")
                    return
                }
                guard let userToken = userToken else {
                    call.reject("Music User Token indisponible")
                    return
                }
                call.resolve(["userToken": userToken])
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
                // fix/duree-du-morceau-precedent — on le signale si rien n'a été
                // préchargé : la durée affichée resterait alors celle du titre
                // précédent, donc une barre de progression fausse sur la console
                // ET sur la TV.
                if !self.promouvoirDureeSuivante() {
                    print("[TuttiMusicKit] saut sans préchargement — durée à confirmer")
                }
                call.resolve(["ok": true])
            } catch {
                // fix/silence-apres-un-saut-rate — LA MUSIQUE REPART.
                // La lecture est coupée juste avant le saut ; si le saut
                // échoue (file vide, morceau suivant pas encore chargé, réseau
                // Apple), rien ne la relançait : silence total dans la salle
                // jusqu'à intervention de l'animateur.
                try? await self.player.play()
                call.reject("Saut échoué : \(error.localizedDescription)")
            }
        }
    }

    // fix/lecteur-hors-fil-principal — LE LECTEUR EST TOUJOURS TOUCHÉ SUR LE
    // FIL PRINCIPAL. Capacitor exécute les méthodes de greffon sur une file
    // d'arrière-plan. Ces trois méthodes lisaient et écrivaient l'état du
    // lecteur Apple depuis cette file, pendant que les tâches de lecture le
    // modifiaient : d'où des valeurs incohérentes renvoyées à la console — qui
    // déclenchait alors une resynchronisation inutile en pleine soirée — et un
    // risque d'arrêt brutal sous charge.
    @objc func pause(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.player.pause()
            call.resolve()
        }
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
        DispatchQueue.main.async {
            self.player.playbackTime = max(0, ms / 1000.0)
            call.resolve()
        }
    }

    @objc func setVolume(_ call: CAPPluginCall) {
        // ApplicationMusicPlayer suit le volume système : pas d'API de volume
        // applicatif. No-op sûr pour rester symétrique avec le hook web.
        call.resolve()
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.lireEtat(call) }
    }

    private func lireEtat(_ call: CAPPluginCall) {
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
