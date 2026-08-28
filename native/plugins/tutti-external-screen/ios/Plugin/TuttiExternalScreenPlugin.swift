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
 * fix/tv-freeze — armure anti-gel, deux mécanismes NATIFS (hors de la page,
 * donc insensibles à sa mort) :
 *  1. webViewWebContentProcessDidTerminate : iOS tue le processus de la
 *     WebView TV sous pression mémoire → l'image reste figée à jamais si on
 *     ne fait rien (c'était LE bug). On reconstruit la fenêtre immédiatement.
 *  2. Chien de garde natif : toutes les 5 s on ping le JS de la vue TV
 *     (evaluateJavaScript). 2 échecs consécutifs → reconstruction. Couvre les
 *     gels que l'iOS ne signale pas (JS bloqué, page morte silencieusement).
 *
 * ⚠️ Non compilable hors Xcode/iOS. Cf. native/README.md.
 */
@objc(TuttiExternalScreenPlugin)
public class TuttiExternalScreenPlugin: CAPPlugin, WKNavigationDelegate {

    // NB: on nomme la propriété `externalWebView` (pas `webView`) car CAPPlugin
    // expose déjà une propriété `webView` (la WebView Capacitor) → "ambiguous
    // use of 'webView'" à la compilation sinon.
    private var externalWindow: UIWindow?
    private var externalWebView: WKWebView?
    private var pendingURL: URL?
    private var watchdogTimer: Timer?
    private var pingFailures = 0

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
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        let web = WKWebView(frame: window.bounds, configuration: config)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.navigationDelegate = self
        web.load(URLRequest(url: url))
        let controller = UIViewController()
        controller.view = web
        window.rootViewController = controller
        window.isHidden = false
        self.externalWindow = window
        self.externalWebView = web
        startWatchdog()
    }

    private func tearDown() {
        stopWatchdog()
        externalWebView?.navigationDelegate = nil
        externalWebView = nil
        externalWindow?.isHidden = true
        externalWindow = nil
    }

    /// Reconstruit intégralement fenêtre + WebView sur l'écran externe courant.
    private func rebuild(reason: String) {
        CAPLog.print("TuttiExternalScreen: rebuild (\(reason))")
        guard let url = pendingURL,
              let screen = UIScreen.screens.first(where: { $0 != UIScreen.main }) else {
            tearDown()
            return
        }
        showWindow(on: screen, url: url)
    }

    // MARK: - Mécanisme 1 : mort du processus WebView (pression mémoire iOS)

    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        DispatchQueue.main.async {
            guard webView === self.externalWebView else { return }
            self.rebuild(reason: "content process terminated")
        }
    }

    // MARK: - Mécanisme 2 : chien de garde natif (ping JS toutes les 5 s)

    private func startWatchdog() {
        stopWatchdog()
        pingFailures = 0
        let timer = Timer(timeInterval: 5.0, repeats: true) { [weak self] _ in
            self?.pingExternal()
        }
        RunLoop.main.add(timer, forMode: .common)
        watchdogTimer = timer
    }

    private func stopWatchdog() {
        watchdogTimer?.invalidate()
        watchdogTimer = nil
        pingFailures = 0
    }

    private func pingExternal() {
        guard let web = externalWebView else { return }
        web.evaluateJavaScript("1") { [weak self] _, error in
            guard let self = self else { return }
            if error == nil {
                self.pingFailures = 0
                return
            }
            self.pingFailures += 1
            if self.pingFailures >= 2 {
                self.rebuild(reason: "watchdog ping failed ×\(self.pingFailures)")
            }
        }
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
