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

    // diag/journal-natif — tout est noté et envoyé au serveur (cf. TuttiJournal).
    public override func load() {
        TuttiJournal.shared.lancerSurveillance()
        TuttiJournal.shared.note("musickit", "greffon chargé")
    }

    /** diag/journal-natif — adresse du serveur pour le journal (par défaut prod). */
    @objc func configurerJournal(_ call: CAPPluginCall) {
        if let base = call.getString("apiBase") { TuttiJournal.shared.configurer(apiBase: base) }
        call.resolve()
    }

    @objc func authorize(_ call: CAPPluginCall) {
        let jeton = TuttiJournal.shared.debut("musickit", "authorize")
        Task {
            let status = await MusicAuthorization.request()
            TuttiJournal.shared.fin("musickit", jeton, ["autorise": status == .authorized])
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
        let jetonPlay = TuttiJournal.shared.debut("musickit", "play", ["id": catalogId, "residentMo": TuttiJournal.memoireResidenteMo()])
        Task {
            do {
                let j1 = TuttiJournal.shared.debut("musickit", "play.fetchSong")
                guard let song = try await self.fetchSong(catalogId) else {
                    TuttiJournal.shared.fin("musickit", j1, ["trouve": false])
                    TuttiJournal.shared.fin("musickit", jetonPlay, ["erreur": "introuvable"])
                    call.reject("Morceau introuvable pour l'id \(catalogId)")
                    return
                }
                TuttiJournal.shared.fin("musickit", j1, ["trouve": true, "dureeS": Int(song.duration ?? 0)])
                self.ecrireDurees(courante: song.duration ?? 0, suivante: 0)
                let j2 = TuttiJournal.shared.debut("musickit", "play.queue=")
                self.player.queue = [song]
                TuttiJournal.shared.fin("musickit", j2)
                let j3 = TuttiJournal.shared.debut("musickit", "play.player.play()")
                try await self.player.play()
                TuttiJournal.shared.fin("musickit", j3)
                TuttiJournal.shared.fin("musickit", jetonPlay, ["ok": true])
                call.resolve(["ok": true])
            } catch {
                TuttiJournal.shared.fin("musickit", jetonPlay, ["erreur": error.localizedDescription])
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
        let jeton = TuttiJournal.shared.debut("musickit", "queueNext", ["id": catalogId])
        Task {
            do {
                guard let song = try await self.fetchSong(catalogId) else {
                    TuttiJournal.shared.fin("musickit", jeton, ["erreur": "introuvable"])
                    call.reject("Morceau introuvable pour l'id \(catalogId)")
                    return
                }
                let j2 = TuttiJournal.shared.debut("musickit", "queueNext.insert")
                try await self.player.queue.insert(song, position: .tail)
                TuttiJournal.shared.fin("musickit", j2)
                self.ecrireDurees(courante: nil, suivante: song.duration ?? 0)
                TuttiJournal.shared.fin("musickit", jeton, ["ok": true])
                call.resolve(["ok": true])
            } catch {
                TuttiJournal.shared.fin("musickit", jeton, ["erreur": error.localizedDescription])
                call.reject("File d'attente échouée : \(error.localizedDescription)")
            }
        }
    }

    /** feat/next-track-preload — saute sur le morceau préchargé (instantané). */
    @objc func skipToNext(_ call: CAPPluginCall) {
        let jeton = TuttiJournal.shared.debut("musickit", "skipToNext")
        Task {
            do {
                // fix/skip-sans-fuite-audio — COUPER l'ancien titre AVANT le
                // saut : si l'entrée suivante doit encore se buffériser, le
                // player continuait de jouer l'ANCIEN morceau pendant ce temps
                // (l'écran affichait déjà le nouveau → « décalage » et titre
                // révélé à l'oreille). Un blanc de quelques centaines de ms
                // est invisible ; l'ancien titre audible est inacceptable.
                self.player.pause()
                let j2 = TuttiJournal.shared.debut("musickit", "skipToNext.skipToNextEntry")
                try await self.player.skipToNextEntry()
                TuttiJournal.shared.fin("musickit", j2)
                let j3 = TuttiJournal.shared.debut("musickit", "skipToNext.play()")
                try await self.player.play()
                TuttiJournal.shared.fin("musickit", j3)
                // fix/duree-du-morceau-precedent — on le signale si rien n'a été
                // préchargé : la durée affichée resterait alors celle du titre
                // précédent, donc une barre de progression fausse sur la console
                // ET sur la TV.
                if !self.promouvoirDureeSuivante() {
                    TuttiJournal.shared.note("musickit", "saut sans préchargement — durée à confirmer", niveau: "warn")
                }
                TuttiJournal.shared.fin("musickit", jeton, ["ok": true])
                call.resolve(["ok": true])
            } catch {
                // fix/silence-apres-un-saut-rate — LA MUSIQUE REPART.
                // La lecture est coupée juste avant le saut ; si le saut
                // échoue (file vide, morceau suivant pas encore chargé, réseau
                // Apple), rien ne la relançait : silence total dans la salle
                // jusqu'à intervention de l'animateur.
                try? await self.player.play()
                TuttiJournal.shared.fin("musickit", jeton, ["erreur": error.localizedDescription])
                call.reject("Saut échoué : \(error.localizedDescription)")
            }
        }
    }

    // fix/app-entierement-gelee-au-premier-morceau — JAMAIS SUR LE FIL PRINCIPAL.
    // J'avais déplacé ces lectures sur le fil principal (build 45). Résultat
    // observé en soirée : à l'instant exact où le premier morceau démarre,
    // console ET TV se figent et plus rien ne sort de l'iPad. Mécanisme :
    // pendant que la tâche de lecture remplace la file du lecteur, MusicKit
    // tient un verrou interne et peut attendre le fil principal ; si le fil
    // principal, lui, attend ce même verrou pour lire l'état, c'est un blocage
    // mutuel — l'app entière est morte. Sur la file d'arrière-plan de
    // Capacitor, une lecture qui attend ne bloque qu'elle-même, jamais l'app.
    @objc func pause(_ call: CAPPluginCall) {
        let jeton = TuttiJournal.shared.debut("musickit", "pause")
        player.pause()
        TuttiJournal.shared.fin("musickit", jeton)
        call.resolve()
    }

    @objc func resume(_ call: CAPPluginCall) {
        let jeton = TuttiJournal.shared.debut("musickit", "resume")
        Task {
            do {
                try await player.play()
                TuttiJournal.shared.fin("musickit", jeton)
                call.resolve()
            } catch {
                TuttiJournal.shared.fin("musickit", jeton, ["erreur": error.localizedDescription])
                call.reject("Reprise échouée : \(error.localizedDescription)")
            }
        }
    }

    @objc func seek(_ call: CAPPluginCall) {
        let ms = call.getDouble("ms") ?? 0
        let jeton = TuttiJournal.shared.debut("musickit", "seek", ["ms": Int(ms)])
        player.playbackTime = max(0, ms / 1000.0)
        TuttiJournal.shared.fin("musickit", jeton)
        call.resolve()
    }

    @objc func setVolume(_ call: CAPPluginCall) {
        // ApplicationMusicPlayer suit le volume système : pas d'API de volume
        // applicatif. No-op sûr pour rester symétrique avec le hook web.
        call.resolve()
    }

    // fix/app-entierement-gelee-au-premier-morceau — LA LECTURE D'ÉTAT NE PEUT
    // PLUS BLOQUER LE PONT. Les greffons Capacitor s'exécutent sur UNE file en
    // série : si une lecture de l'état MusicKit reste suspendue (elle est
    // interrogée quatre fois par seconde, y compris pendant le remplacement
    // de la file au démarrage d'un morceau), TOUS les appels natifs suivants
    // — console et écran externe compris — attendent derrière elle. C'est
    // très probablement l'origine des « console figée au lancement » d'avant.
    // La lecture part sur sa propre file ; au-delà d'une demi-seconde on rend
    // le dernier état connu et on passe à la suite.
    private let fileLecture = DispatchQueue(label: "app.tutti.musickit.lecture")
    private var dernierEtatConnu: [String: Any] = [
        "isPlaying": false, "positionMs": 0.0, "durationMs": 0.0, "nowPlayingId": "",
    ]

    @objc func getStatus(_ call: CAPPluginCall) {
        let semaphore = DispatchSemaphore(value: 0)
        var resultat: [String: Any]?
        fileLecture.async {
            let r = self.lireEtat()
            resultat = r
            semaphore.signal()
        }
        if semaphore.wait(timeout: .now() + 0.5) == .success, let r = resultat {
            dernierEtatConnu = r
            call.resolve(r)
        } else {
            TuttiJournal.shared.note("musickit", "getStatus TROP LENT (>500 ms) — dernier état connu renvoyé", niveau: "warn")
            call.resolve(dernierEtatConnu)
        }
    }

    private func lireEtat() -> [String: Any] {
        let jeton = TuttiJournal.shared.debut("musickit", "getStatus.lecture", silencieux: true)
        defer { TuttiJournal.shared.finSiLent("musickit", jeton, seuilMs: 200) }
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
        return [
            "isPlaying": isPlaying,
            "positionMs": player.playbackTime * 1000.0,
            "durationMs": lireDureeCourante() * 1000.0,
            "nowPlayingId": nowPlayingId,
        ]
    }
}
