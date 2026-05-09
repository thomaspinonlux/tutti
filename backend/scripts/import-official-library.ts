/**
 * scripts/import-official-library.ts
 *
 * Import bibliothèque officielle Tutti — pivot YouTube-only via yt-dlp.
 *
 * Lit data/official-library/playlists/*.json, résout chaque track via
 * `yt-dlp ytsearch5:` (gratuit, no quota), upsert dans la DB
 * (OfficialPlaylist + OfficialPlaylistTrack) puis réécrit le JSON avec
 * `youtube_id` cached pour run suivant (idempotent).
 *
 * Spotify : retiré de CE SCRIPT uniquement (officiel-library scope). Le
 * lib `src/lib/officialLibraryImport.ts` continue d'utiliser Spotify
 * pour les routes admin /api/admin/library/* (out of scope ici).
 *
 * Usage : pnpm --filter @tutti/backend run import:official-library
 *
 * Variables d'env requises :
 *   - DATABASE_URL / DIRECT_URL (Supabase)
 *
 * Pré-requis système :
 *   - yt-dlp installé (brew install yt-dlp)
 *   - youtube-dl-exec + p-limit en deps backend
 */

import 'dotenv/config';
import * as dotenv from 'dotenv';
import { join, basename } from 'node:path';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import youtubedlDefault from 'youtube-dl-exec';
import pLimit from 'p-limit';
import { existsSync } from 'node:fs';

// pnpm a skip le build script de youtube-dl-exec → binaire embarqué absent.
// Force usage du yt-dlp système (brew install yt-dlp). Fallback sur le
// binaire embarqué s'il existe (cas où user a fait `pnpm approve-builds`).
const YT_DLP_SYSTEM = '/opt/homebrew/bin/yt-dlp';
const youtubedl = existsSync(YT_DLP_SYSTEM)
  ? youtubedlDefault.create(YT_DLP_SYSTEM)
  : youtubedlDefault;
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';

dotenv.config({
  path: join(process.cwd(), '..', 'credentials.env.local'),
  override: false,
});

// ───── Types (locaux au script — pas d'import lib pour rester self-contained)

type DifficultyDb = 'EASY' | 'MEDIUM' | 'EXPERT';

interface SourceTrack {
  position: number;
  title: string;
  artist: string;
  year?: number | null;
  difficulty?: string;
  spotify_id?: string | null;
  youtube_id?: string | null;
  cover_url?: string | null;
  answers_accepted?: Record<string, unknown> | null;
}

interface SourcePlaylist {
  id?: string;
  slug?: string;
  name_fr: string;
  name_en: string;
  description_fr?: string | null;
  description_en?: string | null;
  locale_primary: string;
  theme?: string | null;
  difficulty?: string;
  visibility?: 'public' | 'premium_only' | 'private';
  track_count?: number;
  tracks: SourceTrack[];
  import_hints?: Record<string, unknown>;
}

interface FileReport {
  filename: string;
  slug: string;
  total: number;
  youtubeMatched: number;
  youtubeAlreadyCached: number;
  youtubeMissed: number;
  unmatched: Array<{ position: number; artist: string; title: string }>;
}

const CONCURRENCY = 5;
const DEFAULT_PLAYLISTS_DIR = join(process.cwd(), 'data', 'official-library', 'playlists');

// ───── Helpers ────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['']/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDifficulty(d: string | undefined): DifficultyDb {
  if (!d) return 'MEDIUM';
  const u = d.toUpperCase();
  if (u === 'EASY' || u === 'MEDIUM' || u === 'EXPERT') return u;
  return 'MEDIUM';
}

// ───── yt-dlp search ──────────────────────────────────────────────────────

interface YtDlpEntry {
  id?: string;
  title?: string;
  channel?: string;
  uploader?: string;
}

