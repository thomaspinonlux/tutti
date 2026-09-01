import UIKit

/**
 * TuttiTvComponents — briques visuelles de l'écran joueur natif, calquées sur
 * les composants du web (`TvScreenView.tsx`) :
 *   - PaddedLabel    → les « pills » (bandeau de phase, manche, RÉVÉLÉ…)
 *   - CoralRingView  → `CoralRingTimer` (anneau corail de la phase 2)
 *   - EqualizerView  → `Equalizer` (barres animées pendant l'écoute)
 *   - LeaderRowView  → une ligne de `DarkLeaderboard`
 */

/// Libellé avec marges intérieures — l'équivalent d'un `px-4 py-2` du web.
final class PaddedLabel: UILabel {
    var insets = UIEdgeInsets(top: 6, left: 12, bottom: 6, right: 12)

    override func drawText(in rect: CGRect) {
        super.drawText(in: rect.inset(by: insets))
    }

    override var intrinsicContentSize: CGSize {
        let s = super.intrinsicContentSize
        return CGSize(width: s.width + insets.left + insets.right,
                      height: s.height + insets.top + insets.bottom)
    }

    override func sizeThatFits(_ size: CGSize) -> CGSize {
        let s = super.sizeThatFits(size)
        return CGSize(width: s.width + insets.left + insets.right,
                      height: s.height + insets.top + insets.bottom)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        clipsToBounds = true
    }
}

/// Anneau de compte à rebours corail — reprend le tracé SVG du web :
/// rayon 52 sur une boîte 120, trait 9, arrondi, ombre portée corail.
final class CoralRingView: UIView {

    private let trackLayer = CAShapeLayer()
    private let progressLayer = CAShapeLayer()
    private let numberLabel = UILabel()

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        trackLayer.fillColor = UIColor.clear.cgColor
        trackLayer.strokeColor = UIColor(white: 1, alpha: 0.07).cgColor
        progressLayer.fillColor = UIColor.clear.cgColor
        progressLayer.strokeColor = TvTheme.coral.cgColor
        progressLayer.lineCap = .round
        progressLayer.shadowColor = TvTheme.coral.cgColor
        progressLayer.shadowOpacity = 0.67
        progressLayer.shadowRadius = 10
        progressLayer.shadowOffset = .zero
        layer.addSublayer(trackLayer)
        layer.addSublayer(progressLayer)
        numberLabel.textAlignment = .center
        numberLabel.textColor = .white
        addSubview(numberLabel)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) non supporté") }

    private var ratio: CGFloat = 1
    private var seconds: Int = 10

    func update(remaining: Double, total: Double) {
        ratio = CGFloat(max(0, min(1, total > 0 ? remaining / total : 0)))
        seconds = Int(ceil(max(0, remaining) / 1000))
        numberLabel.text = String(seconds)
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let side = min(bounds.width, bounds.height)
        // Proportions du SVG web : r=52 dans une boîte 120, trait 9.
        let radius = side * (52.0 / 120.0)
        let lineWidth = side * (9.0 / 120.0)
        let center = CGPoint(x: bounds.midX, y: bounds.midY)
        let path = UIBezierPath(arcCenter: center, radius: radius,
                                startAngle: -.pi / 2, endAngle: .pi * 1.5, clockwise: true)
        trackLayer.path = path.cgPath
        trackLayer.lineWidth = lineWidth
        progressLayer.path = path.cgPath
        progressLayer.lineWidth = lineWidth
        progressLayer.strokeStart = 0
        progressLayer.strokeEnd = ratio
        numberLabel.font = TvTheme.mono(side * 0.33, bold: true)
        numberLabel.frame = bounds
    }
}

/// Barres d'égaliseur animées — mêmes 7 barres et mêmes décalages que le web.
final class EqualizerView: UIView {

    private var bars: [UIView] = []
    private let delays: [Double] = [0.0, 0.18, 0.36, 0.12, 0.28, 0.06, 0.22]

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        for _ in delays {
            let bar = UIView()
            bar.backgroundColor = TvTheme.coral
            bar.layer.cornerRadius = 3
            addSubview(bar)
            bars.append(bar)
        }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) non supporté") }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard window != nil else { return }
        for (i, bar) in bars.enumerated() {
            bar.layer.removeAnimation(forKey: "eq")
            let anim = CABasicAnimation(keyPath: "transform.scale.y")
            anim.fromValue = 0.35
            anim.toValue = 1.0
            anim.duration = 0.9 + Double(i % 3) * 0.25
            anim.beginTime = CACurrentMediaTime() + delays[i]
            anim.autoreverses = true
            anim.repeatCount = .infinity
            bar.layer.add(anim, forKey: "eq")
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let w: CGFloat = 6
        let gap: CGFloat = 6
        let totalW = CGFloat(bars.count) * w + CGFloat(bars.count - 1) * gap
        var x = (bounds.width - totalW) / 2
        for bar in bars {
            bar.layer.anchorPoint = CGPoint(x: 0.5, y: 1)
            bar.frame = CGRect(x: x, y: 0, width: w, height: bounds.height)
            bar.center = CGPoint(x: x + w / 2, y: bounds.height)
            x += w + gap
        }
    }
}

