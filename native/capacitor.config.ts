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
  // fix/native-youtube-origin — ORIGINE DE LA WEBVIEW.
  //
  // Par défaut Capacitor sert le bundle local sous `capacitor://localhost`.
  // YouTube REFUSE d'embarquer une vidéo depuis une origine qui n'est pas
  // http(s) (erreurs 150/153, « Video not allowed in embedded players ») : le
  // lecteur YouTube ne s'initialisait donc jamais dans l'app iPad, et seule
  // Apple Music fonctionnait en natif. `hostname` + `iosScheme` font servir le
  // MÊME bundle local sous l'origine `https://tuttiparty.app`, que YouTube
  // accepte — aucun contenu n'est chargé depuis le réseau pour autant.
  //
  // Sans effet de bord sur les appels réseau : l'API et le socket passent par
  // VITE_API_URL / VITE_SOCKET_URL (Railway), jamais par une URL relative.
  // Côté backend, l'origine envoyée devient celle du site web déjà autorisé.
  //
  // ⚠️ Changer l'origine RÉINITIALISE le stockage local de l'app : l'animateur
  // devra reconnecter Apple Music une fois après la mise à jour.
  server: {
    hostname: 'tuttiparty.app',
    iosScheme: 'https',
    androidScheme: 'https',
  },

  // Dev à chaud (optionnel) : décommenter et pointer sur le serveur Vite pour
  // recharger l'app sans rebuild. En prod, laisser commenté → webDir sert.
  // server: { url: 'http://192.168.1.XX:5173', cleartext: true },
};

export default config;
