/**
 * youtubeRefresh.ts — feat/youtube-compliance
 *
 * Job de rafraîchissement périodique des données API YouTube stockées,
 * requis par les YouTube API Services Developer Policies III.E.4 (refresh
 * ou suppression au moins tous les 30 jours).
 *
 * Stratégie :
 *   - Sélectionne les Tracks (workspace) et OfficialPlaylistTracks (lib)
 *     où provider='youtube' (resp. youtube_id != null) ET last_refreshed_at
 *     IS NULL OU last_refreshed_at < (now - 30 jours).
 *   - Batch 50 IDs / call YouTube videos.list (quota 1 unit/call).
 *   - Pour chaque verdict :
 *       is_playable=true  → ne change rien d'autre (les métadonnées title/
 *                            artist sont curées, on ne les écrase pas).
 *       is_playable=false → update is_playable + playability_reason.
 *     Dans tous les cas : update last_refreshed_at = now.
 *   - Retourne stats { checked, updated, unplayable, errored }.
 *
 * Limite par run : 500 tracks par défaut (10 batches de 50 = 10 quota units).
 * Cron horaire (cf. `cronYoutubeRefresh.ts`) → ~12k tracks/jour max si
 * besoin. Quota défaut YT = 10k units/jour → marge confortable.
 *
 * Pas de soft-delete automatique des tracks non-jouables depuis >60j :
 * - super-admins peuvent corriger via /admin/library/audit (PR #27)
 * - hosts peuvent remplacer manuellement via /admin/tracks/:id
 *   (panel "Vérifier disponibilité" + Track details)
 * Suppression auto = risque de perdre des entrées corrigeables. Future PR
 * si on veut purger après >90j.
 */

import { prisma } from './prisma.js';
import { classifyYoutubeIds } from './youtubeValidation.js';

export interface RefreshStats {
  /** Total tracks examinés (workspace + officielles). */
  checked: number;
  /** Tracks dont is_playable a changé (true→false ou false→true). */
  updated: number;
  /** Tracks marqués is_playable=false après ce run. */
  unplayable: number;
  /** Tracks en erreur (batch API échoué, exception inattendue). */
  errored: number;
  /** Durée du run en millisecondes. */
  durationMs: number;
  /** Source du déclenchement, pour audit logs : 'cron' | 'admin_manual'. */
  source: 'cron' | 'admin_manual';
}

const REFRESH_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours
const DEFAULT_MAX_TRACKS_PER_RUN = 500;
const BATCH_SIZE = 50;

/**
 * Run principal — peut être appelé par :
 *   - le cron tick (startYouTubeRefreshCron)
 *   - l'endpoint admin POST /api/admin/refresh-youtube-data
 *
 * Retourne les stats sans throw (les erreurs par batch sont loggées et
 * comptées dans `errored`). En cas de YT_API_KEY absente, retourne stats
 * vides + log d'erreur.
 */
export async function refreshYouTubeData(
  source: 'cron' | 'admin_manual',
  maxTracks: number = DEFAULT_MAX_TRACKS_PER_RUN,
): Promise<RefreshStats> {
  const startedAt = Date.now();
  const stats: RefreshStats = {
    checked: 0,
    updated: 0,
    unplayable: 0,
    errored: 0,
    durationMs: 0,
    source,
  };
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.error('[Cron][YouTubeRefresh] YOUTUBE_API_KEY absent → skip run');
    stats.durationMs = Date.now() - startedAt;
    return stats;
  }

  const cutoff = new Date(Date.now() - REFRESH_WINDOW_MS);

  // ── Workspace tracks ────────────────────────────────────────────────────
  const wsTracks = await prisma.track.findMany({
    where: {
      provider: 'youtube',
      OR: [{ last_refreshed_at: null }, { last_refreshed_at: { lt: cutoff } }],
    },
    take: maxTracks,
    select: {
      id: true,
      provider_track_id: true,
      is_playable: true,
    },
  });

  await processTracks(
    apiKey,
    wsTracks.map((t) => ({
      id: t.id,
      yt_id: t.provider_track_id,
      was_playable: t.is_playable,
    })),
    async (id, verdict) => {
      await prisma.track.update({
        where: { id },
        data: {
          is_playable: verdict.is_playable,
          playability_reason: verdict.reason,
          last_refreshed_at: new Date(),
          // Ne touche PAS playability_checked_at (réservé aux checks user-triggered).
        },
      });
    },
    stats,
  );

  // ── Official library tracks ─────────────────────────────────────────────
  const remaining = Math.max(0, maxTracks - wsTracks.length);
  const officialTracks =
    remaining > 0
      ? await prisma.officialPlaylistTrack.findMany({
          where: {
            youtube_id: { not: null },
            OR: [{ last_refreshed_at: null }, { last_refreshed_at: { lt: cutoff } }],
          },
          take: remaining,
          select: {
            id: true,
            youtube_id: true,
            is_playable: true,
          },
        })
      : [];

  await processTracks(
    apiKey,
    officialTracks.map((t) => ({
      id: t.id,
      yt_id: t.youtube_id!,
      was_playable: t.is_playable,
    })),
    async (id, verdict) => {
      await prisma.officialPlaylistTrack.update({
        where: { id },
        data: {
          is_playable: verdict.is_playable,
          playability_reason: verdict.reason,
          last_refreshed_at: new Date(),
        },
      });
    },
    stats,
  );

  stats.durationMs = Date.now() - startedAt;
  console.info(
    `[Cron][YouTubeRefresh] source=${source} checked=${stats.checked} updated=${stats.updated} unplayable=${stats.unplayable} errored=${stats.errored} durationMs=${stats.durationMs}`,
  );
  return stats;
}

