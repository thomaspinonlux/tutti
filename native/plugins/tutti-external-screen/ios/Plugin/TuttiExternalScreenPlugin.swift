import Foundation
import Capacitor
import UIKit
import WebKit

/**
 * TuttiExternalScreenPlugin — affiche l'écran joueurs (route /screen) sur un
 * affichage EXTERNE (USB-C / AirPlay) avec un contenu indépendant de la console.
 *
 * L'iPad rend lui-même la TV dans une seconde fenêtre → aucune latence réseau
 * côté écran joueurs (contrairement au /screen web qui interroge le serveur).
 *
 * ⚠️ Non compilable hors Xcode/iOS. La gestion des écrans externes est
 *    sensible à la version d'iOS (UIScreen classique vs UIWindowScene). Cette
 *    implémentation UIScreen couvre le cas courant ; à valider sur device et à
 *    adapter si besoin en scènes (iPadOS récent). Cf. native/README.md.
 */
@objc(TuttiExternalScreenPlugin)
public class TuttiExternalScreenPlugin: CAPPlugin {

    // NB: on nomme la propriété `externalWebView` (pas `webView`) car CAPPlugin
    // expose déjà une propriété `webView` (la WebView Capacitor) → "ambiguous
    // use of 'webView'" à la compilation sinon.
    private var externalWindow: UIWindow?
    private var externalWebView: WKWebView?
    private var pendingURL: URL?

    public override func load() {
        NotificationCenter.default.addObserver(
            self, selector: #selector(screenDidConnect),
            name: UIScreen.didConnectNotification, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(screenDidDisconnect),
            name: UIScreen.didDisconnectNotification, object: nil)
    }

    @objc func isConnected(_ call: CAPPluginCall) {
        call.resolve(["connected": UIScreen.screens.count > 1])
    }

    @objc func present(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString) else {
            call.reject("url requise")
            return
        }
        pendingURL = url
        DispatchQueue.main.async {
            let external = UIScreen.screens.first { $0 != UIScreen.main }
            guard let screen = external else {
                // Pas d'écran externe pour l'instant : on mémorise l'URL, la
                // fenêtre s'ouvrira à la connexion (screenDidConnect).
                call.resolve(["presented": false])
                return
            }
            self.showWindow(on: screen, url: url)
            call.resolve(["presented": true])
        }
    }

    @objc func dismiss(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.tearDown()
            call.resolve()
        }
    }

    // MARK: - Interne

    private func showWindow(on screen: UIScreen, url: URL) {
        tearDown()
        let window = UIWindow(frame: screen.bounds)
        window.screen = screen
        let web = WKWebView(frame: window.bounds)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.load(URLRequest(url: url))
        let controller = UIViewController()
        controller.view = web
        window.rootViewController = controller
        window.isHidden = false
        self.externalWindow = window
        self.externalWebView = web
    }

    private func tearDown() {
        externalWebView = nil
        externalWindow?.isHidden = true
        externalWindow = nil
    }

    @objc private func screenDidConnect() {
        guard let url = pendingURL else { return }
        if let screen = UIScreen.screens.first(where: { $0 != UIScreen.main }) {
            showWindow(on: screen, url: url)
        }
    }

    @objc private func screenDidDisconnect() {
        tearDown()
    }
}
