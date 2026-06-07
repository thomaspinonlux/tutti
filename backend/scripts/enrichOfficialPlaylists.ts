/**
 * scripts/enrichOfficialPlaylists.ts — feat/enrich-official-playlists-pool-80
 *
 * Enrichit les playlists officielles du catalogue (`official_playlists` /
 * `official_playlist_tracks`) jusqu'à un POOL CIBLE de N tracks (default 80).
 *
 * PIVOT STRATÉGIQUE (2026-06-07) — abandon de search.list (quota 100/jour
 * épuisé) au profit de videos.list batch 50 (1 unit each, 10k/jour). Claude
 * génère directement les youtubeVideoId depuis sa connaissance, on valide
 * ensuite en batch.
 *
 * Cause initiale (audit 2026-06) : les 95 playlists du catalogue ont toutes
 * exactement 15 tracks, default_session_size=15 → `Math.min(15,15)=15` →
 * set identique à chaque session. PO confirme "mêmes morceaux à chaque
 * relance". Sans enrichir le pool, aucune variété possible.
 *
 * Workflow par playlist :
 *   1. Récupère les tracks existantes (title, artist, year).
 *   2. Claude Sonnet 4.5 → génère N suggestions complémentaires AVEC
 *      youtubeVideoId fourni depuis sa knowledge (null si pas sûr).
 *   3. Validate en batch via videos.list?id=v1,v2,...,v50&part=...
 *      Critères : exists, status.embeddable=true, durée 90-360s, vues > 50k.
 *   4. INSERT official_playlist_tracks avec position incrémentale.
 *   5. UPDATE official_playlists.track_count.
 *
 * Usage :
 *   pnpm enrich:official-playlists                    # toutes (95), pool=80
 *   pnpm enrich:official-playlists --limit=3          # tester sur 3
 *   pnpm enrich:official-playlists --playlist=italo-disco-classics
 *   pnpm enrich:official-playlists --target-size=60   # pool plus petit
 *   pnpm enrich:official-playlists --dry-run          # preview sans INSERT
 *   pnpm enrich:official-playlists --skip-validation  # debug, skip videos.list
 *
 * Env requis : ANTHROPIC_API_KEY, YOUTUBE_API_KEY, DATABASE_URL.
 *
 * Coût estimé (pool=80, 95 playlists) :
 *   - Claude Sonnet 4.5 : ~95 × 85 tracks × ~400 tok = ~25M tok out = ~$3.75
 *     + ~22M tok in = ~$0.65 → ~$4.40 (~4€)
 *   - YouTube quota : ~95 × 85 / 50 ≈ 162 batches × 1 unit = ~165 units
 *     (vs 800k en version search) → quasi gratuit.
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
/** videos.list accepte jusqu'à 50 IDs par requête (toujours 1 unit). */
const VIDEOS_LIST_BATCH = 50;
/** Concurrency global pour les batches videos.list. 2 = ~120 ID validés/sec
 * en burst, largement sous les rate limits. */
const YT_GLOBAL_CONCURRENCY = 2;
/** Max tracks par artiste dans les suggestions retenues. Claude ignore parfois
 * la consigne "max 2" → on enforce côté code. */
const MAX_TRACKS_PER_ARTIST = 2;
/** Durée minimum/maximum acceptée (en secondes) pour une track YouTube.
 * < 90s = teaser/extrait, > 360s = remix étendu ou DJ set. */
const MIN_DURATION_SEC = 90;
const MAX_DURATION_SEC = 360;
/** Vues minimum pour considérer la track populaire (anti-bootleg). */
const MIN_VIEW_COUNT = 50_000;
const ANTHROPIC_MODEL = 'claude-sonnet-4-5-20250929';
const MAX_TOKENS = 8000;

// Limite globale partagée par toutes les playlists pour les appels YouTube.
const ytGlobalLimit = pLimit(YT_GLOBAL_CONCURRENCY);

// $ per million tokens (2026-06 Sonnet 4.5 pricing)
const PRICE_INPUT_USD_PER_M = 3;
const PRICE_OUTPUT_USD_PER_M = 15;
const USD_TO_EUR = 0.92;

