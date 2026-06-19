/**
 * tvAudioTargetStore.ts — feat/tv-audio-output
 *
 * Flags in-memory par workspace pour le routing audio vers l'écran TV :
 *
 *   - audio_target      : 'host' (défaut) | 'tv'
 *                         Posté par le HOST quand il toggle "sortir le son sur
 *                         l'écran TV". Persiste tant que la session vit ; TTL
 *                         de sécurité 4h si jamais l'animateur ne re-toggle pas.
 *
 *   - tv_audio_armed    : boolean (défaut false)
 *                         Posté par la TV quand l'utilisateur clique "Activer
 *                         le son sur cet écran" (gesture nécessaire pour
 *                         débloquer l'autoplay navigateur).
 *                         TTL court (60s) — si la TV se déconnecte / unmount,
 *                         on retombe sur le host (jamais de silence).
 *
 *   - tv_spotify_ready  : boolean (défaut false)
 *                         Posté par la TV quand son Spotify Web Playback SDK
 *                         est connecté + 'ready'. Tant qu'il vaut false, les
 *                         tracks Spotify restent sur le host (résolution du
 *                         sink côté client gère ce cas, cf. lib/audioSink).
 *                         TTL court (60s) — refresh à chaque heartbeat TV.
 *
 * In-memory (pas DB) : flags volatils sans valeur après crash. Single-instance
 * (Railway 1 container). Scaling horizontal → Redis pubsub.
 */

export type AudioTarget = 'host' | 'tv';

const TARGET_TTL_MS = 4 * 60 * 60 * 1000; // 4h safety net
const TV_FLAG_TTL_MS = 60_000; // 60s — re-POSTé par la TV (heartbeat)

interface TargetEntry {
  value: AudioTarget;
  ts: number;
}
interface FlagEntry {
  value: boolean;
  ts: number;
}

const targetByWorkspace = new Map<string, TargetEntry>();
const tvAudioArmedByWorkspace = new Map<string, FlagEntry>();
const tvSpotifyReadyByWorkspace = new Map<string, FlagEntry>();

function readWithTtl<T>(
  map: Map<string, { value: T; ts: number }>,
  id: string,
  ttl: number,
): T | null {
  const e = map.get(id);
  if (!e) return null;
  if (Date.now() - e.ts > ttl) {
    map.delete(id);
    return null;
  }
  return e.value;
}

export function setAudioTarget(workspaceId: string, target: AudioTarget): void {
  targetByWorkspace.set(workspaceId, { value: target, ts: Date.now() });
}
export function getAudioTarget(workspaceId: string): AudioTarget {
  return readWithTtl(targetByWorkspace, workspaceId, TARGET_TTL_MS) ?? 'host';
}

export function setTvAudioArmed(workspaceId: string, armed: boolean): void {
  if (!armed) {
    tvAudioArmedByWorkspace.delete(workspaceId);
    return;
  }
  tvAudioArmedByWorkspace.set(workspaceId, { value: true, ts: Date.now() });
}
export function getTvAudioArmed(workspaceId: string): boolean {
  return readWithTtl(tvAudioArmedByWorkspace, workspaceId, TV_FLAG_TTL_MS) ?? false;
}

export function setTvSpotifyReady(workspaceId: string, ready: boolean): void {
  if (!ready) {
    tvSpotifyReadyByWorkspace.delete(workspaceId);
    return;
  }
  tvSpotifyReadyByWorkspace.set(workspaceId, { value: true, ts: Date.now() });
}
export function getTvSpotifyReady(workspaceId: string): boolean {
  return readWithTtl(tvSpotifyReadyByWorkspace, workspaceId, TV_FLAG_TTL_MS) ?? false;
}

/** Test helper — vide tous les stores audio target. */
export function _clearAllTvAudioStores(): void {
  targetByWorkspace.clear();
  tvAudioArmedByWorkspace.clear();
  tvSpotifyReadyByWorkspace.clear();
}