/**
 * Helper : pour un set de tracks (ws ou officielles), classify par batch
 * puis update via la closure `updateOne`. Mutate les stats en place.
 */
async function processTracks(
  apiKey: string,
  tracks: ReadonlyArray<{ id: string; yt_id: string; was_playable: boolean }>,
  updateOne: (
    id: string,
    verdict: { is_playable: boolean; reason: string | null },
  ) => Promise<void>,
  stats: RefreshStats,
): Promise<void> {
  for (let i = 0; i < tracks.length; i += BATCH_SIZE) {
    const batch = tracks.slice(i, i + BATCH_SIZE);
    const ytIds = batch.map((b) => b.yt_id);
    let verdicts: Map<string, { is_playable: boolean; reason: string | null }>;
    try {
      verdicts = await classifyYoutubeIds(apiKey, ytIds);
    } catch (err) {
      console.error(`[Cron][YouTubeRefresh] batch failed (ids=${ytIds.length})`, err);
      stats.errored += batch.length;
      continue;
    }
    await Promise.all(
      batch.map(async (b) => {
        const verdict = verdicts.get(b.yt_id) ?? {
          is_playable: false,
          reason: 'no_response',
        };
        try {
          await updateOne(b.id, verdict);
          stats.checked += 1;
          if (verdict.is_playable !== b.was_playable) stats.updated += 1;
          if (!verdict.is_playable) stats.unplayable += 1;
        } catch (err) {
          console.error(`[Cron][YouTubeRefresh] update fail id=${b.id}`, err);
          stats.errored += 1;
        }
      }),
    );
  }
}

// ───── Cron scheduler (in-process) ────────────────────────────────────────
//
// Pas de dep node-cron — un simple setInterval suffit pour 1 job. Tick
// horaire pour permettre de traiter rapidement les nouvelles tracks
// (chacune fixée pour 30j après son 1er check). Si le serveur redémarre,
// le 1er tick partira ~1h plus tard.
//
// Si on déploie en multi-instance backend dans le futur, basculer vers
// Railway Cron pour éviter de courrer N runs en parallèle.

const CRON_INTERVAL_MS = 60 * 60 * 1000; // 1h
let cronTimer: ReturnType<typeof setInterval> | null = null;

export function startYouTubeRefreshCron(): void {
  if (cronTimer) {
    console.warn('[Cron][YouTubeRefresh] already started, skip');
    return;
  }
  console.info(`[Cron][YouTubeRefresh] scheduled every ${CRON_INTERVAL_MS / 1000 / 60}min`);
  // Premier tick après 5min (laisse le boot terminer + migrations appliquées).
  setTimeout(
    () => {
      void refreshYouTubeData('cron').catch((err) => {
        console.error('[Cron][YouTubeRefresh] initial run failed', err);
      });
    },
    5 * 60 * 1000,
  );
  // Puis tick horaire.
  cronTimer = setInterval(() => {
    void refreshYouTubeData('cron').catch((err) => {
      console.error('[Cron][YouTubeRefresh] tick failed', err);
    });
  }, CRON_INTERVAL_MS);
}

export function stopYouTubeRefreshCron(): void {
  if (cronTimer) {
    clearInterval(cronTimer);
    cronTimer = null;
    console.info('[Cron][YouTubeRefresh] stopped');
  }
}