async function searchYouTubeTrack(title: string, artist: string): Promise<string | null> {
  const queries = [`${artist} ${title} official audio`, `${artist} ${title}`, `${title} ${artist}`];

  for (const q of queries) {
    try {
      const result = (await youtubedl(`ytsearch5:${q}`, {
        dumpSingleJson: true,
        noWarnings: true,
        skipDownload: true,
        flatPlaylist: true,
      })) as { entries?: YtDlpEntry[] };

      const entries = result.entries ?? [];
      if (entries.length === 0) continue;

      const targetTitle = normalize(title);
      const targetArtist = normalize(artist);
      const titleWords = targetTitle.split(' ').slice(0, 3).join(' ');
      const artistFirst = targetArtist.split(' ')[0] ?? '';

      // Match strict : titleWords (3 1ers mots) + 1er mot artiste tous deux
      // présents dans entry.title normalisé.
      for (const entry of entries) {
        if (!entry.id) continue;
        const entryText = normalize(entry.title ?? '');
        if (entryText.includes(titleWords) && entryText.includes(artistFirst)) {
          console.info(`✅ MATCH ${artist} - ${title} → ${entry.id}`);
          return entry.id;
        }
      }

      // Fallback : 1er résultat si search a renvoyé qqch
      const fallback = entries.find((e) => e.id);
      if (fallback?.id) {
        console.info(`⚠️ FALLBACK ${artist} - ${title} → ${fallback.id} (${fallback.title})`);
        return fallback.id;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[yt-dlp] error "${q}": ${message}`);
    }
  }

  console.info(`❌ MISS ${artist} - ${title}`);
  return null;
}

// ───── DB upsert ──────────────────────────────────────────────────────────

interface NormalizedPlaylist {
  slug: string;
  name_fr: string;
  name_en: string;
  description_fr: string | null;
  description_en: string | null;
  locale_primary: string;
  theme: string | null;
  difficulty: DifficultyDb;
  visibility: 'public' | 'premium_only' | 'private';
}

function normalizePlaylist(src: SourcePlaylist): NormalizedPlaylist {
  return {
    slug: src.slug ?? src.id ?? '',
    name_fr: src.name_fr,
    name_en: src.name_en,
    description_fr: src.description_fr ?? null,
    description_en: src.description_en ?? null,
    locale_primary: src.locale_primary,
    theme: src.theme ?? null,
    difficulty: normalizeDifficulty(src.difficulty),
    visibility: src.visibility ?? 'public',
  };
}

async function upsertPlaylist(
  pl: NormalizedPlaylist,
  resolvedTracks: SourceTrack[],
): Promise<void> {
  const data = {
    name_fr: pl.name_fr,
    name_en: pl.name_en,
    description_fr: pl.description_fr,
    description_en: pl.description_en,
    locale_primary: pl.locale_primary,
    theme: pl.theme,
    difficulty: pl.difficulty,
    visibility: pl.visibility,
    track_count: resolvedTracks.length,
  };
  const playlist = await prisma.officialPlaylist.upsert({
    where: { slug: pl.slug },
    create: { slug: pl.slug, ...data },
    update: data,
  });
  await prisma.officialPlaylistTrack.deleteMany({ where: { playlist_id: playlist.id } });
  if (resolvedTracks.length > 0) {
    await prisma.officialPlaylistTrack.createMany({
      data: resolvedTracks.map((t) => ({
        playlist_id: playlist.id,
        position: t.position,
        title: t.title,
        artist: t.artist,
        year: t.year ?? null,
        difficulty: normalizeDifficulty(t.difficulty ?? pl.difficulty),
        spotify_id: null, // pivot YT-only : DB toujours null pour lib officielle
        youtube_id: t.youtube_id ?? null,
        cover_url: t.cover_url ?? null,
        answers_accepted: t.answers_accepted
          ? (t.answers_accepted as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      })),
    });
  }
}

// ───── Process ────────────────────────────────────────────────────────────

async function processFile(filePath: string): Promise<FileReport> {
  const filename = basename(filePath);
  const raw = await readFile(filePath, 'utf-8');
  const source = JSON.parse(raw) as SourcePlaylist;
  const slug = source.slug ?? source.id ?? '';
  if (!slug || !Array.isArray(source.tracks)) {
    throw new Error(`${filename}: format invalide (slug/id ou tracks manquant)`);
  }
  const pl = normalizePlaylist(source);

  const report: FileReport = {
    filename,
    slug: pl.slug,
    total: source.tracks.length,
    youtubeMatched: 0,
    youtubeAlreadyCached: 0,
    youtubeMissed: 0,
    unmatched: [],
  };

  const limit = pLimit(CONCURRENCY);
  const resolvedTracks = await Promise.all(
    source.tracks.map((track) =>
      limit(async (): Promise<SourceTrack> => {
        const next: SourceTrack = { ...track };

        // Idempotence : si youtube_id déjà cached, skip search
        if (next.youtube_id) {
          report.youtubeAlreadyCached += 1;
        } else {
          const id = await searchYouTubeTrack(track.title, track.artist);
          if (id) {
            next.youtube_id = id;
            report.youtubeMatched += 1;
          } else {
            report.youtubeMissed += 1;
          }
        }

        // Cover fallback YouTube thumbnail si youtube_id résolu et pas de cover
        if (!next.cover_url && next.youtube_id) {
          next.cover_url = `https://img.youtube.com/vi/${next.youtube_id}/hqdefault.jpg`;
        }

        if (!next.youtube_id) {
          report.unmatched.push({
            position: next.position,
            artist: next.artist,
            title: next.title,
          });
        }

        return next;
      }),
    ),
  );

  // Re-trie par position pour préserver l'ordre malgré le parallélisme
  resolvedTracks.sort((a, b) => a.position - b.position);
  report.unmatched.sort((a, b) => a.position - b.position);

  await upsertPlaylist(pl, resolvedTracks);

  // Réécrit JSON avec youtube_id résolus (cache idempotent)
  const updatedSource: SourcePlaylist = { ...source, tracks: resolvedTracks };
  await writeFile(filePath, JSON.stringify(updatedSource, null, 2) + '\n', 'utf-8');

  return report;
}

