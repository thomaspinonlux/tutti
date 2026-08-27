/**
 * DRY-RUN matching Spotify du catalogue officiel — READ-ONLY (Spotify search +
 * lecture DB). AUCUNE écriture DB. Écrit un CSV maître append-only.
 *
 * Usage : pnpm exec tsx scripts/spotifyMatchDryrun.ts [groupe]   (défaut 1)
 *   - Trie les 95 OfficialPlaylist par #tracks décroissant, groupes de 10.
 *   - Affiche la carte des groupes (au groupe 1).
 *   - Traite UNIQUEMENT le groupe demandé. Reprise : saute les tracks déjà
 *     présents dans le CSV. Loggue tous les 100.
 *   - Résumé du groupe à la fin (auto-ok / review / no-match + liste no-match).
 *
 * À supprimer après la campagne.
 */
import 'dotenv/config';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const CSV = '/Users/thomaspinon/Documents/Claude Code/tutti/spotify-match-dryrun.v2.csv';

// Fix B — marqueurs DANGER (audio différent). PAS : remaster/radio edit/single
// version/taylor's version (ceux-là = OK, on ne pénalise pas).
const DANGER = [
  'live',
  'karaoke',
  'instrumental',
  'acoustic',
  'cover',
  'remix',
  'sped up',
  'slowed',
  'tribute',
  'made famous',
  're-recorded',
];
const GROUP = Math.max(1, parseInt(process.argv[2] ?? '1', 10));
const GROUP_SIZE = 10;
// Mode chunk : `chunk <startIdx> <count>` → traite count playlists depuis startIdx
// (liste triée par #tracks desc). Resume-safe. Pour grappiller en petits morceaux
// avec repos entre chunks (orchestré côté bash). Le label de groupe CSV reste
// correct (calculé depuis l'index global → G1/G2/… exacts).
const IS_CHUNK = process.argv[2] === 'chunk';
const CHUNK_START = IS_CHUNK ? Math.max(0, parseInt(process.argv[3] ?? '0', 10)) : 0;
const CHUNK_COUNT = IS_CHUNK ? Math.max(1, parseInt(process.argv[4] ?? '2', 10)) : 0;
const THROTTLE_MS = 1000; // 1 req/s — sous la fenêtre glissante 30s de Spotify, tenable sur 4000+ appels

const AUTO = 0.82; // les deux ≥ → auto-ok
const FLOOR = 0.55; // l'un < → no-match

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/feat\.?|ft\.?/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function lev(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = d[0]!;
    d[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = d[j]!;
      d[j] = Math.min(d[j]! + 1, d[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[n]!;
}
function sim(a: string, b: string): number {
  const na = norm(a);
  const nb = norm(b);
  if (!na && !nb) return 1;
  const max = Math.max(na.length, nb.length, 1);
  return Math.max(0, 1 - lev(na, nb) / max);
}
// Pour la similarité de TITRE : retire aussi le suffixe " - …" (US Edit, Remastered,
// 2018 Remaster, Love Theme from…, From "Top Gun"…) en plus de (...)/[...] via norm().
// Le DANGER reste détecté séparément sur le titre BRUT (hasDanger), donc une version
// "live/remix" garde un tSim haut mais sera quand même forcée en review.
function normTitle(s: string): string {
  return norm(s.split(/\s[-–—]\s/)[0] ?? s);
}
function simT(a: string, b: string): number {
  const na = normTitle(a);
  const nb = normTitle(b);
  if (!na && !nb) return 1;
  const short = na.length <= nb.length ? na : nb;
  const long = na.length <= nb.length ? nb : na;
  if (short.length >= 6 && long.startsWith(short)) return 1; // sous-titre/extension bénigne
  const max = Math.max(na.length, nb.length, 1);
  return Math.max(0, 1 - lev(na, nb) / max);
}
function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Vrai parseur CSV (virgules dans les champs quotés + guillemets doublés).
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

// Fix A — artiste principal : drop ", …" (multi-artistes), feat/ft/featuring/with…, & …
function cleanArtist(a: string): string {
  let s = a.split(',')[0] ?? a;
  // token feat/ft/featuring/with entouré d'espaces, point optionnel ("ft. X", "feat X"…)
  s = s.replace(/\s+(?:featuring|feat|ft|with)\.?\s+.*$/i, '');
  s = s.split('&')[0] ?? s;
  return s.trim() || a.trim();
}

// Fix B — détecte un marqueur DANGER dans les ANNOTATIONS du titre brut Spotify
// (parenthèses, crochets, suffixe après " - "), pas dans le corps ni l'artiste.
function dangerZone(title: string): string {
  const zones: string[] = [];
  const re = /[([{]([^)\]}]*)[)\]}]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(title))) zones.push(m[1] ?? '');
  const parts = title.split(/\s[-–—]\s/);
  if (parts.length > 1) zones.push(parts.slice(1).join(' '));
  return zones.join(' ').toLowerCase();
}
function hasDanger(title: string): boolean {
  const zone = dangerZone(title);
  if (!zone) return false;
  return DANGER.some((d) => new RegExp(`\\b${d.replace(/ /g, '\\s+')}\\b`).test(zone));
}

