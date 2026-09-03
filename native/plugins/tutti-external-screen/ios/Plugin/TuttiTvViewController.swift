import UIKit
import CoreImage

/**
 * TuttiTvViewController — ÉCRAN JOUEUR NATIF, RÉPLIQUE DE L'ÉCRAN ACTUEL.
 *
 * Reproduit `frontend/src/pages/screen/TvScreenView.tsx` : même structure
 * (bandeau haut, scène centrale, colonne classement + QR), mêmes couleurs,
 * mêmes polices (Caprasimo / Fraunces / Outfit / JetBrains Mono embarquées),
 * mêmes proportions. Aucun élément n'est redessiné à ma façon.
 *
 * Deux gains, impossibles avec la WebView :
 *
 *  1. AUCUN GEL. Plus de navigateur sur la TV : iOS n'a plus de processus web
 *     à tuer sous pression mémoire. C'était la cause des écrans figés.
 *
 *  2. AUCUN DÉCALAGE SON / IMAGE. La console pousse ici, sans réseau, le
 *     morceau RÉELLEMENT joué par le lecteur (`updatePlayback`). Tant que le
 *     lecteur n'a pas confirmé, la TV NE BASCULE PAS : elle ne peut donc
 *     jamais afficher un titre que la salle n'entend pas encore.
 */
final class TuttiTvViewController: UIViewController {

    // MARK: - État

    private var poller: TuttiTvPoller?
    private var state: TvScreenState?
    private var playback = TvPlayback()
    private var audioTrackId = ""
    private var displayedTrack: TvTrack?
    private var tickTimer: Timer?
    private let coverCache = NSCache<NSString, UIImage>()
    private var blurredCache = NSCache<NSString, UIImage>()

    // MARK: - Vues (fond)

    private let backdropView = UIImageView()
    private let scrimLayer = CAGradientLayer()
    private let coralGlow = UIView()

    // MARK: - Vues (bandeau haut)

    private let brandLabel = UILabel()
    private let brandDot = UIView()
    private let roundPill = PaddedLabel()
    private let trackCounter = UILabel()
    private let playlistName = UILabel()
    private let phasePill = PaddedLabel()

    // MARK: - Vues (scène centrale)

    private let buzzChip = PaddedLabel()
    private let mysteryCover = UIImageView()
    private let mysteryGlow = UIView()
    private let mysteryMark = UILabel()
    private let timerLabel = UILabel()
    private let timerRing = CoralRingView()
    private let timerSub = UILabel()
    private let equalizer = EqualizerView()
    private let listenLabel = UILabel()
    private let listenTrack = UIView()
    private let listenFill = UIView()
    private let revealCover = UIImageView()
    private let revealGlow = UIView()
    private let revealPill = PaddedLabel()
    private let revealTitle = UILabel()
    private let revealArtist = UILabel()
    private let revealMeta = UILabel()
    private let centerMessage = UILabel()
    private let centerSub = UILabel()

    // MARK: - Vues (colonne latérale)

    private let boardPanel = UIView()
    private let boardIcon = UILabel()
    private let boardTitle = UILabel()
    private let boardEmpty = UILabel()
    private var boardRows: [LeaderRowView] = []
    private let qrPanel = UIView()
    private let qrWhite = UIView()
    private let qrImage = UIImageView()
    private let qrLabel = UILabel()
    private let qrCode = UILabel()
    private let qrHint = UILabel()

    // MARK: - Pause

    private let pauseOverlay = UIView()
    private let pausePanel = UIView()
    private let pauseIcon = UILabel()
    private let pauseTitle = UILabel()
    private let pauseHint = UILabel()

    // MARK: - Cycle de vie

    init(apiBase: String, workspaceId: String) {
        super.init(nibName: nil, bundle: nil)
        poller = TuttiTvPoller(apiBase: apiBase, workspaceId: workspaceId) { [weak self] newState in
            self?.apply(newState)
        }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) non supporté") }

