/**
 * Wrapper API pour /api/playlists/*.
 */

import type { MusicProviderId, Playlist, PlaylistWithTracks, Track } from '@tutti/shared';
import { api } from './api.js';

export async function listPlaylists(): Promise<Playlist[]> {
  const data = await api<{ playlists: Playlist[] }>('/api/playlists');
  return data.playlists;
}

export async function getPlaylist(id: string): Promise<PlaylistWithTracks> {
  const data = await api<{ playlist: PlaylistWithTracks }>(
    `/api/playlists/${encodeURIComponent(id)}`,
  );
  return data.playlist;
}

export async function createPlaylist(input: {
  name: string;
  language?: 'fr' | 'en';
}): Promise<Playlist> {
  const data = await api<{ playlist: Playlist }>('/api/playlists', { method: 'POST', body: input });
  return data.playlist;
}

export async function updatePlaylist(
  id: string,
  patch: Partial<Pick<Playlist, 'name' | 'language' | 'cover_url' | 'is_published' | 'level'>>,
): Promise<Playlist> {
  const data = await api<{ playlist: Playlist }>(`/api/playlists/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: patch,
  });
  return data.playlist;
}

export async function deletePlaylist(id: string): Promise<void> {
  await api(`/api/playlists/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function addTrack(
  playlistId: string,
  input: { provider: MusicProviderId; provider_track_id: string },
): Promise<Track> {
  const data = await api<{ track: Track }>(
    `/api/playlists/${encodeURIComponent(playlistId)}/tracks`,
    {
      method: 'POST',
      body: input,
    },
  );
  return data.track;
}

export async function deleteTrack(playlistId: string, trackId: string): Promise<void> {
  await api(
    `/api/playlists/${encodeURIComponent(playlistId)}/tracks/${encodeURIComponent(trackId)}`,
    {
      method: 'DELETE',
    },
  );
}

export async function reorderTracks(playlistId: string, trackIds: string[]): Promise<void> {
  await api(`/api/playlists/${encodeURIComponent(playlistId)}/tracks/reorder`, {
    method: 'PATCH',
    body: { trackIds },
  });
}

export async function updateTrackAliases(
  playlistId: string,
  trackId: string,
  patch: { artist_aliases?: string[]; title_aliases?: string[] },
): Promise<Track> {
  const data = await api<{ track: Track }>(
    `/api/playlists/${encodeURIComponent(playlistId)}/tracks/${encodeURIComponent(trackId)}`,
    { method: 'PATCH', body: patch },
  );
  return data.track;
}

// ───── Phase 5 — partage par code court ──────────────────────────────────

export interface PlaylistShareEntry {
  id: string;
  code: string;
  playlist_id: string;
  created_by: string;
  max_uses: number | null;
  uses_count: number;
  expires_at: string | null;
  created_at: string;
}

export interface PlaylistSharePreview {
  code: string;
  playlist: {
    id: string;
    name: string;
    description: string | null;
    cover_url: string | null;
    level: string;
    language: string;
    tracks_count: number;
  };
  uses_count: number;
  max_uses: number | null;
  expires_at: string | null;
}

export async function createPlaylistShareCode(
  playlistId: string,
  opts: { max_uses?: number; expires_at?: string } = {},
): Promise<PlaylistShareEntry> {
  const data = await api<{ share: PlaylistShareEntry }>(
    `/api/playlists/${encodeURIComponent(playlistId)}/share`,
    { method: 'POST', body: opts },
  );
  return data.share;
}

export async function getPlaylistSharePreview(code: string): Promise<PlaylistSharePreview> {
  return api<PlaylistSharePreview>(
    `/api/playlists/share/${encodeURIComponent(code.toUpperCase())}`,
  );
}

export async function importPlaylistFromShare(
  code: string,
): Promise<{ playlist: Playlist; tracks_imported: number }> {
  return api<{ playlist: Playlist; tracks_imported: number }>(
    `/api/playlists/share/${encodeURIComponent(code.toUpperCase())}/import`,
    { method: 'POST' },
  );
}
