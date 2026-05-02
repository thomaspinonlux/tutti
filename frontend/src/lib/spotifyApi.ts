/**
 * Wrappers API /api/spotify/* + import bulk + duplicates check.
 * Utilisés par les 3 modes de création de playlist (search-tracks /
 * my-playlists / search-playlists).
 */

import type { TrackResult } from '@tutti/shared';
import { api } from './api.js';

export interface SpotifyPlaylistSummary {
  id: string;
  name: string;
  description: string | null;
  cover_url: string | null;
  owner_name: string;
  owner_id: string;
  tracks_count: number;
  is_public: boolean;
  is_collaborative: boolean;
  followers_count: number | null;
}

export interface PaginatedTracks {
  items: TrackResult[];
  total: number;
  next: string | null;
}

export interface PaginatedPlaylists {
  items: SpotifyPlaylistSummary[];
  total: number;
  next: string | null;
}

export interface SearchTracksParams {
  artist?: string;
  track?: string;
  year_min?: number;
  year_max?: number;
  genre?: string;
  market?: string;
  limit?: number;
  offset?: number;
}

function toQuery(p: Record<string, unknown> | object): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
    if (v === undefined || v === null || v === '') continue;
    u.set(k, String(v));
  }
  return u.toString();
}

export async function searchTracks(p: SearchTracksParams): Promise<PaginatedTracks> {
  const qs = toQuery(p);
  return api<PaginatedTracks>(`/api/spotify/search-tracks?${qs}`);
}

export async function getMyPlaylists(
  opts: { limit?: number; offset?: number } = {},
): Promise<PaginatedPlaylists> {
  const qs = toQuery(opts);
  return api<PaginatedPlaylists>(`/api/spotify/my-playlists?${qs}`);
}

export async function searchPlaylists(opts: {
  q: string;
  market?: string;
  limit?: number;
  offset?: number;
}): Promise<PaginatedPlaylists> {
  const qs = toQuery(opts);
  return api<PaginatedPlaylists>(`/api/spotify/search-playlists?${qs}`);
}

export async function getSpotifyPlaylistTracks(
  playlistId: string,
  opts: { limit?: number; offset?: number; market?: string } = {},
): Promise<PaginatedTracks> {
  const qs = toQuery(opts);
  return api<PaginatedTracks>(
    `/api/spotify/playlist/${encodeURIComponent(playlistId)}/tracks?${qs}`,
  );
}

// ── Import bulk vers une playlist Tutti ─────────────────────────────────

export interface ImportTracksResult {
  imported: number;
  skipped: number;
  errors: Array<{ provider_track_id: string; error: string }>;
}

export async function importTracks(
  playlistId: string,
  provider: 'spotify' | 'demo',
  providerTrackIds: string[],
): Promise<ImportTracksResult> {
  return api<ImportTracksResult>(`/api/playlists/${encodeURIComponent(playlistId)}/import-tracks`, {
    method: 'POST',
    body: { provider, provider_track_ids: providerTrackIds },
  });
}

// ── Duplicates check (cross-workspace) ──────────────────────────────────

export interface DuplicateCheckResult {
  provider_track_id?: string;
  artist: string;
  title: string;
  duplicate: boolean;
  existing_playlist: { playlist_id: string; playlist_name: string } | null;
}

export async function checkDuplicates(
  candidates: Array<{ provider_track_id?: string; artist: string; title: string }>,
): Promise<{ results: DuplicateCheckResult[] }> {
  return api<{ results: DuplicateCheckResult[] }>(`/api/playlists/duplicates-check`, {
    method: 'POST',
    body: { candidates },
  });
}
