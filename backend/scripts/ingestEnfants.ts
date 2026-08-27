/**
 * Ingestion enfants — 2 playlists "devine l'ŒUVRE" depuis
 * backend/data/tutti-generiques-enfants.csv.
 *
 * Colonnes : playlist,work,aliases,artist,title,level
 *
 * Playlists créées :
 *   - Génériques Disney & Pixar               · official-pl-generiques-disney
 *   - Génériques dessins animés & séries enfants · official-pl-generiques-dessins-animes
 *
 * Spécificité — guess_mode='work' :
 *   - La réponse à deviner est le NOM DE L'ŒUVRE (work_title), pas l'artiste.
 *   - work_aliases (split par `|`) sont les traductions/raccourcis acceptés
 *     en plus du work_title.
 *   - Au clone-on-launch (cf. library.ts), le matching Whisper compare la
 *     transcription au work_title + work_aliases (Track.canonical_title +
 *     Track.aliases). L'artiste reste pour l'affichage du reveal.
 *   - Migration : 20260620090000_add_guess_mode_work_title (3 colonnes
 *     ajoutées : OfficialPlaylist.guess_mode, OfficialPlaylistTrack.work_title,
 *     OfficialPlaylistTrack.work_aliases).
 *
 * Recherche YouTube : query = "title work" (ex: "Circle of Life The Lion King")
 * car l'artiste est souvent vide pour ces génériques.
 *
 * Idempotent : skip les tracks (playlist_id, dedupKey artist+title) déjà
 * présentes. Réversible : rollback JSON compatible funPlaylistsRollback.ts.
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
loadEnv({ path: '/Users/thomaspinon/Documents/Claude Code/tutti/credentials.env.local' });
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient, type Level } from '@prisma/client';
import { classifyYoutubeIds } from '../src/lib/youtubeValidation.js';

const ROOT = '/Users/thomaspinon/Documents/Claude Code/tutti';
const CSV = `${ROOT}/backend/data/tutti-generiques-enfants.csv`;
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const ROLLBACK = `${ROOT}/enfants-rollback-${STAMP}.json`;
const THROTTLE_MS = 120;
const FALLBACK_ARTIST = 'Bande originale';

interface PlaylistMeta {
  slug: string;
  name_en: string;
  sub_fr: string;
  sub_en: string;
  category: string;
}
const META: Record<string, PlaylistMeta> = {
  'Génériques Disney & Pixar': {
    slug: 'official-pl-generiques-disney',
    name_en: 'Disney & Pixar Themes',
    sub_fr: 'Devine l’ŒUVRE — Roi Lion, Frozen, Encanto, Moana…',
    sub_en: 'Guess the MOVIE — Lion King, Frozen, Encanto, Moana…',
    category: 'originals',
  },
  'Génériques dessins animés & séries enfants': {
    slug: 'official-pl-generiques-dessins-animes',
    name_en: 'Cartoon & Kid TV Themes',
    sub_fr: 'Devine l’ŒUVRE — Simpson, Pokémon, Bob l’éponge, Bluey…',
    sub_en: 'Guess the SHOW — Simpsons, Pokémon, SpongeBob, Bluey…',
    category: 'originals',
  },
};

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
  if (v === 'HARD') return 'EXPERT';
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
  // Query : title + work (artiste souvent vide pour les génériques).
  const q = artist ? `${artist} - ${title} ${work}` : `${title} ${work}`;
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
  playlist: string;
  work: string;
  workAliases: string[];
  artist: string;
  title: string;
  level: Level;
};

async function main(): Promise<void> {
  const apiKey = process.env.YOUTUBE_API_KEY ?? '';
  if (!apiKey) {
    console.warn(
      '⚠️  YOUTUBE_API_KEY absent — partial run : seuls les tracks déjà au catalogue seront ajoutés. Set YOUTUBE_API_KEY dans backend/.env pour le run complet.',
    );
  }
  const prisma = new PrismaClient();

  const rawRows = readFileSync(CSV, 'utf8')
    .split('\n')
    .slice(1)
    .filter((l) => l.trim())
    .map(parseCsvLine);
  const rows: Row[] = rawRows
    .map((c) => ({
      playlist: (c[0] ?? '').trim(),
      work: (c[1] ?? '').trim(),
      workAliases: (c[2] ?? '')
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean),
      artist: (c[3] ?? '').trim() || FALLBACK_ARTIST,
      title: (c[4] ?? '').trim(),
      level: levelFromCsv(c[5] ?? ''),
    }))
    .filter((r) => r.playlist && r.work && r.title && r.playlist in META);

  // index catalogue existant (par dedupKey)
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

  // upsert + tag guess_mode='work' pour les 2 playlists.
  const createdPlaylistIds: string[] = [];
  const plIdByName: Record<string, string> = {};
  for (const [name, m] of Object.entries(META)) {
    const found = await prisma.officialPlaylist.findFirst({
      where: { OR: [{ slug: m.slug }, { name_fr: name }] },
      select: { id: true, guess_mode: true },
    });
    if (found) {
      plIdByName[name] = found.id;
      if (found.guess_mode !== 'work') {
        await prisma.officialPlaylist.update({
          where: { id: found.id },
          data: { guess_mode: 'work' },
        });
        console.log(
          `↺ playlist existante : "${name}" (${found.id}) — guess_mode='work' mis à jour`,
        );
      } else {
        console.log(`↺ playlist existante : "${name}" (${found.id}) — guess_mode='work' OK`);
      }
    } else {
      const pl = await prisma.officialPlaylist.create({
        data: {
          slug: m.slug,
          name_fr: name,
          name_en: m.name_en,
          locale_primary: 'fr-FR',
          theme: m.slug.replace('official-pl-', ''),
          difficulty: 'MEDIUM',
          visibility: 'public',
          category: m.category,
          subtitle_fr: m.sub_fr,
          subtitle_en: m.sub_en,
          track_count: 0,
          guess_mode: 'work',
        },
        select: { id: true },
      });
      plIdByName[name] = pl.id;
      createdPlaylistIds.push(pl.id);
      console.log(`✚ playlist créée : "${name}" (${pl.id}) — guess_mode='work'`);
    }
  }

  const maxPos = new Map<string, number>();
  const presentByPlaylist = new Map<string, Set<string>>();
  for (const [name, id] of Object.entries(plIdByName)) {
    const a = await prisma.officialPlaylistTrack.aggregate({
      where: { playlist_id: id },
      _max: { position: true },
    });
    maxPos.set(id, a._max.position ?? 0);
    const inPl = await prisma.officialPlaylistTrack.findMany({
      where: { playlist_id: id },
      select: { artist: true, title: true },
    });
    const set = new Set<string>();
    for (const t of inPl) set.add(dedupKey(t.artist, t.title));
    presentByPlaylist.set(name, set);
  }

  const reuse: Array<Row & { src: ExTrack }> = [];
  const toSearch: Row[] = [];
  let alreadyInPlaylist = 0;
  for (const r of rows) {
    const k = dedupKey(r.artist, r.title);
    if (presentByPlaylist.get(r.playlist)?.has(k)) {
      alreadyInPlaylist++;
      continue;
    }
    const ex = existing.get(k);
    if (ex && ex.youtube_id) reuse.push({ ...r, src: ex });
    else toSearch.push(r);
  }
  if (alreadyInPlaylist > 0) {
    console.log(`  idempotence : ${alreadyInPlaylist} tracks déjà présentes → skip`);
  }
  console.log(
    `\n=== DRY-RUN PRE-WRITE [enfants] ===\n  CSV total  : ${rows.length}\n  réutilisé  : ${reuse.length}\n  à résoudre : ${toSearch.length}\n`,
  );

  const counters: Record<
    string,
    { nouveaux: number; reutilises: number; ytEchec: number; workFilled: number }
  > = {};
  for (const name of Object.keys(META)) {
    counters[name] = { nouveaux: 0, reutilises: 0, ytEchec: 0, workFilled: 0 };
  }

  const resolved: Array<Row & { videoId: string; videoTitle: string }> = [];
  if (apiKey && toSearch.length > 0) {
    for (const [i, r] of toSearch.entries()) {
      if (i % 25 === 0) console.log(`  search ${i}/${toSearch.length}…`);
      try {
        const hit = await searchYouTube(apiKey, r.work, r.artist, r.title);
        if (!hit) {
          counters[r.playlist]!.ytEchec++;
          continue;
        }
        resolved.push({ ...r, ...hit });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'QUOTA') {
          console.warn(`  🚫 quota YouTube atteint après ${i}/${toSearch.length} — stop search`);
          for (const rem of toSearch.slice(i)) counters[rem.playlist]!.ytEchec++;
          break;
        }
        counters[r.playlist]!.ytEchec++;
      }
      await sleep(THROTTLE_MS);
    }
  } else if (!apiKey && toSearch.length > 0) {
    for (const r of toSearch) counters[r.playlist]!.ytEchec++;
  }

  const verdicts = apiKey
    ? await classifyYoutubeIds(
        apiKey,
        resolved.map((r) => r.videoId),
      )
    : new Map<string, { is_playable: boolean }>();
  const newPlayable = resolved.filter((r) => {
    if (verdicts.get(r.videoId)?.is_playable) return true;
    counters[r.playlist]!.ytEchec++;
    return false;
  });

  const created: Array<{
    id: string;
    playlist: string;
    artist: string;
    title: string;
    work_title: string;
    work_aliases: string[];
    youtube_id: string;
    level: Level;
    videoTitle: string | null;
    reused: boolean;
  }> = [];
  const writeRollback = (): void => {
    writeFileSync(
      ROLLBACK,
      JSON.stringify(
        {
          created_at: new Date().toISOString(),
          campaign: 'enfants',
          created_playlist_ids: createdPlaylistIds,
          track_ids: created.map((c) => c.id),
          count: created.length,
          items: created,
        },
        null,
        2,
      ),
    );
  };
  try {
    const addTrack = async (
      r: Row,
      yt: string,
      src: ExTrack | null,
      videoTitle: string | null,
    ): Promise<void> => {
      const plId = plIdByName[r.playlist]!;
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
        playlist: r.playlist,
        artist: r.artist,
        title: r.title,
        work_title: r.work,
        work_aliases: r.workAliases,
        youtube_id: yt,
        level: r.level,
        videoTitle,
        reused: !!src,
      });
      counters[r.playlist]!.workFilled++;
    };
    for (const r of reuse) {
      await addTrack(r, r.src.youtube_id!, r.src, null);
      counters[r.playlist]!.reutilises++;
    }
    for (const r of newPlayable) {
      await addTrack(r, r.videoId, null, r.videoTitle);
      counters[r.playlist]!.nouveaux++;
    }
  } finally {
    writeRollback();
  }

  // track_count cohérent + vérif work_title rempli partout.
  const plInfo: Array<{ id: string; name: string; n: number; workOk: number; workMiss: number }> =
    [];
  for (const [name, id] of Object.entries(plIdByName)) {
    const n = await prisma.officialPlaylistTrack.count({ where: { playlist_id: id } });
    await prisma.officialPlaylist.update({ where: { id }, data: { track_count: n } });
    const workOk = await prisma.officialPlaylistTrack.count({
      where: { playlist_id: id, work_title: { not: null } },
    });
    const workMiss = n - workOk;
    plInfo.push({ id, name, n, workOk, workMiss });
  }

  console.log('\n=== PLAYLISTS [enfants] ===');
  for (const p of plInfo) {
    console.log(
      `  "${p.name}"  id=${p.id}  morceaux=${p.n}  work_title rempli=${p.workOk}/${p.n}${p.workMiss > 0 ? `  ⚠️ ${p.workMiss} sans work_title` : ' ✓'}`,
    );
  }
  console.log('\n=== COMPTEURS [enfants] (par playlist) ===');
  for (const [name, c] of Object.entries(counters)) {
    console.log(
      `  "${name}" : ajoutés-nouveaux ${c.nouveaux} · réutilisés-existants ${c.reutilises} · youtube-échec ${c.ytEchec} · work_title écrit ${c.workFilled}`,
    );
  }
  console.log('\n=== ÉCHANTILLON 15 [enfants] (NOUVEAUX puis réutilisés) ===');
  const sample = [...created.filter((c) => !c.reused), ...created.filter((c) => c.reused)].slice(
    0,
    15,
  );
  for (const c of sample) {
    const tag = c.reused ? '(réutilisé)' : '(nouveau)';
    const aliases = c.work_aliases.length > 0 ? ` [alias : ${c.work_aliases.join(' | ')}]` : '';
    console.log(`  [${c.playlist}] ${tag} [${c.level}] ${c.artist} — ${c.title}`);
    console.log(`      ŒUVRE : "${c.work_title}"${aliases}`);
    console.log(
      `      → ${c.videoTitle ?? '(id réutilisé du catalogue)'}  https://youtu.be/${c.youtube_id}`,
    );
  }
  console.log(`\n📄 ROLLBACK : ${ROLLBACK}`);
  console.log(
    `   undo = pnpm exec tsx scripts/funPlaylistsRollback.ts "${ROLLBACK}"  (format compatible)`,
  );
  await prisma.$disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
