/**
 * scripts/enrichOfficialPlaylists.ts — feat/enrich-official-playlists-pool-80
 *
 * Enrichit les playlists officielles du catalogue (`official_playlists` /
 * `official_playlist_tracks`) jusqu'à un POOL CIBLE de N tracks (default 80).
 *
 * Cause initiale (audit 2026-06) : les 95 playlists du catalogue ont toutes
 * exactement 15 tracks, default_session_size=15 → `Math.min(15,15)=15` →
 * set identique à chaque session. PO confirme "mêmes morceaux à chaque
 * relance". Sans enrichir le pool, aucune variété possible.
 *
 * Workflow par playlist :
 *   1. Récupère les tracks existantes (title, artist, year).
 *   2. Claude Sonnet 4.5 → génère N suggestions complémentaires (même thème,
 *      époque, langue), en lui passant les tracks existantes pour éviter
 *      les doublons sémantiques.
 *   3. Pour chaque suggestion : YouTube Data API search avec scoring
 *      VEVO/Official/Topic, anti-doublon par slug(artist+title).
 *   4. INSERT official_playlist_tracks avec position incrémentale.
 *   5. UPDATE official_playlists.track_count.
 *
 * Usage :
 *   pnpm enrich:official-playlists                    # toutes (95), pool=80
 *   pnpm enrich:official-playlists --limit=3          # tester sur 3
 *   pnpm enrich:official-playlists --playlist=italo-disco-classics
 *   pnpm enrich:official-playlists --target-size=60   # pool plus petit
 *   pnpm enrich:official-playlists --dry-run          # preview sans INSERT
 *
 * Env requis : ANTHROPIC_API_KEY, YOUTUBE_API_KEY, DATABASE_URL.
 *
 * Coût estimé (pool=80, 95 playlists) :
 *   - Claude Sonnet 4.5 : ~95 × 85 tracks × ~350 tok = ~22M tok out = ~$3.30
 *     + ~22M tok in = ~$0.65 → ~$4 (~3.7€)
 *   - YouTube quota : 85 × 100 units × 95 = ~810k → 1 jour de quota max ou
 *     étaler. Default quota 10k/day → augmentation requise OU --limit=10.
 */

import { PrismaClient } from '@prisma/client';
import pLimit from 'p-limit';
import { config } from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';

config();

const prisma = new PrismaClient();

const TARGET_POOL_DEFAULT = 80;
const OVERREQUEST_FACTOR = 1.5;
const PLAYLIST_CONCURRENCY = 2;
/** Limite GLOBALE (toutes playlists confondues) pour rester sous le quota
 * YouTube per-minute (~300/min sur quota standard). 4 en parallèle = ~240
 * requêtes/min en burst, ce qui passe en général. */
const YT_GLOBAL_CONCURRENCY = 4;
/** Max tracks par artiste dans les suggestions retenues. Claude ignore parfois
 * la consigne "max 2" → on enforce côté code. */
const MAX_TRACKS_PER_ARTIST = 2;
const ANTHROPIC_MODEL = 'claude-sonnet-4-5-20250929';
const MAX_TOKENS = 6000;

// Limite globale partagée par toutes les playlists pour les appels YouTube.
const ytGlobalLimit = pLimit(YT_GLOBAL_CONCURRENCY);

// $ per million tokens (2026-06 Sonnet 4.5 pricing)
const PRICE_INPUT_USD_PER_M = 3;
const PRICE_OUTPUT_USD_PER_M = 15;
const USD_TO_EUR = 0.92;

interface CliArgs {
  limit: number | null;
  playlistSlug: string | null;
  targetSize: number;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number.parseInt(limitArg.split('=')[1] ?? '', 10) || null : null;
  const playlistArg = args.find((a) => a.startsWith('--playlist='));
  const playlistSlug = playlistArg ? (playlistArg.split('=')[1] ?? null) : null;
  const targetArg = args.find((a) => a.startsWith('--target-size='));
  const targetSize = targetArg
    ? Number.parseInt(targetArg.split('=')[1] ?? '', 10) || TARGET_POOL_DEFAULT
    : TARGET_POOL_DEFAULT;
  const dryRun = args.includes('--dry-run');
  return { limit, playlistSlug, targetSize, dryRun };
}

