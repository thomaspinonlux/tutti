/**
 * scripts/importSongLevels.ts — bulk-apply des niveaux (Song.level).
 *
 * Lit un CSV `track_id,niveau` (niveau ∈ 1|2|3) et applique le niveau sur la
 * CHANSON canonique liée à chaque track : track_id → song_id → songs.level.
 *
 * Règles (cf. demande) :
 *   1. NE touche QUE les chansons avec level IS NULL — ne réécrase JAMAIS un
 *      niveau déjà tagué (double garde : filtre applicatif + WHERE level IS NULL).
 *   2. track_id sans song_id (ou introuvable) : listés à part (fichier JSON),
 *      n'interrompent pas le reste.
 *   3. DRY-RUN PAR DÉFAUT : affiche le bilan sans écrire. `--apply` pour écrire.
 *   4. Idempotent (null → niveau seulement). Rollback JSON à chaque run réel.
 *
 * track_id accepté depuis les DEUX catalogues : official_playlist_tracks.id
 * (officiel) OU tracks.id (playlists perso). Le niveau vit sur la chanson, donc
 * il se propage à tous les tracks partageant cette chanson (design canonique).
 *
 * Usage :
 *   pnpm import:song-levels --file=niveaux_a_importer.csv               # DRY-RUN
 *   pnpm import:song-levels --file=niveaux_a_importer.csv --apply       # écrit
 *   pnpm import:song-levels --file=... --apply --rollback-out=./rb.json
 *   pnpm import:song-levels --rollback=./rb.json                        # RESTAURE
 *   pnpm import:song-levels --file=... --no-song-out=./sans-song.json
 *   pnpm import:song-levels --file=... --verbose
 *
 * Env requis : DATABASE_URL.
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config();

const prisma = new PrismaClient();

// ───── Args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const hasFlag = (n: string): boolean => args.includes(`--${n}`);
const getOpt = (n: string): string | undefined => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : undefined;
};

const APPLY = hasFlag('apply'); // sans --apply → dry-run
const DRY_RUN = !APPLY;
const VERBOSE = hasFlag('verbose');
const FILE = getOpt('file') ?? 'niveaux_a_importer.csv';
const ROLLBACK_IN = getOpt('rollback');
const ROLLBACK_OUT = getOpt('rollback-out') ?? `song-levels-rollback-${nowStamp()}.json`;
const NO_SONG_OUT = getOpt('no-song-out') ?? `song-levels-sans-song-${nowStamp()}.json`;
const CHUNK = 1_000;

function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RollbackEntry {
  song_id: string;
  previous_level: number | null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ───── Mode ROLLBACK ───────────────────────────────────────────────────────
async function restoreRollback(path: string): Promise<void> {
  const entries = JSON.parse(readFileSync(path, 'utf8')) as RollbackEntry[];
  console.info(`↩️  Restauration de ${entries.length} chansons depuis ${path}…`);
  let restored = 0;
  for (const c of chunk(entries, 200)) {
    await prisma.$transaction(
      c.map((e) =>
        prisma.song.update({ where: { id: e.song_id }, data: { level: e.previous_level } }),
      ),
    );
    restored += c.length;
  }
  console.info(`✓ ${restored} chansons restaurées.`);
}

// ───── Parsing CSV ───────────────────────────────────────────────────────────
interface ParsedCsv {
  byTrack: Map<string, number>; // track_id → niveau (dédup)
  invalid: string[]; // lignes niveau hors 1/2/3 ou id malformé
  csvConflicts: Array<{ track_id: string; niveaux: number[] }>;
  totalRows: number;
}

function parseCsv(path: string): ParsedCsv {
  const raw = readFileSync(path, 'utf8').replace(/^﻿/, '');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '');
  const start = /track_id/i.test(lines[0] ?? '') ? 1 : 0; // saute l'en-tête si présent
  const seen = new Map<string, number[]>();
  const invalid: string[] = [];
  let totalRows = 0;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!;
    totalRows++;
    const [rawId, rawNiv] = line.split(',');
    const id = (rawId ?? '').trim();
    const niv = Number.parseInt((rawNiv ?? '').trim(), 10);
    if (!UUID_RE.test(id) || ![1, 2, 3].includes(niv)) {
      invalid.push(line);
      continue;
    }
    const list = seen.get(id) ?? [];
    list.push(niv);
    seen.set(id, list);
  }
  const byTrack = new Map<string, number>();
  const csvConflicts: Array<{ track_id: string; niveaux: number[] }> = [];
  for (const [id, nivs] of seen) {
    const uniq = [...new Set(nivs)];
    if (uniq.length > 1) csvConflicts.push({ track_id: id, niveaux: nivs });
    byTrack.set(id, Math.max(...nivs)); // conflit → niveau le plus élevé (déterministe)
  }
  return { byTrack, invalid, csvConflicts, totalRows };
}

// ───── Résolution track_id → song_id ─────────────────────────────────────────
async function resolveSongIds(trackIds: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>(); // track_id → song_id | null (trouvé sans song)
  for (const c of chunk(trackIds, CHUNK)) {
    const [official, perso] = await Promise.all([
      prisma.officialPlaylistTrack.findMany({
        where: { id: { in: c } },
        select: { id: true, song_id: true },
      }),
      prisma.track.findMany({
        where: { id: { in: c } },
        select: { id: true, song_id: true },
      }),
    ]);
    for (const t of official) if (!map.has(t.id)) map.set(t.id, t.song_id);
    for (const t of perso) if (!map.has(t.id)) map.set(t.id, t.song_id);
  }
  return map;
}

async function main(): Promise<void> {
  if (ROLLBACK_IN) {
    await restoreRollback(ROLLBACK_IN);
    return;
  }

  console.info(`📄 Lecture ${FILE}…`);
  const csv = parseCsv(FILE);
  const trackIds = [...csv.byTrack.keys()];
  console.info(
    `   ${csv.totalRows} lignes · ${trackIds.length} track_id valides distincts · ` +
      `${csv.invalid.length} invalides · ${csv.csvConflicts.length} conflits CSV`,
  );

  console.info(`🔗 Résolution track_id → song_id…`);
  const trackToSong = await resolveSongIds(trackIds);

  const notFound: string[] = []; // track_id absent des 2 catalogues
  const noSong: string[] = []; // track_id trouvé mais song_id NULL
  // song_id → niveau souhaité (dédup, plus élevé sur conflit)
  const songWanted = new Map<string, number>();
  const songConflicts: Array<{ song_id: string; niveaux: number[] }> = [];
  const songNiveaux = new Map<string, number[]>();

  for (const [trackId, niveau] of csv.byTrack) {
    if (!trackToSong.has(trackId)) {
      notFound.push(trackId);
      continue;
    }
    const songId = trackToSong.get(trackId)!;
    if (!songId) {
      noSong.push(trackId);
      continue;
    }
    const list = songNiveaux.get(songId) ?? [];
    list.push(niveau);
    songNiveaux.set(songId, list);
  }
  for (const [songId, nivs] of songNiveaux) {
    const uniq = [...new Set(nivs)];
    if (uniq.length > 1) songConflicts.push({ song_id: songId, niveaux: nivs });
    songWanted.set(songId, Math.max(...nivs));
  }

  // État actuel des chansons ciblées.
  const songIds = [...songWanted.keys()];
  const current = new Map<string, number | null>();
  for (const c of chunk(songIds, CHUNK)) {
    const rows = await prisma.song.findMany({
      where: { id: { in: c } },
      select: { id: true, level: true },
    });
    for (const s of rows) current.set(s.id, s.level);
  }

  // Catégorisation.
  const toApply: Array<{ song_id: string; niveau: number; previous: number | null }> = [];
  let alreadyTagged = 0; // level déjà non-null → jamais réécrasé
  let songMissing = 0; // song_id référencé mais chanson absente (incohérence)
  for (const [songId, niveau] of songWanted) {
    if (!current.has(songId)) {
      songMissing++;
      continue;
    }
    const lvl = current.get(songId)!;
    if (lvl !== null) {
      alreadyTagged++;
      continue;
    }
    toApply.push({ song_id: songId, niveau, previous: lvl });
  }

  // ── Écriture des track_id sans song (toujours, même en dry-run) ──
  const noSongPayload = {
    generated_at: new Date().toISOString(),
    not_found: notFound,
    no_song_id: noSong,
  };
  writeFileSync(NO_SONG_OUT, JSON.stringify(noSongPayload, null, 2), 'utf8');

  // ── Application réelle ──
  let updated = 0;
  const rollback: RollbackEntry[] = [];
  if (APPLY && toApply.length > 0) {
    for (const c of chunk(toApply, 200)) {
      await prisma.$transaction(
        c.map((e) =>
          prisma.song.updateMany({
            where: { id: e.song_id, level: null }, // double garde : n'écrit que si TOUJOURS null
            data: { level: e.niveau },
          }),
        ),
      );
      for (const e of c) rollback.push({ song_id: e.song_id, previous_level: e.previous });
      updated += c.length;
    }
    writeFileSync(ROLLBACK_OUT, JSON.stringify(rollback, null, 2), 'utf8');
  }

  if (VERBOSE) {
    if (csv.csvConflicts.length) {
      console.info(`\n⚠️  Conflits CSV (niveau le + élevé retenu) :`);
      for (const c of csv.csvConflicts) console.info(`   ${c.track_id} → ${c.niveaux.join('/')}`);
    }
    if (songConflicts.length) {
      console.info(`\n⚠️  Chansons ciblées par plusieurs niveaux (+ élevé retenu) :`);
      for (const c of songConflicts) console.info(`   ${c.song_id} → ${c.niveaux.join('/')}`);
    }
  }

  console.info(
    `\n═══ Bilan ${DRY_RUN ? '(DRY-RUN — aucune écriture)' : '(APPLIQUÉ)'} ═══\n` +
      `  Lignes CSV                : ${csv.totalRows}\n` +
      `  track_id valides distincts: ${trackIds.length}\n` +
      `  Lignes invalides          : ${csv.invalid.length}\n` +
      `  ── résolution ──\n` +
      `  Chansons ciblées (uniques): ${songIds.length}\n` +
      `  ✅ À APPLIQUER (level null): ${toApply.length}${DRY_RUN ? '' : `  → ${updated} écrites`}\n` +
      `  ⏭️  Déjà taguées (ignorées): ${alreadyTagged}\n` +
      `  ── à part (n'bloquent pas) ──\n` +
      `  track_id sans song_id     : ${noSong.length}\n` +
      `  track_id introuvables     : ${notFound.length}\n` +
      `  Chansons référencées absentes: ${songMissing}\n` +
      `  Conflits CSV / chanson    : ${csv.csvConflicts.length} / ${songConflicts.length}\n` +
      `  📄 Liste sans-song écrite  : ${NO_SONG_OUT}\n` +
      (APPLY && rollback.length
        ? `  💾 Rollback écrit          : ${ROLLBACK_OUT} (${rollback.length})\n`
        : '') +
      (DRY_RUN ? `\n→ Relance avec --apply pour écrire réellement.\n` : ''),
  );
}

main()
  .catch((err) => {
    console.error('❌ importSongLevels a échoué :', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