// ───── Pool d'apps dry-run (rotation anti-cap) ─────────────────────────────
// SÉCURITÉ ABSOLUE : le pool ne contient QUE les apps dédiées dry-run
// (SPOTIFY_DRYRUN*, SPOTIFY_DRYRUN2*, SPOTIFY_DRYRUN3*). JAMAIS l'app prod
// (SPOTIFY_CLIENT_*) — la bulk-search la caperait et casserait la lecture
// Spotify live côté joueurs. Pas de fallback prod, point.
interface DryApp {
  name: string;
  id: string;
  secret: string;
  token: { access_token: string; expires_at: number } | null;
  capped: boolean;
  consec429: number;
}
function buildPool(): DryApp[] {
  const defs: Array<[string, string, string]> = [
    ['DRYRUN', 'SPOTIFY_DRYRUN_CLIENT_ID', 'SPOTIFY_DRYRUN_CLIENT_SECRET'],
    ['DRYRUN2', 'SPOTIFY_DRYRUN2_CLIENT_ID', 'SPOTIFY_DRYRUN2_CLIENT_SECRET'],
    ['DRYRUN3', 'SPOTIFY_DRYRUN3_CLIENT_ID', 'SPOTIFY_DRYRUN3_CLIENT_SECRET'],
  ];
  const pool: DryApp[] = [];
  for (const [name, idk, sk] of defs) {
    const id = process.env[idk];
    const secret = process.env[sk];
    if (id && secret) pool.push({ name, id, secret, token: null, capped: false, consec429: 0 });
  }
  return pool;
}
const POOL = buildPool();
let cur = 0;

