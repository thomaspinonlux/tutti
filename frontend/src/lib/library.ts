/**
 * Wrappers API /api/library/* — accès host à la bibliothèque officielle.
 *
 *   GET  /api/library/playlists                          : liste filtrable
 *   GET  /api/library/playlists/:id                      : détail + tracks
 *   POST /api/library/playlists/:id/launch  { sessionId }: clone + crée round
 */

import { api } from './api.js';

export interface LibraryPlaylistSummary {
  id: string;
  slug: string;
  name_fr: string;
  name_en: string;
  description_fr: string | null;
  description_en: string | null;
  locale_primary: string;
  theme: string | null;
  difficulty: 'EASY' | 'MEDIUM' | 'EXPERT';
  visibility: 'public' | 'premium_only' | 'private';
  track_count: number;
  spotify_count: number;
  youtube_count: number;
  /** true si premium_only et user pas premium → carte grisée + cadenas. */
  locked: boolean;
}

export interface LibraryTrack {
  id: string;
  position: number;
  title: string;
  artist: string;
  year: number | null;
  difficulty: 'EASY' | 'MEDIUM' | 'EXPERT';
  spotify_id: string | null;
  youtube_id: string | null;
  cover_url: string | null;
}

export interface LibraryPlaylistDetail extends LibraryPlaylistSummary {
  tracks: LibraryTrack[];
}

export type PreferProvider = 'spotify' | 'youtube';

export interface LaunchResult {
  round: {
    id: string;
    session_id: string;
    playlist_id: string;
    position: number;
    status: string;
    current_track_index: number;
    started_at: string | null;
    ended_at: string | null;
    created_at: string;
    playlist: { id: string; name: string; level: string; tracks_count: number };
  };
  playable_count: number;
  total_count: number;
  provider_used: PreferProvider;
}

export async function listLibraryPlaylists(filters?: {
  locale?: string;
  theme?: string;
  difficulty?: string;
}): Promise<LibraryPlaylistSummary[]> {
  const params = new URLSearchParams();
  if (filters?.locale) params.set('locale', filters.locale);
  if (filters?.theme) params.set('theme', filters.theme);
  if (filters?.difficulty) params.set('difficulty', filters.difficulty);
  const qs = params.toString();
  const data = await api<{ playlists: LibraryPlaylistSummary[] }>(
    `/api/library/playlists${qs ? `?${qs}` : ''}`,
  );
  return data.playlists;
}

export async function getLibraryPlaylist(id: string): Promise<LibraryPlaylistDetail> {
  const data = await api<{ playlist: LibraryPlaylistDetail }>(
    `/api/library/playlists/${encodeURIComponent(id)}`,
  );
  return data.playlist;
}

export async function launchLibraryPlaylist(
  id: string,
  sessionId: string,
  preferProvider: PreferProvider = 'spotify',
): Promise<LaunchResult> {
  return api<LaunchResult>(`/api/library/playlists/${encodeURIComponent(id)}/launch`, {
    method: 'POST',
    body: { session_id: sessionId, preferProvider },
  });
}

// ───── Quiz packs (feat/official-quiz-library) ───────────────────────────

export interface LibraryQuizPackSummary {
  id: string;
  slug: string;
  name_fr: string;
  name_en: string;
  description_fr: string | null;
  description_en: string | null;
  locale_primary: string;
  category: string | null;
  difficulty: 'EASY' | 'MEDIUM' | 'EXPERT';
  visibility: 'public' | 'premium_only' | 'private';
  question_count: number;
  /** true si premium_only et user pas premium → carte grisée + cadenas. */
  locked: boolean;
}

export interface QuizLaunchResult {
  session: {
    id: string;
    short_code: string;
    status: string;
    name: string;
    game_type: 'TRACKS' | 'QUIZZ';
    language: string;
  };
  question_set: { id: string; name: string; question_count: number };
  pack: { id: string; slug: string };
}

export async function listLibraryQuizPacks(filters?: {
  locale?: string;
  category?: string;
  difficulty?: string;
}): Promise<LibraryQuizPackSummary[]> {
  const params = new URLSearchParams();
  if (filters?.locale) params.set('locale', filters.locale);
  if (filters?.category) params.set('category', filters.category);
  if (filters?.difficulty) params.set('difficulty', filters.difficulty);
  const qs = params.toString();
  const data = await api<{ packs: LibraryQuizPackSummary[] }>(
    `/api/library/quiz-packs${qs ? `?${qs}` : ''}`,
  );
  return data.packs;
}

export async function launchLibraryQuizPack(
  id: string,
  language: 'fr' | 'en' = 'fr',
): Promise<QuizLaunchResult> {
  return api<QuizLaunchResult>(`/api/library/quiz-packs/${encodeURIComponent(id)}/launch`, {
    method: 'POST',
    body: { language },
  });
}
