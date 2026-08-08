/**
 * platform.ts — couche « capacités » (bridge natif ⇄ web).
 *
 * Fait tenir les DEUX cibles en parallèle depuis un seul code (cf. docs/NATIVE.md) :
 *   - Web / PWA        → navigateur (joueurs, secours universel)
 *   - Natif iPad       → Capacitor (console + son, ponts Swift)
 *   - Desktop          → Electron (poste du lieu)
 *
 * Principe : le reste de l'app (UI React, logique de jeu) ne sait PAS sur quelle
 * plateforme il tourne. Il interroge ce module, qui choisit la bonne
 * implémentation à l'exécution. La détection se fait via des globals injectés
 * par la coque native — AUCUN import de `@capacitor/core` ni d'`electron` ici,
 * pour que le build web reste 100 % inchangé (pas de nouvelle dépendance).
 *
 * Capacitor injecte `window.Capacitor` dans la WebView native.
 * Electron : le preload (desktop/preload.cjs) pose `window.__TUTTI_DESKTOP__`,
 * et le renderer Electron a de toute façon « Electron » dans son userAgent.
 */

export type Platform = 'web' | 'ios' | 'android' | 'electron';

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string; // 'ios' | 'android' | 'web'
  /** Plugins natifs enregistrés, exposés par la coque Capacitor à l'exécution. */
  Plugins?: Record<string, unknown>;
}

interface TuttiDesktopGlobal {
  platform: 'electron';
  version?: string;
}

declare global {
  interface Window {
    Capacitor?: CapacitorGlobal;
    __TUTTI_DESKTOP__?: TuttiDesktopGlobal;
  }
}

/** True si on tourne dans la coque desktop Electron. */
export function isElectron(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.__TUTTI_DESKTOP__?.platform === 'electron') return true;
  // Filet de sécurité : le renderer Electron expose « Electron » dans l'UA.
  return typeof navigator !== 'undefined' && /\bElectron\//.test(navigator.userAgent);
}

/** True si on tourne dans la coque native Capacitor (iOS / Android). */
export function isCapacitorNative(): boolean {
  if (typeof window === 'undefined') return false;
  return window.Capacitor?.isNativePlatform?.() === true;
}

/** Renvoie la plateforme courante, résolue une seule fois par chargement. */
export function getPlatform(): Platform {
  if (isCapacitorNative()) {
    const p = window.Capacitor?.getPlatform?.();
    if (p === 'ios') return 'ios';
    if (p === 'android') return 'android';
  }
  if (isElectron()) return 'electron';
  return 'web';
}

/** True pour un navigateur classique / PWA (ni Capacitor, ni Electron). */
export function isWeb(): boolean {
  return getPlatform() === 'web';
}

/**
 * Origine à utiliser pour TOUTE URL affichée ou partagée vers un AUTRE appareil
 * (QR de jointure /play, lien « rejoindre », URL de l'écran TV externe, bouton
 * partager, lien de parrainage…).
 *
 * En natif, `window.location.origin` vaut `capacitor://localhost` : inexploitable
 * par un téléphone qui scanne le QR ou par une 2ᵉ WebView (écran externe). On
 * renvoie donc l'URL WEB HÉBERGÉE (`VITE_WEB_ORIGIN`, défaut prod
 * `https://tuttiparty.app`). En web / PWA, l'origine courante convient déjà
 * (c'est `tuttiparty.app`). Jamais de slash final.
 *
 * ⚠️ NE PAS utiliser pour les redirections d'auth (OAuth / reset password) :
 * celles-ci doivent revenir vers l'origine qui exécute réellement l'app.
 */
export function getShareableOrigin(): string {
  if (isCapacitorNative()) {
    return (import.meta.env.VITE_WEB_ORIGIN ?? 'https://tuttiparty.app').replace(/\/$/, '');
  }
  return typeof window !== 'undefined' ? window.location.origin : '';
}

/**
 * True si la plateforme peut fournir une lecture Apple Music NATIVE
 * (MusicKit Swift, sans blocage autoplay) : iOS via Capacitor uniquement.
 * Partout ailleurs on reste sur MusicKit JS (web) — cf. useAppleMusicPlayer.
 * Utilisé plus tard pour brancher `NativeMusicKit` vs `WebMusicKitJS`.
 */
export function supportsNativeAppleMusic(): boolean {
  return getPlatform() === 'ios';
}

/**
 * True si la plateforme peut sortir l'écran joueurs sur un affichage EXTERNE
 * avec un contenu indépendant (iPad natif). Le web ne sait que recopier l'écran.
 */
export function supportsExternalPlayerScreen(): boolean {
  return getPlatform() === 'ios';
}