/// Une ligne de classement — médaille, pastille d'équipe, nom, points, gain.
final class LeaderRowView: UIView {

    private let rankLabel = UILabel()
    private let teamDot = UIView()
    private let nameLabel = UILabel()
    private let pointsLabel = UILabel()
    private let deltaLabel = UILabel()
    private var isLeader = false
    private var hasTeamColor = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        layer.cornerRadius = 16
        layer.borderWidth = 1
        rankLabel.textAlignment = .center
        teamDot.layer.cornerRadius = 6
        teamDot.layer.borderWidth = 1
        teamDot.layer.borderColor = UIColor(white: 1, alpha: 0.3).cgColor
        nameLabel.textColor = .white
        nameLabel.lineBreakMode = .byTruncatingTail
        pointsLabel.textColor = .white
        pointsLabel.textAlignment = .right
        deltaLabel.textColor = TvTheme.coral
        deltaLabel.textAlignment = .right
        for v in [rankLabel, teamDot, nameLabel, pointsLabel, deltaLabel] { addSubview(v) }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) non supporté") }

    func configure(rank: Int, label: String, points: Int, delta: Int, color: String?) {
        isLeader = rank == 0
        let medals = ["🥇", "🥈", "🥉"]
        rankLabel.text = rank < medals.count ? medals[rank] : String(rank + 1)
        rankLabel.textColor = isLeader ? TvTheme.coral : .white
        nameLabel.text = label
        pointsLabel.text = String(points)
        deltaLabel.text = delta > 0 ? "+\(delta)" : ""
        // Mêmes fonds que le web : leader teinté corail, autres blanc 4 %.
        backgroundColor = isLeader ? TvTheme.coral(0.13) : UIColor(white: 1, alpha: 0.04)
        layer.borderColor = (isLeader ? TvTheme.coral(0.4) : UIColor(white: 1, alpha: 0.07)).cgColor
        if let hex = color, let parsed = LeaderRowView.color(from: hex) {
            teamDot.isHidden = false
            teamDot.backgroundColor = parsed
            hasTeamColor = true
        } else {
            teamDot.isHidden = true
            hasTeamColor = false
        }
        setNeedsLayout()
    }

    func applyLayout(leaderBig: Bool) {
        let base: CGFloat = leaderBig ? 30 : 24
        rankLabel.font = TvTheme.display(isLeader ? base : base * 0.85)
        nameLabel.font = TvTheme.sans(isLeader ? base : base * 0.8, bold: true)
        pointsLabel.font = TvTheme.mono(isLeader ? base * 0.85 : base * 0.75, bold: true)
        deltaLabel.font = TvTheme.mono(base * 0.5, bold: true)
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let padX: CGFloat = 16
        rankLabel.frame = CGRect(x: padX, y: 0, width: 40, height: bounds.height)
        var nameX = rankLabel.frame.maxX + 12
        if hasTeamColor {
            teamDot.frame = CGRect(x: nameX, y: bounds.midY - 6, width: 12, height: 12)
            nameX += 20
        }
        let deltaW: CGFloat = deltaLabel.text?.isEmpty == false ? 56 : 0
        let pointsW: CGFloat = 74
        pointsLabel.frame = CGRect(x: bounds.width - padX - deltaW - pointsW, y: 0,
                                   width: pointsW, height: bounds.height)
        deltaLabel.frame = CGRect(x: bounds.width - padX - deltaW, y: 0,
                                  width: deltaW, height: bounds.height)
        nameLabel.frame = CGRect(x: nameX, y: 0,
                                 width: max(0, pointsLabel.frame.minX - nameX - 8),
                                 height: bounds.height)
    }

    private static func color(from hex: String) -> UIColor? {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let value = UInt32(s, radix: 16) else { return nil }
        return UIColor(
            red: CGFloat((value >> 16) & 0xFF) / 255.0,
            green: CGFloat((value >> 8) & 0xFF) / 255.0,
            blue: CGFloat(value & 0xFF) / 255.0,
            alpha: 1)
    }
}
