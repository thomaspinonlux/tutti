/**
 * scripts/validate-youtube-ids.ts
 *
 * Problème A (fix/playback-and-zombies-v4) — valide chaque youtube_id de la
 * bibliothèque officielle Tutti contre la YouTube Data API v3 :
 *   - status.embeddable === true
 *   - status.privacyStatus === 'public'
 *   - !contentDetails.regionRestriction.blocked.includes('FR' | 'LU')
 *   - vidéo trouvée (sinon supprimée/retirée par owner)
 *
 * Update OfficialPlaylistTrack.is_playable + playability_reason +
 * playability_checked_at en DB.
 *
 * Usage : pnpm --filter @tutti/backend run validate:youtube-ids
 *
 * Pré-requis env :
 *   - YOUTUBE_API_KEY (server key Google Cloud, 10 000 quota/jour défaut)
 *
 * Coût quota : videos endpoint = 1 unit/call. Batch 50 IDs/call.
 * 1005 tracks → 21 calls → 21 units (négligeable).
 */

import 'dotenv/config';
import * as dotenv from 'dotenv';
import { join } from 'node:path';
import { prisma } from '../src/lib/prisma.js';

dotenv.config({
  path: join(process.cwd(), '..', 'credentials.env.local'),
  override: false,
});

// ───── Types YouTube API ──────────────────────────────────────────────────

interface YtVideoItem {
  id: string;
  status?: {
    embeddable?: boolean;
    privacyStatus?: 'public' | 'unlisted' | 'private';
    uploadStatus?: string;
  };
  contentDetails?: {
    regionRestriction?: {
      allowed?: string[];
      blocked?: string[];
    };
  };
}

interface YtVideoResponse {
  items?: YtVideoItem[];
}

const BLOCKED_REGIONS = ['FR', 'LU']; // marchés cibles Tutti

type Verdict = { is_playable: boolean; reason: string | null };

function classify(item: YtVideoItem): Verdict {
  if (item.status?.privacyStatus === 'private') {
    return { is_playable: false, reason: 'private_video' };
  }
  if (item.status?.embeddable !== true) {
    return { is_playable: false, reason: 'not_embeddable' };
  }
  const blocked = item.contentDetails?.regionRestriction?.blocked ?? [];
  for (const region of BLOCKED_REGIONS) {
    if (blocked.includes(region)) {
      return { is_playable: false, reason: `blocked_${region}` };
    }
  }
  const allowed = item.contentDetails?.regionRestriction?.allowed;
  if (allowed && allowed.length > 0) {
    // Si une whitelist est définie, on doit être dedans pour FR ET LU.
    const okFr = allowed.includes('FR');
    const okLu = allowed.includes('LU');
    if (!okFr && !okLu) {
      return { is_playable: false, reason: 'not_in_allowed_regions' };
    }
  }
  return { is_playable: true, reason: null };
}

// ───── Batch fetch YouTube ────────────────────────────────────────────────

async function fetchBatch(apiKey: string, ids: string[]): Promise<Map<string, YtVideoItem>> {
  const params = new URLSearchParams({
    part: 'status,contentDetails',
    id: ids.join(','),
    key: apiKey,
  });
  const url = `https://www.googleapis.com/youtube/v3/videos?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`YouTube API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as YtVideoResponse;
  const map = new Map<string, YtVideoItem>();
  for (const item of data.items ?? []) {
    map.set(item.id, item);
  }
  return map;
}

// ───── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.error('[FATAL] YOUTUBE_API_KEY absent');
    process.exit(1);
  }

  const tracks = await prisma.officialPlaylistTrack.findMany({
    where: { youtube_id: { not: null } },
    select: {
      id: true,
      title: true,
      artist: true,
      youtube_id: true,
      is_playable: true,
      playlist: { select: { slug: true } },
    },
    orderBy: [{ playlist_id: 'asc' }, { position: 'asc' }],
  });
  console.info(`[Validate YT] ${tracks.length} tracks à vérifier\n`);

  const BATCH_SIZE = 50;
  const checkedAt = new Date();
  let totalNotFound = 0;
  let totalNotEmbeddable = 0;
  let totalBlocked = 0;
  let totalPrivate = 0;
  let totalPlayable = 0;
  let stateChanges = 0;

  for (let i = 0; i < tracks.length; i += BATCH_SIZE) {
    const batch = tracks.slice(i, i + BATCH_SIZE);
    const ids = batch.map((t) => t.youtube_id!).filter(Boolean);
    let returned: Map<string, YtVideoItem>;
    try {
      returned = await fetchBatch(apiKey, ids);
    } catch (err) {
      console.error(`[Validate YT] batch ${i}-${i + batch.length} failed:`, err);
      continue;
    }

    for (const t of batch) {
      const item = returned.get(t.youtube_id!);
      let verdict: Verdict;
      if (!item) {
        verdict = { is_playable: false, reason: 'video_not_found' };
        totalNotFound += 1;
      } else {
        verdict = classify(item);
        if (verdict.is_playable) {
          totalPlayable += 1;
        } else if (verdict.reason === 'not_embeddable') {
          totalNotEmbeddable += 1;
        } else if (verdict.reason?.startsWith('blocked_')) {
          totalBlocked += 1;
        } else if (verdict.reason === 'private_video') {
          totalPrivate += 1;
        }
      }

      if (t.is_playable !== verdict.is_playable) {
        stateChanges += 1;
        const tag = verdict.is_playable ? '✅ NOW PLAYABLE' : `❌ ${verdict.reason}`;
        console.info(
          `${tag.padEnd(28)} ${t.playlist.slug} #${t.youtube_id}  ${t.artist} — ${t.title}`,
        );
      }

      await prisma.officialPlaylistTrack.update({
        where: { id: t.id },
        data: {
          is_playable: verdict.is_playable,
          playability_reason: verdict.reason,
          playability_checked_at: checkedAt,
        },
      });
    }
  }

  console.info('\n══════════════════════════════════════════════════════════════════════');
  console.info('  RAPPORT VALIDATION YouTube — bibliothèque officielle Tutti');
  console.info('══════════════════════════════════════════════════════════════════════');
  console.info(`  Total tracks vérifiés     : ${tracks.length}`);
  console.info(`  ✅ Playable                : ${totalPlayable}`);
  console.info(`  ❌ Vidéo introuvable       : ${totalNotFound}`);
  console.info(`  ❌ Non-embeddable          : ${totalNotEmbeddable}`);
  console.info(`  ❌ Bloquée FR/LU           : ${totalBlocked}`);
  console.info(`  ❌ Privée                  : ${totalPrivate}`);
  console.info(`  Changements d'état (DB)   : ${stateChanges}`);
  const coverage = ((totalPlayable / tracks.length) * 100).toFixed(1);
  console.info(`  Couverture playable       : ${coverage}%`);
  console.info('══════════════════════════════════════════════════════════════════════\n');
}

main()
  .catch((err) => {
    console.error('[FATAL]', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
