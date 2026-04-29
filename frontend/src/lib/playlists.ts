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
