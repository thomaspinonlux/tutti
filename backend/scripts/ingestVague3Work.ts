/**
 * Ingest VAGUE 3 — WORK-MODE (devine l'ŒUVRE) — étoffe 3 playlists EXISTANTES
 * depuis backend/data/tutti-remplissage-vague3-work.csv.
 *
 * Colonnes : slug,playlist,work,aliases,artist,title,level
 * Cibles (par SLUG, préfixé official-pl-) :
 *   video-games · club-dorothee · series-tv
 *
 * Spécificité guess_mode='work' (cf. ingestEnfants) :
 *   - réponse à deviner = work_title (+ work_aliases split par `|`), pas l'artiste.
 *   - on FLIP les 3 playlists en guess_mode='work'.
 *   - BACKFILL : une track DÉJÀ présente qui matche une ligne CSV et qui n'a PAS
 *     de work_title → on lui écrit work_title/work_aliases (sinon elle serait
 *     injouable en work-mode). Non destructif (null → valeur).
 *   - tracks existantes SANS match CSV → laissées sans work_title → SIGNALÉES.
 *
 * GARDE-FOU : ne crée JAMAIS de playlist (abort si un slug cible manque).
 * Réversible : rollback JSON (created track_ids deletables ; backfilled listés à part).
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
loadEnv({ path: '/Users/thomaspinon/Documents/Claude Code/tutti/credentials.env.local' });
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient, type Level } from '@prisma/client';
import { classifyYoutubeIds } from '../src/lib/youtubeValidation.js';

const ROOT = '/Users/thomaspinon/Documents/Claude Code/tutti';
const CSV = `${ROOT}/backend/data/tutti-remplissage-vague3-work.csv`;
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const ROLLBACK = `${ROOT}/vague3-work-rollback-${STAMP}.json`;
const THROTTLE_MS = 120;
const FALLBACK_ARTIST = 'Bande originale';

const TARGET_SLUGS = [
  'official-pl-video-games',
  'official-pl-club-dorothee',
  'official-pl-series-tv',
];

const FORBIDDEN_TERMS = [
  'remix',
  'live',
  'karaoke',
  'karaoké',
  'cover',
  'instrumental',
  'tribute',
  're-recorded',
  're-record',
  'rerecorded',
  'mashup',
  'parody',
  'parodie',
  'sped up',
  'slowed',
  'reverb',
  'piano version',
  '8-bit',
  'lullaby',
];

function lower(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function containsForbidden(s: string): boolean {
  const l = lower(s);
  return FORBIDDEN_TERMS.some((t) => l.includes(t));
}
function levenshtein(a: string, b: string): number {
  const A = lower(a);
  const B = lower(b);
  if (A === B) return 0;
  const m = A.length;
  const n = B.length;
  if (!m) return n ? 1 : 0;
  if (!n) return 1;
  const dp = new Array<number>(n + 1).fill(0).map((_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (A[i - 1] === B[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[n]! / Math.max(m, n);
}
function dedupKey(artist: string, title: string): string {
  const norm = (s: string): string =>
    lower(s)
      .replace(/\(.*?\)|\[.*?\]/g, ' ')
      .replace(/feat\.?|ft\.?/g, ' ')
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  return `${norm(artist)}|${norm(title)}`;
}
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
function levelFromCsv(raw: string): Level {
  const v = raw.trim().toUpperCase();
  if (v === 'EASY') return 'EASY';
  if (v === 'HARD' || v === 'EXPERT') return 'EXPERT';
  return 'MEDIUM';
}

interface YTItem {
  id: { videoId?: string };
  snippet: { title: string; channelTitle: string };
}
async function searchYouTube(
  apiKey: string,
  work: string,
  artist: string,
  title: string,
): Promise<{ videoId: string; videoTitle: string } | null> {
  const realArtist = artist && artist !== FALLBACK_ARTIST ? artist : '';
  const q = realArtist ? `${realArtist} - ${title} ${work}` : `${title} ${work}`;
  const params = new URLSearchParams({
    part: 'snippet',
    q,
    type: 'video',
    maxResults: '15',
    videoEmbeddable: 'true',
    safeSearch: 'none',
    key: apiKey,
  });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`);
  if (res.status === 403) throw new Error('QUOTA');
  if (!res.ok) return null;
  const data = (await res.json()) as { items: YTItem[] };
  let cands = (data.items ?? []).filter((it) => Boolean(it.id.videoId));
  cands = cands.filter(
    (it) => !containsForbidden(it.snippet.title) && !containsForbidden(it.snippet.channelTitle),
  );
  const scored = cands.map((it) => {
    const channel = lower(it.snippet.channelTitle);
    let score = levenshtein(it.snippet.title, q);
    if (channel.includes('vevo')) score -= 0.4;
    if (channel.includes('official')) score -= 0.25;
    if (channel.includes(lower(work))) score -= 0.3;
    if (channel.endsWith('- topic')) score -= 0.35;
    return { it, score };
  });
  scored.sort((a, b) => a.score - b.score);
  const best = scored[0];
  if (!best || !best.it.id.videoId || best.score > 0.75) return null;
  return { videoId: best.it.id.videoId, videoTitle: best.it.snippet.title };
}

type ExTrack = {
  youtube_id: string | null;
  spotify_id: string | null;
  song_id: string | null;
  cover_url: string | null;
  year: number | null;
  is_playable: boolean;
  artist_aliases: string[];
  title_aliases: string[];
};
type Row = {
  slug: string;
  work: string;
  workAliases: string[];
  artist: string;
  title: string;
  level: Level;
};

async function main(): Promise<void> {
  const apiKey = process.env.YOUTUBE_API_KEY ?? '';
  if (!apiKey) console.warn('⚠️  YOUTUBE_API_KEY absent — nouveaux SKIPPÉS.');
  const prisma = new PrismaClient();

  // ── GARDE-FOU : les 3 playlists doivent exister ──
  const targets = await prisma.officialPlaylist.findMany({
    where: { slug: { in: TARGET_SLUGS } },
    select: { id: true, slug: true, name_fr: true, guess_mode: true },
  });
  const idBySlug = new Map(targets.map((t) => [t.slug, t.id]));
  const missing = TARGET_SLUGS.filter((s) => !idBySlug.has(s));
  if (missing.length > 0) {
    console.error(`🛑 ABORT — slugs introuvables : ${missing.join(', ')}`);
    await prisma.$disconnect();
    process.exit(1);
  }

  // ── FLIP guess_mode='work' ──
  for (const t of targets) {
    if (t.guess_mode !== 'work') {
      await prisma.officialPlaylist.update({ where: { id: t.id }, data: { guess_mode: 'work' } });
      console.log(
        `↺ ${t.slug} — "${t.name_fr}" → guess_mode='work' (était ${t.guess_mode ?? 'null'})`,
      );
    } else {
      console.log(`↺ ${t.slug} — "${t.name_fr}" → guess_mode='work' déjà OK`);
    }
  }

  // ── Parse CSV 7 colonnes : slug,playlist,work,aliases,artist,title,level ──
  const rows: Row[] = readFileSync(CSV, 'utf8')
    .split('\n')
    .slice(1)
    .filter((l) => l.trim())
    .map(parseCsvLine)
    .map((c) => ({
      slug: `official-pl-${(c[0] ?? '').trim()}`,
      work: (c[2] ?? '').trim(),
      workAliases: (c[3] ?? '')
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean),
      artist: (c[4] ?? '').trim() || FALLBACK_ARTIST,
      title: (c[5] ?? '').trim(),
      level: levelFromCsv(c[6] ?? ''),
    }))
    .filter((r) => r.work && r.title && idBySlug.has(r.slug));

  // ── Index catalogue global (réutilisation youtube_id) ──
  const allTracks = await prisma.officialPlaylistTrack.findMany({
    select: {
      artist: true,
      title: true,
      youtube_id: true,
      spotify_id: true,
      song_id: true,
      cover_url: true,
      year: true,
      is_playable: true,
      artist_aliases: true,
      title_aliases: true,
    },
  });
  const existing = new Map<string, ExTrack>();
  for (const t of allTracks) {
    const k = dedupKey(t.artist, t.title);
    const prev = existing.get(k);
    if (!prev || (!prev.youtube_id && t.youtube_id)) existing.set(k, t);
  }

  // ── Index des tracks DÉJÀ dans les playlists cibles (id + work_title présent) ──
  const maxPos = new Map<string, number>();
  const inPlBySlug = new Map<string, Map<string, { id: string; hasWork: boolean }>>();
  const existingNoWorkBySlug = new Map<string, number>(); // existant sans work_title (référence)
  for (const slug of TARGET_SLUGS) {
    const id = idBySlug.get(slug)!;
    const a = await prisma.officialPlaylistTrack.aggregate({
      where: { playlist_id: id },
      _max: { position: true },
    });
    maxPos.set(id, a._max.position ?? 0);
    const inPl = await prisma.officialPlaylistTrack.findMany({
      where: { playlist_id: id },
      select: { id: true, artist: true, title: true, work_title: true },
    });
    const m = new Map<string, { id: string; hasWork: boolean }>();
    let noWork = 0;
    for (const t of inPl) {
      m.set(dedupKey(t.artist, t.title), { id: t.id, hasWork: !!t.work_title });
      if (!t.work_title) noWork++;
    }
    inPlBySlug.set(slug, m);
    existingNoWorkBySlug.set(slug, noWork);
  }

  // ── Classer : backfill (existant sans work) / reuse / search ──
  const backfill: Array<{ id: string } & Row> = [];
  const reuse: Array<Row & { src: ExTrack }> = [];
  const toSearch: Row[] = [];
  let alreadyComplete = 0;
  for (const r of rows) {
    const k = dedupKey(r.artist, r.title);
    const inPl = inPlBySlug.get(r.slug)?.get(k);
    if (inPl) {
      if (!inPl.hasWork) backfill.push({ id: inPl.id, ...r });
      else alreadyComplete++;
      continue;
    }
    const ex = existing.get(k);
    if (ex && ex.youtube_id) reuse.push({ ...r, src: ex });
    else toSearch.push(r);
  }

  const counters: Record<
    string,
    { nouveaux: number; reutilises: number; backfilles: number; ytEchec: number }
  > = {};
  for (const slug of TARGET_SLUGS)
    counters[slug] = { nouveaux: 0, reutilises: 0, backfilles: 0, ytEchec: 0 };

  console.log(
    `\n=== DRY-RUN PRE-WRITE [vague3-work] ===\n  CSV lignes valides : ${rows.length}\n  déjà complètes (skip) : ${alreadyComplete}\n  backfill work_title (existant) : ${backfill.length}\n  réutilisés catalogue : ${reuse.length}\n  à résoudre (search YT) : ${toSearch.length}\n`,
  );

  // ── Résolution YouTube ──
  const resolved: Array<Row & { videoId: string; videoTitle: string }> = [];
  if (apiKey && toSearch.length > 0) {
    for (const [i, r] of toSearch.entries()) {
      if (i % 25 === 0) console.log(`  search ${i}/${toSearch.length}…`);
      try {
        const hit = await searchYouTube(apiKey, r.work, r.artist, r.title);
        if (!hit) {
          counters[r.slug]!.ytEchec++;
          continue;
        }
        resolved.push({ ...r, ...hit });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'QUOTA') {
          console.warn(`  🚫 quota YouTube atteint après ${i}/${toSearch.length} — stop search`);
          for (const rem of toSearch.slice(i)) counters[rem.slug]!.ytEchec++;
          break;
        }
        counters[r.slug]!.ytEchec++;
      }
      await sleep(THROTTLE_MS);
    }
  } else if (!apiKey && toSearch.length > 0) {
    for (const r of toSearch) counters[r.slug]!.ytEchec++;
  }

  const verdicts = apiKey
    ? await classifyYoutubeIds(
        apiKey,
        resolved.map((r) => r.videoId),
      )
    : new Map<string, { is_playable: boolean }>();
  const newPlayable = resolved.filter((r) => {
    if (verdicts.get(r.videoId)?.is_playable) return true;
    counters[r.slug]!.ytEchec++;
    return false;
  });

  // ── Write ──
  const created: Array<{
    id: string;
    slug: string;
    artist: string;
    title: string;
    work_title: string;
    work_aliases: string[];
    youtube_id: string;
    level: Level;
    videoTitle: string | null;
    reused: boolean;
  }> = [];
  const backfilled: Array<{ id: string; slug: string; work_title: string }> = [];
  const writeRollback = (): void => {
    writeFileSync(
      ROLLBACK,
      JSON.stringify(
        {
          created_at: new Date().toISOString(),
          campaign: 'vague3-work',
          created_playlist_ids: [],
          track_ids: created.map((c) => c.id), // deletables via funPlaylistsRollback
          count: created.length,
          items: created,
          // backfilled = tracks préexistantes mises à jour (work_title null→valeur).
          // NON supprimées par le rollback (elles préexistaient).
          backfilled,
        },
        null,
        2,
      ),
    );
  };
  try {
    // 1) Backfill work_title sur l'existant qui matche le CSV.
    for (const b of backfill) {
      await prisma.officialPlaylistTrack.update({
        where: { id: b.id },
        data: { work_title: b.work, work_aliases: b.workAliases, difficulty: b.level },
      });
      backfilled.push({ id: b.id, slug: b.slug, work_title: b.work });
      counters[b.slug]!.backfilles++;
    }
    // 2) Création (reuse + new) avec work_title.
    const addTrack = async (
      r: Row,
      yt: string,
      src: ExTrack | null,
      videoTitle: string | null,
    ): Promise<void> => {
      const plId = idBySlug.get(r.slug)!;
      const pos = (maxPos.get(plId) ?? 0) + 1;
      maxPos.set(plId, pos);
      const t = await prisma.officialPlaylistTrack.create({
        data: {
          playlist_id: plId,
          position: pos,
          title: r.title,
          artist: r.artist,
          difficulty: r.level,
          youtube_id: yt,
          spotify_id: src?.spotify_id ?? null,
          song_id: src?.song_id ?? null,
          cover_url: src?.cover_url ?? null,
          year: src?.year ?? null,
          artist_aliases: src?.artist_aliases ?? [],
          title_aliases: src?.title_aliases ?? [],
          is_playable: src ? src.is_playable : true,
          playability_checked_at: new Date(),
          last_refreshed_at: new Date(),
          work_title: r.work,
          work_aliases: r.workAliases,
        },
        select: { id: true },
      });
      created.push({
        id: t.id,
        slug: r.slug,
        artist: r.artist,
        title: r.title,
        work_title: r.work,
        work_aliases: r.workAliases,
        youtube_id: yt,
        level: r.level,
        videoTitle,
        reused: !!src,
      });
    };
    for (const r of reuse) {
      await addTrack(r, r.src.youtube_id!, r.src, null);
      counters[r.slug]!.reutilises++;
    }
    for (const r of newPlayable) {
      await addTrack(r, r.videoId, null, r.videoTitle);
      counters[r.slug]!.nouveaux++;
    }
  } finally {
    writeRollback();
  }

  // ── track_count + couverture work_title finale ──
  const plInfo: Array<{ slug: string; name: string; n: number; workOk: number; workMiss: number }> =
    [];
  for (const t of targets) {
    const n = await prisma.officialPlaylistTrack.count({ where: { playlist_id: t.id } });
    await prisma.officialPlaylist.update({ where: { id: t.id }, data: { track_count: n } });
    const workOk = await prisma.officialPlaylistTrack.count({
      where: { playlist_id: t.id, work_title: { not: null } },
    });
    plInfo.push({ slug: t.slug, name: t.name_fr, n, workOk, workMiss: n - workOk });
  }

  console.log('\n=== PLAYLISTS [vague3-work] (guess_mode=work) ===');
  for (const p of plInfo) {
    console.log(
      `  ${p.slug} — "${p.name}" → ${p.n} tracks · work_title ${p.workOk}/${p.n}${p.workMiss > 0 ? `  ⚠️ ${p.workMiss} SANS work_title (existant hors CSV)` : ' ✓'}`,
    );
  }
  console.log('\n=== COMPTEURS (par playlist) ===');
  for (const slug of TARGET_SLUGS) {
    const c = counters[slug]!;
    console.log(
      `  ${slug} : nouveaux ${c.nouveaux} · réutilisés ${c.reutilises} · backfill ${c.backfilles} · youtube-échec ${c.ytEchec}`,
    );
  }
  console.log('\n=== ÉCHANTILLON 15 (nouveaux d’abord) ===');
  const sample = [...created.filter((c) => !c.reused), ...created.filter((c) => c.reused)].slice(
    0,
    15,
  );
  for (const c of sample) {
    const aliases = c.work_aliases.length ? ` [alias : ${c.work_aliases.join(' | ')}]` : '';
    console.log(`  [${c.slug.replace('official-pl-', '')}] [${c.level}] ${c.artist} — ${c.title}`);
    console.log(`      ŒUVRE : "${c.work_title}"${aliases}`);
    console.log(`      → ${c.videoTitle ?? '(réutilisé)'}  https://youtu.be/${c.youtube_id}`);
  }
  const totalAdded = created.length;
  const totalBackfill = backfilled.length;
  const totalEchec = Object.values(counters).reduce((s, c) => s + c.ytEchec, 0);
  console.log(
    `\n=== TOTAL : +${totalAdded} créées · ${totalBackfill} backfill · ${totalEchec} youtube-échec ===`,
  );
  console.log(`📄 ROLLBACK : ${ROLLBACK}`);
  console.log(`   undo (créées) = pnpm exec tsx scripts/funPlaylistsRollback.ts "${ROLLBACK}"`);
  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
