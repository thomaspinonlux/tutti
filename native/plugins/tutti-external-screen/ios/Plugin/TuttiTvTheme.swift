import UIKit
import CoreText
import Capacitor

/**
 * TuttiTvTheme — VALEURS DE DESIGN DE L'ÉCRAN JOUEUR, reprises une à une de
 * `frontend/src/pages/screen/TvScreenView.tsx`.
 *
 * Objectif : le rendu natif doit être indiscernable du rendu web actuel. Toute
 * couleur, tout rayon, toute police ici a été relevée dans le composant web —
 * rien n'est réinventé. Si le web change, ces valeurs doivent suivre.
 */
enum TvTheme {

    // MARK: - Couleurs (identiques au web)

    /// `CORAL = '#FF5C4D'`
    static let coral = UIColor(red: 1.0, green: 0.361, blue: 0.302, alpha: 1)
    /// Fond de l'écran : `bg-[#0B0B0F]`
    static let background = UIColor(red: 0.043, green: 0.043, blue: 0.059, alpha: 1)
    /// Panneaux : `bg-[#191922]`
    static let panel = UIColor(red: 0.098, green: 0.098, blue: 0.133, alpha: 1)
    /// Pochette mystère : `backgroundColor: '#101018'`
    static let mysteryBase = UIColor(red: 0.063, green: 0.063, blue: 0.094, alpha: 1)
    /// Chip compteur de buzz : `bg-[#23232e]`
    static let chip = UIColor(red: 0.137, green: 0.137, blue: 0.180, alpha: 1)
    /// Filet des panneaux : `border-white/[0.07]`
    static let panelBorder = UIColor(white: 1, alpha: 0.07)

    static func white(_ alpha: CGFloat) -> UIColor { UIColor(white: 1, alpha: alpha) }
    static func coral(_ alpha: CGFloat) -> UIColor { coral.withAlphaComponent(alpha) }

    /// Rayon des panneaux : `rounded-[20px]`
    static let panelRadius: CGFloat = 20

    // MARK: - Polices
    //
    // Mêmes familles que le web (cf. tailwind.config.js) : Caprasimo en
    // display, Fraunces en éditorial italique, Outfit en sans, JetBrains Mono
    // en mono. Les fichiers sont embarqués dans l'app (native/assets/fonts).
    // Repli sur les polices système si un fichier venait à manquer : l'écran
    // reste lisible plutôt que de planter.

    /// Enregistre les polices de marque embarquées avec les fichiers web
    /// (`public/fonts`, copiés dans l'app par Capacitor). Sans cet appel,
    /// `UIFont(name:)` ne les trouve pas et on retomberait sur les polices
    /// système — donc un rendu différent du web. Idempotent.
    private static var fontsRegistered = false

    static func registerBundledFonts() {
        if fontsRegistered { return }
        fontsRegistered = true
        let names = [
            "Caprasimo-Regular", "Fraunces-Italic",
            "Outfit-Regular", "Outfit-Bold",
            "JetBrainsMono-Regular", "JetBrainsMono-Bold",
        ]
        for name in names {
            let url = Bundle.main.url(forResource: name, withExtension: "ttf",
                                      subdirectory: "public/fonts")
                ?? Bundle.main.url(forResource: name, withExtension: "ttf")
            guard let fontUrl = url else {
                CAPLog.print("TuttiTv: police introuvable \(name)")
                continue
            }
            CTFontManagerRegisterFontsForURL(fontUrl as CFURL, .process, nil)
        }
    }

    static func display(_ size: CGFloat) -> UIFont {
        UIFont(name: "Caprasimo-Regular", size: size)
            ?? UIFont.systemFont(ofSize: size, weight: .heavy)
    }

    static func editorialItalic(_ size: CGFloat) -> UIFont {
        UIFont(name: "Fraunces-BlackItalic", size: size)
            ?? UIFont.italicSystemFont(ofSize: size)
    }

    static func sans(_ size: CGFloat, bold: Bool = false) -> UIFont {
        UIFont(name: bold ? "Outfit-Bold" : "Outfit-Regular", size: size)
            ?? UIFont.systemFont(ofSize: size, weight: bold ? .bold : .regular)
    }

    static func mono(_ size: CGFloat, bold: Bool = false) -> UIFont {
        UIFont(name: bold ? "JetBrainsMono-Bold" : "JetBrainsMono-Regular", size: size)
            ?? UIFont.monospacedSystemFont(ofSize: size, weight: bold ? .bold : .regular)
    }

    /// Équivalent de `tracking-[0.28em]` : l'interlettrage CSS est exprimé en
    /// em, UIKit le veut en points → on multiplie par le corps.
    static func tracked(_ text: String, font: UIFont, em: CGFloat,
                        color: UIColor) -> NSAttributedString {
        NSAttributedString(string: text, attributes: [
            .font: font,
            .foregroundColor: color,
            .kern: font.pointSize * em,
        ])
    }
}