    override func viewDidLoad() {
        super.viewDidLoad()
        TvTheme.registerBundledFonts()
        view.backgroundColor = TvTheme.background
        buildViews()
        poller?.start()
        let t = Timer(timeInterval: 0.1, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(t, forMode: .common)
        tickTimer = t
    }

    deinit {
        tickTimer?.invalidate()
        poller?.stop()
    }

    // MARK: - Entrée depuis le plugin

    func updatePlayback(trackId: String, positionMs: Double, durationMs: Double, isPaused: Bool) {
        // fix/fil-principal — appelé 5×/s par la console. On ne reconstruit la
        // vue QUE si le morceau confirmé change ; sinon on met à jour les
        // nombres et la barre de progression se recale toute seule au tick.
        let trackChanged = trackId != audioTrackId
        audioTrackId = trackId
        playback.positionMs = positionMs
        playback.durationMs = durationMs
        playback.isPaused = isPaused
        playback.receivedAt = Date().timeIntervalSince1970
        if trackChanged { reconcileDisplayedTrack() }
    }

    // MARK: - Construction

    private func buildViews() {
        // Fond : pochette floutée plein cadre + voile dégradé (comme le web).
        backdropView.contentMode = .scaleAspectFill
        backdropView.clipsToBounds = true
        view.addSubview(backdropView)

        scrimLayer.colors = [
            UIColor(white: 0, alpha: 0.55).cgColor,
            UIColor(white: 0, alpha: 0.35).cgColor,
            UIColor(white: 0, alpha: 0.80).cgColor,
        ]
        scrimLayer.locations = [0, 0.5, 1]
        view.layer.addSublayer(scrimLayer)

        coralGlow.backgroundColor = TvTheme.coral(0.16)
        coralGlow.isUserInteractionEnabled = false
        view.addSubview(coralGlow)

        // ── Bandeau haut ────────────────────────────────────────────────
        brandLabel.text = "Tutti"
        brandLabel.font = TvTheme.display(32)
        brandLabel.textColor = .white
        brandDot.backgroundColor = TvTheme.coral
        brandDot.layer.cornerRadius = 5

        roundPill.textColor = TvTheme.white(0.55)
        roundPill.font = TvTheme.mono(11)
        roundPill.insets = UIEdgeInsets(top: 6, left: 14, bottom: 6, right: 14)
        roundPill.layer.cornerRadius = 14
        roundPill.layer.borderWidth = 1
        roundPill.layer.borderColor = TvTheme.white(0.12).cgColor

        trackCounter.font = TvTheme.mono(11)
        trackCounter.textColor = TvTheme.white(0.9)
        playlistName.font = TvTheme.mono(11)
        playlistName.textColor = TvTheme.white(0.45)
        playlistName.lineBreakMode = .byTruncatingTail

        phasePill.font = TvTheme.mono(11, bold: true)
        phasePill.textColor = TvTheme.background
        phasePill.backgroundColor = TvTheme.coral
        phasePill.insets = UIEdgeInsets(top: 8, left: 16, bottom: 8, right: 16)
        phasePill.layer.cornerRadius = 17
        phasePill.layer.shadowColor = TvTheme.coral.cgColor
        phasePill.layer.shadowOpacity = 0.33
        phasePill.layer.shadowRadius = 15
        phasePill.layer.shadowOffset = CGSize(width: 0, height: 8)

        // ── Scène centrale ──────────────────────────────────────────────
        buzzChip.font = TvTheme.sans(15, bold: true)
        buzzChip.textColor = .white
        buzzChip.backgroundColor = TvTheme.chip
        buzzChip.insets = UIEdgeInsets(top: 12, left: 16, bottom: 12, right: 16)
        buzzChip.layer.cornerRadius = 16
        buzzChip.layer.borderWidth = 1
        buzzChip.layer.borderColor = TvTheme.white(0.10).cgColor

        mysteryGlow.backgroundColor = TvTheme.coral(0.30)
        mysteryCover.contentMode = .scaleAspectFill
        mysteryCover.clipsToBounds = true
        mysteryCover.backgroundColor = TvTheme.mysteryBase
        mysteryCover.layer.cornerRadius = 26
        mysteryCover.layer.borderWidth = 1
        mysteryCover.layer.borderColor = TvTheme.white(0.12).cgColor
        mysteryMark.text = "?"
        mysteryMark.textColor = TvTheme.white(0.95)
        mysteryMark.textAlignment = .center

        timerLabel.font = TvTheme.mono(18, bold: true)
        timerLabel.textColor = TvTheme.white(0.7)
        timerLabel.textAlignment = .center
        timerSub.font = TvTheme.editorialItalic(24)
        timerSub.textColor = TvTheme.white(0.55)
        timerSub.textAlignment = .center

        listenLabel.font = TvTheme.mono(12)
        listenLabel.textColor = TvTheme.white(0.6)
        listenLabel.textAlignment = .center
        listenTrack.backgroundColor = TvTheme.white(0.12)
        listenTrack.layer.cornerRadius = 3
        listenTrack.clipsToBounds = true
        listenFill.backgroundColor = TvTheme.coral
        listenFill.layer.cornerRadius = 3
        listenTrack.addSubview(listenFill)

        revealGlow.backgroundColor = TvTheme.coral(0.32)
        revealCover.contentMode = .scaleAspectFill
        revealCover.clipsToBounds = true
        revealCover.backgroundColor = UIColor(red: 0.094, green: 0.094, blue: 0.125, alpha: 1)
        revealCover.layer.cornerRadius = 28
        revealCover.layer.borderWidth = 1
        revealCover.layer.borderColor = TvTheme.white(0.20).cgColor

        revealPill.font = TvTheme.mono(11, bold: true)
        revealPill.textColor = TvTheme.background
        revealPill.backgroundColor = TvTheme.coral
        revealPill.insets = UIEdgeInsets(top: 6, left: 16, bottom: 6, right: 16)
        revealPill.layer.cornerRadius = 15

        revealTitle.numberOfLines = 3
        revealTitle.textColor = .white
        revealTitle.layer.shadowColor = UIColor.black.cgColor
        revealTitle.layer.shadowOpacity = 0.6
        revealTitle.layer.shadowRadius = 30
        revealTitle.layer.shadowOffset = CGSize(width: 0, height: 12)
        revealArtist.numberOfLines = 2
        revealArtist.textColor = TvTheme.coral
        revealMeta.font = TvTheme.mono(16)
        revealMeta.textColor = TvTheme.white(0.55)

        centerMessage.textAlignment = .center
        centerMessage.numberOfLines = 2
        centerMessage.textColor = .white
        centerSub.textAlignment = .center
        centerSub.numberOfLines = 2
        centerSub.font = TvTheme.editorialItalic(24)
        centerSub.textColor = TvTheme.white(0.6)

        // ── Colonne latérale ────────────────────────────────────────────
        stylePanel(boardPanel)
        boardIcon.text = "🏆"
        boardIcon.font = UIFont.systemFont(ofSize: 18)
        boardTitle.font = TvTheme.mono(12, bold: true)
        boardTitle.textColor = TvTheme.white(0.55)
        boardEmpty.font = TvTheme.editorialItalic(18)
        boardEmpty.textColor = TvTheme.white(0.45)
        boardEmpty.textAlignment = .center
        boardEmpty.numberOfLines = 2
        boardPanel.addSubview(boardIcon)
        boardPanel.addSubview(boardTitle)
        boardPanel.addSubview(boardEmpty)

        stylePanel(qrPanel)
        qrWhite.backgroundColor = .white
        qrWhite.layer.cornerRadius = 16
        qrImage.contentMode = .scaleAspectFit
        qrWhite.addSubview(qrImage)
        qrLabel.font = TvTheme.mono(10)
        qrLabel.textColor = TvTheme.coral
        qrCode.font = TvTheme.mono(24, bold: true)
        qrCode.textColor = .white
        qrHint.font = TvTheme.editorialItalic(12)
        qrHint.textColor = TvTheme.white(0.45)
        qrPanel.addSubview(qrWhite)
        qrPanel.addSubview(qrLabel)
        qrPanel.addSubview(qrCode)
        qrPanel.addSubview(qrHint)

        // ── Pause ───────────────────────────────────────────────────────
        pauseOverlay.backgroundColor = UIColor(white: 0, alpha: 0.85)
        pauseOverlay.isHidden = true
        stylePanel(pausePanel)
        pauseIcon.text = "⏸"
        pauseIcon.font = UIFont.systemFont(ofSize: 72)
        pauseIcon.textAlignment = .center
        pauseTitle.font = TvTheme.display(48)
        pauseTitle.textColor = .white
        pauseTitle.textAlignment = .center
        pauseTitle.text = "Pause"
        pauseHint.font = TvTheme.editorialItalic(20)
        pauseHint.textColor = TvTheme.white(0.55)
        pauseHint.textAlignment = .center
        pauseHint.text = "L'animateur a mis la musique en pause"
        pausePanel.addSubview(pauseIcon)
        pausePanel.addSubview(pauseTitle)
        pausePanel.addSubview(pauseHint)
        pauseOverlay.addSubview(pausePanel)

        let all: [UIView] = [
            coralGlow, brandLabel, brandDot, roundPill, trackCounter, playlistName, phasePill,
            buzzChip, mysteryGlow, mysteryCover, mysteryMark, timerLabel, timerRing, timerSub,
            equalizer, listenLabel, listenTrack, revealGlow, revealCover, revealPill,
            revealTitle, revealArtist, revealMeta, centerMessage, centerSub,
            boardPanel, qrPanel, pauseOverlay,
        ]
        for v in all { view.addSubview(v) }
        // Note : mysteryMark figure aussi dans le tableau `all` ci-dessus ; c'est
        // ce placement-ci qui fait foi (il le range dans la pochette mystère).
        mysteryCover.addSubview(mysteryMark)
        refresh()
    }

    private func stylePanel(_ v: UIView) {
        v.backgroundColor = TvTheme.panel
        v.layer.cornerRadius = TvTheme.panelRadius
        v.layer.borderWidth = 1
        v.layer.borderColor = TvTheme.panelBorder.cgColor
        v.layer.shadowColor = UIColor.black.cgColor
        v.layer.shadowOpacity = 0.55
        v.layer.shadowRadius = 35
        v.layer.shadowOffset = CGSize(width: 0, height: 24)
    }

    // MARK: - Réception d'état

    private var lastStateSignature = ""
    private var qrPendingCode = ""

    private func apply(_ newState: TvScreenState?) {
        guard let newState = newState else { return }
        // fix/fil-principal — l'interrogation revient chaque seconde ; on ne
        // redessine que si quelque chose a changé (état, morceau, phase,
        // scores, joueurs). Une signature courte suffit à le savoir.
        // fix/build-ios-qui-echoue — CETTE EXPRESSION EST DÉCOUPÉE.
        // Écrite d'un seul bloc — tableau de huit termes mêlant chaînes
        // optionnelles, valeurs de repli, conversions, interpolation, map et
        // joined imbriqués —, elle faisait ABANDONNER le compilateur Swift :
        // « unable to type-check this expression in reasonable time ». C'était
        // l'unique erreur du build iOS. Résultat strictement identique, écrit
        // en étapes dont le type est explicite : le compilateur n'a plus rien
        // à deviner.
        var scoresCumules = ""
        if let cumulative = newState.cumulative {
            var morceaux: [String] = []
            for score in cumulative {
                morceaux.append(score.id + ":" + String(score.totalPoints))
            }
            scoresCumules = morceaux.joined()
        }
        let composants: [String] = [
            newState.state,
            newState.currentTrack?.trackId ?? "",
            newState.currentTrack?.phase ?? "",
            String(newState.currentTrack?.correctAnswers?.count ?? 0),
            scoresCumules,
            String(newState.players?.count ?? 0),
            String(newState.session?.isPaused ?? false),
            newState.joinCode ?? "",
        ]
        let sig: String = composants.joined(separator: "|")
        state = newState
        if sig == lastStateSignature { return }
        lastStateSignature = sig
        reconcileDisplayedTrack()
    }

    /// Règle anti-décalage : on n'affiche un morceau que si le lecteur confirme
    /// le jouer. Sinon on reste sur le précédent. Exception au tout premier
    /// morceau (rien d'autre à montrer) et si aucune confirmation n'arrive
    /// jamais (console web, lecteur non instrumenté).
    private func reconcileDisplayedTrack() {
        guard let serverTrack = state?.currentTrack else {
            displayedTrack = nil
            refresh()
            return
        }
        if audioTrackId.isEmpty
            || audioTrackId == serverTrack.trackId
            || displayedTrack == nil {
            displayedTrack = serverTrack
        }
        refresh()
    }

    private func tick() {
        guard let track = displayedTrack else { return }
        if track.isPhase2, let iso = track.phase2StartedAt {
            let started = TuttiTvViewController.parseIso(iso)
            if started > 0 {
                let elapsed = (Date().timeIntervalSince1970 - started) * 1000.0
                let remaining = max(0, 10_000 - elapsed)
                timerRing.update(remaining: remaining, total: 10_000)
            }
        }
        layoutListeningProgress()
    }

    // MARK: - Rendu

    private var stateName: String { state?.state ?? "IDLE" }
    private var isPausedNow: Bool {
        stateName == "PAUSED" || (state?.session?.isPaused ?? false)
    }
    private var playingRound: TvRoundLite? {
        state?.session?.rounds?.first(where: { $0.status == "PLAYING" })
    }

    private func refresh() {
        let track = displayedTrack
        let revealed = track?.isRevealed ?? false
        let phase2 = track?.isPhase2 ?? false
        let phase1 = track?.phase == "phase1"
        let inGame = (stateName == "PLAYING" || stateName == "PAUSED")

        // Bandeau haut
        let hasRound = playingRound != nil
        roundPill.isHidden = !hasRound
        trackCounter.isHidden = !hasRound
        playlistName.isHidden = !hasRound
        if let round = playingRound {
            roundPill.text = "MANCHE \(round.position)"
            let total = round.playlist.tracksCount ?? 0
            trackCounter.isHidden = total == 0
            if total > 0, let t = track {
                trackCounter.text = "\(t.trackIndex + 1) / \(total)"
            }
            playlistName.text = round.playlist.name.uppercased()
        }
        phasePill.text = phaseLabel(track)

        // Scène
        buzzChip.isHidden = !(inGame && phase1)
        buzzChip.text = "🔴 Buzzez !"

        let showMystery = inGame && track != nil && !revealed && !phase2
        mysteryCover.isHidden = !showMystery
        mysteryGlow.isHidden = !showMystery
        mysteryMark.isHidden = !showMystery
        if showMystery, let t = track { loadCover(t, into: mysteryCover, blurred: true) }

        let showTimer = inGame && phase2
        timerLabel.isHidden = !showTimer
        timerRing.isHidden = !showTimer
        timerSub.isHidden = !showTimer
        timerLabel.attributedText = TvTheme.tracked(
            "QUELQU'UN A TROUVÉ", font: TvTheme.mono(18, bold: true), em: 0.34,
            color: TvTheme.white(0.7))
        timerSub.text = "Vite, les autres — buzzez !"

        let showListening = inGame && phase1
        equalizer.isHidden = !showListening
        listenLabel.isHidden = !showListening
        listenTrack.isHidden = !showListening
        listenLabel.attributedText = TvTheme.tracked(
            "ÉCOUTEZ ET BUZZEZ", font: TvTheme.mono(12), em: 0.34,
            color: TvTheme.white(0.6))

        revealCover.isHidden = !revealed
        revealGlow.isHidden = !revealed
        revealPill.isHidden = !revealed
        revealTitle.isHidden = !revealed
        revealArtist.isHidden = !revealed
        revealMeta.isHidden = !revealed
        if revealed, let t = track {
            loadCover(t, into: revealCover, blurred: false)
            revealPill.text = "RÉVÉLÉ"
            revealTitle.text = t.title
            revealTitle.font = TvTheme.display(titleSize(for: t.title))
            revealArtist.text = t.artist
            revealArtist.font = TvTheme.editorialItalic(36)
            // Volontairement masqué : aucun texte ne lui est jamais affecté.
            // On le garde en place pour ne rien changer à la mise en page.
            revealMeta.isHidden = true
            updateBackdrop(t)
        } else {
            updateBackdrop(nil)
        }

        // Message central hors jeu
        let showMessage = !inGame || track == nil
        centerMessage.isHidden = !showMessage
        centerSub.isHidden = !showMessage
        if showMessage {
            switch stateName {
            case "LOBBY":
                centerMessage.font = TvTheme.display(64)
                centerMessage.text = state?.sessionName ?? "Blind test"
                let n = state?.players?.count ?? 0
                centerSub.text = n == 0
                    ? "En attente des joueurs…"
                    : (n == 1 ? "1 joueur connecté" : "\(n) joueurs connectés")
            case "ROUND_PODIUM":
                centerMessage.font = TvTheme.display(64)
                centerMessage.text = "Fin de la manche"
                centerSub.text = "Classement général"
            case "FINAL_PODIUM":
                centerMessage.font = TvTheme.display(64)
                let winner = state?.finalScores?.first?.label
                centerMessage.text = winner.map { "\($0) gagne !" } ?? "Partie terminée"
                centerSub.text = "Bravo à tous"
            case "PLAYLIST_SELECTION":
                centerMessage.font = TvTheme.display(56)
                centerMessage.text = "Prochaine playlist…"
                centerSub.text = "Préparez-vous"
            default:
                centerMessage.font = TvTheme.display(56)
                centerMessage.text = "Tutti"
                centerSub.text = "L'animateur prépare la partie"
            }
        }

        // Classement + QR
        let scores = (stateName == "FINAL_PODIUM" ? state?.finalScores : state?.cumulative) ?? []
        buildLeaderboard(scores: scores, compact: !revealed)
        boardTitle.attributedText = TvTheme.tracked(
            "CLASSEMENT", font: TvTheme.mono(12, bold: true), em: 0.3,
            color: TvTheme.white(0.55))
        if let code = state?.joinCode {
            qrPanel.isHidden = false
            qrCode.text = code
            qrLabel.attributedText = TvTheme.tracked(
                "REJOIGNEZ", font: TvTheme.mono(10), em: 0.28, color: TvTheme.coral)
            qrHint.text = "Scannez pour jouer"
            // fix/qr-de-la-session-precedente — LA CONDITION EXIGEAIT UNE IMAGE
        // VIDE. Une fois le premier QR posé, il ne pouvait plus changer : à la
        // partie suivante, le texte affichait le nouveau code mais le QR
        // renvoyait toujours vers la session précédente. Les joueurs qui
        // scannaient tombaient dans la mauvaise partie.
        if qrPendingCode != code {
                qrPendingCode = code
                DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                    let img = TuttiTvViewController.makeQr(from: code)
                    DispatchQueue.main.async { self?.qrImage.image = img }
                }
            }
        } else {
            qrPanel.isHidden = true
        }

        pauseOverlay.isHidden = !isPausedNow
        if !pauseOverlay.isHidden { view.bringSubviewToFront(pauseOverlay) }

        view.setNeedsLayout()
    }