async function tokenFor(app: DryApp): Promise<string | null> {
  if (app.token && app.token.expires_at > Date.now() + 60_000) return app.token.access_token;
  const auth = Buffer.from(`${app.id}:${app.secret}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token: string; expires_in: number };
  app.token = { access_token: data.access_token, expires_at: Date.now() + data.expires_in * 1000 };
  return app.token.access_token;
}

// Compat : le null-check de démarrage (main/mainSubset) vérifie qu'au moins une
// app dry-run a des creds valides.
async function getSpotifyAppToken(): Promise<string | null> {
  if (POOL.length === 0) return null;
  return tokenFor(POOL[cur] ?? POOL[0]!);
}

// Probe 1-appel par app au démarrage → marque les capées (ne gâche pas d'appels
// dessus) et démarre sur la 1ʳᵉ drainée.
async function preProbeApps(): Promise<void> {
  for (const app of POOL) {
    const tk = await tokenFor(app);
    if (!tk) {
      app.capped = true;
      console.warn(`[pool] ${app.name} creds KO → exclue`);
      continue;
    }
    const r = await fetch('https://api.spotify.com/v1/search?q=test&type=track&limit=1', {
      headers: { Authorization: `Bearer ${tk}` },
    });
    app.capped = r.status === 429;
    console.log(
      `[pool] ${app.name}: ${r.status === 200 ? 'DRAINED ✓' : r.status === 429 ? 'capée' : 'status ' + r.status}`,
    );
  }
  const firstOk = POOL.findIndex((a) => !a.capped);
  cur = firstOk >= 0 ? firstOk : 0;
}

function rotateToDrained(): DryApp | null {
  for (let k = 1; k <= POOL.length; k++) {
    const i = (cur + k) % POOL.length;
    if (!POOL[i]!.capped) {
      cur = i;
      return POOL[i]!;
    }
  }
  return null;
}

interface SpotItem {
  id: string;
  name: string;
  artists: Array<{ name: string }>;
}
// Rotation : l'app courante cape (3× 429 d'affilée) → bascule sur la suivante
// drainée SANS attendre son retry-after (alternatives dispo, pas de grind).
// Toutes capées → ABORT_CAPPED (exit 42 → grappille sleep + re-probe plus tard).
async function searchSpotify(artist: string, title: string): Promise<SpotItem[]> {
  let app = POOL[cur];
  if (!app) return [];
  if (app.capped) {
    const n = rotateToDrained();
    if (!n) throw new Error('ABORT_CAPPED: toutes les apps dry-run capées — STOP propre');
    app = n;
  }
  const tk = await tokenFor(app);
  if (!tk) {
    app.capped = true;
    const n = rotateToDrained();
    if (!n) throw new Error('ABORT_CAPPED: plus aucune app dry-run valide — STOP propre');
    return searchSpotify(artist, title);
  }
  const q = `${artist.replace(/[":]/g, ' ')} ${title.replace(/[":]/g, ' ')}`.trim();
  const params = new URLSearchParams({ q, type: 'track', limit: '10' });
  const res = await fetch(`https://api.spotify.com/v1/search?${params.toString()}`, {
    headers: { Authorization: `Bearer ${tk}` },
  });
  if (res.status === 429) {
    app.consec429 += 1;
    if (app.consec429 >= 3) {
      console.warn(`[pool] ${app.name} capée (${app.consec429}× 429) → rotation`);
      app.capped = true;
      app.consec429 = 0;
      const n = rotateToDrained();
      if (!n) throw new Error('ABORT_CAPPED: toutes les apps dry-run capées — STOP propre');
      return searchSpotify(artist, title);
    }
    const ra = Math.min(Number(res.headers.get('retry-after') ?? '3'), 15);
    await sleep(ra * 1000 + 300);
    return searchSpotify(artist, title);
  }
  if (!res.ok) return [];
  const data = (await res.json()) as { tracks?: { items: SpotItem[] } };
  app.consec429 = 0;
  return data.tracks?.items ?? [];
}

interface Scored {
  it: SpotItem;
  aSim: number;
  tSim: number;
  danger: boolean;
}
// Cœur du matching (Fix A + Fix B). Partagé par le mode groupe ET le mode subset
// → on teste exactement le même code.
async function classifyTrack(
  artistRaw: string,
  title: string,
): Promise<{ flag: 'auto-ok' | 'review' | 'no-match'; best: Scored | null; qArtist: string }> {
  const qArtist = cleanArtist(artistRaw); // Fix A
  const items = await searchSpotify(qArtist, title);
  const scored: Scored[] = items.map((it) => ({
    it,
    aSim: Math.max(...it.artists.map((a) => sim(a.name, qArtist)), 0),
    tSim: simT(it.name, title), // titre sans suffixe de version
    danger: hasDanger(it.name), // Fix B (sur le titre brut)
  }));
  scored.sort((a, b) => b.aSim + b.tSim - (a.aSim + a.tSim));
  let best = scored[0] ?? null;
  // Fix B : meilleur candidat dangereux → tente une alternative PROPRE
  // équivalente (titre+artiste) parmi les autres résultats de la search.
  if (best && best.danger) {
    const alt = scored.find((s) => !s.danger && s.aSim >= AUTO && s.tSim >= AUTO);
    if (alt) best = alt; // version propre récupérée
  }
  let flag: 'auto-ok' | 'review' | 'no-match';
  if (!best || best.aSim < FLOOR || best.tSim < FLOOR) flag = 'no-match';
  else if (best.danger)
    flag = 'review'; // danger non récupéré → jamais auto-ok
  else if (best.aSim >= AUTO && best.tSim >= AUTO) flag = 'auto-ok';
  else flag = 'review';
  return { flag, best, qArtist };
}

