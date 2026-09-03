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
    /// feat/tv-native — écran joueurs rendu NATIVEMENT (aucune WebView).
    private var nativeTv: TuttiTvViewController?
    private var pendingNativeApiBase: String?
    private var pendingNativeWorkspaceId: String?
    private var watchdogTimer: Timer?
    private var pingFailures = 0

    public override func load() {
        NotificationCenter.default.addObserver(
            self, selector: #selector(screenDidConnect),
            name: UIScreen.didConnectNotification, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(screenDidDisconnect),
            name: UIScreen.didDisconnectNotification, object: nil)
        // fix/tv-plein-ecran — la TV peut annoncer sa résolution définitive
        // APRÈS l'ouverture de la fenêtre : on recadre à chaque changement.
        NotificationCenter.default.addObserver(
            self, selector: #selector(screenModeDidChange),
            name: UIScreen.modeDidChangeNotification, object: nil)
    }

    // fix/geometrie-lue-hors-fil-principal — toutes les autres méthodes de ce
    // greffon basculent sur le fil principal ; celle-ci lisait l'écran et la
    // fenêtre depuis la file d'arrière-plan de Capacitor, d'où des dimensions
    // incohérentes et un risque d'arrêt brutal.
    @objc func isConnected(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.lireConnexion(call) }
    }

    private func lireConnexion(_ call: CAPPluginCall) {
        let external = UIScreen.screens.first { $0 != UIScreen.main }
        var payload: [String: Any] = ["connected": external != nil]
        if let screen = external {
            payload["width"] = Int(screen.bounds.width)
            payload["height"] = Int(screen.bounds.height)
            payload["scale"] = screen.scale
            payload["windowWidth"] = Int(externalWindow?.frame.width ?? 0)
            payload["windowHeight"] = Int(externalWindow?.frame.height ?? 0)
        }
        call.resolve(payload)
    }

    @objc func present(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString) else {
            call.reject("url requise")
            return
        }
        pendingURL = url
        pendingNativeApiBase = nil
        pendingNativeWorkspaceId = nil
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

    /**
     * feat/tv-native — ouvre l'écran joueurs en rendu NATIF sur la TV.
     *
     * Aucune WebView : plus rien qu'iOS puisse tuer sous pression mémoire, et
     * la vue lit directement le lecteur de l'app pour ne jamais afficher un
     * morceau que la salle n'entend pas encore.
     */
    @objc func presentNative(_ call: CAPPluginCall) {
        guard let apiBase = call.getString("apiBase"),
              let workspaceId = call.getString("workspaceId"),
              !apiBase.isEmpty, !workspaceId.isEmpty else {
            call.reject("apiBase et workspaceId requis")
            return
        }
        pendingURL = nil
        pendingNativeApiBase = apiBase
        pendingNativeWorkspaceId = workspaceId
        DispatchQueue.main.async {
            guard let screen = UIScreen.screens.first(where: { $0 != UIScreen.main }) else {
                call.resolve(["presented": false])
                return
            }
            self.showNativeWindow(on: screen, apiBase: apiBase, workspaceId: workspaceId)
            call.resolve(["presented": true])
        }
    }

    /**
     * feat/tv-native — VÉRITÉ DU LECTEUR poussée par la console, sans réseau.
     * `trackId` est l'identifiant du morceau RÉELLEMENT en cours de lecture :
     * la TV ne bascule sur un nouveau morceau que lorsqu'il arrive ici. C'est
     * ce qui rend tout décalage image/son structurellement impossible.
     */
    @objc func updatePlayback(_ call: CAPPluginCall) {
        let trackId = call.getString("trackId") ?? ""
        let positionMs = call.getDouble("positionMs") ?? 0
        let durationMs = call.getDouble("durationMs") ?? 0
        let isPaused = call.getBool("isPaused") ?? false
        DispatchQueue.main.async {
            self.nativeTv?.updatePlayback(
                trackId: trackId,
                positionMs: positionMs,
                durationMs: durationMs,
                isPaused: isPaused)
            call.resolve()
        }
    }

    @objc func dismiss(_ call: CAPPluginCall) {
        pendingURL = nil
        pendingNativeApiBase = nil
        pendingNativeWorkspaceId = nil
        DispatchQueue.main.async {
            self.tearDown()
            call.resolve()
        }
    }

    // MARK: - Interne

    private func showWindow(on screen: UIScreen, url: URL) {
        tearDown()

        // fix/tv-plein-ecran — GÉOMÉTRIE DE L'ÉCRAN EXTERNE.
        // Symptôme corrigé : l'image n'occupait qu'une partie de la TV (bande
        // noire sur le côté). Trois causes possibles, toutes traitées ici :
        //  1. iPadOS choisit par défaut un MODE d'affichage réduit sur la TV →
        //     on force explicitement le mode de plus grande résolution.
        //  2. L'overscan : on demande une mise à l'échelle propre.
        //  3. `screen.bounds` n'est pas encore définitif à la connexion HDMI →
        //     la fenêtre était dimensionnée sur une valeur provisoire. On
        //     ré-applique donc la géométrie plusieurs fois après l'ouverture,
        //     et à chaque changement de mode de l'écran.
        if let best = screen.availableModes.max(by: {
            ($0.size.width * $0.size.height) < ($1.size.width * $1.size.height)
        }) {
            screen.currentMode = best
        }
        screen.overscanCompensation = .scale

        // Fenêtre rattachée à l'écran externe. Sur les iPadOS récents la scène
        // dédiée à l'affichage externe existe parfois : on l'utilise en
        // priorité (géométrie fiable), sinon on retombe sur `window.screen`.
        let window: UIWindow
        if let scene = externalWindowScene(for: screen) {
            window = UIWindow(windowScene: scene)
        } else {
            window = UIWindow(frame: screen.bounds)
            window.screen = screen
        }
        window.backgroundColor = .black
        window.frame = screen.bounds

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        let web = WKWebView(frame: window.bounds, configuration: config)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.navigationDelegate = self
        web.backgroundColor = .black
        web.isOpaque = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.isScrollEnabled = false
        web.insetsLayoutMarginsFromSafeArea = false
        web.load(URLRequest(url: url))

        let controller = UIViewController()
        controller.view = web
        controller.view.backgroundColor = .black
        window.rootViewController = controller
        window.isHidden = false

        self.externalWindow = window
        self.externalWebView = web

        CAPLog.print("TuttiExternalScreen: fenêtre ouverte, bounds=\(screen.bounds)")

        // Ré-application différée de la géométrie (bounds définitifs).
        for delay in [0.3, 1.0, 2.5, 5.0] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                self?.applyLayout()
            }
        }
        startWatchdog()
    }

    /// feat/tv-native — même géométrie que la version web, mais la fenêtre
    /// héberge le contrôleur natif au lieu d'une WebView.
    private func showNativeWindow(on screen: UIScreen, apiBase: String, workspaceId: String) {
        tearDown()

        if let best = screen.availableModes.max(by: {
            ($0.size.width * $0.size.height) < ($1.size.width * $1.size.height)
        }) {
            screen.currentMode = best
        }
        screen.overscanCompensation = .scale

        let window: UIWindow
        if let scene = externalWindowScene(for: screen) {
            window = UIWindow(windowScene: scene)
        } else {
            window = UIWindow(frame: screen.bounds)
            window.screen = screen
        }
        window.backgroundColor = .black
        window.frame = screen.bounds

        let tv = TuttiTvViewController(apiBase: apiBase, workspaceId: workspaceId)
        window.rootViewController = tv
        window.isHidden = false

        self.externalWindow = window
        self.nativeTv = tv
        self.externalWebView = nil

        CAPLog.print("TuttiExternalScreen: TV NATIVE ouverte, bounds=\(screen.bounds)")

        for delay in [0.3, 1.0, 2.5, 5.0] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                self?.applyLayout()
            }
        }
    }

    /// Scène dédiée à un affichage externe, si iPadOS en a créé une.
    private func externalWindowScene(for screen: UIScreen) -> UIWindowScene? {
        for scene in UIApplication.shared.connectedScenes {
            guard let windowScene = scene as? UIWindowScene else { continue }
            if windowScene.screen === screen { return windowScene }
        }
        return nil
    }

    /// Recolle fenêtre + WebView aux dimensions RÉELLES de l'écran externe.
    private func applyLayout() {
        guard let window = externalWindow,
              let screen = UIScreen.screens.first(where: { $0 != UIScreen.main }) else { return }
        let bounds = screen.bounds
        guard bounds.width > 0, bounds.height > 0 else { return }
        if window.frame != bounds {
            CAPLog.print("TuttiExternalScreen: recadrage \(window.frame) → \(bounds)")
            window.frame = bounds
        }
        window.rootViewController?.view.frame = window.bounds
        externalWebView?.frame = window.bounds
    }

    private func tearDown() {
        stopWatchdog()
        nativeTv = nil
        externalWebView?.navigationDelegate = nil
        externalWebView = nil
        externalWindow?.isHidden = true
        externalWindow = nil
    }

    /// Reconstruit intégralement fenêtre + WebView sur l'écran externe courant.
    private func rebuild(reason: String) {
        CAPLog.print("TuttiExternalScreen: rebuild (\(reason))")
        guard let screen = UIScreen.screens.first(where: { $0 != UIScreen.main }) else {
            tearDown()
            return
        }
        if let apiBase = pendingNativeApiBase, let workspaceId = pendingNativeWorkspaceId {
            showNativeWindow(on: screen, apiBase: apiBase, workspaceId: workspaceId)
            return
        }
        guard let url = pendingURL else {
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

    // MARK: - Mécanisme 2 : chien de garde natif par BATTEMENT DE COEUR
    //
    // La page /screen écrit window.__tuttiBeat = Date.now() ~1×/s. On le lit
    // toutes les 4 s : s'il ne bouge plus sur 2 lectures (~8 s), la page est
    // morte MEME si le moteur JS répond (timers suspendus par iOS, boucle de
    // rechargement, deadlock) → reconstruction. Un simple eval("1") raterait
    // ces cas : il répond tant que le processus vit.
    // Grâce de démarrage : tant que __tuttiBeat n'existe pas (page en cours de
    // chargement), on tolère jusqu'à 5 lectures (~20 s) avant de reconstruire.

    private var lastBeat: Double = -1
    private var stalledChecks = 0
    private var noBeatChecks = 0

    private func startWatchdog() {
        stopWatchdog()
        let timer = Timer(timeInterval: 4.0, repeats: true) { [weak self] _ in
            self?.checkHeartbeat()
        }
        RunLoop.main.add(timer, forMode: .common)
        watchdogTimer = timer
    }

    private func stopWatchdog() {
        watchdogTimer?.invalidate()
        watchdogTimer = nil
        pingFailures = 0
        lastBeat = -1
        stalledChecks = 0
        noBeatChecks = 0
    }

    private func checkHeartbeat() {
        guard let web = externalWebView else { return }
        web.evaluateJavaScript("window.__tuttiBeat || 0") { [weak self] result, error in
            guard let self = self else { return }
            if error != nil {
                // Moteur injoignable (processus mort sans notification) :
                // 2 échecs d'affilée → reconstruction.
                self.pingFailures += 1
                if self.pingFailures >= 2 {
                    self.rebuild(reason: "eval failed ×\(self.pingFailures)")
                }
                return
            }
            self.pingFailures = 0
            let beat = (result as? Double) ?? ((result as? NSNumber)?.doubleValue ?? 0)
            if beat <= 0 {
                // Page pas encore prête (pas de battement publié).
                self.noBeatChecks += 1
                if self.noBeatChecks >= 5 {
                    self.rebuild(reason: "page sans battement (~20 s)")
                }
                return
            }
            self.noBeatChecks = 0
            if beat == self.lastBeat {
                self.stalledChecks += 1
                if self.stalledChecks >= 2 {
                    self.rebuild(reason: "battement arrêté (~8 s)")
                }
            } else {
                self.lastBeat = beat
                self.stalledChecks = 0
            }
        }
    }

    @objc private func screenModeDidChange() {
        applyLayout()
    }

    @objc private func screenDidConnect() {
        guard let screen = UIScreen.screens.first(where: { $0 != UIScreen.main }) else { return }
        if let apiBase = pendingNativeApiBase, let workspaceId = pendingNativeWorkspaceId {
            showNativeWindow(on: screen, apiBase: apiBase, workspaceId: workspaceId)
            return
        }
        if let url = pendingURL {
            showWindow(on: screen, url: url)
        }
    }

    @objc private func screenDidDisconnect() {
        tearDown()
    }
}