    private func phaseLabel(_ track: TvTrack?) -> String {
        switch track?.phase {
        case "phase1": return "À VOUS DE JOUER"
        case "phase2": return "DERNIÈRE CHANCE"
        case "phase3-skipped": return "MORCEAU PASSÉ"
        case "phase3", "phase3-revealed": return "RÉVÉLÉ"
        default: return "EN ATTENTE"
        }
    }

    /// Mêmes paliers que le web : le titre rétrécit avec sa longueur.
    private func titleSize(for title: String) -> CGFloat {
        let h = max(view.bounds.height, 1)
        if title.count <= 14 { return h * 0.115 }
        if title.count <= 26 { return h * 0.095 }
        return h * 0.075
    }

    private func buildLeaderboard(scores: [TvScore], compact: Bool) {
        var gains: [String: Int] = [:]
        for a in state?.correctAnswers ?? [] {
            if let pid = a.participantId { gains[pid, default: 0] += a.score }
            if let tid = a.teamId { gains[tid, default: 0] += a.score }
        }
        let rows = Array(scores.prefix(compact ? 5 : 8))
        boardEmpty.isHidden = !rows.isEmpty
        boardEmpty.text = "Pas encore de score"
        while boardRows.count > rows.count {
            boardRows.removeLast().removeFromSuperview()
        }
        while boardRows.count < rows.count {
            let r = LeaderRowView()
            boardPanel.addSubview(r)
            boardRows.append(r)
        }
        for (i, entry) in rows.enumerated() {
            boardRows[i].configure(
                rank: i, label: entry.label, points: entry.totalPoints,
                delta: gains[entry.id] ?? 0, color: entry.color)
        }
    }