// ───── Helpers ────────────────────────────────────────────────────────────

function lower(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function slugifyKey(artist: string, title: string): string {
  return `${lower(artist).replace(/\s+/g, '')}|${lower(title).replace(/\s+/g, '')}`;
}

const FORBIDDEN_TERMS = [
  'remix',
  'live',
  'karaoke',
  'karaoké',
  'cover',
  'instrumental',
  'tribute',
  're-recorded',
  'rerecorded',
  'mashup',
  'parody',
  'parodie',
  'sped up',
  'slowed',
  'reverb',
  'piano version',
  '8-bit',
  '8d audio',
  'lullaby',
  'nightcore',
];

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
  const dp: number[] = new Array(n + 1).fill(0);
  for (let j = 0; j <= n; j++) dp[j] = j;
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

// ───── Anthropic client ───────────────────────────────────────────────────

let anthropicClient: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (anthropicClient) return anthropicClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing');
  anthropicClient = new Anthropic({ apiKey });
  return anthropicClient;
}

interface SuggestedTrack {
  title: string;
  artist: string;
  year: number | null;
  language: string;
}

interface PlaylistContext {
  id: string;
  slug: string;
  name_fr: string;
  name_en: string;
  subtitle_fr: string | null;
  description_fr: string | null;
  locale_primary: string;
  theme: string | null;
  category: string | null;
  difficulty: 'EASY' | 'MEDIUM' | 'EXPERT';
}

function buildSuggestionPrompt(
  pl: PlaylistContext,
  existing: { title: string; artist: string; year: number | null }[],
  requestN: number,
): string {
  const subtitle = pl.subtitle_fr ?? pl.description_fr ?? '';
  const existingList = existing
    .map((t) => `- ${t.title} — ${t.artist}${t.year ? ` (${t.year})` : ''}`)
    .join('\n');
  return `Tu es expert musical pour un jeu de blind test grand public.

Playlist : "${pl.name_fr}"
${subtitle ? `Sous-titre : ${subtitle}\n` : ''}Catégorie : ${pl.category ?? 'n/a'}
Thème : ${pl.theme ?? 'n/a'}
Langue cible principale : ${pl.locale_primary}
Difficulté : ${pl.difficulty}

Tracks DÉJÀ présentes (NE PAS RE-SUGGÉRER, même variantes) :
${existingList || '(aucune)'}

Génère EXACTEMENT ${requestN} tracks supplémentaires cohérentes avec le thème, l'époque et la langue de la playlist.

Critères OBLIGATOIRES :
- Morceaux populaires reconnaissables au blind test (pas de B-side obscur)
- Tracks RÉELLES existantes (pas inventées)
- Diversité d'artistes : max 2 morceaux par artiste sur l'ensemble suggéré
- Mix classiques majeurs + hits moins évidents pour le challenge
- Respecter la langue : ${pl.locale_primary === 'fr' ? 'majorité en français' : pl.locale_primary === 'en' ? 'majorité en anglais' : pl.locale_primary}
- INTERDIT : remix, live, cover, karaoké, instrumental, mashup, version piano

Format JSON STRICT (array uniquement, pas de préambule) :
[
  { "title": "Titre exact", "artist": "Nom artiste exact", "year": 1995, "language": "fr" }
]

Réponds UNIQUEMENT avec le JSON array, rien d'autre.`;
}

interface SuggestionResult {
  tracks: SuggestedTrack[];
  usage: { input_tokens: number; output_tokens: number };
  costEur: number;
  raw: string;
}

