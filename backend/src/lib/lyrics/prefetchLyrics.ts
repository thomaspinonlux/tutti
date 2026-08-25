/**
 * prefetchLyrics.ts — remplissage HORS LIGNE du cache `track_lyrics`.
 *
 * Parcourt les `apple_music_id` distincts des playlists officielles verrouillées
 * sur Apple Music (`official_playlists.forced_source = 'apple_music'`), et pour
 * chacun :
 *   1. `AppleMusicProvider.getTrack(id)` → artiste, titre, album et surtout la
 *      DURÉE Apple (autorité pour valider la version des paroles ; on ne peut
 *      pas se fier à `Track.duration_ms`, non renseigné au clone officiel).
 *   2. `fetchSyncedLyrics` → LRC de la bonne version, ou raison du refus.
 *   3. `evaluateLrc` → filtre qualité.
 *   4. upsert dans `track_lyrics`.
 *
 * Idempotent et reprenable : les ids déjà présents sont sautés (sauf
 * `--refresh`), et un `rejected` manuel n'est JAMAIS réécrit.
 *
 * Concurrence 2 et throttle : LRCLIB est un service gratuit, on reste sous
 * 4 req/s.
 */

import pLimit from 'p-limit';
import { prisma } from '../prisma.js';
import { AppleMusicProvider } from '../../music/apple/AppleMusicProvider.js';
import { fetchSyncedLyrics } from './lrclibClient.js';
import { evaluateLrc } from './lrc.js';
import { upsertFromFetch } from './lyricsStore.js';

const CONCURRENCY = 2;
/** Pause entre deux morceaux d'un même worker → ≤ 4 req/s au global. */
const THROTTLE_MS = 250;

export interface PrefetchProgress {
  processed: number;
  total: number;
  ok: number;
  unusable: number;
  errors: number;
  skippedRejected: number;
  /** Décompte par raison (`none`, `other_version`, …). */
  byReason: Record<string, number>;
}

export interface PrefetchOptions {
  limit?: number;
  /** Re-vérifie même les ids déjà en cache (hors `rejected`). */
  refresh?: boolean;
  onProgress?: (p: PrefetchProgress) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runLyricsPrefetch(opts: PrefetchOptions = {}): Promise<PrefetchProgress> {
  const { limit, refresh = false, onProgress } = opts;
  const apple = new AppleMusicProvider('fr');

  // Périmètre v1 : uniquement les playlists verrouillées sur Apple Music.
  const rows = await prisma.officialPlaylistTrack.findMany({
    where: {
      apple_music_id: { not: null },
      playlist: { forced_source: 'apple_music' },
    },
    select: { apple_music_id: true, song_id: true, title: true, artist: true },
  });

  // Dédup par apple_music_id : un même morceau est dans plusieurs playlists.
  const byAppleId = new Map<string, { songId: string | null; title: string; artist: string }>();
  for (const r of rows) {
    const id = r.apple_music_id!;
    if (!byAppleId.has(id)) {
      byAppleId.set(id, { songId: r.song_id, title: r.title, artist: r.artist });
    }
  }

  let ids = [...byAppleId.keys()];

  if (!refresh) {
    // Saute ce qui est déjà en cache (quel que soit le statut : un `unusable`
    // ne redevient pas magiquement disponible, et un `rejected` est définitif).
    const existing = await prisma.trackLyrics.findMany({
      where: { provider: 'apple_music', provider_track_id: { in: ids } },
      select: { provider_track_id: true },
    });
    const done = new Set(existing.map((e) => e.provider_track_id));
    ids = ids.filter((id) => !done.has(id));
  }

  if (limit && limit > 0) ids = ids.slice(0, limit);

  const progress: PrefetchProgress = {
    processed: 0,
    total: ids.length,
    ok: 0,
    unusable: 0,
    errors: 0,
    skippedRejected: 0,
    byReason: {},
  };
  const bump = (reason: string): void => {
    progress.byReason[reason] = (progress.byReason[reason] ?? 0) + 1;
  };

  console.info(`[LyricsPrefetch] ${ids.length} morceaux à traiter (refresh=${refresh})`);

  const limiter = pLimit(CONCURRENCY);
  await Promise.all(
    ids.map((appleId) =>
      limiter(async () => {
        const meta = byAppleId.get(appleId)!;
        try {
          // 1. Métadonnées + durée Apple (autorité pour la version).
          const track = await apple.getTrack(appleId);
          if (!track || !track.duration_ms) {
            await upsertFromFetch({
              provider: 'apple_music',
              providerTrackId: appleId,
              songId: meta.songId,
              providerDurationMs: track?.duration_ms ?? 0,
              status: 'unusable',
              reason: 'fetch_error',
            });
            progress.unusable += 1;
            bump('fetch_error');
            return;
          }

          // 2. Paroles de la BONNE version.
          const res = await fetchSyncedLyrics({
            artist: track.artist,
            title: track.title,
            album: track.album ?? null,
            durationMs: track.duration_ms,
          });

          if (res.status !== 'found' || !res.lrc) {
            const reason = res.status === 'found' ? 'none' : res.status;
            const written = await upsertFromFetch({
              provider: 'apple_music',
              providerTrackId: appleId,
              songId: meta.songId,
              sourceId: res.sourceId,
              providerDurationMs: track.duration_ms,
              sourceDurationMs: res.sourceDurationMs,
              status: 'unusable',
              reason,
            });
            if (written === 'skipped_rejected') progress.skippedRejected += 1;
            else {
              progress.unusable += 1;
              bump(reason);
            }
            return;
          }

          // 3. Filtre qualité.
          const evaluation = evaluateLrc(res.lrc, track.duration_ms);
          const written = await upsertFromFetch({
            provider: 'apple_music',
            providerTrackId: appleId,
            songId: meta.songId,
            sourceId: res.sourceId,
            providerDurationMs: track.duration_ms,
            sourceDurationMs: res.sourceDurationMs,
            lrc: evaluation.ok ? res.lrc : null,
            lineCount: evaluation.lineCount,
            status: evaluation.ok ? 'ok' : 'unusable',
            reason: evaluation.ok ? null : (evaluation.reason ?? 'none'),
          });

          if (written === 'skipped_rejected') progress.skippedRejected += 1;
          else if (evaluation.ok) {
            progress.ok += 1;
            bump('ok');
          } else {
            progress.unusable += 1;
            bump(evaluation.reason ?? 'none');
          }
        } catch (err) {
          progress.errors += 1;
          bump('fetch_error');
          console.error(
            `[LyricsPrefetch] ${meta.artist} — ${meta.title} (${appleId}) : ${err instanceof Error ? err.message : 'erreur inconnue'}`,
          );
        } finally {
          progress.processed += 1;
          if (progress.processed % 25 === 0) {
            console.info(
              `[LyricsPrefetch] ${progress.processed}/${progress.total} | ok=${progress.ok} | inutilisables=${progress.unusable}`,
            );
          }
          onProgress?.({ ...progress, byReason: { ...progress.byReason } });
          await sleep(THROTTLE_MS);
        }
      }),
    ),
  );

  console.info(
    `[LyricsPrefetch] TERMINÉ | traités=${progress.processed} | ok=${progress.ok} | inutilisables=${progress.unusable} | erreurs=${progress.errors} | rejets préservés=${progress.skippedRejected}`,
  );
  return progress;
}
