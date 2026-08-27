/**
 * P2 — détache les titres non jouables des playlists officielles.
 *
 * « Détacher » = poser is_playable=false : le clone-on-launch SKIP déjà ces
 * tracks (schema OfficialPlaylistTrack.is_playable), donc le titre disparaît du
 * jeu SANS être supprimé (garde youtube_id/réponses/lien → réversible). Non
 * destructif + rollback JSON. Puis recompute le spread JOUABLE par playlist et
 * liste celles qui tombent < 15 (taille de session mini).
 *
 *   DRY (défaut) : ne touche pas la DB.  APPLY=1 : applique + rollback.
 */
import 'dotenv/config';
import * as dotenv from 'dotenv';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { prisma } from '../src/lib/prisma.js';
import { classifyYoutubeIds } from '../src/lib/youtubeValidation.js';

dotenv.config({ path: join(process.cwd(), '..', 'credentials.env.local'), override: false });
const DRY = process.env.APPLY !== '1';
const ROOT = join(process.cwd(), '..');
const MIN = 15;

async function main(): Promise<void> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    console.log('No YOUTUBE_API_KEY — abort.');
    return;
  }

  const tracks = await prisma.officialPlaylistTrack.findMany({
    where: { youtube_id: { not: null } },
    select: {
      id: true,
      youtube_id: true,
      difficulty: true,
      is_playable: true,
      playability_reason: true,
      playlist: { select: { id: true, name_fr: true } },
    },
  });
  const ids = Array.from(new Set(tracks.map((t) => t.youtube_id as string)));
  console.log(`${tracks.length} tracks, ${ids.length} distinct ids. Validating (YouTube API)…`);
  const verdicts = await classifyYoutubeIds(key, ids);

  // Applique les changements de jouabilité (+ rollback).
  const rollback: { id: string; is_playable: boolean; playability_reason: string | null }[] = [];
  let flipped = 0;
  for (const t of tracks) {
    const v = verdicts.get(t.youtube_id as string) ?? {
      is_playable: false,
      reason: 'video_removed',
    };
    if (v.is_playable === t.is_playable && (v.reason ?? null) === (t.playability_reason ?? null))
      continue;
    flipped += 1;
    rollback.push({
      id: t.id,
      is_playable: t.is_playable,
      playability_reason: t.playability_reason,
    });
    if (!DRY) {
      await prisma.officialPlaylistTrack.update({
        where: { id: t.id },
        data: {
          is_playable: v.is_playable,
          playability_reason: v.reason,
          playability_checked_at: new Date(),
        },
      });
    }
    // reflète en mémoire pour le spread ci-dessous
    t.is_playable = v.is_playable;
    t.playability_reason = v.reason;
  }

  // Spread JOUABLE par playlist (+ par difficulté).
  interface Agg {
    name: string;
    total: number;
    playable: number;
    byDiff: Record<string, number>;
  }
  const perPlaylist = new Map<string, Agg>();
  for (const t of tracks) {
    const a =
      perPlaylist.get(t.playlist.id) ??
      ({ name: t.playlist.name_fr, total: 0, playable: 0, byDiff: {} } as Agg);
    a.total += 1;
    if (t.is_playable) {
      a.playable += 1;
      a.byDiff[t.difficulty] = (a.byDiff[t.difficulty] ?? 0) + 1;
    }
    perPlaylist.set(t.playlist.id, a);
  }

  const rows = Array.from(perPlaylist.values()).sort((x, y) => x.playable - y.playable);
  const under = rows.filter((r) => r.playable < MIN);

  const report = [
    'playlist\tplayable\ttotal\tEASY\tMEDIUM\tEXPERT\tunder_15',
    ...rows.map(
      (r) =>
        `${r.name}\t${r.playable}\t${r.total}\t${r.byDiff.EASY ?? 0}\t${r.byDiff.MEDIUM ?? 0}\t${r.byDiff.EXPERT ?? 0}\t${r.playable < MIN ? 'YES' : ''}`,
    ),
  ].join('\n');
  writeFileSync(join(ROOT, 'p2-spread.tsv'), report);

  console.log(`\nPlayability flips: ${flipped}${DRY ? ' (DRY, not written)' : ''}`);
  console.log(`Playlists < ${MIN} jouables : ${under.length}/${rows.length}`);
  for (const r of under) console.log(`  ⚠️  ${r.name}: ${r.playable} jouables (/${r.total})`);

  if (!DRY) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(
      join(ROOT, `p2-playability-rollback-${stamp}.json`),
      JSON.stringify(rollback, null, 2),
    );
    console.log(`\nRollback → p2-playability-rollback-${stamp}.json (${rollback.length} tracks)`);
  }
  console.log('Spread → p2-spread.tsv');
  await prisma.$disconnect();
}
void main();
