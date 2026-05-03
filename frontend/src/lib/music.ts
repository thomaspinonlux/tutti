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
  opts: { limit?: number; signal?: AbortSignal; provider?: MusicProviderId } = {},
): Promise<{ provider: MusicProviderId; results: TrackResult[] }> {
  const params = new URLSearchParams({ q: query });
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.provider) params.set('provider', opts.provider);
  return api<{ provider: MusicProviderId; query: string; results: TrackResult[] }>(
    `/api/music/search?${params.toString()}`,
    { signal: opts.signal },
  );
}

// ───── YouTube OAuth (Phase 3.5) ─────────────────────────────────────────

export interface YouTubeStatus {
  connected: boolean;
  account_email?: string | null;
  premium?: boolean;
  connected_at?: string | null;
  expires_at?: string | null;
}

export async function startYouTubeConnect(): Promise<string> {
  const { authUrl } = await api<{ authUrl: string }>('/api/auth/youtube/authorize', {
    method: 'POST',
  });
  return authUrl;
}

export async function getYouTubeStatus(): Promise<YouTubeStatus> {
  return api<YouTubeStatus>('/api/auth/youtube/status');
}

export async function disconnectYouTube(): Promise<void> {
  await api('/api/auth/youtube/disconnect', { method: 'DELETE' });
}

export async function setYouTubePremium(premium: boolean): Promise<void> {
  await api('/api/auth/youtube/premium', { method: 'PATCH', body: { premium } });
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

export interface SpotifyTokenResponse {
  access_token: string;
  expires_at: string;
  account_email: string | null;
}

/**
 * Récupère un access token Spotify valide pour le host courant — utilisé
 * par le Web Playback SDK. Le backend rafraîchit transparemment si besoin.
 */
export async function getSpotifyToken(): Promise<SpotifyTokenResponse> {
  return api<SpotifyTokenResponse>('/api/auth/spotify/token');
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