// MODE SUBSET — re-teste un petit lot de tracks ciblés (CSV subset-input.csv),
// READ-ONLY, juste pour prouver Fix A + Fix B. N'écrit rien, console only.
async function mainSubset(): Promise<void> {
  const tk = await getSpotifyAppToken();
  if (!tk) {
    console.error('🛑 SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET absents du .env local → STOP.');
    return;
  }
  const usingDryrun = !!process.env.SPOTIFY_DRYRUN_CLIENT_ID;
  console.log(
    `App Spotify: ${usingDryrun ? 'DRY-RUN dédiée ✓' : '⚠ PROD (fallback) — risque ban'}\n`,
  );
  const INPUT = '/Users/thomaspinon/Documents/Claude Code/tutti/subset-input.csv';
  // Vrai parseur CSV (gère les virgules dans les champs quotés + guillemets doublés).
  const parseLine = (line: string): string[] => {
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
  };
  const lines = readFileSync(INPUT, 'utf8')
    .split('\n')
    .slice(1)
    .filter((l) => l.trim());
  const rows = lines.map((line) => {
    const cols = parseLine(line);
    return {
      playlist: cols[1] ?? '',
      artist: cols[2] ?? '',
      title: cols[3] ?? '',
      origFlag: cols[5] ?? '',
      origSpot: cols[6] ?? '',
    };
  });
  console.log(`=== SUBSET CHECK (${rows.length} tracks) — matcher hardené Fix A + Fix B ===\n`);
  let recovered = 0;
  let stillNo = 0;
  const out: Array<{
    artist: string;
    title: string;
    origFlag: string;
    flag: string;
    best: Scored | null;
  }> = [];
  for (const r of rows) {
    const { flag, best, qArtist } = await classifyTrack(r.artist, r.title);
    const spot = best ? `${best.it.name} — ${best.it.artists.map((a) => a.name).join('/')}` : '∅';
    const conf = best
      ? `a${best.aSim.toFixed(2)} t${best.tSim.toFixed(2)}${best.danger ? ' !DANGER' : ''}`
      : '';
    let tag = '';
    if (r.origFlag === 'no-match' && flag !== 'no-match') {
      recovered++;
      tag = ' ✅REC';
    } else if (r.origFlag === 'no-match' && flag === 'no-match') {
      stillNo++;
      tag = ' ⚠still-no-match';
    }
    console.log(`[${r.origFlag} → ${flag}]${tag}  ${r.artist} — ${r.title}`);
    console.log(`     qArtist="${qArtist}"  →  ${spot}  (${conf})`);
    out.push({ artist: r.artist, title: r.title, origFlag: r.origFlag, flag, best });
    await sleep(THROTTLE_MS);
  }
  const nm = rows.filter((r) => r.origFlag === 'no-match').length;
  console.log('\n=== RÉSUMÉ SUBSET ===');
  console.log(
    `no-match d'origine : ${nm}  →  récupérés : ${recovered}  |  encore no-match : ${stillNo}`,
  );
  const gly = out.find((o) => o.artist === 'Bush' && o.title === 'Glycerine');
  if (gly) {
    const b = gly.best;
    console.log(
      `Glycerine (était auto-ok FAUX/Live) : ${gly.flag}  →  ${b ? b.it.name : '∅'}` +
        (b ? `  (a${b.aSim.toFixed(2)} t${b.tSim.toFixed(2)} danger=${b.danger})` : ''),
    );
  }
}