interface CliArgs {
  limit: number | null;
  /** Liste de slugs (comma-separated via --playlist=a,b,c). null = toutes. */
  playlistSlugs: string[] | null;
  targetSize: number;
  /** Skip si déjà ≥ ce nombre de tracks (idempotence des relances). */
  skipExistingLarge: number | null;
  dryRun: boolean;
  skipValidation: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number.parseInt(limitArg.split('=')[1] ?? '', 10) || null : null;
  const playlistArg = args.find((a) => a.startsWith('--playlist='));
  const playlistSlugs = playlistArg
    ? (playlistArg.split('=')[1] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : null;
  const targetArg = args.find((a) => a.startsWith('--target-size='));
  const targetSize = targetArg
    ? Number.parseInt(targetArg.split('=')[1] ?? '', 10) || TARGET_POOL_DEFAULT
    : TARGET_POOL_DEFAULT;
  const skipLargeArg = args.find((a) => a.startsWith('--skip-existing-large'));
  let skipExistingLarge: number | null = null;
  if (skipLargeArg) {
    const eq = skipLargeArg.split('=')[1];
    skipExistingLarge = eq ? Number.parseInt(eq, 10) || 60 : 60;
  }
  const dryRun = args.includes('--dry-run');
  const skipValidation = args.includes('--skip-validation');
  return {
    limit,
    playlistSlugs: playlistSlugs && playlistSlugs.length > 0 ? playlistSlugs : null,
    targetSize,
    skipExistingLarge,
    dryRun,
    skipValidation,
  };
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
  /** youtubeVideoId fourni par Claude depuis sa knowledge. null si pas sûr. */
  youtubeVideoId: string | null;
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

CRITIQUE — POUR CHAQUE TRACK : fournis le YouTube videoId EXACT du clip officiel ou audio officiel (chaîne VEVO, "Official Video", "Official Audio", "Artist - Topic"). Tu connais les videoIds des morceaux populaires dans ta knowledge. Si tu n'es PAS 100% SÛR du videoId, mets "youtubeVideoId": null (on validera côté code, mieux vaut null qu'un mauvais ID).

Critères OBLIGATOIRES :
- Morceaux populaires reconnaissables au blind test (pas de B-side obscur)
- Tracks RÉELLES existantes (pas inventées)
- Diversité d'artistes : max 2 morceaux par artiste sur l'ensemble suggéré
- Mix classiques majeurs + hits moins évidents pour le challenge
- Respecter la langue : ${pl.locale_primary === 'fr' ? 'majorité en français' : pl.locale_primary === 'en' ? 'majorité en anglais' : pl.locale_primary}
- INTERDIT : remix, live, cover, karaoké, instrumental, mashup, version piano

Format JSON STRICT (array uniquement, pas de préambule) :
[
  {
    "title": "Bohemian Rhapsody",
    "artist": "Queen",
    "year": 1975,
    "language": "en",
    "youtubeVideoId": "fJ9rUzIMcZQ"
  },
  {
    "title": "Titre dont tu n'es pas sûr du videoId",
    "artist": "Artiste",
    "year": 2000,
    "language": "fr",
    "youtubeVideoId": null
  }
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
    // Accepter "youtubeVideoId" ou "youtube_video_id" ou "videoId" pour
    // robustesse face aux variations Claude.
    const rawId =
      (typeof obj.youtubeVideoId === 'string' && obj.youtubeVideoId) ||
      (typeof obj.youtube_video_id === 'string' && obj.youtube_video_id) ||
      (typeof obj.videoId === 'string' && obj.videoId) ||
      null;
    const youtubeVideoId = rawId && /^[A-Za-z0-9_-]{11}$/.test(rawId) ? rawId : null;
    tracks.push({ title, artist, year, language, youtubeVideoId });
  }
  return { tracks, usage, costEur, raw: text };
}

// ───── YouTube Data API videos.list batch validation ──────────────────────

interface YouTubeVideoItem {
  id: string;
  snippet?: { title: string; channelTitle: string };
  contentDetails?: { duration: string };
  status?: { embeddable?: boolean; uploadStatus?: string; privacyStatus?: string };
  statistics?: { viewCount?: string };
}

/** Parse ISO 8601 duration (PT1H2M3S → seconds). Returns 0 on parse fail. */
function parseIsoDuration(iso: string): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return 0;
  const h = m[1] ? Number.parseInt(m[1], 10) : 0;
  const min = m[2] ? Number.parseInt(m[2], 10) : 0;
  const s = m[3] ? Number.parseInt(m[3], 10) : 0;
  return h * 3600 + min * 60 + s;
}

interface ValidationVerdict {
  ok: boolean;
  reason?: string;
}

/**
 * Valide les videoIds via videos.list batched. 1 unit de quota par batch
 * (jusqu'à 50 IDs). Retourne map<videoId, verdict>.
 */
