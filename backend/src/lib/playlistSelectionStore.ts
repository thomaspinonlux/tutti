/**
 * playlistSelectionStore.ts — feat/tv-playlist-selection-sync
 *
 * In-memory store éphémère du "playlist focused" par workspace. Utilisé pour
 * que l'écran TV affiche la playlist actuellement centrée par l'animateur
 * pendant la sélection (avant lancement de la partie OU entre 2 manches).
 *
 * Pourquoi in-memory et pas en DB : c'est un état UI volatil (focus carrousel),
 * change ~chaque scroll/snap, pas de valeur après crash backend. TTL court
 * (30s) auto-clear si l'animateur quitte la sélection sans POST null.
 *
 * Conçu single-instance backend (Railway un seul container). Si on passe à
 * du scaling horizontal, migrer vers Redis pubsub.
 */

const FOCUS_TTL_MS = 30_000;

interface FocusEntry {
  playlistId: string;
  ts: number;
}

const focusByWorkspace = new Map<string, FocusEntry>();

/**
 * Stocke le focus playlist pour ce workspace. Appeler avec `null` pour
 * clear (sortie de l'écran de sélection).
 */
export function setFocusedPlaylist(workspaceId: string, playlistId: string | null): void {
  if (playlistId === null) {
    focusByWorkspace.delete(workspaceId);
    return;
  }
  focusByWorkspace.set(workspaceId, { playlistId, ts: Date.now() });
}

/**
 * Lit le focus playlist actuel pour ce workspace. Retourne null si :
 *   - aucun focus stocké
 *   - focus trop ancien (> 30s, host probablement parti)
 */
export function getFocusedPlaylist(workspaceId: string): string | null {
  const entry = focusByWorkspace.get(workspaceId);
  if (!entry) return null;
  if (Date.now() - entry.ts > FOCUS_TTL_MS) {
    focusByWorkspace.delete(workspaceId);
    return null;
  }
  return entry.playlistId;
}

/** Test helper — vide le store. */
export function _clearAllFocus(): void {
  focusByWorkspace.clear();
}