    // MARK: - Pochettes

    private func updateBackdrop(_ track: TvTrack?) {
        guard let urlString = track?.coverUrl else {
            backdropView.image = nil
            coralGlow.isHidden = false
            return
        }
        coralGlow.isHidden = true
        if let blurred = blurredCache.object(forKey: urlString as NSString) {
            backdropView.image = blurred
            return
        }
        loadImage(urlString) { [weak self] image in
            guard let image = image else { return }
            // fix/fil-principal — le flou (rayon 60 sur 600×600) se calcule en
            // arrière-plan : sur le fil principal il figeait TOUTE l'app,
            // console comprise, pendant plusieurs centaines de millisecondes.
            DispatchQueue.global(qos: .userInitiated).async {
                let blurred = TuttiTvViewController.blur(image, radius: 60) ?? image
                DispatchQueue.main.async {
                    guard let self = self else { return }
                    self.blurredCache.setObject(blurred, forKey: urlString as NSString)
                    if self.displayedTrack?.coverUrl == urlString { self.backdropView.image = blurred }
                }
            }
        }
    }

    private func loadCover(_ track: TvTrack, into target: UIImageView, blurred: Bool) {
        guard let urlString = track.coverUrl else {
            target.image = nil
            return
        }
        let key = (blurred ? "b|" : "c|") + urlString
        if let cached = coverCache.object(forKey: key as NSString) {
            target.image = cached
            return
        }
        loadImage(urlString) { [weak self] image in
            guard let image = image else { return }
            DispatchQueue.global(qos: .userInitiated).async {
                let final = blurred ? (TuttiTvViewController.blur(image, radius: 22) ?? image) : image
                DispatchQueue.main.async {
                    guard let self = self else { return }
                    self.coverCache.setObject(final, forKey: key as NSString)
                    if self.displayedTrack?.coverUrl == urlString { target.image = final }
                }
            }
        }
    }

