/**
 * playlistSelectionStore.ts — feat/tv-playlist-selection-sync (+ grid mirror)
 *
 * In-memory store éphémère de la SÉLECTION en cours par workspace : la playlist
 * officielle centrée (focus) + la position de scroll de l'écran animateur. Sert
 * à la TV pour mirrorer la grille de sélection (mêmes cards) et suivre le scroll
 * de l'animateur en direct.
 *
 * In-memory (pas DB) : état UI volatil, change ~chaque scroll/snap, sans valeur
 * après crash. TTL court (30s) auto-clear si l'animateur quitte sans POST null.
 * Single-instance (Railway 1 container). Scaling horizontal → Redis pubsub.
 */

const FOCUS_TTL_MS = 30_000;

interface FocusEntry {
  playlistId: string;
  /** Position de scroll de la grille host, ratio 0..1 (cross-device). */
  scrollRatio: number;
  ts: number;
}

const focusByWorkspace = new Map<string, FocusEntry>();

/**
 * Stocke la sélection courante (playlist focused + scroll). `playlistId === null`
 * → clear (sortie de l'écran de sélection).
 */
export function setFocusedPlaylist(
  workspaceId: string,
  playlistId: string | null,
  scrollRatio = 0,
): void {
  if (playlistId === null) {
    focusByWorkspace.delete(workspaceId);
    return;
  }
  const ratio = Number.isFinite(scrollRatio) ? Math.min(1, Math.max(0, scrollRatio)) : 0;
  focusByWorkspace.set(workspaceId, { playlistId, scrollRatio: ratio, ts: Date.now() });
}

/**
 * Lit la sélection courante (playlist focused + scroll). null si rien stocké ou
 * focus trop ancien (> 30s, host probablement parti).
 */
export function getFocusedSelection(
  workspaceId: string,
): { playlistId: string; scrollRatio: number } | null {
  const entry = focusByWorkspace.get(workspaceId);
  if (!entry) return null;
  if (Date.now() - entry.ts > FOCUS_TTL_MS) {
    focusByWorkspace.delete(workspaceId);
    return null;
  }
  return { playlistId: entry.playlistId, scrollRatio: entry.scrollRatio };
}

/** Test helper — vide le store. */
export function _clearAllFocus(): void {
  focusByWorkspace.clear();
}
