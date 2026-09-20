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
  installerChienDeGarde();
}

/**
 * diag/console-qui-ne-repond-plus — LE JOURNAL DOIT DIRE SI LA PAGE EST MORTE.
 *
 * Soiree du 18/09, 21:36 a 21:38 : la console reste deux minutes sur la grille
 * des playlists, aucun appui ne produit la moindre requete, puis l application
 * est fermee de force. Cote serveur il n y a RIEN a lire — une page qui ne
 * repond plus n envoie rien, pas meme son silence. Impossible de dire si le
 * fil JavaScript etait bloque, si la page avait ete mise en veille par iOS, ou
 * si le bouton lui-meme ne repondait pas.
 *
 * Le chien de garde bat toutes les deux secondes. Quand un battement arrive
 * tres en retard, c est que la page n a pas tourne entre-temps : il le dit,
 * avec le retard mesure et l etat de visibilite — une page en arriere-plan
 * est ralentie par le navigateur, ce qui est normal et doit se distinguer d un
 * vrai blocage. Une seule ligne par episode, jamais de rafale.
 */
const BATTEMENT_MS = 2_000;
/** En dessous, c est l ordinaire : navigateur occupe, rendu en cours. */
const RETARD_SIGNIFICATIF_MS = 10_000;

function installerChienDeGarde(): void {
  if (typeof window === 'undefined') return;
  let dernierBattement = Date.now();
  let cache = false;
  let episodeEnCours = false;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') cache = true;
    // On repart d un battement propre au retour : le temps passe en veille
    // n est pas un blocage.
    dernierBattement = Date.now();
  });
  window.setInterval(() => {
    const maintenant = Date.now();
    const retard = maintenant - dernierBattement - BATTEMENT_MS;
    dernierBattement = maintenant;
    if (retard < RETARD_SIGNIFICATIF_MS) {
      if (episodeEnCours) {
        remoteLog('page-figee', 'la page repond de nouveau', { retardMs: retard }, 'warn');
        episodeEnCours = false;
      }
      cache = false;
      return;
    }
    if (episodeEnCours) return; // deja signale, on n inonde pas
    episodeEnCours = true;
    remoteLog(
      'page-figee',
      `la page n a pas tourne pendant ${Math.round(retard / 1000)} s`,
      { retardMs: retard, visibilite: document.visibilityState, avaitEteCachee: cache },
      'error',
    );
  }, BATTEMENT_MS);
}