async function main(): Promise<void> {
  const tk = await getSpotifyAppToken();
  if (!tk) {
    console.error(
      '🛑 Aucune app dry-run (SPOTIFY_DRYRUN*_CLIENT_ID/SECRET) valide en .env → STOP.',
    );
    return;
  }
  // Pool d'apps + probe : rotation anti-cap. Jamais l'app prod.
  await preProbeApps();
  console.log(
    `[pool] ${POOL.length} app(s), ${POOL.filter((a) => !a.capped).length} drainée(s) au départ`,
  );

  const counts = await prisma.officialPlaylistTrack.groupBy({
    by: ['playlist_id'],
    _count: { _all: true },
  });
  const countMap = new Map(counts.map((c) => [c.playlist_id, c._count._all]));
  const pls = (
    await prisma.officialPlaylist.findMany({ select: { id: true, slug: true, name_fr: true } })
  )
    .map((p) => ({ ...p, n: countMap.get(p.id) ?? 0 }))
    .sort((a, b) => b.n - a.n);

  const groupCount = Math.ceil(pls.length / GROUP_SIZE);
  if (GROUP === 1 && !IS_CHUNK) {
    console.log(
      `=== CARTE DES GROUPES (${pls.length} playlists, ${groupCount} groupes de ${GROUP_SIZE}) ===`,
    );
    console.log('grp | #tk | playlist');
    pls.forEach((p, i) => {
      const g = Math.floor(i / GROUP_SIZE) + 1;
      console.log(`G${String(g).padStart(2)} | ${String(p.n).padStart(3)} | ${p.slug}`);
    });
    console.log('');
  }

  const group = IS_CHUNK
    ? pls.slice(CHUNK_START, CHUNK_START + CHUNK_COUNT)
    : pls.slice((GROUP - 1) * GROUP_SIZE, GROUP * GROUP_SIZE);
  if (group.length === 0) {
    console.log(
      IS_CHUNK
        ? `[chunk] start=${CHUNK_START} hors limites (${pls.length} playlists) — FINI`
        : `Groupe ${GROUP} hors limites (max ${groupCount}).`,
    );
    return;
  }

  // Reprise : clés déjà dans le CSV (playlist|artist|title normalisés).
  const seen = new Set<string>();
  if (existsSync(CSV)) {
    for (const line of readFileSync(CSV, 'utf8').split('\n').slice(1)) {
      if (!line.trim()) continue;
      const cols = parseCsvLine(line); // [0]=group [1]=playlist [2]=artist [3]=title
      seen.add(`${cols[1] ?? ''}|${norm(cols[2] ?? '')}|${norm(cols[3] ?? '')}`);
    }
  } else {
    appendFileSync(
      CSV,
      'group,playlist,artist,title,youtube_id,spotify_track_name,spotify_artist_name,spotify_id,confidence,flag\n',
    );
  }

  let tested = 0;
  let autoOk = 0;
  let review = 0;
  let noMatch = 0;
  const noMatchList: string[] = [];
  const total = group.reduce((s, p) => s + p.n, 0);
  let processed = 0;

  const baseIdx = IS_CHUNK ? CHUNK_START : (GROUP - 1) * GROUP_SIZE;
  for (let gi = 0; gi < group.length; gi++) {
    const pl = group[gi]!;
    const groupLabel = `G${Math.floor((baseIdx + gi) / GROUP_SIZE) + 1}`;
    const tracks = await prisma.officialPlaylistTrack.findMany({
      where: { playlist_id: pl.id, spotify_id: null },
      select: { artist: true, title: true, youtube_id: true },
    });
    for (const t of tracks) {
      processed++;
      const key = `${pl.slug}|${norm(t.artist)}|${norm(t.title)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const { flag, best } = await classifyTrack(t.artist, t.title);

      tested++;
      if (flag === 'auto-ok') autoOk++;
      else if (flag === 'review') review++;
      else {
        noMatch++;
        noMatchList.push(`${t.artist} — ${t.title}`);
      }

      appendFileSync(
        CSV,
        [
          groupLabel,
          pl.slug,
          t.artist,
          t.title,
          t.youtube_id ?? '',
          best?.it.name ?? '',
          best?.it.artists.map((a) => a.name).join(' / ') ?? '',
          best?.it.id ?? '',
          best
            ? `a${best.aSim.toFixed(2)} t${best.tSim.toFixed(2)}${best.danger ? ' !DANGER' : ''}`
            : '',
          flag,
        ]
          .map(csvCell)
          .join(',') + '\n',
      );

      if (processed % 100 === 0) console.log(`[dryrun] ${groupLabel} ${processed}/${total}`);
      await sleep(THROTTLE_MS);
    }
    if (IS_CHUNK) console.log(`[chunk] ${pl.slug} faite — total ${seen.size}/4280`);
  }

  const pct = (a: number) => (tested ? ((100 * a) / tested).toFixed(0) : '0');
  console.log('');
  console.log(
    `=== RÉSUMÉ ${IS_CHUNK ? `CHUNK start=${CHUNK_START}` : `GROUPE ${GROUP}`} (${group.length} playlists) ===`,
  );
  console.log(`testés (nouveaux ce run) : ${tested}`);
  console.log(
    `auto-ok : ${autoOk} (${pct(autoOk)}%)  |  review : ${review} (${pct(review)}%)  |  no-match : ${noMatch} (${pct(noMatch)}%)`,
  );
  console.log(`CSV : ${CSV}`);
  if (noMatchList.length) {
    console.log(`--- no-match (${noMatchList.length}) ---`);
    noMatchList.forEach((s) => console.log(`  ✗ ${s}`));
  }
}

(process.argv[2] === 'subset' ? mainSubset() : main())
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    const msg = e instanceof Error ? e.message : String(e);
    // exit 42 = app Spotify capée (signal distinct pour que l'orchestrateur bash STOP).
    process.exit(msg.includes('ABORT_CAPPED') ? 42 : 1);
  });