async function validateVideoIdsBatch(ids: string[]): Promise<Map<string, ValidationVerdict>> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  const out = new Map<string, ValidationVerdict>();
  if (!apiKey || ids.length === 0) {
    for (const id of ids) out.set(id, { ok: false, reason: 'no_api_key' });
    return out;
  }
  const params = new URLSearchParams({
    id: ids.join(','),
    part: 'snippet,contentDetails,status,statistics',
    key: apiKey,
  });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params.toString()}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn(`[YT] videos.list failed : ${res.status} ${body.slice(0, 200)}`);
    for (const id of ids) out.set(id, { ok: false, reason: `http_${res.status}` });
    return out;
  }
  const data = (await res.json()) as { items: YouTubeVideoItem[] };
  const foundIds = new Set(data.items.map((it) => it.id));
  for (const id of ids) {
    if (!foundIds.has(id)) {
      out.set(id, { ok: false, reason: 'not_found' });
    }
  }
  for (const it of data.items) {
    const snippet = it.snippet;
    const titleStr = snippet?.title ?? '';
    const channelStr = snippet?.channelTitle ?? '';
    const duration = it.contentDetails?.duration ? parseIsoDuration(it.contentDetails.duration) : 0;
    const views = it.statistics?.viewCount ? Number.parseInt(it.statistics.viewCount, 10) || 0 : 0;
    const embeddable = it.status?.embeddable === true;
    const isPublic = it.status?.privacyStatus === 'public';
    let verdict: ValidationVerdict = { ok: true };
    if (!embeddable) verdict = { ok: false, reason: 'not_embeddable' };
    else if (!isPublic) verdict = { ok: false, reason: `privacy_${it.status?.privacyStatus}` };
    else if (duration < MIN_DURATION_SEC) verdict = { ok: false, reason: `too_short_${duration}s` };
    else if (duration > MAX_DURATION_SEC) verdict = { ok: false, reason: `too_long_${duration}s` };
    else if (views < MIN_VIEW_COUNT) verdict = { ok: false, reason: `low_views_${views}` };
    else if (containsForbidden(titleStr) || containsForbidden(channelStr))
      verdict = { ok: false, reason: 'forbidden_term' };
    out.set(it.id, verdict);
  }
  return out;
}

/** Découpe ids en batches de VIDEOS_LIST_BATCH puis valide en parallèle. */
async function validateVideoIds(ids: string[]): Promise<Map<string, ValidationVerdict>> {
  const result = new Map<string, ValidationVerdict>();
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += VIDEOS_LIST_BATCH) {
    batches.push(ids.slice(i, i + VIDEOS_LIST_BATCH));
  }
  const partials = await Promise.all(
    batches.map((batch) => ytGlobalLimit(() => validateVideoIdsBatch(batch))),
  );
  for (const p of partials) {
    for (const [k, v] of p) result.set(k, v);
  }
  return result;
}

// ───── Enrich one playlist ────────────────────────────────────────────────

interface EnrichResult {
  slug: string;
  name: string;
  existingCount: number;
  suggestionsGenerated: number;
  withVideoId: number;
  newAfterDedup: number;
  validated: number;
  inserted: number;
  costEur: number;
  inputTokens: number;
  outputTokens: number;
  ytQuotaUsed: number;
  sampleTitles: string[];
  validationReasons: Record<string, number>;
  error?: string;
}

