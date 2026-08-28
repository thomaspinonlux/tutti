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
    /// Durée du morceau courant (s), mémorisée au play() pour getStatus().
    private var currentDurationSec: Double = 0
    /// feat/next-track-preload — durée du morceau PRÉCHARGÉ (prochain de la
    /// file), promue dans currentDurationSec au skipToNext().
    private var nextDurationSec: Double = 0

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
            SKCloudServiceController().requestUserToken(
                forDeveloperToken: developerToken
            ) { userToken, error in
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
                self.currentDurationSec = song.duration ?? 0
                self.nextDurationSec = 0
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
                self.nextDurationSec = song.duration ?? 0
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
                try await self.player.skipToNextEntry()
                try await self.player.play()
                if self.nextDurationSec > 0 {
                    self.currentDurationSec = self.nextDurationSec
                    self.nextDurationSec = 0
                }
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
        call.resolve([
            "isPlaying": isPlaying,
            "positionMs": player.playbackTime * 1000.0,
            "durationMs": currentDurationSec * 1000.0,
        ])
    }
}