async function suggestComplementaryTracks(
  pl: PlaylistContext,
  existing: { title: string; artist: string; year: number | null }[],
  requestN: number,
): Promise<SuggestionResult> {
  const client = getAnthropic();
  const prompt = buildSuggestionPrompt(pl, existing, requestN);
  const resp = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = resp.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  const usage = {
    input_tokens: resp.usage.input_tokens,
    output_tokens: resp.usage.output_tokens,
  };
  const costEur =
    ((usage.input_tokens * PRICE_INPUT_USD_PER_M) / 1_000_000 +
      (usage.output_tokens * PRICE_OUTPUT_USD_PER_M) / 1_000_000) *
    USD_TO_EUR;

  // Extract first JSON array
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end < 0 || end < start) {
    return { tracks: [], usage, costEur, raw: text };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { tracks: [], usage, costEur, raw: text };
  }
  if (!Array.isArray(parsed)) return { tracks: [], usage, costEur, raw: text };
  const tracks: SuggestedTrack[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Record<string, unknown>;
    const title = typeof obj.title === 'string' ? obj.title.trim() : '';
    const artist = typeof obj.artist === 'string' ? obj.artist.trim() : '';
    if (!title || !artist) continue;
    const year =
      typeof obj.year === 'number' && Number.isFinite(obj.year) ? Math.floor(obj.year) : null;
    const language = typeof obj.language === 'string' ? obj.language : pl.locale_primary;
    tracks.push({ title, artist, year, language });
  }
  return { tracks, usage, costEur, raw: text };
}

// ───── YouTube Data API search ────────────────────────────────────────────

interface YouTubeSearchItem {
  id: { videoId?: string };
  snippet: { title: string; channelTitle: string; publishedAt?: string };
}

async function searchYouTubeVideo(track: SuggestedTrack): Promise<string | null> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return null;
  const q = `${track.artist} - ${track.title}${track.year ? ` ${track.year}` : ''}`;
  const params = new URLSearchParams({
    part: 'snippet',
    q,
    type: 'video',
    maxResults: '10',
    videoEmbeddable: 'true',
    safeSearch: 'none',
    key: apiKey,
  });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn(
      `[YT] search failed "${track.artist} - ${track.title}" : ${res.status} ${body.slice(0, 200)}`,
    );
    return null;
  }
  const data = (await res.json()) as { items: YouTubeSearchItem[] };
  let candidates = data.items.filter((it) => Boolean(it.id.videoId));
  candidates = candidates.filter(
    (it) => !containsForbidden(it.snippet.title) && !containsForbidden(it.snippet.channelTitle),
  );
  if (candidates.length === 0) return null;
  const artistLower = lower(track.artist);
  const scored = candidates.map((it) => {
    const channel = lower(it.snippet.channelTitle);
    const title = it.snippet.title;
    const titleDist = levenshtein(title, `${track.artist} - ${track.title}`);
    let score = titleDist;
    if (channel.includes('vevo')) score -= 0.4;
    if (channel.includes('official')) score -= 0.25;
    if (channel.includes(artistLower)) score -= 0.2;
    if (channel.endsWith('- topic')) score -= 0.35;
    return { item: it, score };
  });
  scored.sort((a, b) => a.score - b.score);
  const best = scored[0];
  if (!best || !best.item.id.videoId) return null;
  if (best.score > 0.7) {
    return null;
  }
  return best.item.id.videoId;
}

// ───── Enrich one playlist ────────────────────────────────────────────────

interface EnrichResult {
  slug: string;
  name: string;
  existingCount: number;
  suggestionsGenerated: number;
  newAfterDedup: number;
  resolvedOnYouTube: number;
  inserted: number;
  costEur: number;
  inputTokens: number;
  outputTokens: number;
  ytQuotaUsed: number;
  sampleTitles: string[];
  error?: string;
}

