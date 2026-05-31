/**
 * playlistProposals.ts — feat/tv-playlist-carousel
 *
 * Wrappers HTTP pour les 3 endpoints PR A.
 */

import { api } from './api.js';

export interface LibraryCatalogPlaylist {
  id: string;
  slug: string;
  name_fr: string;
  name_en: string;
  description_fr: string | null;
  description_en: string | null;
  locale_primary: string;
  theme: string | null;
  difficulty: 'EASY' | 'MEDIUM' | 'EXPERT';
  track_count: number;
}

export interface ProposalSummaryRow {
  official_playlist_id: string;
  playlist_name: string;
  count: number;
  participants: string[];
}

const apiBase = (): string =>
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';

/**
 * GET catalogue OfficialPlaylist (public, scoped par session.short_code).
 * Sert TV (lobby carousel) et PlayPage (modal proposition).
 */
export async function getLibraryCatalogForSession(
  shortCode: string,
): Promise<LibraryCatalogPlaylist[]> {
  const url = `${apiBase()}/api/sessions/by-code/${encodeURIComponent(shortCode)}/library-playlists`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`library-playlists ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { playlists: LibraryCatalogPlaylist[] };
  return data.playlists ?? [];
}

/**
 * POST proposition (joueur). Body { token, official_playlist_id }.
 * Idempotent côté backend (unique constraint).
 */
export async function proposeLibraryPlaylist(args: {
  shortCode: string;
  token: string;
  officialPlaylistId: string;
}): Promise<void> {
  const url = `${apiBase()}/api/sessions/by-code/${encodeURIComponent(args.shortCode)}/proposals`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: args.token, official_playlist_id: args.officialPlaylistId }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`propose ${res.status}: ${text.slice(0, 200)}`);
  }
}

/**
 * GET propositions agrégées (host, workspace gated).
 */
export async function getProposals(
  sessionId: string,
): Promise<{ total: number; summary: ProposalSummaryRow[] }> {
  return api<{ total: number; summary: ProposalSummaryRow[] }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/proposals`,
  );
}