    /// Images brutes déjà téléchargées (avant flou) + demandeurs en attente.
    private let rawCache = NSCache<NSString, UIImage>()
    private var waiters: [String: [(UIImage?) -> Void]] = [:]

    /// fix/pochette-absente — plusieurs vues demandent la MÊME image (fond
    /// flouté, pochette mystère, pochette révélée). L'ancien anti-doublon
    /// ignorait purement le second demandeur : il ne recevait jamais l'image,
    /// d'où des pochettes absentes à la révélation. Désormais : cache brut, et
    /// tous les demandeurs d'une même URL sont servis à l'arrivée.
    private func loadImage(_ urlString: String, done: @escaping (UIImage?) -> Void) {
        if let cached = rawCache.object(forKey: urlString as NSString) {
            done(cached)
            return
        }
        guard let url = URL(string: urlString) else { done(nil); return }
        if waiters[urlString] != nil {
            waiters[urlString]?.append(done)
            return
        }
        waiters[urlString] = [done]
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            // Décodage sur le fil réseau, pas sur le fil principal.
            let image = data.flatMap { UIImage(data: $0) }
            DispatchQueue.main.async {
                guard let self = self else { return }
                if let image = image { self.rawCache.setObject(image, forKey: urlString as NSString) }
                let callbacks = self.waiters.removeValue(forKey: urlString) ?? []
                for cb in callbacks { cb(image) }
            }
        }.resume()
    }

    /// Un seul contexte CoreImage pour toute la vue : en créer un à chaque
    /// flou coûtait plusieurs centaines de millisecondes.
    private static let ciContext = CIContext(options: [.useSoftwareRenderer: false])

    private static func blur(_ image: UIImage, radius: Double) -> UIImage? {
        guard let cg = image.cgImage else { return nil }
        let context = ciContext
        let input = CIImage(cgImage: cg)
        guard let filter = CIFilter(name: "CIGaussianBlur") else { return nil }
        filter.setValue(input.clampedToExtent(), forKey: kCIInputImageKey)
        filter.setValue(radius, forKey: kCIInputRadiusKey)
        guard let out = filter.outputImage else { return nil }
        guard let result = context.createCGImage(out, from: input.extent) else { return nil }
        return UIImage(cgImage: result)
    }

    // MARK: - Mise en page

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        layoutAll()
    }

    private func layoutAll() {
        let b = view.bounds
        backdropView.frame = b
        scrimLayer.frame = b
        let glowSide = b.height * 0.55
        coralGlow.frame = CGRect(x: b.midX - glowSide / 2, y: -b.height * 0.12,
                                 width: glowSide, height: glowSide)
        coralGlow.layer.cornerRadius = glowSide / 2

        // Marge racine : px-[2.5vmin] pt-[1.5vmin] pb-[3vmin]
        let vmin = min(b.width, b.height)
        let rootX = vmin * 0.025
        let rootTop = vmin * 0.015
        let rootBottom = vmin * 0.03

        // Bandeau haut : px-12 py-7
        let headX = rootX + 48
        let headY = rootTop + 28
        brandLabel.sizeToFit()
        brandLabel.frame = CGRect(x: headX, y: headY, width: brandLabel.frame.width,
                                  height: brandLabel.frame.height)
        brandDot.frame = CGRect(x: brandLabel.frame.maxX + 4, y: headY + 4, width: 10, height: 10)

        var cursor = brandLabel.frame.maxX + 24
        let pillH: CGFloat = 28
        if !roundPill.isHidden {
            roundPill.sizeToFit()
            roundPill.frame = CGRect(x: cursor, y: brandLabel.frame.midY - pillH / 2,
                                     width: roundPill.frame.width, height: pillH)
            cursor = roundPill.frame.maxX + 12
        }
        if !trackCounter.isHidden {
            trackCounter.sizeToFit()
            trackCounter.frame = CGRect(x: cursor, y: brandLabel.frame.midY - 8,
                                        width: trackCounter.frame.width, height: 16)
            cursor = trackCounter.frame.maxX + 12
        }
        if !playlistName.isHidden {
            let maxW = max(0, b.width * 0.22)
            playlistName.frame = CGRect(x: cursor, y: brandLabel.frame.midY - 8,
                                        width: maxW, height: 16)
        }
        phasePill.sizeToFit()
        let phaseH: CGFloat = 34
        phasePill.frame = CGRect(x: b.width - rootX - 48 - phasePill.frame.width,
                                 y: brandLabel.frame.midY - phaseH / 2,
                                 width: phasePill.frame.width, height: phaseH)

        // Zone principale : px-12 pb-12, gap-10
        let mainTop = max(brandLabel.frame.maxY, phasePill.frame.maxY) + 28
        let mainX = rootX + 48
        let mainW = b.width - mainX * 2
        let mainH = b.height - mainTop - rootBottom - 48
        let gap: CGFloat = 40
        let revealed = displayedTrack?.isRevealed ?? false
        // grid lg:grid-cols-[1fr_360px] à l'écoute, [1.5fr_1fr] au reveal
        let asideW: CGFloat = revealed ? (mainW - gap) / 2.5 : min(360, mainW * 0.28)
        let stageW = mainW - gap - asideW
        let stageRect = CGRect(x: mainX, y: mainTop, width: stageW, height: mainH)
        let asideRect = CGRect(x: mainX + stageW + gap, y: mainTop, width: asideW, height: mainH)

        layoutStage(stageRect, revealed: revealed)
        layoutAside(asideRect, revealed: revealed)

        pauseOverlay.frame = b
        let pw = min(b.width * 0.5, 720)
        let ph = min(b.height * 0.4, 380)
        pausePanel.frame = CGRect(x: (b.width - pw) / 2, y: (b.height - ph) / 2,
                                  width: pw, height: ph)
        pauseIcon.frame = CGRect(x: 0, y: ph * 0.16, width: pw, height: 84)
        pauseTitle.frame = CGRect(x: 0, y: pauseIcon.frame.maxY + 12, width: pw, height: 60)
        pauseHint.frame = CGRect(x: 24, y: pauseTitle.frame.maxY + 8, width: pw - 48, height: 32)
    }

    private func layoutStage(_ r: CGRect, revealed: Bool) {
        if !buzzChip.isHidden {
            buzzChip.sizeToFit()
            buzzChip.frame = CGRect(x: r.minX, y: r.minY,
                                    width: buzzChip.frame.width + 4, height: 44)
        }

        if revealed {
            // section flex-row : pochette + bloc texte, centré verticalement
            let coverSide = min(r.height * 0.52, min(r.width * 0.42, 400))
            let textW = r.width - coverSide - 40
            let coverY = r.midY - coverSide / 2
            revealCover.frame = CGRect(x: r.minX, y: coverY, width: coverSide, height: coverSide)
            revealGlow.frame = revealCover.frame.insetBy(dx: -40, dy: -40)
            revealGlow.layer.cornerRadius = revealGlow.frame.width * 0.4

            let textX = revealCover.frame.maxX + 40
            revealPill.sizeToFit()
            let titleH = ceil(revealTitle.sizeThatFits(
                CGSize(width: textW, height: .greatestFiniteMagnitude)).height)
            let artistH = ceil(revealArtist.sizeThatFits(
                CGSize(width: textW, height: .greatestFiniteMagnitude)).height)
            let blockH = 30 + 24 + titleH + 16 + artistH
            var y = r.midY - blockH / 2
            revealPill.frame = CGRect(x: textX, y: y, width: revealPill.frame.width, height: 30)
            y += 30 + 24
            revealTitle.frame = CGRect(x: textX, y: y, width: textW, height: titleH)
            y += titleH + 16
            revealArtist.frame = CGRect(x: textX, y: y, width: textW, height: artistH)
            return
        }

        if !timerRing.isHidden {
            let side: CGFloat = min(340, r.height * 0.5)
            let blockH = 26 + 24 + side + 24 + 30
            var y = r.midY - blockH / 2
            timerLabel.frame = CGRect(x: r.minX, y: y, width: r.width, height: 26)
            y += 26 + 24
            timerRing.frame = CGRect(x: r.midX - side / 2, y: y, width: side, height: side)
            y += side + 24
            timerSub.frame = CGRect(x: r.minX, y: y, width: r.width, height: 30)
            return
        }

        if !mysteryCover.isHidden {
            let side = min(min(r.height * 0.44, 440), r.width * 0.8)
            let progressH: CGFloat = listenTrack.isHidden ? 0 : 120
            let totalH = side + progressH
            let top = r.midY - totalH / 2
            mysteryCover.frame = CGRect(x: r.midX - side / 2, y: top, width: side, height: side)
            mysteryGlow.frame = mysteryCover.frame.insetBy(dx: -24, dy: -24)
            mysteryGlow.layer.cornerRadius = mysteryGlow.frame.width * 0.4
            mysteryMark.frame = mysteryCover.bounds
            mysteryMark.font = TvTheme.display(side * 0.42)

            if !listenTrack.isHidden {
                let w = side
                let x = r.midX - w / 2
                var y = mysteryCover.frame.maxY + 44
                equalizer.frame = CGRect(x: r.midX - 40, y: y, width: 80, height: 36)
                y += 36 + 16
                listenLabel.frame = CGRect(x: r.minX, y: y, width: r.width, height: 18)
                y += 18 + 16
                listenTrack.frame = CGRect(x: x, y: y, width: w, height: 6)
                layoutListeningProgress()
            }
            return
        }

        if !centerMessage.isHidden {
            let h1: CGFloat = 84
            let h2: CGFloat = 36
            let y = r.midY - (h1 + 16 + h2) / 2
            centerMessage.frame = CGRect(x: r.minX, y: y, width: r.width, height: h1)
            centerSub.frame = CGRect(x: r.minX, y: y + h1 + 16, width: r.width, height: h2)
        }
    }

    private func layoutListeningProgress() {
        if listenTrack.isHidden { return }
        let total = playback.durationMs > 0
            ? playback.durationMs
            : Double(displayedTrack?.durationMs ?? 0)
        var ratio: CGFloat = 0
        if total > 0 {
            ratio = CGFloat(min(1, max(0, playback.currentPositionMs() / total)))
        }
        listenFill.frame = CGRect(x: 0, y: 0,
                                  width: listenTrack.bounds.width * ratio,
                                  height: listenTrack.bounds.height)
    }

    private func layoutAside(_ r: CGRect, revealed: Bool) {
        let qrH: CGFloat = 148
        let gap: CGFloat = 20
        boardPanel.frame = CGRect(x: r.minX, y: r.minY, width: r.width,
                                  height: max(0, r.height - qrH - gap))
        qrPanel.frame = CGRect(x: r.minX, y: boardPanel.frame.maxY + gap,
                               width: r.width, height: qrH)

        let pad: CGFloat = 24
        boardIcon.frame = CGRect(x: pad, y: pad, width: 22, height: 22)
        boardTitle.frame = CGRect(x: pad + 30, y: pad + 2,
                                  width: boardPanel.bounds.width - pad - 30, height: 18)
        boardEmpty.frame = CGRect(x: pad, y: boardPanel.bounds.height / 2 - 20,
                                  width: boardPanel.bounds.width - pad * 2, height: 40)

        var y = pad + 22 + 16
        let rowH: CGFloat = revealed ? 62 : 54
        for row in boardRows {
            row.frame = CGRect(x: pad, y: y, width: boardPanel.bounds.width - pad * 2,
                               height: rowH)
            row.applyLayout(leaderBig: revealed)
            y += rowH + 10
        }

        let qpad: CGFloat = 20
        let qrSide = qrH - qpad * 2
        qrWhite.frame = CGRect(x: qpad, y: qpad, width: qrSide, height: qrSide)
        qrImage.frame = qrWhite.bounds.insetBy(dx: 8, dy: 8)
        let tx = qrWhite.frame.maxX + 16
        let tw = max(0, qrPanel.bounds.width - tx - qpad)
        qrLabel.frame = CGRect(x: tx, y: qpad + 6, width: tw, height: 14)
        qrCode.frame = CGRect(x: tx, y: qrLabel.frame.maxY + 6, width: tw, height: 30)
        qrHint.frame = CGRect(x: tx, y: qrCode.frame.maxY + 4, width: tw, height: 18)
    }

    // MARK: - Utilitaires

    // fix/analyseurs-de-date-recrees-en-boucle — ILS SONT CRÉÉS UNE FOIS.
    // Cette fonction est appelée dix fois par seconde pendant toute la phase de
    // buzz et construisait un, voire deux analyseurs de date à chaque passage.
    // C'est un objet coûteux à construire : de la charge permanente sur l'iPad
    // pour un résultat identique. On mémorise aussi la dernière conversion,
    // puisque la même date est relue à chaque battement.
    private static let analyseurFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let analyseurSimple: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
    private static var derniereDateLue: (iso: String, valeur: TimeInterval)?

    private static func parseIso(_ iso: String) -> TimeInterval {
        if let cache = derniereDateLue, cache.iso == iso { return cache.valeur }
        var valeur: TimeInterval = 0
        if let d = analyseurFraction.date(from: iso) {
            valeur = d.timeIntervalSince1970
        } else if let d = analyseurSimple.date(from: iso) {
            valeur = d.timeIntervalSince1970
        }
        derniereDateLue = (iso, valeur)
        return valeur
    }

    private static func makeQr(from code: String) -> UIImage? {
        let text = "https://tuttiparty.app/play?session=\(code)"
        guard let data = text.data(using: .utf8),
              let filter = CIFilter(name: "CIQRCodeGenerator") else { return nil }
        filter.setValue(data, forKey: "inputMessage")
        filter.setValue("M", forKey: "inputCorrectionLevel")
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 12, y: 12))
        let context = CIContext()
        guard let cg = context.createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}
