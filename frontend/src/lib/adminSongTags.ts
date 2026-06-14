/**
 * adminSongTags.ts — feat/song-tags-classification (ÉTAPE 4)
 *
 * Client de l'API admin de révision des tags (super-admin only). Voir
 * backend/src/routes/adminSongTags.ts.
 */
import { api } from './api.js';

export type SongThemeFamily = 'decade' | 'genre' | 'mood' | 'work' | 'format';

export interface SongThemeDef {
  slug: string;
  label_fr: string;
  label_en: string;
  family: SongThemeFamily;
  is_work?: boolean;
}

export type WorkKind = 'film' | 'serie' | 'dessin_anime' | 'jeu_video' | 'comedie_musicale';

export interface SongTagRow {
  id: string;
  title: string;
  artist: string;
  year: number | null;
  themes: string[];
  is_francophone: boolean;
  is_international: boolean;
  level: 1 | 2 | 3 | null;
  work_title: string | null;
  work_kind: WorkKind | null;
  tags_reviewed: boolean;
}

export type TagStatus = 'all' | 'reviewed' | 'unreviewed';

export interface SongTagFilter {
  theme?: string;
  status?: TagStatus;
  q?: string;
}

export interface SongTagListResult {
  songs: SongTagRow[];
  total: number;
  page: number;
  limit: number;
}

/** Patch partiel d'une song. Tout champ fourni est écrit ; tags_reviewed passe true. */
export interface SongTagPatch {
  themes?: string[];
  is_francophone?: boolean;
  is_international?: boolean;
  level?: 1 | 2 | 3 | null;
  work_title?: string | null;
  work_kind?: WorkKind | null;
}

export function getSongTagsMeta(): Promise<{ themes: SongThemeDef[]; work_kinds: WorkKind[] }> {
  return api('/api/admin/song-tags/meta');
}

export function listSongTags(
  params: SongTagFilter & { page?: number; limit?: number },
): Promise<SongTagListResult> {
  const qs = new URLSearchParams();
  if (params.theme) qs.set('theme', params.theme);
  if (params.status && params.status !== 'all') qs.set('status', params.status);
  if (params.q) qs.set('q', params.q);
  if (params.page) qs.set('page', String(params.page));
  if (params.limit) qs.set('limit', String(params.limit));
  const s = qs.toString();
  return api(`/api/admin/song-tags${s ? `?${s}` : ''}`);
}

export function patchSongTags(id: string, patch: SongTagPatch): Promise<{ song: SongTagRow }> {
  return api(`/api/admin/song-tags/${id}`, { method: 'PATCH', body: patch });
}

export function bulkValidateSongTags(filter: SongTagFilter): Promise<{ count: number }> {
  return api('/api/admin/song-tags/bulk-validate', { method: 'POST', body: filter });
}
