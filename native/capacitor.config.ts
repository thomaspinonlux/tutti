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
  // Dev à chaud (optionnel) : décommenter et pointer sur le serveur Vite pour
  // recharger l'app sans rebuild. En prod, laisser commenté → webDir sert.
  // server: { url: 'http://192.168.1.XX:5173', cleartext: true },
};

export default config;
