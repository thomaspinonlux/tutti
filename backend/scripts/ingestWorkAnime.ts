/**
 * Ingestion du CSV WORK (anime / jeux-tv) — mode "devine l'œuvre".
 * CSV 6 colonnes : slug,playlist,artist,title,level,work.
 *
 * Étapes :
 *   1. preprocess 6→4 col (drop slug + work, EXPERT→HARD) + map (artist,title)→work.
 *   2. _ingestPlaylistsLib : crée official-pl-anime-openings + official-pl-jeux-tv-fr
 *      + tracks (résolution youtube_id, dédup, reuse, alias titre/artiste, rollback).
 *   3. post-pass : guess_mode='work' sur les 2 playlists + work_title par track
 *      (matché par dedupKey) + génération des work_aliases (IA, par œuvre).
 *
 * Réversible : le rollback de la lib supprime les tracks/playlists créées (et donc
 * work_title/guess_mode portés par ces rows).
 *
 * Jetable (campagne).
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
loadEnv({ path: '/Users/thomaspinon/Documents/Claude Code/tutti/credentials.env.local' });
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';
import pLimit from 'p-limit';
import { ingestPlaylists, type PlaylistMeta } from './_ingestPlaylistsLib.js';

const ROOT = '/Users/thomaspinon/Documents/Claude Code/tutti';
const TMP =
  '/private/tmp/claude-501/-Users-thomaspinon-Documents-Claude-Code/a9f75dfd-8016-4626-91ce-ab632973c807/scratchpad';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const SRC = `${ROOT}/backend/data/tutti-orig-anime-jeuxtv-WORK.csv`;
const CSV4 = `${TMP}/work-anime-4col.csv`;
const ROLLBACK = `${ROOT}/orig-anime-jeuxtv-rollback-${STAMP}.json`;

const META: Record<string, PlaylistMeta> = {
  'Anime (Openings)': {
    slug: 'official-pl-anime-openings',
    name_en: 'Anime (Openings)',
    sub_fr: "Devine l'anime à son opening — 3 niveaux",
    sub_en: 'Guess the anime from its opening — 3 levels',
    category: 'genres',
  },
  'Génériques Jeux TV & Émissions FR': {
    slug: 'official-pl-jeux-tv-fr',
    name_en: 'French TV Show Themes',
    sub_fr: "Devine l'émission à son générique — 3 niveaux",
    sub_en: 'Guess the show from its theme — 3 levels',
    category: 'genres',
  },
};

// ── helpers ───────────────────────────────────────────────────────────────
function lower(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function norm(s: string): string {
  return lower(s)
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/feat\.?|ft\.?/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const dedupKey = (artist: string, title: string): string => `${norm(artist)}|${norm(title)}`;

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
const csvField = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

// preprocess 6→4 + map (artist,title)→work
function preprocess(): Map<string, string> {
  const lines = readFileSync(SRC, 'utf8').split('\n');
  const out = ['playlist,artist,title,level'];
  const workByKey = new Map<string, string>();
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const c = parseCsvLine(line); // [slug, playlist, artist, title, level, work]
    if (c.length < 6) continue;
    const playlist = (c[1] ?? '').trim();
    const artist = (c[2] ?? '').trim();
    const title = (c[3] ?? '').trim();
    const lvl = (c[4] ?? '').trim().toUpperCase();
    const work = (c[5] ?? '').trim();
    out.push([playlist, artist, title, lvl === 'EXPERT' ? 'HARD' : lvl].map(csvField).join(','));
    if (work) workByKey.set(dedupKey(artist, title), work);
  }
  writeFileSync(CSV4, out.join('\n'));
  return workByKey;
}

// ── work_aliases via Anthropic ──────────────────────────────────────────────
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5-20250929';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' });

async function genWorkAliases(work: string): Promise<string[]> {
  const prompt = `Tu génères des ALIAS pour le titre d'une œuvre (anime, série, jeu TV, émission) que des joueurs francophones de blind test pourraient dire à voix haute pour la deviner.

Œuvre : "${work}"

Donne les variantes acceptables : traduction française, titre original (romaji pour un anime japonais), abréviations/sigles courants, surnoms usuels. PAS de variantes triviales (casse, ponctuation). Max 6, pertinentes uniquement.

Réponds UNIQUEMENT par un tableau JSON de chaînes, ex: ["L'Attaque des Titans","Shingeki no Kyojin","SNK"]. Si aucune variante pertinente, réponds [].`;
  try {
    const r = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = r.content.find((b) => b.type === 'text')?.text ?? '[]';
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const arr = JSON.parse(m[0]) as unknown[];
    const aliases = arr
      .filter((x): x is string => typeof x === 'string')
      .map((s) => s.trim())
      .filter((s) => s && lower(s) !== lower(work));
    return Array.from(new Set(aliases)).slice(0, 6);
  } catch (err) {
    console.warn(`  work_aliases fail "${work}":`, err instanceof Error ? err.message : err);
    return [];
  }
}

// ── main ────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const workByKey = preprocess();
  console.log(`[work] preprocess : ${workByKey.size} (artist,title)→work mappés`);

  await ingestPlaylists({
    csvPath: CSV4,
    rollbackPath: ROLLBACK,
    meta: META,
    campaign: 'work-anime-jeuxtv',
  });

  const prisma = new PrismaClient();
  const slugs = ['official-pl-anime-openings', 'official-pl-jeux-tv-fr'];
  const pls = await prisma.officialPlaylist.findMany({
    where: { slug: { in: slugs } },
    select: { id: true, slug: true },
  });
  // 1. guess_mode='work'
  for (const p of pls) {
    await prisma.officialPlaylist.update({ where: { id: p.id }, data: { guess_mode: 'work' } });
  }
  console.log(`[work] guess_mode='work' sur ${pls.length} playlists`);

  // 2. work_title par track + collecte des œuvres distinctes
  const tracks = await prisma.officialPlaylistTrack.findMany({
    where: { playlist_id: { in: pls.map((p) => p.id) } },
    select: { id: true, artist: true, title: true },
  });
  const workOfTrack = new Map<string, string>();
  let matched = 0;
  const works = new Set<string>();
  for (const t of tracks) {
    const w = workByKey.get(dedupKey(t.artist, t.title));
    if (w) {
      workOfTrack.set(t.id, w);
      works.add(w);
      matched++;
    }
  }
  console.log(
    `[work] work_title matché : ${matched}/${tracks.length} | œuvres distinctes : ${works.size}`,
  );

  // 3. génère les work_aliases par œuvre (concurrence 10, cache)
  const limit = pLimit(10);
  const aliasByWork = new Map<string, string[]>();
  await Promise.all(
    [...works].map((w) =>
      limit(async () => {
        aliasByWork.set(w, await genWorkAliases(w));
      }),
    ),
  );
  const totalAliases = [...aliasByWork.values()].reduce((s, a) => s + a.length, 0);
  console.log(`[work] work_aliases générés : ${totalAliases} sur ${works.size} œuvres`);

  // 4. applique work_title + work_aliases par track
  for (const t of tracks) {
    const w = workOfTrack.get(t.id);
    if (!w) continue;
    await prisma.officialPlaylistTrack.update({
      where: { id: t.id },
      data: { work_title: w, work_aliases: aliasByWork.get(w) ?? [] },
    });
  }
  console.log(`[work] appliqué work_title+work_aliases sur ${matched} tracks`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('[work] fatal:', e);
  process.exitCode = 1;
});
