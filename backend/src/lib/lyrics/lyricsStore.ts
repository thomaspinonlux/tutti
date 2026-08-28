/**
 * lyricsStore.ts — accès DB au cache `track_lyrics`.
 *
 * Seul point de lecture des paroles pour le gameplay. `getUsableLyrics` ne
 * renvoie QUE `status='ok'` : c'est la matérialisation de la règle « paroles
 * vérifiées uniquement ». Aucun appel réseau ici (le prefetch s'en charge hors
 * ligne) → la lecture est instantanée pendant une partie.
 */

import { prisma } from '../prisma.js';

export interface UsableLyrics {
  /** fix/lyrics-duration-check — durée de la version pour laquelle les paroles
   *  ont été validées (référence de synchro, comparée au morceau JOUÉ). */
  providerDurationMs?: number;
  provider: string;
  providerTrackId: string;
  lrc: string;
  lineCount: number;
}

/**
 * Paroles AFFICHABLES d'un morceau, ou null.
 *
 * null couvre : jamais récupérées, `unusable` (rien de propre trouvé), et
 * `rejected` (rejet manuel par un animateur). Dans tous ces cas le bouton
 * « Paroles » n'apparaît pas.
 */
export async function getUsableLyrics(
  provider: string,
  providerTrackId: string,
): Promise<UsableLyrics | null> {
  if (!provider || !providerTrackId) return null;
  const row = await prisma.trackLyrics.findUnique({
    where: { provider_provider_track_id: { provider, provider_track_id: providerTrackId } },
    select: { status: true, synced_lrc: true, line_count: true, provider_duration_ms: true },
  });
  if (!row || row.status !== 'ok' || !row.synced_lrc) return null;
  return {
    provider,
    providerTrackId,
    lrc: row.synced_lrc,
    lineCount: row.line_count,
    providerDurationMs: row.provider_duration_ms,
  };
}

/**
 * Rejet MANUEL (bouton « Paroles fausses ») — définitif et global : le titre
 * n'aura plus de bouton « Paroles », dans cette partie comme dans toutes les
 * suivantes. Le prefetch ne réécrit jamais un `rejected` (cf. prefetchLyrics).
 *
 * Le LRC est effacé : on ne garde pas un texte qu'on a jugé faux.
 * Idempotent, et sûr même si aucune ligne n'existe encore (upsert).
 */
export async function rejectLyrics(provider: string, providerTrackId: string): Promise<void> {
  if (!provider || !providerTrackId) return;
  const now = new Date();
  await prisma.trackLyrics.upsert({
    where: { provider_provider_track_id: { provider, provider_track_id: providerTrackId } },
    update: {
      status: 'rejected',
      reason: 'manual',
      rejected_at: now,
      synced_lrc: null,
      line_count: 0,
    },
    create: {
      provider,
      provider_track_id: providerTrackId,
      source: 'lrclib',
      provider_duration_ms: 0,
      status: 'rejected',
      reason: 'manual',
      rejected_at: now,
      line_count: 0,
    },
  });
}

export interface UpsertFromFetchInput {
  provider: string;
  providerTrackId: string;
  songId?: string | null;
  sourceId?: number | null;
  providerDurationMs: number;
  sourceDurationMs?: number | null;
  lrc?: string | null;
  lineCount?: number;
  status: 'ok' | 'unusable';
  reason?: string | null;
}

/**
 * Écrit le résultat d'une récupération. N'écrase JAMAIS un `rejected` : un
 * arbitrage humain prime sur toute re-récupération automatique.
 */
export async function upsertFromFetch(
  input: UpsertFromFetchInput,
): Promise<'written' | 'skipped_rejected'> {
  const {
    provider,
    providerTrackId,
    songId = null,
    sourceId = null,
    providerDurationMs,
    sourceDurationMs = null,
    lrc = null,
    lineCount = 0,
    status,
    reason = null,
  } = input;

  const existing = await prisma.trackLyrics.findUnique({
    where: { provider_provider_track_id: { provider, provider_track_id: providerTrackId } },
    select: { status: true },
  });
  if (existing?.status === 'rejected') return 'skipped_rejected';

  const now = new Date();
  const data = {
    song_id: songId,
    source: 'lrclib',
    source_id: sourceId,
    provider_duration_ms: providerDurationMs,
    source_duration_ms: sourceDurationMs,
    synced_lrc: status === 'ok' ? lrc : null,
    line_count: status === 'ok' ? lineCount : 0,
    status,
    reason,
    fetched_at: now,
    checked_at: now,
  };

  await prisma.trackLyrics.upsert({
    where: { provider_provider_track_id: { provider, provider_track_id: providerTrackId } },
    update: data,
    create: { provider, provider_track_id: providerTrackId, ...data },
  });
  return 'written';
}
