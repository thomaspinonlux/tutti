/**
 * Finalise spotify_id du catalogue (SEARCH-ONLY, écrit en DB).
 * Cible : OfficialPlaylistTrack avec youtube_id ET spotify_id=null.
 * Pour chaque : Spotify search q=artist+title → classifyTrack (artiste+titre
 * normalisés, seuils AUTO 0.82 / FLOOR 0.55, détection danger live/remix…).
 * N'écrit QUE les `auto-ok`. Idempotent (ne traite que les null). Rollback JSON
 * incrémental. Round-robin sur les 3 apps dry-run (anti-cap, backoff 429).
 *
 * SÉCURITÉ : pool = UNIQUEMENT SPOTIFY_DRYRUN/2/3 — JAMAIS l'app prod
 * (SPOTIFY_CLIENT_*), sinon la bulk-search caperait la lecture live joueurs.
 *
 * Réplique fidèle du cœur de spotifyMatchDryrun.ts (matcher prouvé), + write.
 * Usage : tsx scripts/spotifyFinalizeIds.ts [--limit=N]
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';

const prisma = new PrismaClient();
const THROTTLE_MS = 400; // plancher anti-ban ; charge répartie sur 3 apps
const AUTO = 0.82;
const FLOOR = 0.55;
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Math.max(1, parseInt(limitArg.split('=')[1] ?? '0', 10)) : 0;

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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
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
  const m = a.length,
    n = b.length;
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
  const na = norm(a),
    nb = norm(b);
  if (!na && !nb) return 1;
  return Math.max(0, 1 - lev(na, nb) / Math.max(na.length, nb.length, 1));
}
function normTitle(s: string): string {
  return norm(s.split(/\s[-–—]\s/)[0] ?? s);
}
function simT(a: string, b: string): number {
  const na = normTitle(a),
    nb = normTitle(b);
  if (!na && !nb) return 1;
  const short = na.length <= nb.length ? na : nb;
  const long = na.length <= nb.length ? nb : na;
  if (short.length >= 6 && long.startsWith(short)) return 1;
  return Math.max(0, 1 - lev(na, nb) / Math.max(na.length, nb.length, 1));
}
function cleanArtist(a: string): string {
  let s = a.split(',')[0] ?? a;
  s = s.replace(/\s+(?:featuring|feat|ft|with)\.?\s+.*$/i, '');
  s = s.split('&')[0] ?? s;
  return s.trim() || a.trim();
}
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

// ── Pool dry-run (anti-cap, JAMAIS prod) ────────────────────────────────────
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
    const id = process.env[idk],
      secret = process.env[sk];
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
async function searchSpotify(artist: string, title: string): Promise<SpotItem[]> {
  let app = POOL[cur];
  if (!app) return [];
  if (app.capped) {
    const n = rotateToDrained();
    if (!n) throw new Error('ABORT_CAPPED');
    app = n;
  }
  const tk = await tokenFor(app);
  if (!tk) {
    app.capped = true;
    const n = rotateToDrained();
    if (!n) throw new Error('ABORT_CAPPED');
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
      console.warn(`[pool] ${app.name} capée → rotation`);
      app.capped = true;
      app.consec429 = 0;
      const n = rotateToDrained();
      if (!n) throw new Error('ABORT_CAPPED');
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
async function classifyTrack(
  artistRaw: string,
  title: string,
): Promise<{ flag: 'auto-ok' | 'review' | 'no-match'; best: Scored | null }> {
  const qArtist = cleanArtist(artistRaw);
  const items = await searchSpotify(qArtist, title);
  const scored: Scored[] = items.map((it) => ({
    it,
    aSim: Math.max(...it.artists.map((a) => sim(a.name, qArtist)), 0),
    tSim: simT(it.name, title),
    danger: hasDanger(it.name),
  }));
  scored.sort((a, b) => b.aSim + b.tSim - (a.aSim + a.tSim));
  let best = scored[0] ?? null;
  if (best && best.danger) {
    const alt = scored.find((s) => !s.danger && s.aSim >= AUTO && s.tSim >= AUTO);
    if (alt) best = alt;
  }
  let flag: 'auto-ok' | 'review' | 'no-match';
  if (!best || best.aSim < FLOOR || best.tSim < FLOOR) flag = 'no-match';
  else if (best.danger) flag = 'review';
  else if (best.aSim >= AUTO && best.tSim >= AUTO) flag = 'auto-ok';
  else flag = 'review';
  return { flag, best };
}

// ── main ────────────────────────────────────────────────────────────────────
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const ROLLBACK = `/Users/thomaspinon/Documents/Claude Code/tutti/spotify-finalize-rollback-${STAMP}.json`;
const written: string[] = []; // ids OfficialPlaylistTrack passés de null→spotify_id (undo = re-null)
function flushRollback(): void {
  writeFileSync(
    ROLLBACK,
    JSON.stringify(
      {
        created_at: new Date().toISOString(),
        campaign: 'spotify-finalize',
        undo: 'set spotify_id=null pour track_ids',
        track_ids: written,
        count: written.length,
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  if (POOL.length === 0) {
    console.error('🛑 Aucune app dry-run (SPOTIFY_DRYRUN*) → STOP.');
    return;
  }
  await preProbeApps();
  if (POOL.every((a) => a.capped)) {
    console.error('🛑 Toutes les apps dry-run capées au démarrage → réessaie plus tard.');
    return;
  }

  const targets = await prisma.officialPlaylistTrack.findMany({
    where: { youtube_id: { not: null }, spotify_id: null },
    select: { id: true, artist: true, title: true },
    orderBy: { id: 'asc' },
    ...(LIMIT ? { take: LIMIT } : {}),
  });
  console.log(`[finalize] cible : ${targets.length} tracks (yt set, sp null)\n`);

  let ok = 0,
    review = 0,
    noMatch = 0,
    aborted = false;
  for (const [i, t] of targets.entries()) {
    try {
      const { flag, best } = await classifyTrack(t.artist, t.title);
      if (flag === 'auto-ok' && best) {
        await prisma.officialPlaylistTrack.update({
          where: { id: t.id },
          data: { spotify_id: best.it.id },
        });
        written.push(t.id);
        ok++;
      } else if (flag === 'review') review++;
      else noMatch++;
    } catch (err) {
      if (err instanceof Error && err.message === 'ABORT_CAPPED') {
        console.warn(
          `\n🚫 toutes apps capées après ${i}/${targets.length} → stop propre (idempotent, relancer plus tard)`,
        );
        aborted = true;
        break;
      }
      noMatch++;
    }
    if (i % 50 === 0) {
      flushRollback();
      console.log(`  ${i}/${targets.length} | écrits=${ok} review=${review} no-match=${noMatch}`);
    }
    await sleep(THROTTLE_MS);
  }
  flushRollback();
  console.log(
    `\n[finalize] DONE${aborted ? ' (PARTIEL, capé)' : ''} | écrits=${ok} · review=${review} · no-match=${noMatch} · rollback=${ROLLBACK}`,
  );
}

main()
  .catch((e) => {
    console.error('[finalize] fatal:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