async function listPlaylistFiles(playlistsDir: string): Promise<string[]> {
  return (await readdir(playlistsDir)).filter((f) => f.endsWith('.json'));
}

// ───── Report ─────────────────────────────────────────────────────────────

function printReport(reports: FileReport[], durationMs: number): void {
  console.info('\n══════════════════════════════════════════════════════════════════════');
  console.info('  RAPPORT FINAL — IMPORT BIBLIOTHÈQUE OFFICIELLE TUTTI (YouTube-only)');
  console.info('══════════════════════════════════════════════════════════════════════\n');
  let totalTracks = 0;
  let totalMatch = 0;
  let totalCache = 0;
  let totalMiss = 0;
  for (const r of reports) {
    totalTracks += r.total;
    totalMatch += r.youtubeMatched;
    totalCache += r.youtubeAlreadyCached;
    totalMiss += r.youtubeMissed;
    console.info(`📁 ${r.filename}  (slug: ${r.slug}, ${r.total} tracks)`);
    console.info(
      `   YouTube : ${r.youtubeMatched} matched, ${r.youtubeAlreadyCached} cached, ${r.youtubeMissed} missed`,
    );
    if (r.unmatched.length > 0) {
      console.info(`   ⚠️ Non-matchés (${r.unmatched.length}) :`);
      for (const u of r.unmatched) {
        console.info(`       #${u.position}  ${u.artist} — ${u.title}`);
      }
    }
    console.info('');
  }
  console.info('──────────────────────────────────────────────────────────────────────');
  console.info(`  TOTAL  : ${reports.length} playlists, ${totalTracks} tracks`);
  console.info(
    `  YouTube: ${totalMatch} matched cette run, ${totalCache} déjà cachés, ${totalMiss} non-matchés`,
  );
  const coverage =
    totalTracks > 0 ? (((totalMatch + totalCache) / totalTracks) * 100).toFixed(1) : '0';
  console.info(`  Couverture finale : ${coverage}%`);
  console.info(`  Durée : ${(durationMs / 1000).toFixed(1)}s`);
  console.info('══════════════════════════════════════════════════════════════════════\n');
}

// ───── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.info(`[Library] Lecture des playlists dans ${DEFAULT_PLAYLISTS_DIR}\n`);
  const startedAt = Date.now();
  const files = await listPlaylistFiles(DEFAULT_PLAYLISTS_DIR);
  const reports: FileReport[] = [];
  for (const f of files) {
    try {
      const r = await processFile(join(DEFAULT_PLAYLISTS_DIR, f));
      reports.push(r);
    } catch (err) {
      console.error(`[FATAL] ${f} a échoué:`, err);
    }
  }
  printReport(reports, Date.now() - startedAt);
}

main()
  .catch((err) => {
    console.error('[FATAL]', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
