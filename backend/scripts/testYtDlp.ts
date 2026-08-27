/**
 * TEST faisabilité yt-dlp vs YouTube Data API search (READ-ONLY, n'écrit rien).
 * 15 tracks droppées (enfants-4-8-ans / video-games / disney-fr). Pour chaque :
 *   - yt-dlp ytsearch1 → 1er id + titre.
 *   - API search relâchée (même logique que _ingestPlaylistsLib) → 1er id.
 * classifyYoutubeIds (embeddable) sur tous. Compare les taux valide+embeddable.
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
loadEnv({ path: '/Users/thomaspinon/Documents/Claude Code/tutti/credentials.env.local' });
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { classifyYoutubeIds } from '../src/lib/youtubeValidation.js';

const YTDLP =
  '/private/tmp/claude-501/-Users-thomaspinon-Documents-Claude-Code/a9f75dfd-8016-4626-91ce-ab632973c807/scratchpad/yt-dlp';
const KEY = process.env.YOUTUBE_API_KEY ?? '';
const CSV =
  '/Users/thomaspinon/Documents/Claude Code/tutti/backend/data/tutti-mortes-complement.csv';

function lower(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function normCmp(s: string): string {
  return lower(s)
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/feat\.?|ft\.?/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function lev(a: string, b: string): number {
  const m = a.length,
    n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let p = d[0]!;
    d[0] = i;
    for (let j = 1; j <= n; j++) {
      const t = d[j]!;
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1));
      p = t;
    }
  }
  return d[n]!;
}
function simScore(videoTitle: string, target: string): number {
  const a = normCmp(videoTitle),
    b = target;
  return lev(a, b) / Math.max(a.length, b.length, 1); // distance normalisée (bas = bon)
}
const FORBIDDEN = [
  'remix',
  'live',
  'karaoke',
  'karaoké',
  'cover',
  'instrumental',
  'tribute',
  'sped up',
  'slowed',
  '8-bit',
  'lullaby',
  'piano version',
];
function forbiddenHit(text: string, source: string): boolean {
  const l = lower(text),
    src = lower(source);
  return FORBIDDEN.some((t) => l.includes(t) && !src.includes(t));
}
function dedupKey(a: string, t: string): string {
  const n = (s: string): string =>
    lower(s)
      .replace(/\(.*?\)|\[.*?\]/g, ' ')
      .replace(/feat\.?|ft\.?/g, ' ')
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  return `${n(a)}|${n(t)}`;
}
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

interface YTItem {
  id: { videoId?: string };
  snippet: { title: string; channelTitle: string };
}
// API relâchée : retourne les candidats classés (ids), seuil 0.5 normalisé, forbidden-si-absent-source.
async function apiSearch(
  artist: string,
  title: string,
): Promise<Array<{ id: string; title: string }>> {
  const source = `${artist} ${title}`;
  const target = normCmp(source);
  const params = new URLSearchParams({
    part: 'snippet',
    q: `${artist} - ${title}`,
    type: 'video',
    maxResults: '15',
    videoEmbeddable: 'true',
    safeSearch: 'none',
    key: KEY,
  });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: YTItem[] };
  const cands = (data.items ?? []).filter(
    (it) => it.id.videoId && !forbiddenHit(it.snippet.title, source),
  );
  return cands
    .map((it) => ({ it, score: simScore(it.snippet.title, target) }))
    .filter((s) => s.score <= 0.5)
    .sort((a, b) => a.score - b.score)
    .slice(0, 5)
    .map((s) => ({ id: s.it.id.videoId!, title: s.it.snippet.title }));
}

function ytdlp(artist: string, title: string): { id: string; title: string } | null {
  try {
    const out = execFileSync(
      YTDLP,
      [
        '--skip-download',
        '--no-warnings',
        '--print',
        '%(id)s|%(title)s',
        `ytsearch1:${artist} ${title}`,
      ],
      { timeout: 40000, encoding: 'utf8' },
    ).trim();
    const [id, ...rest] = out.split('|');
    if (!id) return null;
    return { id, title: rest.join('|') };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const map: Record<string, string> = {
    'enfants-4-8': 'official-pl-enfants-4-8-ans',
    'jeux-video': 'official-pl-video-games',
    'disney-fr': 'official-pl-disney-fr',
  };
  // tracks déjà en DB (landées) par playlist
  const landed = new Map<string, Set<string>>();
  for (const dbSlug of Object.values(map)) {
    const pl = await prisma.officialPlaylist.findUnique({
      where: { slug: dbSlug },
      include: { tracks: { select: { artist: true, title: true } } },
    });
    const set = new Set<string>();
    for (const t of pl?.tracks ?? []) set.add(dedupKey(t.artist, t.title));
    landed.set(dbSlug, set);
  }
  // CSV rows pour les 3 slugs, garde les DROPPÉES (pas en DB), 5 par playlist
  const lines = readFileSync(CSV, 'utf8').split('\n').slice(1);
  const picked: Array<{ pl: string; artist: string; title: string }> = [];
  const perCount: Record<string, number> = {};
  for (const line of lines) {
    if (!line.trim()) continue;
    const c = parseCsvLine(line);
    const csvSlug = (c[0] ?? '').trim();
    const dbSlug = map[csvSlug];
    if (!dbSlug) continue;
    const artist = (c[2] ?? '').trim(),
      title = (c[3] ?? '').trim();
    if (!artist || !title) continue;
    if (landed.get(dbSlug)?.has(dedupKey(artist, title))) continue; // landée → pas droppée
    if ((perCount[csvSlug] ?? 0) >= 5) continue;
    perCount[csvSlug] = (perCount[csvSlug] ?? 0) + 1;
    picked.push({ pl: csvSlug, artist, title });
  }
  console.log(
    `[test] ${picked.length} tracks droppées sélectionnées (${JSON.stringify(perCount)})\n`,
  );

  // résout yt-dlp + API
  const rows = [];
  for (const t of picked) {
    const yt = ytdlp(t.artist, t.title);
    const api = await apiSearch(t.artist, t.title);
    rows.push({ t, ytId: yt?.id ?? null, ytTitle: yt?.title ?? null, apiCands: api });
  }
  // classify embeddable : tous les ids candidats
  const allIds = [
    ...new Set(
      rows.flatMap((r) => [r.ytId, ...r.apiCands.map((a) => a.id)]).filter((x): x is string => !!x),
    ),
  ];
  const verdicts = await classifyYoutubeIds(KEY, allIds);
  const ok = (id: string | null | undefined): boolean => !!id && !!verdicts.get(id)?.is_playable;

  let ytOk = 0,
    apiOk = 0;
  console.log('track | yt-dlp id (emb?) | API 1er emb? ');
  for (const r of rows) {
    const ytEmb = ok(r.ytId);
    const apiPick = r.apiCands.find((a) => ok(a.id));
    if (ytEmb) ytOk++;
    if (apiPick) apiOk++;
    console.log(
      `${(r.t.artist + ' — ' + r.t.title).slice(0, 42).padEnd(42)} | ${r.ytId ?? 'none'} ${ytEmb ? '✓' : '✗'} | ${apiPick ? apiPick.id + ' ✓' : 'aucun ✗'}`,
    );
  }
  console.log(`\n=== TAUX valide+embeddable sur ${rows.length} droppées ===`);
  console.log(`  yt-dlp : ${ytOk}/${rows.length} (${Math.round((ytOk / rows.length) * 100)}%)`);
  console.log(`  API    : ${apiOk}/${rows.length} (${Math.round((apiOk / rows.length) * 100)}%)`);
  console.log('\n=== 3 exemples yt-dlp (track → id → titre vidéo) ===');
  for (const r of rows.filter((x) => ok(x.ytId)).slice(0, 3)) {
    console.log(`  "${r.t.artist} — ${r.t.title}"\n    → ${r.ytId} | "${r.ytTitle}"`);
  }
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error('fatal:', e);
  process.exitCode = 1;
});
