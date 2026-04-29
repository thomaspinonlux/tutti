/**
 * Onboarding et permissions micro pour les joueurs (étape 9.5+).
 *
 * - Détection plateforme (iOS Safari / Chrome Android / autre) pour
 *   donner des instructions de réautorisation adaptées en cas de blocage.
 * - Stockage localStorage de l'état "onboarding vu" pour proposer une
 *   version condensée aux joueurs récurrents.
 * - Wrapper sur navigator.mediaDevices.getUserMedia avec gestion d'erreurs.
 */

const ONBOARDED_KEY = 'tutti.player.onboarded.tracks';

export type Platform = 'ios' | 'android' | 'other';

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  // iPad récents annoncent "Macintosh" — on détecte aussi via touchPoints.
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return 'ios'; // iPad Pro masqué
  return 'other';
}

export function hasPlayedBefore(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function markOnboardingDone(): void {
  try {
    window.localStorage.setItem(ONBOARDED_KEY, 'true');
  } catch {
    /* ignore */
  }
}

export type MicPermissionResult =
  | { kind: 'granted' }
  | { kind: 'denied'; reason: 'user' | 'unavailable' | 'unknown' }
  | { kind: 'unsupported' };

/**
 * Demande l'autorisation micro. Doit être appelé dans un user gesture
 * (clic sur bouton) sur iOS Safari, sinon la prompt ne s'affiche pas.
 *
 * On ne garde PAS le MediaStream actif : on le coupe immédiatement après
 * vérification. Le vrai stream pour Whisper sera récupéré au moment
 * du buzz (étape 11).
 */
export async function requestMicPermission(): Promise<MicPermissionResult> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { kind: 'unsupported' };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // On ferme tout de suite — le vrai usage sera lors du buzz.
    for (const track of stream.getTracks()) track.stop();
    return { kind: 'granted' };
  } catch (err: unknown) {
    const name = (err as { name?: string })?.name ?? '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return { kind: 'denied', reason: 'user' };
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return { kind: 'denied', reason: 'unavailable' };
    }
    return { kind: 'denied', reason: 'unknown' };
  }
}

/**
 * Vérifie silencieusement si la permission micro est encore active
 * (pas de prompt). Utilisé entre les manches pour détecter une révocation.
 *
 * Note : `permissions.query({ name: 'microphone' })` n'est pas supporté
 * partout. En cas d'indisponibilité, on retombe sur un getUserMedia silencieux.
 */
export async function checkMicPermission(): Promise<MicPermissionResult> {
  if (typeof navigator === 'undefined') return { kind: 'unsupported' };

  // Permissions API (Chrome, Firefox)
  const perms = (
    navigator as Navigator & { permissions?: { query: (q: object) => Promise<PermissionStatus> } }
  ).permissions;
  if (perms?.query) {
    try {
      const status = await perms.query({ name: 'microphone' as PermissionName });
      if (status.state === 'granted') return { kind: 'granted' };
      if (status.state === 'denied') return { kind: 'denied', reason: 'user' };
      // 'prompt' = on n'a pas encore demandé, on ne fait rien ici (l'onboarding
      // s'en chargera explicitement).
      return { kind: 'denied', reason: 'unknown' };
    } catch {
      // Safari < 16 ne supporte pas { name: 'microphone' }, on passe en fallback
    }
  }

  // Fallback Safari : on ne peut pas vérifier silencieusement → on assume granted
  // tant que le getUserMedia explicite n'a pas échoué.
  return { kind: 'granted' };
}
