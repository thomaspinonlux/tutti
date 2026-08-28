import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Config Capacitor — coque native de la console Tutti.
 *
 * `webDir` pointe vers le build du frontend du workspace (`../frontend/dist`),
 * produit par `pnpm -C ../frontend build`. Aucune duplication de code : la
 * coque emballe EXACTEMENT la même app web (cf. docs/NATIVE.md, cible B).
 *
 * Détection côté JS : Capacitor injecte `window.Capacitor` dans la WebView, ce
 * que lit `frontend/src/lib/platform.ts` (isCapacitorNative / supportsNativeAppleMusic).
 */
const config: CapacitorConfig = {
  appId: 'app.tuttiparty',
  appName: 'Tutti',
  webDir: '../frontend/dist',
  ios: {
    // La console joue le son : on garde la WebView audible même en arrière-plan
    // (voir aussi la capability UIBackgroundModes=audio à ajouter dans Xcode).
    contentInset: 'always',
  },
  // fix/native-youtube-origin (v2) — LA WEBVIEW CHARGE LE SITE EN LIGNE.
  //
  // Historique du problème : par défaut Capacitor sert le bundle local sous
  // `capacitor://localhost`. YouTube refuse d'embarquer une vidéo depuis une
  // origine qui n'est pas http(s) (erreurs 150/153) → le lecteur YouTube ne
  // s'initialisait JAMAIS dans l'app, seule Apple Music fonctionnait.
  //
  // Tentative écartée : `hostname` + `iosScheme: 'https'`. Sur iOS le schéma
  // reste `capacitor` quoi qu'il arrive — WKWebView interdit d'enregistrer un
  // gestionnaire pour http/https. On obtenait `capacitor://tuttiparty.app`,
  // toujours refusé par YouTube, et en prime bloqué par le CORS du backend.
  //
  // Solution retenue : `server.url` — la WebView charge le site déployé. L'app
  // tourne alors sous l'origine RÉELLE `https://tuttiparty.app`, acceptée par
  // YouTube comme par le backend. `window.Capacitor` reste injecté, donc les
  // plugins natifs (MusicKit, écran externe) continuent de fonctionner.
  //
  // Effet de bord assumé : l'app a besoin du réseau au démarrage (elle en a
  // besoin de toute façon : API, streaming Apple Music et YouTube). En
  // contrepartie, une mise à jour du site met l'app à jour immédiatement,
  // sans passer par TestFlight.
  server: {
    url: 'https://tuttiparty.app',
    cleartext: false,
  },

  // Dev à chaud (optionnel) : décommenter et pointer sur le serveur Vite pour
  // recharger l'app sans rebuild. En prod, laisser commenté → webDir sert.
  // server: { url: 'http://192.168.1.XX:5173', cleartext: true },
};

export default config;
