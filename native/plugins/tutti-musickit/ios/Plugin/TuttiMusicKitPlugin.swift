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
        guard prendreLaMain() else {
            TuttiJournal.shared.note("musickit", "play IGNORÉ — une commande est déjà en cours", ["id": catalogId], niveau: "warn")
            call.reject("Une lecture est déjà en cours de démarrage")
            return
        }
        let feuVert = peutInterrogerApple()
        guard feuVert.ok else {
            rendreLaMain()
            TuttiJournal.shared.note("musickit", "play REFUSÉ — \(feuVert.raison)", ["id": catalogId], niveau: "warn")
            call.reject("Apple Music n'est pas disponible à l'instant (\(feuVert.raison))")
            return
        }
        let jetonPlay = TuttiJournal.shared.debut("musickit", "play", ["id": catalogId, "residentMo": TuttiJournal.memoireResidenteMo()])
        Task {
            defer { self.rendreLaMain() }
            do {
                let j1 = TuttiJournal.shared.debut("musickit", "play.fetchSong")
                // RÈGLE — aucun appel Apple n'est attendu sans échéance.
                let trouve = try await self.courseAvecDelai(self.delaiCommandeApple) {
                    try await self.chercherMorceau(catalogId)
                }
                guard let song = trouve ?? nil else {
                    TuttiJournal.shared.fin("musickit", j1, ["trouve": false])
                    TuttiJournal.shared.fin("musickit", jetonPlay, ["erreur": "introuvable"])
                    call.reject("Morceau introuvable pour l'id \(catalogId)")
                    return
                }
                TuttiJournal.shared.fin("musickit", j1, ["trouve": true, "dureeS": Int(song.duration ?? 0)])
                self.ecrireDurees(courante: song.duration ?? 0, suivante: 0)

                // fix/play-qui-gele-liPad — ON NE RAPPELLE PLUS player.play()
                // SUR UNE FILE FRAÎCHEMENT REMPLACÉE.
                //
                // Journal du 09/09 19:36:46 (build 52) :
                //     ■ play.fetchSong   848 ms   trouvé
                //     ■ play.queue=        3 ms   file remplacée
                //     ▶ play.player.play()        ← AUCUNE LIGNE DE FIN
                //     FIL PRINCIPAL BLOQUÉ { play.player.play() depuis 3334 ms }
                //       … 8376 … 13418 … 23483 … 33546 … 43609 … 48640 ms
                // L'iPad entier est mort sur cet appel ; le téléphone animateur,
                // lui, continue (il parle au serveur, pas à MusicKit).
                //
                // J'avais mis `queue= + play()` quelques heures plus tôt pour
                // empêcher l'empilement de copies. C'était un mauvais échange :
                // `insert + skipToNextEntry` est mesuré entre 0 et 9 ms et n'a
                // JAMAIS bloqué — y compris ce même soir à 18:53 et 18:54 —
                // parce que `skipToNextEntry` démarre lui-même la lecture sur
                // un lecteur déjà vivant, alors que `play()` sur un lecteur
                // arrêté attend Apple en tenant le fil principal.
                //
                // L'empilement est traité autrement, sans toucher à ce chemin :
                //   - on n'insère pas une copie d'un morceau déjà dans la file ;
                //   - les relances de la console sont espacées de 5 s ;
                //   - la lecture est vérifiée avant d'annoncer « ça joue ».
                //
                // Reste le tout premier morceau d'une session : le lecteur n'a
                // pas de file, il n'y a rien à quoi s'accrocher, `queue= +
                // play()` est inévitable. C'est le seul moment de risque, une
                // fois par soirée, et il est signalé comme tel dans le journal.
                var demarre: Bool? = false
                let fileVide = self.player.queue.entries.isEmpty
                if fileVide {
                    TuttiJournal.shared.note("musickit", "premier morceau de la session — passage obligé par queue= + play()", ["id": catalogId], niveau: "warn")
                    let j2 = TuttiJournal.shared.debut("musickit", "play.queue=")
                    let remplace = try await self.courseAvecDelai(self.delaiCommandeApple) {
                        self.player.queue = [song]
                        return true
                    }
                    TuttiJournal.shared.fin("musickit", j2, ["remplace": remplace == true])
                    if remplace == true {
                        let j3 = TuttiJournal.shared.debut("musickit", "play.player.play()")
                        demarre = try await self.courseAvecDelai(self.delaiCommandeApple) {
                            try await self.player.play()
                            return true
                        }
                        TuttiJournal.shared.fin("musickit", j3, ["demarre": demarre == true])
                    }
                } else {
                    // Chemin normal : jamais bloqué en six soirées de journaux.
                    if self.fileContient(catalogId) {
                        TuttiJournal.shared.note("musickit", "déjà dans la file — pas de copie supplémentaire", ["id": catalogId])
                    } else {
                        let j2 = TuttiJournal.shared.debut("musickit", "play.insert")
                        let insere = try await self.courseAvecDelai(self.delaiCommandeApple) {
                            try await self.player.queue.insert(song, position: .afterCurrentEntry)
                            return true
                        }
                        TuttiJournal.shared.fin("musickit", j2, ["insere": insere == true])
                    }
                    let j3 = TuttiJournal.shared.debut("musickit", "play.skip")
                    demarre = try await self.courseAvecDelai(self.delaiCommandeApple) {
                        try await self.player.skipToNextEntry()
                        try await self.player.play()
                        return true
                    }
                    TuttiJournal.shared.fin("musickit", j3, ["demarre": demarre == true])
                }
                guard demarre == true else {
                    // Apple n'a pas démarré dans le délai : on le DIT au lieu de
                    // laisser la salle devant un écran mort.
                    TuttiJournal.shared.note(
                        "musickit",
                        "APPLE NE DÉMARRE PAS — abandon après \(Int(self.delaiCommandeApple)) s",
                        ["id": catalogId],
                        niveau: "error"
                    )
                    self.noterEtat(enLecture: false, position: 0, nowPlayingId: catalogId, confirme: true)
                    TuttiJournal.shared.fin("musickit", jetonPlay, ["erreur": "apple-ne-demarre-pas"])
                    call.reject("Apple Music n'a pas démarré (réseau ?) — réessaie ou passe sur YouTube")
                    return
                }
                // La fiche connaît le morceau COMMANDÉ dès maintenant : pendant
                // le délai de grâce, une lecture d'état qui annoncerait encore
                // l'ancien titre ne l'écrasera pas (cf. rafraichirEnFond).
                self.noterEtat(enLecture: true, position: 0, nowPlayingId: catalogId, confirme: true, commande: true)
                // VÉRIFICATION — on ne dit « ça joue » qu'après l'avoir vu.
                let j4 = TuttiJournal.shared.debut("musickit", "play.verif")
                let verif = await self.attendreEntreeCourante(catalogId, delaiSec: 3.0)
                TuttiJournal.shared.fin("musickit", j4, ["vu": verif.vu, "apresMs": verif.apresMs, "annonce": verif.annonce])
                if verif.vu {
                    self.noterEtat(enLecture: true, position: self.player.playbackTime, nowPlayingId: catalogId, confirme: true)
                } else {
                    TuttiJournal.shared.note(
                        "musickit",
                        "LECTURE NON VÉRIFIÉE — Apple n'annonce pas le morceau demandé",
                        ["attendu": catalogId, "annonce": verif.annonce],
                        niveau: "warn"
                    )
                }
                TuttiJournal.shared.fin("musickit", jetonPlay, ["ok": true, "verifie": verif.vu])
                call.resolve(["ok": true, "verifie": verif.vu])
            } catch {
                // fix/fiche-menteuse-apres-echec — LA FICHE DIT LA VÉRITÉ MÊME
                // QUAND ÇA RATE. Sans ça, après un échec de lecture la fiche
                // annonçait encore « en lecture » avec l'ANCIEN identifiant :
                // la console voyait l'ancien titre, relançait, échouait, et
                // recommençait chaque seconde — boucle sans fin, écran figé.
                // Le chemin « Apple ne démarre pas » juste au-dessus le faisait
                // déjà ; celui-ci l'oubliait.
                self.noterEtat(enLecture: false, position: 0, nowPlayingId: "", confirme: true, commande: true)
                self.noterPauseApresErreur()
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
        let feuVertPrechargement = peutInterrogerApple()
        guard feuVertPrechargement.ok else {
            TuttiJournal.shared.note("musickit", "queueNext REFUSÉ — \(feuVertPrechargement.raison)", ["id": catalogId], niveau: "warn")
            call.reject("Préchargement reporté (\(feuVertPrechargement.raison))")
            return
        }
        let jeton = TuttiJournal.shared.debut("musickit", "queueNext", ["id": catalogId])
        Task {
            do {
                let trouve = try await self.courseAvecDelai(self.delaiCommandeApple) {
                    try await self.chercherMorceau(catalogId)
                }
                guard let song = trouve ?? nil else {
                    TuttiJournal.shared.fin("musickit", jeton, ["erreur": "introuvable"])
                    call.reject("Morceau introuvable pour l'id \(catalogId)")
                    return
                }
                // fix/meme-morceau-en-boucle — jamais deux fois le même morceau
                // dans la file : un préchargement répété (relance de la console)
                // le rejouerait à la suite.
                if self.fileContient(catalogId) {
                    TuttiJournal.shared.note("musickit", "préchargement ignoré — déjà dans la file", ["id": catalogId])
                    self.ecrireDurees(courante: nil, suivante: song.duration ?? 0)
                    TuttiJournal.shared.fin("musickit", jeton, ["ok": true, "dejaLa": true])
                    call.resolve(["ok": true])
                    return
                }
                let j2 = TuttiJournal.shared.debut("musickit", "queueNext.insert")
                let insere = try await self.courseAvecDelai(self.delaiCommandeApple) {
                    try await self.player.queue.insert(song, position: .tail)
                    return true
                }
                TuttiJournal.shared.fin("musickit", j2, ["insere": insere == true])
                guard insere == true else {
                    TuttiJournal.shared.note("musickit", "PRÉCHARGEMENT ABANDONNÉ — Apple n'a pas répondu", ["id": catalogId], niveau: "warn")
                    TuttiJournal.shared.fin("musickit", jeton, ["erreur": "preload-abandonne"])
                    call.reject("Préchargement abandonné (Apple ne répond pas)")
                    return
                }
                self.ecrireDurees(courante: nil, suivante: song.duration ?? 0)
                TuttiJournal.shared.fin("musickit", jeton, ["ok": true])
                call.resolve(["ok": true])
            } catch {
                self.noterPauseApresErreur()
                TuttiJournal.shared.fin("musickit", jeton, ["erreur": error.localizedDescription])
                call.reject("File d'attente échouée : \(error.localizedDescription)")
            }
        }
    }

    /** feat/next-track-preload — saute sur le morceau préchargé (instantané). */
    @objc func skipToNext(_ call: CAPPluginCall) {
        // fix/meme-morceau-en-boucle — le saut est VÉRIFIÉ contre le morceau
        // attendu par la console. S'il tombe sur autre chose (copie résiduelle,
        // entrée qui n'a pas encore basculé), on se replie sur une lecture
        // directe du bon morceau au lieu de laisser jouer n'importe quoi.
        let attendu = call.getString("expectedId") ?? ""
        guard prendreLaMain() else {
            TuttiJournal.shared.note("musickit", "skipToNext IGNORÉ — une commande est déjà en cours", ["attendu": attendu], niveau: "warn")
            call.reject("Une lecture est déjà en cours de démarrage")
            return
        }
        let jeton = TuttiJournal.shared.debut("musickit", "skipToNext", ["attendu": attendu])
        Task {
            defer { self.rendreLaMain() }
            do {
                // fix/skip-sans-fuite-audio — COUPER l'ancien titre AVANT le
                // saut : si l'entrée suivante doit encore se buffériser, le
                // player continuait de jouer l'ANCIEN morceau pendant ce temps
                // (l'écran affichait déjà le nouveau → « décalage » et titre
                // révélé à l'oreille). Un blanc de quelques centaines de ms
                // est invisible ; l'ancien titre audible est inacceptable.
                self.player.pause()
                let j2 = TuttiJournal.shared.debut("musickit", "skipToNext.skipToNextEntry")
                let saute = try await self.courseAvecDelai(self.delaiCommandeApple) {
                    try await self.player.skipToNextEntry()
                    return true
                }
                TuttiJournal.shared.fin("musickit", j2, ["saute": saute == true])
                guard saute == true else {
                    TuttiJournal.shared.note("musickit", "APPLE NE SAUTE PAS — abandon", niveau: "error")
                    TuttiJournal.shared.fin("musickit", jeton, ["erreur": "apple-ne-saute-pas"])
                    call.reject("Apple Music n'a pas changé de morceau — réessaie")
                    return
                }
                let j3 = TuttiJournal.shared.debut("musickit", "skipToNext.play()")
                let demarre = try await self.courseAvecDelai(self.delaiCommandeApple) {
                    try await self.player.play()
                    return true
                }
                TuttiJournal.shared.fin("musickit", j3, ["demarre": demarre == true])
                if !attendu.isEmpty {
                    self.noterEtat(enLecture: true, position: 0, nowPlayingId: attendu, confirme: true, commande: true)
                    let j4 = TuttiJournal.shared.debut("musickit", "skipToNext.verif")
                    let verif = await self.attendreEntreeCourante(attendu, delaiSec: 1.5)
                    TuttiJournal.shared.fin("musickit", j4, ["vu": verif.vu, "apresMs": verif.apresMs, "annonce": verif.annonce])
                    if !verif.vu {
                        TuttiJournal.shared.note(
                            "musickit",
                            "SAUT VERS LE MAUVAIS MORCEAU — repli sur une lecture directe",
                            ["attendu": attendu, "annonce": verif.annonce],
                            niveau: "warn"
                        )
                        let repli = try await self.lireDirectement(attendu)
                        if !self.promouvoirDureeSuivante() {
                            TuttiJournal.shared.note("musickit", "saut sans préchargement — durée à confirmer", niveau: "warn")
                        }
                        TuttiJournal.shared.fin("musickit", jeton, ["ok": repli.ok, "verifie": repli.verifie, "repli": true])
                        if repli.ok {
                            call.resolve(["ok": true, "verifie": repli.verifie, "repli": true])
                        } else {
                            call.reject("Apple Music n'a pas démarré le morceau attendu")
                        }
                        return
                    }
                    self.noterEtat(enLecture: true, position: self.player.playbackTime, nowPlayingId: attendu, confirme: true)
                } else {
                    // fix/ecran-fige-sur-apple-music — nouveau morceau : la fiche repart à zéro.
                    self.noterEtat(enLecture: true, position: 0, confirme: true)
                }
                // fix/duree-du-morceau-precedent — on le signale si rien n'a été
                // préchargé : la durée affichée resterait alors celle du titre
                // précédent, donc une barre de progression fausse sur la console
                // ET sur la TV.
                if !self.promouvoirDureeSuivante() {
                    TuttiJournal.shared.note("musickit", "saut sans préchargement — durée à confirmer", niveau: "warn")
                }
                TuttiJournal.shared.fin("musickit", jeton, ["ok": true])
                call.resolve(["ok": true, "verifie": !attendu.isEmpty])
            } catch {
                // fix/silence-apres-un-saut-rate — LA MUSIQUE REPART.
                // La lecture est coupée juste avant le saut ; si le saut
                // échoue (file vide, morceau suivant pas encore chargé, réseau
                // Apple), rien ne la relançait : silence total dans la salle
                // jusqu'à intervention de l'animateur.
                _ = try? await self.courseAvecDelai(self.delaiCommandeApple) {
                    try await self.player.play()
                    return true
                }
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
        noterEtat(enLecture: false, position: nil, confirme: true)
        TuttiJournal.shared.fin("musickit", jeton)
        call.resolve()
    }

    @objc func resume(_ call: CAPPluginCall) {
        let jeton = TuttiJournal.shared.debut("musickit", "resume")
        Task {
            do {
                let demarre = try await self.courseAvecDelai(self.delaiCommandeApple) {
                    try await self.player.play()
                    return true
                }
                guard demarre == true else {
                    TuttiJournal.shared.note("musickit", "APPLE NE REPREND PAS — abandon", niveau: "error")
                    self.noterEtat(enLecture: false, position: nil, confirme: true)
                    TuttiJournal.shared.fin("musickit", jeton, ["erreur": "apple-ne-reprend-pas"])
                    call.reject("Apple Music n'a pas repris — réessaie ou passe sur YouTube")
                    return
                }
                self.noterEtat(enLecture: true, position: nil, confirme: true)
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
        noterEtat(enLecture: nil, position: max(0, ms / 1000.0), confirme: true)
        TuttiJournal.shared.fin("musickit", jeton)
        call.resolve()
    }

    @objc func setVolume(_ call: CAPPluginCall) {
        // ApplicationMusicPlayer suit le volume système : pas d'API de volume
        // applicatif. No-op sûr pour rester symétrique avec le hook web.
        call.resolve()
    }

    // fix/ecran-fige-sur-apple-music — ON N'ATTEND PLUS JAMAIS APPLE.
    //
    // Constaté en direct le 04/09 (journal natif, playlist Britpop 90) :
    //   11:10:52  getStatus TROP LENT (>500 ms) — répété toutes les 500 ms
    //   11:10:55  getStatus.lecture LENT { dureeMs: 4039 }
    //   11:10:57  FIL PRINCIPAL BLOQUÉ { operationsEnCours:
    //               ["getStatus.lecture depuis 1728 ms"] }
    //   … et le fil principal est resté bloqué plus de 57 secondes.
    //
    // Mécanisme : la console demande l'état quatre fois par seconde et
    // l'ancienne implémentation INTERROGEAIT ApplicationMusicPlayer à chaque
    // fois. Ces propriétés ne répondent que depuis le fil principal ; quand
    // MusicKit tarde, la lecture prend ce fil en otage et l'écran gèle. Le
    // délai de garde d'une demi-seconde protégeait l'appelant mais n'annulait
    // pas la lecture : elle continuait de tenir le verrou, et les demandes
    // suivantes s'empilaient derrière elle sur une file en série.
    //
    // Désormais le greffon tient une FICHE D'ÉTAT toujours disponible :
    //   - les commandes que NOUS passons (play, pause, resume, seek, saut) la
    //     mettent à jour immédiatement — aucune question à poser à Apple ;
    //   - entre deux, la position avance à l'horloge (départ + temps écoulé) ;
    //   - un rafraîchissement part vers Apple SANS ATTENDRE, un seul à la fois.
    //     S'il répond, la fiche est recalée au millième près ; s'il ne répond
    //     pas, l'app continue sur l'horloge au lieu de se figer.
    // Aucune attente nulle part : plus rien ne peut prendre le fil principal.
    private let fileLecture = DispatchQueue(label: "app.tutti.musickit.lecture")
    private let verrouFiche = NSLock()
    private var ficheEnLecture = false
    private var fichePositionSec: Double = 0
    /// Instant (horloge monotone) auquel `fichePositionSec` a été posée.
    private var ficheAncreeA: Double = ProcessInfo.processInfo.systemUptime
    private var ficheNowPlayingId = ""
    /// Dernier instant où Apple a réellement confirmé la fiche.
    private var ficheConfirmeeA: Double = 0
    /// Un rafraîchissement au plus en vol : sans ce garde-fou, quatre demandes
    /// par seconde s'empilaient sur une file en série derrière une lecture
    /// suspendue.
    private var rafraichissementEnVol = false
    /// Au-delà de ce délai sans confirmation d'Apple, on le signale une fois.
    private let seuilNonConfirmeSec: Double = 3.0
    private var nonConfirmeSignale = false

    private func maintenant() -> Double { ProcessInfo.processInfo.systemUptime }

    /// Dernier morceau connu du lecteur (fiche), sans rien demander à Apple.
    private func nowPlayingIdConnu() -> String {
        verrouFiche.lock(); defer { verrouFiche.unlock() }
        return ficheNowPlayingId
    }

    // fix/play-qui-ne-rend-jamais-la-main — AUCUNE COMMANDE APPLE N'EST ATTENDUE
    // SANS LIMITE.
    //
    // Journal du 04/09 13:31 (build 48, correctif getStatus déjà en place) :
    //   ▶ play.fetchSong          → trouvé en 2514 ms (déjà anormalement lent)
    //   ▶ play.player.play()      → ne se termine JAMAIS
    //   FIL PRINCIPAL BLOQUÉ { play.player.play() depuis 27073 ms }
    // Ce n'est plus la lecture d'état : c'est la commande « joue » elle-même
    // qui reste suspendue — MusicKit attend Apple (réseau du bar) en tenant le
    // fil qui dessine l'écran. Tant qu'on l'attend, l'app est morte.
    //
    // `courseAvecDelai` laisse la commande partir mais rend la main au bout de
    // `delaiSec`. L'appelant peut alors se replier proprement (message à la
    // console, bascule de source) au lieu de figer la salle.
    private func courseAvecDelai<T: Sendable>(
        _ delaiSec: Double,
        _ operation: @escaping @Sendable () async throws -> T
    ) async throws -> T? {
        try await withThrowingTaskGroup(of: T?.self) { groupe in
            groupe.addTask { try await operation() }
            groupe.addTask {
                try? await Task.sleep(nanoseconds: UInt64(delaiSec * 1_000_000_000))
                return nil
            }
            let premier = try await groupe.next() ?? nil
            groupe.cancelAll()
            return premier
        }
    }

    /// Délai au-delà duquel on considère qu'Apple ne démarrera pas.
    private let delaiCommandeApple: Double = 6.0

    // fix/deux-play-en-meme-temps — UNE SEULE COMMANDE APPLE À LA FOIS.
    // Journal du 04/09 20:49 : deux `play` en vol simultanément
    //   operationsEnCours: ["play depuis 2265 ms", "play depuis 3491 ms",
    //                       "play.prepareToPlay depuis 2221 ms", "… 3365 ms"]
    // Deux remplacements de file concurrents sur ApplicationMusicPlayer est le
    // scénario d'interblocage le plus évident. On refuse le second au lieu de
    // le lancer par-dessus le premier.
    private let verrouCommande = NSLock()
    private var commandeEnCours = false
    private func prendreLaMain() -> Bool {
        verrouCommande.lock(); defer { verrouCommande.unlock() }
        if commandeEnCours { return false }
        commandeEnCours = true
        return true
    }
    private func rendreLaMain() {
        verrouCommande.lock(); defer { verrouCommande.unlock() }
        commandeEnCours = false
    }

    // fix/fetchsong-zombies — LE DÉLAI DE GARDE NE TUE PAS LA REQUÊTE.
    //
    // Journal du 05/09 22:48 : le fil principal bloqué 6 min 25, avec une pile
    // de play.fetchSong « depuis 5 610 882 ms » — 93 minutes d'appels jamais
    // revenus, empilés les uns sur les autres.
    // Mécanisme : courseAvecDelai rend la main à l'appelant au bout de 6 s,
    // mais la requête Apple, elle, continue de vivre (l'annulation en Swift
    // est cooperative, MusicKit ne l'honore pas). Chaque tentative en laissait
    // donc une derriere elle. Au bout d'une centaine, l'app etouffe.
    //
    // Deux garde-fous, cette fois sur ce qui est REELLEMENT en vol :
    //   - on refuse toute nouvelle recherche tant qu'une precedente n'est pas
    //     revenue (compteur decremente DANS la requete, pas dans la course) ;
    //   - apres une erreur Apple, on observe une pause avant de reessayer,
    //     au lieu de marteler.
    private let verrouVol = NSLock()
    /// Instants de départ des recherches Apple réellement en vol.
    private var recherchesEnVolDepuis: [Double] = []
    private var pauseJusqua: Double = 0
    private let pauseApresErreurSec: Double = 8.0

    // fix/play-refuse-a-cause-du-prechargement — Journal du 09/09 18:54 :
    //   play REFUSÉ — une recherche precedente n'est toujours pas revenue (1 en vol)
    // La « recherche précédente » était le PRÉCHARGEMENT du titre suivant,
    // parti 6 ms plus tôt et revenu 200 ms plus tard. Refuser un démarrage
    // pour ça, c'est un morceau qui ne part pas et une console qui relance.
    // On ne refuse désormais que si une recherche est réellement BLOQUÉE :
    // plus vieille que le délai de garde, donc jamais revenue.
    private func peutInterrogerApple() -> (ok: Bool, raison: String) {
        verrouVol.lock(); defer { verrouVol.unlock() }
        let maintenant = ProcessInfo.processInfo.systemUptime
        let bloquees = recherchesEnVolDepuis.filter { maintenant - $0 > delaiCommandeApple }
        if !bloquees.isEmpty {
            let plusVieille = Int(maintenant - bloquees.min()!)
            return (false, "\(bloquees.count) recherche(s) Apple bloquee(s), la plus vieille depuis \(plusVieille) s")
        }
        let reste = pauseJusqua - ProcessInfo.processInfo.systemUptime
        if reste > 0 {
            return (false, "pause apres erreur Apple, encore \(Int(reste)) s")
        }
        return (true, "")
    }

    private func noterPauseApresErreur() {
        verrouVol.lock(); defer { verrouVol.unlock() }
        pauseJusqua = ProcessInfo.processInfo.systemUptime + pauseApresErreurSec
    }

    /// fetchSong instrumente : le compteur suit la requete REELLE, pas la course.
    private func chercherMorceau(_ catalogId: String) async throws -> Song? {
        let depart = ProcessInfo.processInfo.systemUptime
        verrouVol.lock(); recherchesEnVolDepuis.append(depart); verrouVol.unlock()
        defer {
            verrouVol.lock()
            if let i = recherchesEnVolDepuis.firstIndex(of: depart) { recherchesEnVolDepuis.remove(at: i) }
            verrouVol.unlock()
        }
        return try await fetchSong(catalogId)
    }

    // MARK: - Vérification de ce que joue réellement Apple

    /// Identifiant du morceau que le lecteur annonce comme entrée courante.
    /// Lecture d'arrière-plan uniquement (jamais sur le fil principal, cf. build 45).
    private func idEntreeCourante() -> String {
        if let entry = player.queue.currentEntry, let item = entry.item, case let .song(song) = item {
            return song.id.rawValue
        }
        return ""
    }

    /// Vrai si la file contient déjà ce morceau (entrée courante comprise).
    private func fileContient(_ catalogId: String) -> Bool {
        for entry in player.queue.entries {
            if let item = entry.item, case let .song(song) = item, song.id.rawValue == catalogId {
                return true
            }
        }
        return false
    }

    /// Attend (au plus `delaiSec`) que le lecteur annonce `catalogId` comme
    /// entrée courante. Sondage toutes les 150 ms, en arrière-plan.
    private func attendreEntreeCourante(_ catalogId: String, delaiSec: Double) async -> (vu: Bool, apresMs: Int, annonce: String) {
        let debut = maintenant()
        var dernier = ""
        while maintenant() - debut < delaiSec {
            dernier = idEntreeCourante()
            if dernier == catalogId {
                return (true, Int((maintenant() - debut) * 1000), dernier)
            }
            try? await Task.sleep(nanoseconds: 150_000_000)
        }
        return (false, Int(delaiSec * 1000), dernier)
    }

    /// Repli : file remplacée par ce seul morceau, lecture, vérification.
    /// Utilisé quand un saut est tombé sur autre chose que le titre attendu.
    private func lireDirectement(_ catalogId: String) async throws -> (ok: Bool, verifie: Bool) {
        let j1 = TuttiJournal.shared.debut("musickit", "repli.fetchSong", ["id": catalogId])
        let trouve = try await courseAvecDelai(delaiCommandeApple) {
            try await self.chercherMorceau(catalogId)
        }
        guard let song = trouve ?? nil else {
            TuttiJournal.shared.fin("musickit", j1, ["trouve": false])
            return (false, false)
        }
        TuttiJournal.shared.fin("musickit", j1, ["trouve": true])
        ecrireDurees(courante: song.duration ?? 0, suivante: 0)
        // Même règle que play : insert + skip sur un lecteur vivant, queue= +
        // play() seulement si la file est vide (cf. fix/play-qui-gele-liPad).
        let j2 = TuttiJournal.shared.debut("musickit", "repli.lecture")
        let demarre = try await courseAvecDelai(delaiCommandeApple) {
            if self.player.queue.entries.isEmpty {
                self.player.queue = [song]
                try await self.player.play()
            } else {
                if !self.fileContient(catalogId) {
                    try await self.player.queue.insert(song, position: .afterCurrentEntry)
                }
                try await self.player.skipToNextEntry()
                try await self.player.play()
            }
            return true
        }
        TuttiJournal.shared.fin("musickit", j2, ["demarre": demarre == true])
        guard demarre == true else { return (false, false) }
        noterEtat(enLecture: true, position: 0, nowPlayingId: catalogId, confirme: true, commande: true)
        let verif = await attendreEntreeCourante(catalogId, delaiSec: 3.0)
        TuttiJournal.shared.note("musickit", "repli.verif", ["vu": verif.vu, "apresMs": verif.apresMs, "annonce": verif.annonce])
        if verif.vu {
            noterEtat(enLecture: true, position: player.playbackTime, nowPlayingId: catalogId, confirme: true)
        }
        return (true, verif.vu)
    }

    /// Position extrapolée à l'horloge depuis le dernier point d'ancrage.
    private func positionCouranteSec() -> Double {
        guard ficheEnLecture else { return fichePositionSec }
        return fichePositionSec + max(0, maintenant() - ficheAncreeA)
    }

    /// Met la fiche à jour depuis une commande que nous venons de passer.
    /// `position` en secondes ; `nil` = on garde la position extrapolée.
    /// Morceau demandé par la dernière commande (play / skip vérifié) et instant.
    private var ficheCommandeeId = ""
    private var ficheCommandeeA: Double = 0
    private var ecartSignale = false
    /// Pendant ce délai après une commande, une lecture d'état qui annonce un
    /// AUTRE morceau est considérée comme périmée (file pas encore basculée).
    private let delaiGraceCommandeSec: Double = 4.0

    private func noterEtat(enLecture: Bool?, position: Double?, nowPlayingId: String? = nil, confirme: Bool = false, commande: Bool = false) {
        verrouFiche.lock()
        defer { verrouFiche.unlock() }
        let pos = position ?? positionCouranteSec()
        if let enLecture { ficheEnLecture = enLecture }
        fichePositionSec = pos
        ficheAncreeA = maintenant()
        if let nowPlayingId { ficheNowPlayingId = nowPlayingId }
        if commande, let nowPlayingId {
            ficheCommandeeId = nowPlayingId
            ficheCommandeeA = maintenant()
            ecartSignale = false
        }
        if confirme {
            ficheConfirmeeA = maintenant()
            nonConfirmeSignale = false
        }
    }

    /// Demande l'état réel à Apple SANS L'ATTENDRE. Un seul appel en vol.
    private func rafraichirEnFond() {
        verrouFiche.lock()
        if rafraichissementEnVol {
            verrouFiche.unlock()
            return
        }
        rafraichissementEnVol = true
        verrouFiche.unlock()
        fileLecture.async { [weak self] in
            guard let self else { return }
            let etat = self.lireEtat()
            var ecartASignaler: (attendu: String, annonce: String, depuisMs: Int)? = nil
            self.verrouFiche.lock()
            self.ficheEnLecture = etat.enLecture
            self.fichePositionSec = etat.positionSec
            self.ficheAncreeA = self.maintenant()
            if !etat.nowPlayingId.isEmpty {
                // fix/meme-morceau-en-boucle — Journal du 09/09 18:53 : à +1 s la
                // fiche disait le bon titre, à +3 s l'ANCIEN (800157892) — la
                // lecture d'état écrasait le morceau commandé avec une entrée
                // courante pas encore basculée, et la console relançait.
                // Dans le délai de grâce, le morceau commandé fait foi.
                let depuisCommande = self.maintenant() - self.ficheCommandeeA
                let commandeRecente = !self.ficheCommandeeId.isEmpty && depuisCommande < self.delaiGraceCommandeSec
                if commandeRecente && etat.nowPlayingId != self.ficheCommandeeId {
                    if !self.ecartSignale {
                        self.ecartSignale = true
                        ecartASignaler = (self.ficheCommandeeId, etat.nowPlayingId, Int(depuisCommande * 1000))
                    }
                } else {
                    self.ficheNowPlayingId = etat.nowPlayingId
                }
            }
            self.ficheConfirmeeA = self.maintenant()
            self.nonConfirmeSignale = false
            self.rafraichissementEnVol = false
            self.verrouFiche.unlock()
            if let e = ecartASignaler {
                TuttiJournal.shared.note(
                    "musickit",
                    "Apple annonce encore un autre titre après la commande — fiche tenue au morceau commandé",
                    ["attendu": e.attendu, "annonce": e.annonce, "depuisMs": e.depuisMs],
                    niveau: "warn"
                )
            }
        }
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        // Réponse immédiate, prise sur la fiche. Aucune attente.
        verrouFiche.lock()
        let enLecture = ficheEnLecture
        let positionSec = positionCouranteSec()
        let nowPlayingId = ficheNowPlayingId
        let confirmeeA = ficheConfirmeeA
        let dejaSignale = nonConfirmeSignale
        let depuis = confirmeeA == 0 ? 0 : maintenant() - confirmeeA
        if depuis > seuilNonConfirmeSec && !dejaSignale { nonConfirmeSignale = true }
        verrouFiche.unlock()

        if depuis > seuilNonConfirmeSec && !dejaSignale {
            // La console allume « Relancer le son » sur ce drapeau : l'animateur
            // voit que l'état n'est plus confirmé, au lieu d'un écran figé.
            TuttiJournal.shared.note(
                "musickit",
                "état Apple non confirmé depuis \(Int(depuis)) s — position tenue à l'horloge",
                ["depuisS": Int(depuis)],
                niveau: "warn"
            )
        }

        call.resolve([
            "isPlaying": enLecture,
            "positionMs": positionSec * 1000.0,
            "durationMs": lireDureeCourante() * 1000.0,
            "nowPlayingId": nowPlayingId,
            "confirme": depuis <= seuilNonConfirmeSec,
        ])

        // Et on relance une confirmation en tâche de fond, sans l'attendre.
        rafraichirEnFond()
    }

    private struct EtatLu {
        let enLecture: Bool
        let positionSec: Double
        let nowPlayingId: String
    }

    /// Lecture réelle auprès d'Apple. N'est appelée QUE depuis `rafraichirEnFond`,
    /// jamais depuis un chemin qui attend le résultat.
    private func lireEtat() -> EtatLu {
        let jeton = TuttiJournal.shared.debut("musickit", "getStatus.lecture", silencieux: true)
        defer { TuttiJournal.shared.finSiLent("musickit", jeton, seuilMs: 200) }
        let enLecture = player.state.playbackStatus == .playing
        // fix/live-sync-check — identité du morceau RÉELLEMENT en lecture.
        // La console la compare en continu au morceau attendu par le jeu :
        // divergence = resynchronisation automatique.
        var nowPlayingId = ""
        if let entry = player.queue.currentEntry, let item = entry.item {
            if case let .song(song) = item {
                nowPlayingId = song.id.rawValue
            }
        }
        return EtatLu(enLecture: enLecture, positionSec: player.playbackTime, nowPlayingId: nowPlayingId)
    }
}
