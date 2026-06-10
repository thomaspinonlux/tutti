/**
 * scripts/importCanonicalSongs.ts — feat/canonical-song-catalog (ÉTAPE 4)
 *
 * Entrée "Claude Code mode éco abonnement" : alimente le catalogue canonique
 * par fournées JSON SANS appel API Anthropic — les aliases sont fournis dans
 * le fichier (générés en session Claude Code, ou curés à la main).
 *
 * Format JSON (array) :
 * [
 *   {
 *     "title": "Lean On",
 *     "artist": "Major Lazer & DJ Snake ft. MØ",
 *     "title_aliases": ["lean on", "line on", "linon"],
 *     "artist_aliases": ["major lazer", "dj snake", "majeur lazer"],
 *     "youtube_id": "YqeW9_5kURI"        // optionnel
 *   }
 * ]
 *
 * Upsert canonique via songKey (ÉTAPE 2) : si la chanson existe (même sous un
 * autre videoId), les aliases sont fusionnés (union) — jamais écrasés.
 *
 * Usage :
 *   pnpm import:canonical-songs data/canonical/batch-01.json
 *   pnpm import:canonical-songs batch.json --dry-run
 */

import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { songKey } from '../src/lib/songCatalog.js';

config();
const prisma = new PrismaClient();

interface ImportRow {
  title: string;
  artist: string;
  title_aliases?: string[];
  artist_aliases?: string[];
  youtube_id?: string | null;
}

function isImportRow(x: unknown): x is ImportRow {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return typeof o.title === 'string' && typeof o.artist === 'string';
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const dryRun = process.argv.includes('--dry-run');
  const file = args[0];
  if (!file) {
    console.error('Usage: pnpm import:canonical-songs <file.json> [--dry-run]');
    process.exitCode = 1;
    return;
  }

  const raw = JSON.parse(await readFile(file, 'utf8')) as unknown;
  if (!Array.isArray(raw)) {
    console.error('[ImportSongs] le fichier doit contenir un array JSON');
    process.exitCode = 1;
    return;
  }
  const rows = raw.filter(isImportRow);
  console.info(`[ImportSongs] ${rows.length}/${raw.length} rows valides | dry-run=${dryRun}`);

  let createdSongs = 0;
  let mergedSongs = 0;
  let aliasesAdded = 0;

  for (const row of rows) {
    const key = songKey(row.artist, row.title);
    const titleAliases = (row.title_aliases ?? []).map((a) => a.trim()).filter(Boolean);
    const artistAliases = (row.artist_aliases ?? []).map((a) => a.trim()).filter(Boolean);

    if (dryRun) {
      const existing = await prisma.song.findUnique({ where: { normalized_key: key } });
      console.info(
        `[DRY] "${row.artist} — ${row.title}" key="${key}" → ${existing ? 'MERGE' : 'CREATE'}`,
      );
      continue;
    }

    // Artist upsert + merge aliases (P2002-safe).
    let artist: { id: string; aliases: string[] };
    try {
      artist = await prisma.artist.upsert({
        where: { canonical_name: row.artist },
        create: { canonical_name: row.artist, aliases: artistAliases, aliases_source: 'manual' },
        update: {},
        select: { id: true, aliases: true },
      });
    } catch (err) {
      if ((err as { code?: string })?.code !== 'P2002') throw err;
      const found = await prisma.artist.findUnique({
        where: { canonical_name: row.artist },
        select: { id: true, aliases: true },
      });
      if (!found) throw err;
      artist = found;
    }
    const mergedArtist = Array.from(new Set([...artist.aliases, ...artistAliases]));
    if (mergedArtist.length !== artist.aliases.length) {
      await prisma.artist.update({ where: { id: artist.id }, data: { aliases: mergedArtist } });
      aliasesAdded += mergedArtist.length - artist.aliases.length;
    }

    // Song upsert par clé canonique.
    const existing = await prisma.song.findUnique({
      where: { normalized_key: key },
      select: { id: true, title_aliases: true },
    });
    if (existing) {
      const merged = Array.from(new Set([...existing.title_aliases, ...titleAliases]));
      if (merged.length !== existing.title_aliases.length) {
        await prisma.song.update({
          where: { id: existing.id },
          data: { title_aliases: merged },
        });
        aliasesAdded += merged.length - existing.title_aliases.length;
      }
      mergedSongs += 1;
    } else {
      await prisma.song.create({
        data: {
          artist_id: artist.id,
          canonical_title: row.title,
          normalized_key: key,
          title_aliases: titleAliases,
          aliases_source: 'manual',
        },
      });
      createdSongs += 1;
    }
  }

  console.info('\n[ImportSongs] ═══════════ SUMMARY ═══════════');
  console.info(`  Songs créées   : ${createdSongs}`);
  console.info(`  Songs mergées  : ${mergedSongs}`);
  console.info(`  Aliases ajoutés: ${aliasesAdded}`);
  console.info('[ImportSongs] ════════════════════════════════');
}

main()
  .catch((err) => {
    console.error('[ImportSongs] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