async function enrichOnePlaylist(
  pl: PlaylistContext,
  targetSize: number,
  dryRun: boolean,
): Promise<EnrichResult> {
  const existing = await prisma.officialPlaylistTrack.findMany({
    where: { playlist_id: pl.id },
    select: { title: true, artist: true, year: true, position: true },
    orderBy: { position: 'asc' },
  });
  const existingCount = existing.length;
  const needed = targetSize - existingCount;
  const baseResult: EnrichResult = {
    slug: pl.slug,
    name: pl.name_fr,
    existingCount,
    suggestionsGenerated: 0,
    newAfterDedup: 0,
    resolvedOnYouTube: 0,
    inserted: 0,
    costEur: 0,
    inputTokens: 0,
    outputTokens: 0,
    ytQuotaUsed: 0,
    sampleTitles: [],
  };
  if (needed <= 0) {
    console.info(`[Enrich] "${pl.name_fr}" déjà à ${existingCount}/${targetSize} → skip`);
    return baseResult;
  }
  const requestN = Math.ceil(needed * OVERREQUEST_FACTOR);
  console.info(
    `[Enrich] "${pl.name_fr}" — existing=${existingCount} needed=${needed} requesting=${requestN}`,
  );

  // Step 1 : Claude suggestion
  let suggestions: SuggestedTrack[] = [];
  try {
    const r = await suggestComplementaryTracks(pl, existing, requestN);
    suggestions = r.tracks;
    baseResult.costEur += r.costEur;
    baseResult.inputTokens += r.usage.input_tokens;
    baseResult.outputTokens += r.usage.output_tokens;
    baseResult.suggestionsGenerated = suggestions.length;
    if (suggestions.length === 0) {
      console.warn(
        `[Enrich] "${pl.name_fr}" : Claude returned 0 tracks. Raw preview : ${r.raw.slice(0, 200)}`,
      );
      baseResult.error = 'claude_empty_suggestions';
      return baseResult;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    baseResult.error = `claude_error: ${msg}`;
    console.error(`[Enrich] "${pl.name_fr}" Claude error : ${msg}`);
    return baseResult;
  }

  // Step 2 : dedup against existing by slug(artist+title)
  //          + cap per artist (Claude ignore parfois la consigne max-2)
  const existingKeys = new Set(existing.map((t) => slugifyKey(t.artist, t.title)));
  const existingArtistCounts = new Map<string, number>();
  for (const t of existing) {
    const k = lower(t.artist);
    existingArtistCounts.set(k, (existingArtistCounts.get(k) ?? 0) + 1);
  }
  const seenKeys = new Set<string>();
  const perArtistCount = new Map<string, number>(existingArtistCounts);
  const fresh: SuggestedTrack[] = [];
  for (const s of suggestions) {
    const key = slugifyKey(s.artist, s.title);
    if (existingKeys.has(key) || seenKeys.has(key)) continue;
    const artistKey = lower(s.artist);
    const count = perArtistCount.get(artistKey) ?? 0;
    if (count >= MAX_TRACKS_PER_ARTIST) continue;
    seenKeys.add(key);
    perArtistCount.set(artistKey, count + 1);
    fresh.push(s);
  }
  baseResult.newAfterDedup = fresh.length;
  console.info(
    `[Enrich] "${pl.name_fr}" : ${suggestions.length} suggérés → ${fresh.length} fresh après dedup+cap`,
  );

  // Step 3 : resolve YouTube IDs via global concurrency limit (shared across
  // all playlists) to stay under YouTube per-minute quota.
  const resolved = await Promise.all(
    fresh.map((s) =>
      ytGlobalLimit(async () => {
        const id = await searchYouTubeVideo(s);
        baseResult.ytQuotaUsed += 100;
        return { ...s, youtube_id: id };
      }),
    ),
  );
  const playable = resolved.filter((t): t is SuggestedTrack & { youtube_id: string } =>
    Boolean(t.youtube_id),
  );
  baseResult.resolvedOnYouTube = playable.length;
  console.info(`[Enrich] "${pl.name_fr}" : ${playable.length}/${fresh.length} résolus sur YouTube`);

  // Step 4 : cap at needed + insert
  const toInsert = playable.slice(0, needed);
  baseResult.sampleTitles = toInsert.slice(0, 5).map((t) => `${t.artist} — ${t.title}`);

  if (dryRun) {
    console.info(
      `[DRY] "${pl.name_fr}" → would INSERT ${toInsert.length} tracks. Sample : ${baseResult.sampleTitles.join(' | ')}`,
    );
    baseResult.inserted = 0;
    return baseResult;
  }

  if (toInsert.length === 0) {
    console.warn(`[Enrich] "${pl.name_fr}" : aucun track insérable`);
    return baseResult;
  }

  let nextPosition = existingCount + 1;
  await prisma.officialPlaylistTrack.createMany({
    data: toInsert.map((t) => ({
      playlist_id: pl.id,
      position: nextPosition++,
      title: t.title,
      artist: t.artist,
      year: t.year,
      difficulty: pl.difficulty,
      youtube_id: t.youtube_id,
    })),
    skipDuplicates: true,
  });
  await prisma.officialPlaylist.update({
    where: { id: pl.id },
    data: { track_count: existingCount + toInsert.length },
  });
  baseResult.inserted = toInsert.length;
  console.info(
    `[Enrich] "${pl.name_fr}" : ${toInsert.length} tracks INSÉRÉS — total ${existingCount + toInsert.length}/${targetSize}`,
  );
  return baseResult;
}

// ───── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { limit, playlistSlug, targetSize, dryRun } = parseArgs();
  console.info(
    `[EnrichCLI] start | limit=${limit ?? 'none'} | playlist=${playlistSlug ?? 'all'} | target-size=${targetSize} | dry-run=${dryRun}`,
  );

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[EnrichCLI] ANTHROPIC_API_KEY missing — abort');
    process.exitCode = 1;
    return;
  }
  if (!process.env.YOUTUBE_API_KEY) {
    console.error('[EnrichCLI] YOUTUBE_API_KEY missing — abort');
    process.exitCode = 1;
    return;
  }

  const where: Record<string, unknown> = {};
  if (playlistSlug) where.slug = playlistSlug;

  const playlists = (await prisma.officialPlaylist.findMany({
    where,
    select: {
      id: true,
      slug: true,
      name_fr: true,
      name_en: true,
      subtitle_fr: true,
      description_fr: true,
      locale_primary: true,
      theme: true,
      category: true,
      difficulty: true,
    },
    orderBy: { name_fr: 'asc' },
    take: limit ?? undefined,
  })) as PlaylistContext[];

  if (playlists.length === 0) {
    console.error('[EnrichCLI] no playlists matched filter — abort');
    process.exitCode = 1;
    return;
  }
  console.info(`[EnrichCLI] processing ${playlists.length} playlists`);

  const playlistLimit = pLimit(PLAYLIST_CONCURRENCY);
  const results = await Promise.all(
    playlists.map((p) => playlistLimit(() => enrichOnePlaylist(p, targetSize, dryRun))),
  );

  // Summary
  const totalInserted = results.reduce((s, r) => s + r.inserted, 0);
  const totalSuggested = results.reduce((s, r) => s + r.suggestionsGenerated, 0);
  const totalResolved = results.reduce((s, r) => s + r.resolvedOnYouTube, 0);
  const totalCost = results.reduce((s, r) => s + r.costEur, 0);
  const totalIn = results.reduce((s, r) => s + r.inputTokens, 0);
  const totalOut = results.reduce((s, r) => s + r.outputTokens, 0);
  const totalQuota = results.reduce((s, r) => s + r.ytQuotaUsed, 0);
  const errored = results.filter((r) => r.error);

  console.info('\n[EnrichCLI] ═══════════════ SUMMARY ═══════════════');
  console.info(`  Playlists processed       : ${results.length}`);
  console.info(`  Total suggested (Claude)  : ${totalSuggested}`);
  console.info(`  Total resolved on YouTube : ${totalResolved}`);
  console.info(`  Total INSERTED            : ${totalInserted}${dryRun ? ' (DRY-RUN)' : ''}`);
  console.info(`  Claude in tokens          : ${totalIn.toLocaleString()}`);
  console.info(`  Claude out tokens         : ${totalOut.toLocaleString()}`);
  console.info(`  Claude cost (EUR)         : ${totalCost.toFixed(2)}€`);
  console.info(`  YouTube quota units used  : ${totalQuota.toLocaleString()}`);
  if (errored.length > 0) {
    console.info(`  Errored playlists         : ${errored.length}`);
    for (const e of errored) {
      console.info(`    - ${e.slug} : ${e.error}`);
    }
  }
  console.info('[EnrichCLI] ═════════════════════════════════════════');
}

main()
  .catch((err) => {
    console.error('[EnrichCLI] fatal :', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