async function enrichOnePlaylist(
  pl: PlaylistContext,
  targetSize: number,
  dryRun: boolean,
  skipValidation: boolean,
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
    withVideoId: 0,
    newAfterDedup: 0,
    validated: 0,
    inserted: 0,
    costEur: 0,
    inputTokens: 0,
    outputTokens: 0,
    ytQuotaUsed: 0,
    sampleTitles: [],
    validationReasons: {},
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

  // Count tracks that Claude provided a videoId for.
  baseResult.withVideoId = suggestions.filter((s) => s.youtubeVideoId !== null).length;

  // Step 2 : dedup against existing by slug(artist+title) and against
  //          videoIds déjà présents en DB (anti-doublon strict) + cap per
  //          artist (Claude ignore parfois la consigne max-2).
  const existingKeys = new Set(existing.map((t) => slugifyKey(t.artist, t.title)));
  const existingArtistCounts = new Map<string, number>();
  for (const t of existing) {
    const k = lower(t.artist);
    existingArtistCounts.set(k, (existingArtistCounts.get(k) ?? 0) + 1);
  }
  const seenKeys = new Set<string>();
  const seenVideoIds = new Set<string>();
  const perArtistCount = new Map<string, number>(existingArtistCounts);
  const fresh: SuggestedTrack[] = [];
  for (const s of suggestions) {
    const key = slugifyKey(s.artist, s.title);
    if (existingKeys.has(key) || seenKeys.has(key)) continue;
    // Skip si Claude n'a pas fourni de videoId (on n'a pas search.list pour
    // résoudre derrière sans cramer le quota). On compense via OVERREQUEST.
    if (!s.youtubeVideoId) continue;
    if (seenVideoIds.has(s.youtubeVideoId)) continue;
    const artistKey = lower(s.artist);
    const count = perArtistCount.get(artistKey) ?? 0;
    if (count >= MAX_TRACKS_PER_ARTIST) continue;
    seenKeys.add(key);
    seenVideoIds.add(s.youtubeVideoId);
    perArtistCount.set(artistKey, count + 1);
    fresh.push(s);
  }
  baseResult.newAfterDedup = fresh.length;
  console.info(
    `[Enrich] "${pl.name_fr}" : ${suggestions.length} suggérés (${baseResult.withVideoId} avec videoId) → ${fresh.length} fresh après dedup+cap`,
  );

  // Step 3 : validate videoIds via videos.list batch (1 unit per 50 IDs).
  let validated = fresh;
  if (!skipValidation) {
    const idsToValidate = fresh.map((t) => t.youtubeVideoId!).filter((id) => id !== null);
    const verdicts = await validateVideoIds(idsToValidate);
    const batchCount = Math.ceil(idsToValidate.length / VIDEOS_LIST_BATCH);
    baseResult.ytQuotaUsed += batchCount; // 1 unit per batch
    const accepted: SuggestedTrack[] = [];
    for (const t of fresh) {
      const verdict = verdicts.get(t.youtubeVideoId!);
      if (verdict?.ok) {
        accepted.push(t);
      } else {
        const reason = verdict?.reason ?? 'unknown';
        baseResult.validationReasons[reason] = (baseResult.validationReasons[reason] ?? 0) + 1;
      }
    }
    validated = accepted;
    console.info(
      `[Enrich] "${pl.name_fr}" : ${accepted.length}/${fresh.length} validés via videos.list (${batchCount} batches = ${batchCount} units)`,
    );
  } else {
    console.info(`[Enrich] "${pl.name_fr}" : --skip-validation → ${fresh.length} accepted as-is`);
  }
  baseResult.validated = validated.length;

  // Step 4 : cap at needed + insert
  const toInsert = validated.slice(0, needed);
  baseResult.sampleTitles = toInsert
    .slice(0, 5)
    .map((t) => `${t.artist} — ${t.title} (${t.youtubeVideoId})`);

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
      youtube_id: t.youtubeVideoId,
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
  const { limit, playlistSlugs, targetSize, skipExistingLarge, dryRun, skipValidation } =
    parseArgs();
  console.info(
    `[EnrichCLI] start | limit=${limit ?? 'none'} | playlist=${playlistSlugs?.join(',') ?? 'all'} | target-size=${targetSize} | skip-existing-large=${skipExistingLarge ?? 'no'} | dry-run=${dryRun} | skip-validation=${skipValidation}`,
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
  if (playlistSlugs && playlistSlugs.length > 0) {
    where.slug = playlistSlugs.length === 1 ? playlistSlugs[0] : { in: playlistSlugs };
  }
  if (skipExistingLarge !== null) {
    where.track_count = { lt: skipExistingLarge };
  }

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
    playlists.map((p) =>
      playlistLimit(() => enrichOnePlaylist(p, targetSize, dryRun, skipValidation)),
    ),
  );

  // Summary
  const totalInserted = results.reduce((s, r) => s + r.inserted, 0);
  const totalSuggested = results.reduce((s, r) => s + r.suggestionsGenerated, 0);
  const totalWithVideoId = results.reduce((s, r) => s + r.withVideoId, 0);
  const totalValidated = results.reduce((s, r) => s + r.validated, 0);
  const totalCost = results.reduce((s, r) => s + r.costEur, 0);
  const totalIn = results.reduce((s, r) => s + r.inputTokens, 0);
  const totalOut = results.reduce((s, r) => s + r.outputTokens, 0);
  const totalQuota = results.reduce((s, r) => s + r.ytQuotaUsed, 0);
  const errored = results.filter((r) => r.error);
  const aggregatedReasons: Record<string, number> = {};
  for (const r of results) {
    for (const [reason, count] of Object.entries(r.validationReasons)) {
      aggregatedReasons[reason] = (aggregatedReasons[reason] ?? 0) + count;
    }
  }

  console.info('\n[EnrichCLI] ═══════════════ SUMMARY ═══════════════');
  console.info(`  Playlists processed       : ${results.length}`);
  console.info(`  Total suggested (Claude)  : ${totalSuggested}`);
  console.info(`  Suggested w/ videoId      : ${totalWithVideoId}`);
  console.info(`  Validated via videos.list : ${totalValidated}`);
  console.info(`  Total INSERTED            : ${totalInserted}${dryRun ? ' (DRY-RUN)' : ''}`);
  console.info(`  Claude in tokens          : ${totalIn.toLocaleString()}`);
  console.info(`  Claude out tokens         : ${totalOut.toLocaleString()}`);
  console.info(`  Claude cost (EUR)         : ${totalCost.toFixed(2)}€`);
  console.info(`  YouTube quota units used  : ${totalQuota.toLocaleString()}`);
  if (Object.keys(aggregatedReasons).length > 0) {
    console.info('  Validation failures :');
    for (const [reason, count] of Object.entries(aggregatedReasons).sort((a, b) => b[1] - a[1])) {
      console.info(`    - ${reason}: ${count}`);
    }
  }
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
