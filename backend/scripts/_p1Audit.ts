/**
 * P1/P2 audit (read-only) via YouTube Data API v3.
 * Un seul sweep (part=snippet,status,contentDetails) sur tous les youtube_id
 * distincts du catalogue officiel :
 *   - P1 : artiste catalogue absent du titre+chaîne de la vidéo → MISMATCH.
 *   - P2 : classifyYtVideo → is_playable + reason (video_removed / not_embeddable
 *          / blocked_FR|LU / private / not_in_allowed_regions).
 * Sortie : p1-audit.tsv (repo root). N'écrit RIEN en DB.
 */
import 'dotenv/config';
import * as dotenv from 'dotenv';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { prisma } from '../src/lib/prisma.js';
import { classifyYtVideo } from '../src/lib/youtubeValidation.js';
import { classifyVideo } from './_p1lib.js';

dotenv.config({ path: join(process.cwd(), '..', 'credentials.env.local'), override: false });

const YT = 'https://www.googleapis.com/youtube/v3/videos';

interface Item {
  id: string;
  snippet?: { title?: string; channelTitle?: string };
  status?: { embeddable?: boolean; privacyStatus?: string; uploadStatus?: string };
  contentDetails?: { regionRestriction?: { allowed?: string[]; blocked?: string[] } };
}

async function fetchBatch(key: string, ids: string[]): Promise<Map<string, Item>> {
  const params = new URLSearchParams({
    part: 'snippet,status,contentDetails',
    id: ids.join(','),
    key,
  });
  const res = await fetch(`${YT}?${params}`);
  if (!res.ok) throw new Error(`YT API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { items?: Item[] };
  const m = new Map<string, Item>();
  for (const it of data.items ?? []) m.set(it.id, it);
  return m;
}

async function main(): Promise<void> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    console.log('No YOUTUBE_API_KEY — abort.');
    return;
  }

  // Tous les tracks avec youtube_id ; on agrège par youtube_id.
  const tracks = await prisma.officialPlaylistTrack.findMany({
    where: { youtube_id: { not: null } },
    select: { id: true, title: true, artist: true, youtube_id: true },
  });
  const byId = new Map<
    string,
    {
      pairs: Map<string, { artist: string; title: string }>;
      artist: string;
      title: string;
      n: number;
    }
  >();
  for (const t of tracks) {
    const id = t.youtube_id as string;
    const e = byId.get(id) ?? { pairs: new Map(), artist: t.artist, title: t.title, n: 0 };
    e.pairs.set(`${t.artist}|${t.title}`, { artist: t.artist, title: t.title });
    e.n += 1;
    byId.set(id, e);
  }
  const ids = Array.from(byId.keys());
  console.log(`${tracks.length} tracks, ${ids.length} distinct youtube_id. Fetching…`);

  const rows: string[] = [
    [
      'youtube_id',
      'yt_title',
      'yt_channel',
      'catalog_artist',
      'catalog_title',
      'verdict',
      'playable',
      'reason',
      'n_tracks',
    ].join('\t'),
  ];
  let mismatch = 0;
  let titleMis = 0;
  let artistMis = 0;
  let unplayable = 0;
  for (let i = 0; i < ids.length; i += 50) {
    const slice = ids.slice(i, i + 50);
    let items: Map<string, Item>;
    try {
      items = await fetchBatch(key, slice);
    } catch (e) {
      console.log(`Batch ${i} error: ${(e as Error).message} — abort (partial saved).`);
      break;
    }
    for (const id of slice) {
      const meta = byId.get(id)!;
      const it = items.get(id);
      const ytTitle = it?.snippet?.title ?? '';
      const ytChannel = it?.snippet?.channelTitle ?? '';
      const playVerdict = classifyYtVideo(it);
      if (!playVerdict.is_playable) unplayable += 1;

      // Correct si la vidéo matche AU MOINS une paire (artiste,titre) catalogue.
      const pairs = Array.from(meta.pairs.values());
      const verdicts = pairs.map((p) => classifyVideo(p.artist, p.title, ytTitle, ytChannel));
      let verdict: string;
      if (!it) verdict = 'removed';
      else if (verdicts.some((v) => v.correct)) verdict = 'ok';
      else if (verdicts.some((v) => v.reason === 'artist_mismatch')) verdict = 'artist_mismatch';
      else verdict = 'title_mismatch';
      if (verdict === 'artist_mismatch') artistMis += 1;
      if (verdict === 'title_mismatch') titleMis += 1;
      if (verdict === 'artist_mismatch' || verdict === 'title_mismatch') mismatch += 1;

      rows.push(
        [
          id,
          ytTitle.replace(/\t/g, ' '),
          ytChannel.replace(/\t/g, ' '),
          meta.artist.replace(/\t/g, ' '),
          meta.title.replace(/\t/g, ' '),
          verdict,
          playVerdict.is_playable ? 'Y' : 'N',
          playVerdict.reason ?? '',
          String(meta.n),
        ].join('\t'),
      );
    }
    if ((i / 50) % 10 === 0) console.log(`  …${Math.min(i + 50, ids.length)}/${ids.length}`);
  }

  const path = join(process.cwd(), '..', 'p1-audit.tsv');
  writeFileSync(path, rows.join('\n'));
  console.log(`\nWrote ${rows.length - 1} rows → p1-audit.tsv`);
  console.log(
    `MISMATCH total: ${mismatch}  (title_mismatch=${titleMis}, artist_mismatch=${artistMis})`,
  );
  console.log(`UNPLAYABLE (P2): ${unplayable}`);
  await prisma.$disconnect();
}
void main();
