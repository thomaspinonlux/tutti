/**
 * Wrappers API /api/admin/library/* — bibliothèque officielle Tutti.
 */

import { api } from './api.js';

export type Visibility = 'public' | 'premium_only' | 'private';
export type Difficulty = 'EASY' | 'MEDIUM' | 'EXPERT';

export interface OfficialPlaylistSummary {
  id: string;
  slug: string;
  name_fr: string;
  name_en: string;
  theme: string | null;
  difficulty: Difficulty;
  locale_primary: string;
  visibility: Visibility;
  track_count: number;
  created_at: string;
  updated_at: string;
}

export interface OfficialTrack {
  id: string;
  playlist_id: string;
  position: number;
  title: string;
  artist: string;
  year: number | null;
  difficulty: Difficulty;
  spotify_id: string | null;
  youtube_id: string | null;
  answers_accepted: Record<string, unknown> | null;
  created_at: string;
}

export interface OfficialPlaylistDetail extends OfficialPlaylistSummary {
  description_fr: string | null;
  description_en: string | null;
  tracks: OfficialTrack[];
}

export interface ImportFileReport {
  filename: string;
  slug: string;
  total: number;
  spotifyMatched: number;
  spotifyAlreadyCached: number;
  spotifyMissed: number;
  youtubeMatched: number;
  youtubeAlreadyCached: number;
  youtubeMissed: number;
  unmatched: Array<{
    position: number;
    artist: string;
    title: string;
    spotify: boolean;
    youtube: boolean;
  }>;
}

export interface ImportResult {
  files: ImportFileReport[];
  durationMs: number;
  spotifyAvailable: boolean;
  youtubeAvailable: boolean;
}

export async function listOfficialPlaylists(opts?: {
  visibility?: Visibility;
  q?: string;
}): Promise<OfficialPlaylistSummary[]> {
  const params = new URLSearchParams();
  if (opts?.visibility) params.set('visibility', opts.visibility);
  if (opts?.q) params.set('q', opts.q);
  const qs = params.toString();
  const path = `/api/admin/library/playlists${qs ? `?${qs}` : ''}`;
  const data = await api<{ playlists: OfficialPlaylistSummary[] }>(path);
  return data.playlists;
}

export async function getOfficialPlaylist(id: string): Promise<OfficialPlaylistDetail> {
  const data = await api<{ playlist: OfficialPlaylistDetail }>(
    `/api/admin/library/playlists/${encodeURIComponent(id)}`,
  );
  return data.playlist;
}

export async function patchOfficialPlaylist(
  id: string,
  changes: Partial<{
    name_fr: string;
    name_en: string;
    description_fr: string | null;
    description_en: string | null;
    visibility: Visibility;
  }>,
): Promise<OfficialPlaylistDetail> {
  const data = await api<{ playlist: OfficialPlaylistDetail }>(
    `/api/admin/library/playlists/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: changes },
  );
  return data.playlist;
}

export async function resyncOfficialPlaylist(id: string): Promise<ImportFileReport> {
  const data = await api<{ report: ImportFileReport }>(
    `/api/admin/library/playlists/${encodeURIComponent(id)}/resync`,
    { method: 'POST' },
  );
  return data.report;
}

export async function reimportOfficialLibrary(): Promise<ImportResult> {
  return api<ImportResult>('/api/admin/library/reimport', { method: 'POST' });
}
