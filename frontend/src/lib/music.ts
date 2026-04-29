/**
 * Wrapper API pour les routes /api/music/*.
 *
 * Le frontend ne connaît jamais le provider concret — il appelle toujours
 * `searchTracks(q)` qui résout côté backend selon le provider actif de
 * l'establishment.
 */

import type { MusicProviderId, ProviderInfo, TrackResult } from '@tutti/shared';
import { api } from './api.js';

export async function listProviders(): Promise<ProviderInfo[]> {
  const data = await api<{ providers: ProviderInfo[] }>('/api/music/providers');
  return data.providers;
}

export async function searchTracks(
  query: string,
  opts: { limit?: number; signal?: AbortSignal } = {},
): Promise<{ provider: MusicProviderId; results: TrackResult[] }> {
  const params = new URLSearchParams({ q: query });
  if (opts.limit) params.set('limit', String(opts.limit));
  return api<{ provider: MusicProviderId; query: string; results: TrackResult[] }>(
    `/api/music/search?${params.toString()}`,
    { signal: opts.signal },
  );
}

// ───── Spotify OAuth ──────────────────────────────────────────────────────

export interface SpotifyStatus {
  connected: boolean;
  account_email: string | null;
  expires_at: string | null;
  connected_at: string | null;
}

/** Lance la connexion Spotify — retourne l'URL d'autorisation à laquelle rediriger. */
export async function startSpotifyConnect(): Promise<string> {
  const { authUrl } = await api<{ authUrl: string }>('/api/auth/spotify/authorize', {
    method: 'POST',
  });
  return authUrl;
}

export async function getSpotifyStatus(): Promise<SpotifyStatus> {
  return api<SpotifyStatus>('/api/auth/spotify/status');
}

export async function disconnectSpotify(): Promise<void> {
  await api('/api/auth/spotify/disconnect', { method: 'DELETE' });
}

export async function getTrack(providerTrackId: string): Promise<TrackResult | null> {
  try {
    const data = await api<{ track: TrackResult }>(
      `/api/music/track/${encodeURIComponent(providerTrackId)}`,
    );
    return data.track;
  } catch (err) {
    // 404 = pas trouvé : on remonte null (l'erreur n'est pas exceptionnelle).
    if (err instanceof Error && err.message.toLowerCase().includes('introuvable')) {
      return null;
    }
    throw err;
  }
}
