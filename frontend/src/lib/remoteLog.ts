/**
 * remoteLog — journal distant des appareils (cf. backend routes/clientLog).
 *
 * Envoie une étape clé ou une erreur au serveur, pour qu'elle soit lisible
 * dans les logs même quand l'appareil se fige et que personne ne peut ouvrir
 * sa console. Fire-and-forget : jamais bloquant, jamais d'exception.
 *
 * Usage : remoteLog('lancement', 'clic Démarrer', { playlist: id });
 */
import { api } from './api.js';
import { isCapacitorNative } from './platform.js';

const DEVICE = (() => {
  if (typeof navigator === 'undefined') return 'inconnu';
  const ua = navigator.userAgent;
  const kind = /iPad/.test(ua)
    ? 'iPad'
    : /iPhone/.test(ua)
      ? 'iPhone'
      : /Mac/.test(ua)
        ? 'Mac'
        : 'web';
  return isCapacitorNative() ? `${kind}-app` : `${kind}-navigateur`;
})();

export function remoteLog(
  tag: string,
  message: string,
  meta?: Record<string, unknown>,
  level: 'info' | 'warn' | 'error' = 'info',
): void {
  try {
    const line = `[${tag}] ${message}`;
    if (level === 'error') console.error(line, meta ?? '');
    else if (level === 'warn') console.warn(line, meta ?? '');
    else console.info(line, meta ?? '');
    // diag/journal-sans-compte — l'écran TV et les joueurs n'ont pas de compte :
    // leurs lignes partaient vers la route authentifiée et étaient refusées en
    // silence. Route publique dédiée, débit plafonné côté serveur.
    void api('/api/client-log/public', {
      method: 'POST',
      anonymous: true,
      headers: { 'x-tutti-diag': '1' },
      body: { tag, level, message: message.slice(0, 600), meta, device: DEVICE },
    }).catch(() => undefined);
  } catch {
    /* jamais bloquant */
  }
}

/**
 * Capture globale : toute erreur JavaScript non gérée et toute promesse rejetée
 * sans rattrapage sont envoyées au serveur. À installer une seule fois.
 */
let installed = false;
export function installRemoteErrorCapture(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (e) => {
    remoteLog(
      'erreur-js',
      e.message || 'erreur inconnue',
      {
        source: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined,
      },
      'error',
    );
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason instanceof Error ? e.reason.message : String(e.reason);
    remoteLog('promesse-rejetee', reason, undefined, 'error');
  });
}
