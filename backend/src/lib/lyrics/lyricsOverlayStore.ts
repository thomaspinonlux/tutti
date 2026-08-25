/**
 * lyricsOverlayStore.ts — état « paroles affichées ? » par SESSION.
 *
 * Même esprit que qrOverlayStore (in-memory, TTL 4 h) : c'est de l'état UI
 * volatil, sans valeur après un redémarrage. Deux différences assumées :
 *   - indexé par SESSION (et non par workspace) : les paroles suivent le
 *     morceau en cours, qui est une notion de session ;
 *   - remis à zéro à chaque changement de morceau / fin de manche / fin de
 *     session (cf. gameplayCore), pour qu'un overlay ne survive jamais au
 *     titre auquel il appartient.
 *
 * L'affichage est TOUJOURS déclenché à la main par l'animateur — jamais
 * automatiquement à la révélation.
 */

const LYRICS_TTL_MS = 4 * 60 * 60 * 1000; // 4 h, filet de sécurité

interface Entry {
  on: boolean;
  ts: number;
}

const lyricsBySession = new Map<string, Entry>();

export function setLyricsOverlay(sessionId: string, on: boolean): void {
  if (!sessionId) return;
  lyricsBySession.set(sessionId, { on, ts: Date.now() });
}

export function getLyricsOverlay(sessionId: string): boolean {
  if (!sessionId) return false;
  const entry = lyricsBySession.get(sessionId);
  if (!entry) return false;
  if (Date.now() - entry.ts > LYRICS_TTL_MS) {
    lyricsBySession.delete(sessionId);
    return false;
  }
  return entry.on;
}

/**
 * Éteint l'overlay. Appelé à chaque nouveau morceau, fin de manche, fin de
 * session et abandon : les paroles d'un titre ne doivent jamais déborder sur
 * le suivant.
 */
export function clearLyricsOverlay(sessionId: string): void {
  if (!sessionId) return;
  lyricsBySession.delete(sessionId);
}

/** Réinitialisation complète — tests uniquement. */
export function _clearAllLyricsOverlay(): void {
  lyricsBySession.clear();
}
