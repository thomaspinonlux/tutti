import UIKit
import CoreImage

/**
 * TuttiTvViewController — ÉCRAN JOUEURS 100 % NATIF.
 *
 * Remplace la seconde WebView (page /screen) par un rendu UIKit dessiné par
 * l'app elle-même. Deux gains structurels, impossibles en WebView :
 *
 *  1. AUCUN GEL. Il n'y a plus de navigateur sur la TV : iOS n'a plus de
 *     processus web à tuer sous pression mémoire. C'était la cause des gels.
 *
 *  2. AUCUN DÉCALAGE SON / IMAGE. La console pousse ici, en direct et sans
 *     réseau (même app, même processus), ce que le lecteur joue RÉELLEMENT :
 *     identifiant du morceau + position. La règle d'affichage est stricte —
 *     `pendingConfirmation` : tant que le lecteur n'a pas confirmé jouer le
 *     morceau annoncé par le serveur, la TV NE BASCULE PAS. Elle ne peut donc
 *     jamais afficher un titre que la salle n'entend pas encore. C'est la
 *     réponse au « décalage d'une chanson ».
 *
 * Le reste de l'état (scores, phases, podiums) vient du même endpoint public
 * que la version web, interrogé chaque seconde.
 */
final class TuttiTvViewController: UIViewController {

    // MARK: - Constantes de style

    private let bg = UIColor(red: 0.043, green: 0.043, blue: 0.059, alpha: 1)
    private let panel = UIColor(red: 0.098, green: 0.098, blue: 0.133, alpha: 1)
    private let coral = UIColor(red: 1.0, green: 0.361, blue: 0.302, alpha: 1)
    private let dim = UIColor(white: 0.72, alpha: 1)
    private let phase2DurationMs: Double = 10_000

    // MARK: - État

    private var poller: TuttiTvPoller?
    private var state: TvScreenState?
    private var playback = TvPlayback()
    /// Identifiant du morceau que le LECTEUR joue réellement (poussé par la
    /// console). Vide tant qu'aucune confirmation n'est arrivée.
    private var audioTrackId: String = ""
    /// Dernier morceau réellement confirmé et affiché — la TV reste dessus
    /// tant que le suivant n'est pas confirmé par le lecteur.
    private var displayedTrack: TvTrack?
    private var tickTimer: Timer?
    private var coverCache = NSCache<NSString, UIImage>()
    private var coverRequestedFor: String = ""

    // MARK: - Vues

    private let eyebrow = UILabel()
    private let bigTitle = UILabel()
    private let subTitle = UILabel()
    private let coverView = UIImageView()
    private let coverPlaceholder = UILabel()
    private let countdownLabel = UILabel()
    private let progressTrack = UIView()
    private let progressFill = UIView()
    private let boardTitle = UILabel()
    private let boardStack = UIStackView()
    private let qrView = UIImageView()
    private let joinLabel = UILabel()
    private let pausedBadge = UILabel()
    private let foundStack = UIStackView()

    // MARK: - Cycle de vie

