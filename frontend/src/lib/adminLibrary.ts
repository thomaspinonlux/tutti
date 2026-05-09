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
  cover_url: string | null;
  answers_accepted: Record<string, unknown> | null;
  /** Alias prononciation curés super-admin (matching vocal Whisper). */
  artist_aliases: string[];
  title_aliases: string[];
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

// ───── Official Quiz Library — feat/official-quiz-library ────────────────

export interface OfficialQuizPackSummary {
  id: string;
  slug: string;
  name_fr: string;
  name_en: string;
  category: string | null;
  difficulty: Difficulty;
  locale_primary: string;
  visibility: Visibility;
  question_count: number;
  created_at: string;
  updated_at: string;
}

export interface OfficialQuizQuestion {
  id: string;
  pack_id: string;
  position: number;
  type: 'MCQ' | 'TRUE_FALSE' | 'FREE_TEXT';
  question_fr: string;
  question_en: string;
  choices_fr: string[];
  choices_en: string[];
  correct_answer_index: number | null;
  correct_answer_bool: boolean | null;
  correct_answer_fr: string | null;
  correct_answer_en: string | null;
  alternatives_fr: string[];
  alternatives_en: string[];
  explanation_fr: string | null;
  explanation_en: string | null;
  difficulty: Difficulty;
  media_url: string | null;
}

export interface OfficialQuizPackDetail extends OfficialQuizPackSummary {
  description_fr: string | null;
  description_en: string | null;
  questions: OfficialQuizQuestion[];
}

export async function listOfficialQuizPacks(opts?: {
  visibility?: Visibility;
  q?: string;
}): Promise<OfficialQuizPackSummary[]> {
  const params = new URLSearchParams();
  if (opts?.visibility) params.set('visibility', opts.visibility);
  if (opts?.q) params.set('q', opts.q);
  const qs = params.toString();
  const path = `/api/admin/library/quiz-packs${qs ? `?${qs}` : ''}`;
  const data = await api<{ packs: OfficialQuizPackSummary[] }>(path);
  return data.packs;
}

export async function getOfficialQuizPack(id: string): Promise<OfficialQuizPackDetail> {
  const data = await api<{ pack: OfficialQuizPackDetail }>(
    `/api/admin/library/quiz-packs/${encodeURIComponent(id)}`,
  );
  return data.pack;
}

export async function patchOfficialQuizPack(
  id: string,
  changes: Partial<{
    name_fr: string;
    name_en: string;
    description_fr: string | null;
    description_en: string | null;
    visibility: Visibility;
  }>,
): Promise<OfficialQuizPackDetail> {
  const data = await api<{ pack: OfficialQuizPackDetail }>(
    `/api/admin/library/quiz-packs/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: changes },
  );
  return data.pack;
}

export async function patchOfficialTrack(
  trackId: string,
  changes: Partial<{
    spotify_id: string | null;
    youtube_id: string | null;
    cover_url: string | null;
    artist_aliases: string[];
    title_aliases: string[];
  }>,
): Promise<OfficialTrack> {
  const data = await api<{ track: OfficialTrack }>(
    `/api/admin/library/tracks/${encodeURIComponent(trackId)}`,
    { method: 'PATCH', body: changes },
  );
  return data.track;
}
