import Foundation
import Capacitor
import MusicKit

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

    @objc func authorize(_ call: CAPPluginCall) {
        Task {
            let status = await MusicAuthorization.request()
            call.resolve(["authorized": status == .authorized])
        }
    }

    @objc func play(_ call: CAPPluginCall) {
        guard let catalogId = call.getString("catalogId") else {
            call.reject("catalogId requis")
            return
        }
        Task {
            do {
                var request = MusicCatalogResourceRequest<Song>(
                    matching: \.id, equalTo: MusicItemID(catalogId))
                request.limit = 1
                let response = try await request.response()
                guard let song = response.items.first else {
                    call.reject("Morceau introuvable pour l'id \(catalogId)")
                    return
                }
                self.currentDurationSec = song.duration ?? 0
                self.player.queue = [song]
                try await self.player.play()
                call.resolve(["ok": true])
            } catch {
                call.reject("Lecture échouée : \(error.localizedDescription)")
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