    init(apiBase: String, workspaceId: String) {
        super.init(nibName: nil, bundle: nil)
        poller = TuttiTvPoller(apiBase: apiBase, workspaceId: workspaceId) { [weak self] newState in
            self?.apply(newState)
        }
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) non supporté")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = bg
        buildViews()
        poller?.start()
        let t = Timer(timeInterval: 0.1, repeats: true) { [weak self] _ in
            self?.tick()
        }
        RunLoop.main.add(t, forMode: .common)
        tickTimer = t
    }

    deinit {
        tickTimer?.invalidate()
        poller?.stop()
    }

    // MARK: - API appelée par le plugin

    /// Vérité du lecteur, poussée par la console (sans réseau).
    func updatePlayback(trackId: String, positionMs: Double, durationMs: Double, isPaused: Bool) {
        audioTrackId = trackId
        playback.positionMs = positionMs
        playback.durationMs = durationMs
        playback.isPaused = isPaused
        playback.receivedAt = Date().timeIntervalSince1970
        reconcileDisplayedTrack()
    }

    // MARK: - Construction des vues

    private func buildViews() {
        eyebrow.font = UIFont.monospacedSystemFont(ofSize: 22, weight: .semibold)
        eyebrow.textColor = coral
        eyebrow.textAlignment = .center

        bigTitle.font = UIFont.systemFont(ofSize: 84, weight: .heavy)
        bigTitle.textColor = .white
        bigTitle.textAlignment = .center
        bigTitle.numberOfLines = 3
        bigTitle.adjustsFontSizeToFitWidth = true
        bigTitle.minimumScaleFactor = 0.4

        subTitle.font = UIFont.systemFont(ofSize: 46, weight: .medium)
        subTitle.textColor = dim
        subTitle.textAlignment = .center
        subTitle.numberOfLines = 2
        subTitle.adjustsFontSizeToFitWidth = true
        subTitle.minimumScaleFactor = 0.5

        coverView.contentMode = .scaleAspectFill
        coverView.clipsToBounds = true
        coverView.layer.cornerRadius = 24
        coverView.backgroundColor = panel

        coverPlaceholder.text = "♪"
        coverPlaceholder.font = UIFont.systemFont(ofSize: 150, weight: .light)
        coverPlaceholder.textColor = UIColor(white: 1, alpha: 0.25)
        coverPlaceholder.textAlignment = .center
        coverPlaceholder.backgroundColor = panel
        coverPlaceholder.layer.cornerRadius = 24
        coverPlaceholder.clipsToBounds = true

        countdownLabel.font = UIFont.systemFont(ofSize: 220, weight: .heavy)
        countdownLabel.textColor = coral
        countdownLabel.textAlignment = .center

        progressTrack.backgroundColor = UIColor(white: 1, alpha: 0.12)
        progressTrack.layer.cornerRadius = 6
        progressTrack.clipsToBounds = true
        progressFill.backgroundColor = coral
        progressTrack.addSubview(progressFill)

        boardTitle.font = UIFont.monospacedSystemFont(ofSize: 20, weight: .bold)
        boardTitle.textColor = dim
        boardTitle.textAlignment = .left

        boardStack.axis = .vertical
        boardStack.spacing = 10
        boardStack.alignment = .fill

        foundStack.axis = .vertical
        foundStack.spacing = 8
        foundStack.alignment = .center

        qrView.contentMode = .scaleAspectFit
        qrView.backgroundColor = .white
        qrView.layer.cornerRadius = 12
        qrView.clipsToBounds = true

        joinLabel.font = UIFont.monospacedSystemFont(ofSize: 30, weight: .bold)
        joinLabel.textColor = .white
        joinLabel.textAlignment = .center

        pausedBadge.text = "PAUSE"
        pausedBadge.font = UIFont.systemFont(ofSize: 70, weight: .heavy)
        pausedBadge.textColor = .white
        pausedBadge.textAlignment = .center
        pausedBadge.backgroundColor = UIColor(white: 0, alpha: 0.55)
        pausedBadge.layer.cornerRadius = 20
        pausedBadge.clipsToBounds = true

        let all: [UIView] = [coverPlaceholder, coverView, eyebrow, bigTitle, subTitle,
                             countdownLabel, progressTrack, boardTitle, boardStack,
                             foundStack, qrView, joinLabel, pausedBadge]
        for v in all {
            v.isHidden = true
            view.addSubview(v)
        }
    }

    // MARK: - Réception d'état

    private func apply(_ newState: TvScreenState?) {
        guard let newState = newState else { return }
        state = newState
        reconcileDisplayedTrack()
    }

    /// Décide QUEL morceau la TV a le droit d'afficher.
    ///
    /// Règle : on n'affiche le morceau annoncé par le serveur que si le lecteur
    /// confirme le jouer. Sinon on reste sur le précédent. Zéro décalage
    /// possible entre ce qu'on entend et ce qu'on voit.
    ///
    /// Exception : si aucune confirmation n'est jamais arrivée (console web,
    /// lecteur non instrumenté), on affiche l'état serveur — sinon la TV
    /// resterait vide.
    private func reconcileDisplayedTrack() {
        guard let serverTrack = state?.currentTrack else {
            displayedTrack = nil
            refresh()
            return
        }
        if audioTrackId.isEmpty {
            displayedTrack = serverTrack
        } else if audioTrackId == serverTrack.trackId {
            displayedTrack = serverTrack
        } else if displayedTrack == nil {
            // Premier morceau, lecteur pas encore confirmé : on l'affiche quand
            // même (rien d'autre à montrer), la confirmation suivra.
            displayedTrack = serverTrack
        }
        // Sinon : le lecteur joue encore l'ancien → on NE bascule PAS.
        refresh()
    }

    private func tick() {
        // Rafraîchit uniquement ce qui bouge en continu (chrono + barre).
        guard let track = displayedTrack else { return }
        if track.isPhase2, let startedIso = track.phase2StartedAt {
            let started = TuttiTvViewController.parseIso(startedIso)
            if started > 0 {
                let elapsed = (Date().timeIntervalSince1970 - started) * 1000.0
                let remaining = max(0, phase2DurationMs - elapsed)
                countdownLabel.text = String(Int(ceil(remaining / 1000.0)))
            }
        }
        layoutProgress()
    }

    // MARK: - Rendu

    private func refresh() {
        let hideAll: [UIView] = [coverPlaceholder, coverView, eyebrow, bigTitle, subTitle,
                                 countdownLabel, progressTrack, boardTitle, boardStack,
                                 foundStack, qrView, joinLabel, pausedBadge]
        for v in hideAll { v.isHidden = true }

        guard let s = state else {
            eyebrow.isHidden = false
            eyebrow.text = "TUTTI"
            bigTitle.isHidden = false
            bigTitle.text = "Connexion…"
            view.setNeedsLayout()
            return
        }

        switch s.state {
        case "LOBBY":
            renderLobby(s)
        case "PLAYING", "PAUSED":
            renderPlaying(s, paused: s.state == "PAUSED")
        case "ROUND_PODIUM":
            renderRoundPodium(s)
        case "FINAL_PODIUM":
            renderFinalPodium(s)
        case "PLAYLIST_SELECTION":
            renderSelection(s)
        default:
            eyebrow.isHidden = false
            eyebrow.text = "TUTTI"
            bigTitle.isHidden = false
            bigTitle.text = "Prêt à jouer"
            subTitle.isHidden = false
            subTitle.text = "L'animateur prépare la partie"
        }
        view.setNeedsLayout()
    }

    private func renderLobby(_ s: TvScreenState) {
        eyebrow.isHidden = false
        eyebrow.text = "REJOIGNEZ LA PARTIE"
        bigTitle.isHidden = false
        bigTitle.text = s.sessionName ?? "Blind test"
        let count = s.players?.count ?? 0
        subTitle.isHidden = false
        if count == 0 {
            subTitle.text = "En attente des joueurs…"
        } else if count == 1 {
            subTitle.text = "1 joueur connecté"
        } else {
            subTitle.text = "\(count) joueurs connectés"
        }
        if let code = s.joinCode {
            joinLabel.isHidden = false
            joinLabel.text = code
            qrView.isHidden = false
            qrView.image = TuttiTvViewController.makeQr(from: code)
        }
        fillBoard(names: (s.players ?? []).map { $0.pseudo }, values: [], title: "JOUEURS")
        boardTitle.isHidden = (s.players?.isEmpty ?? true)
        boardStack.isHidden = boardTitle.isHidden
    }

    private func renderPlaying(_ s: TvScreenState, paused: Bool) {
        guard let track = displayedTrack else {
            eyebrow.isHidden = false
            eyebrow.text = "TUTTI"
            bigTitle.isHidden = false
            bigTitle.text = "Chargement du morceau…"
            return
        }

        let round = s.roundPosition ?? 1
        let total = s.roundsTotal ?? 1
        eyebrow.isHidden = false
        eyebrow.text = "MANCHE \(round)/\(total)  ·  TITRE \(track.trackIndex + 1)"

        if track.isRevealed {
            bigTitle.isHidden = false
            bigTitle.text = track.title
            subTitle.isHidden = false
            subTitle.text = track.artist
            showCover(track)
        } else if track.isPhase2 {
            countdownLabel.isHidden = false
            bigTitle.isHidden = false
            bigTitle.text = "Quelqu'un a trouvé !"
            subTitle.isHidden = false
            subTitle.text = "Vite, les autres — buzzez !"
        } else {
            coverPlaceholder.isHidden = false
            bigTitle.isHidden = false
            bigTitle.text = "À vous de jouer"
            subTitle.isHidden = false
            subTitle.text = "Buzzez dès que vous reconnaissez"
        }

        if paused {
            pausedBadge.isHidden = false
        }

        progressTrack.isHidden = false
        fillFound(track.correctAnswers ?? [])
        fillBoard(
            names: (s.cumulative ?? []).prefix(8).map { $0.label },
            values: (s.cumulative ?? []).prefix(8).map { "\($0.totalPoints)" },
            title: "CLASSEMENT")
    }

    private func renderRoundPodium(_ s: TvScreenState) {
        eyebrow.isHidden = false
        eyebrow.text = "FIN DE LA MANCHE \(s.lastEndedRoundPosition ?? 1)"
        bigTitle.isHidden = false
        let ranking = s.roundRanking ?? []
        bigTitle.text = ranking.first.map { "\($0.pseudo) remporte la manche" } ?? "Manche terminée"
        subTitle.isHidden = false
        subTitle.text = "Classement général"
        fillBoard(
            names: (s.cumulative ?? []).prefix(10).map { $0.label },
            values: (s.cumulative ?? []).prefix(10).map { "\($0.totalPoints)" },
            title: "CLASSEMENT GÉNÉRAL")
    }

    private func renderFinalPodium(_ s: TvScreenState) {
        eyebrow.isHidden = false
        eyebrow.text = "C'EST FINI !"
        let scores = s.finalScores ?? []
        bigTitle.isHidden = false
        bigTitle.text = scores.first.map { "\($0.label) gagne !" } ?? "Partie terminée"
        subTitle.isHidden = false
        subTitle.text = scores.first.map { "\($0.totalPoints) points" } ?? ""
        fillBoard(
            names: scores.prefix(10).map { $0.label },
            values: scores.prefix(10).map { "\($0.totalPoints)" },
            title: "CLASSEMENT FINAL")
    }

    private func renderSelection(_ s: TvScreenState) {
        eyebrow.isHidden = false
        eyebrow.text = "L'ANIMATEUR CHOISIT"
        bigTitle.isHidden = false
        bigTitle.text = "Prochaine playlist…"
        subTitle.isHidden = false
        subTitle.text = "Préparez-vous"
        if let code = s.joinCode {
            joinLabel.isHidden = false
            joinLabel.text = code
            qrView.isHidden = false
            qrView.image = TuttiTvViewController.makeQr(from: code)
        }
    }

    // MARK: - Sous-rendus

    private func fillBoard(names: [String], values: [String], title: String) {
        boardTitle.isHidden = names.isEmpty
        boardStack.isHidden = names.isEmpty
        boardTitle.text = title
        for sub in boardStack.arrangedSubviews {
            boardStack.removeArrangedSubview(sub)
            sub.removeFromSuperview()
        }
        for (index, name) in names.enumerated() {
            let row = UILabel()
            let weight: UIFont.Weight = index == 0 ? UIFont.Weight.heavy : UIFont.Weight.medium
            row.font = UIFont.systemFont(ofSize: 34, weight: weight)
            row.textColor = index == 0 ? UIColor.white : dim
            let value = index < values.count ? values[index] : ""
            row.text = value.isEmpty ? name : "\(index + 1). \(name)   \(value)"
            boardStack.addArrangedSubview(row)
        }
    }

    private func fillFound(_ answers: [TvCorrectAnswer]) {
        for sub in foundStack.arrangedSubviews {
            foundStack.removeArrangedSubview(sub)
            sub.removeFromSuperview()
        }
        if answers.isEmpty { return }
        foundStack.isHidden = false
        for a in answers.prefix(3) {
            let row = UILabel()
            row.font = UIFont.systemFont(ofSize: 30, weight: .semibold)
            row.textColor = coral
            row.textAlignment = .center
            row.text = "\(a.position). \(a.pseudo)  +\(a.score)"
            foundStack.addArrangedSubview(row)
        }
    }

    private func showCover(_ track: TvTrack) {
        guard let urlString = track.coverUrl, let url = URL(string: urlString) else {
            coverPlaceholder.isHidden = false
            return
        }
        coverView.isHidden = false
        let key = urlString as NSString
        if let cached = coverCache.object(forKey: key) {
            coverView.image = cached
            return
        }
        if coverRequestedFor == urlString { return }
        coverRequestedFor = urlString
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let self = self, let data = data, let image = UIImage(data: data) else { return }
            self.coverCache.setObject(image, forKey: key)
            DispatchQueue.main.async {
                if self.displayedTrack?.coverUrl == urlString {
                    self.coverView.image = image
                }
            }
        }.resume()
    }

    // MARK: - Mise en page (frames explicites : aucun conflit possible)

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        layoutViews()
    }

    private func layoutViews() {
        let b = view.bounds
        let margin = b.width * 0.045
        let contentWidth = b.width - margin * 2
        let boardWidth = b.width * 0.30
        let leftWidth = contentWidth - boardWidth - margin

        eyebrow.frame = CGRect(x: margin, y: margin * 0.6, width: contentWidth, height: 34)

        let isGame = !progressTrack.isHidden
        if isGame {
            let coverSide = min(leftWidth * 0.62, b.height * 0.42)
            let coverX = margin + (leftWidth - coverSide) / 2
            let coverY = margin * 1.6 + 34
            coverView.frame = CGRect(x: coverX, y: coverY, width: coverSide, height: coverSide)
            coverPlaceholder.frame = coverView.frame
            countdownLabel.frame = CGRect(x: margin, y: coverY, width: leftWidth, height: coverSide)

            let textY = coverY + coverSide + margin * 0.5
            bigTitle.frame = CGRect(x: margin, y: textY, width: leftWidth, height: b.height * 0.14)
            subTitle.frame = CGRect(x: margin, y: bigTitle.frame.maxY + 6,
                                    width: leftWidth, height: b.height * 0.08)
            foundStack.frame = CGRect(x: margin, y: subTitle.frame.maxY + 10,
                                      width: leftWidth, height: b.height * 0.16)

            progressTrack.frame = CGRect(x: margin, y: b.height - margin - 12,
                                         width: leftWidth, height: 12)
            pausedBadge.frame = CGRect(x: margin + leftWidth / 2 - 160,
                                       y: b.height / 2 - 60, width: 320, height: 120)

            boardTitle.frame = CGRect(x: b.width - margin - boardWidth,
                                      y: margin * 1.6 + 34, width: boardWidth, height: 28)
            boardStack.frame = CGRect(x: b.width - margin - boardWidth,
                                      y: boardTitle.frame.maxY + 14,
                                      width: boardWidth, height: b.height * 0.7)
        } else {
            // Écrans pleine largeur (lobby, podiums, sélection).
            let topY = b.height * 0.10
            bigTitle.frame = CGRect(x: margin, y: topY, width: contentWidth, height: b.height * 0.20)
            subTitle.frame = CGRect(x: margin, y: bigTitle.frame.maxY + 8,
                                    width: contentWidth, height: b.height * 0.10)
            let qrSide = min(b.width * 0.16, b.height * 0.26)
            qrView.frame = CGRect(x: b.width - margin - qrSide, y: b.height - margin - qrSide - 52,
                                  width: qrSide, height: qrSide)
            joinLabel.frame = CGRect(x: b.width - margin - qrSide, y: qrView.frame.maxY + 8,
                                     width: qrSide, height: 40)
            boardTitle.frame = CGRect(x: margin, y: subTitle.frame.maxY + margin * 0.6,
                                      width: contentWidth * 0.6, height: 28)
            boardStack.frame = CGRect(x: margin, y: boardTitle.frame.maxY + 14,
                                      width: contentWidth * 0.6,
                                      height: b.height - boardTitle.frame.maxY - margin * 2)
        }
        layoutProgress()
    }

    private func layoutProgress() {
        if progressTrack.isHidden { return }
        let total = playback.durationMs > 0
            ? playback.durationMs
            : Double(displayedTrack?.durationMs ?? 0)
        var ratio: CGFloat = 0
        if total > 0 {
            ratio = CGFloat(min(1.0, max(0.0, playback.currentPositionMs() / total)))
        }
        progressFill.frame = CGRect(x: 0, y: 0,
                                    width: progressTrack.bounds.width * ratio,
                                    height: progressTrack.bounds.height)
    }

    // MARK: - Utilitaires

    private static func parseIso(_ iso: String) -> TimeInterval {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFraction.date(from: iso) { return d.timeIntervalSince1970 }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        if let d = plain.date(from: iso) { return d.timeIntervalSince1970 }
        return 0
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
