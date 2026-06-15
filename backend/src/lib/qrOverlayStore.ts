/**
 * qrOverlayStore.ts — feat/tv-join-qr-codes
 *
 * Flag in-memory par workspace : "l'animateur veut afficher le QR de
 * rejoindre EN GRAND sur la TV". Piloté par l'animateur (toggle), lu par la
 * TV via screen-state.
 *
 * INDÉPENDANT de l'état principal (focused-playlist) : ce flag vaut pendant
 * PLAYING, PAUSED et PLAYLIST_SELECTION — pas seulement la sélection. On le
 * garde donc dans un store séparé du focus.
 *
 * In-memory (pas DB) : état UI volatil, sans valeur après crash. TTL long
 * (4h) = simple filet de sécurité si l'animateur ferme sans toggle off ;
 * le cas normal = re-clic → off → delete. Single-instance (Railway 1
 * container). Scaling horizontal → Redis.
 */

const QR_TTL_MS = 4 * 60 * 60 * 1000; // 4h safety net

interface Entry {
  ts: number;
}

const qrByWorkspace = new Map<string, Entry>();

/** Active (on=true) ou coupe (on=false) l'overlay QR géant pour ce workspace. */
export function setQrOverlay(workspaceId: string, on: boolean): void {
  if (!on) {
    qrByWorkspace.delete(workspaceId);
    return;
  }
  qrByWorkspace.set(workspaceId, { ts: Date.now() });
}

/** true si l'overlay QR géant est demandé (et pas expiré). */
export function getQrOverlay(workspaceId: string): boolean {
  const entry = qrByWorkspace.get(workspaceId);
  if (!entry) return false;
  if (Date.now() - entry.ts > QR_TTL_MS) {
    qrByWorkspace.delete(workspaceId);
    return false;
  }
  return true;
}

/** Test helper — vide le store. */
export function _clearAllQrOverlay(): void {
  qrByWorkspace.clear();
}
