/**
 * Ingest Groupe A — tutti-groupeA-complement.csv (5 col slug,playlist,artist,
 * title,level). Complète des playlists EXISTANTES (match par slug). Filtre
 * YouTube assoupli (lib). Dédup, difficulty=level, alias backfill séparé après.
 *
 *   NORMAL (11 playlists) : disney-vo→official-pl-disney-en (remap),
 *     duos-cultes, french-touch, italie-classique, musicals-us, pop-divas,
 *     punk-rock-90s-2000s, quebec, rap-fr-2020→official-pl-hiphop-fr-2020s
 *     (remap), rap-fr-culte, tubes-de-l-ete.
 *   WORK  (series-tv) : official-pl-series-tv (déjà guess_mode='work').
 *     artist="Générique", work_title dérivé du titre (avant " ("), work_aliases IA.
 *
 * 2 rollbacks JSON (normal + series-tv).
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
const SRC = `${ROOT}/backend/data/tutti-groupeA-complement.csv`;

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
const dedupKey = (a: string, t: string): string => `${norm(a)}|${norm(t)}`;

// Split la source en (normal 4col, seriestv 4col) + map (artist,title)→work série.
function preprocess(): { normal: string; series: string; workByKey: Map<string, string> } {
  const lines = readFileSync(SRC, 'utf8').split('\n');
  const normal = ['playlist,artist,title,level'];
  const series = ['playlist,artist,title,level'];
  const workByKey = new Map<string, string>();
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const c = parseCsvLine(line); // [slug, playlist, artist, title, level]
    if (c.length < 5) continue;
    const slug = (c[0] ?? '').trim();
    const playlist = (c[1] ?? '').trim();
    const artist = (c[2] ?? '').trim();
    const title = (c[3] ?? '').trim();
    const lvl = (c[4] ?? '').trim().toUpperCase();
    const row = [playlist, artist, title, lvl === 'EXPERT' ? 'HARD' : lvl].map(csvField).join(',');
    if (slug === 'series-tv') {
      series.push(row);
      const work = title.split(' (')[0].trim(); // "Friends (I'll Be...)" → "Friends"
      if (work) workByKey.set(dedupKey(artist, title), work);
    } else {
      normal.push(row);
    }
  }
  const np = `${TMP}/groupeA-normal-4col.csv`;
  const sp = `${TMP}/groupeA-series-4col.csv`;
  writeFileSync(np, normal.join('\n'));
  writeFileSync(sp, series.join('\n'));
  return { normal: np, series: sp, workByKey };
}

const g = (slug: string): PlaylistMeta => ({
  slug,
  name_en: '',
  sub_fr: '',
  sub_en: '',
  category: 'genres',
});

// NORMAL — clés = nom playlist du CSV ; slug = playlist EXISTANTE (remaps inclus).
const NORMAL_META: Record<string, PlaylistMeta> = {
  'Disney VO': g('official-pl-disney-en'),
  'Duos cultes': g('official-pl-duos-cultes'),
  'French Touch & Electro': g('official-pl-french-touch'),
  'Italie classique': g('official-pl-italie-classique'),
  'Comédies musicales US': g('official-pl-musicals-us'),
  'Pop Divas': g('official-pl-pop-divas'),
  'Punk Rock 90s-2000s': g('official-pl-punk-rock-90s-2000s'),
  'Québec & Franco': g('official-pl-quebec'),
  'Hip-Hop FR 2020': g('official-pl-hiphop-fr-2020s'),
  'Rap Français': g('official-pl-rap-fr-culte'),
  "Tubes de l'été": g('official-pl-tubes-de-l-ete'),
};
const SERIES_META: Record<string, PlaylistMeta> = {
  'Génériques Séries TV': g('official-pl-series-tv'),
};

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5-20250929';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' });
async function genWorkAliases(work: string): Promise<string[]> {
  const prompt = `Tu génères des ALIAS pour le titre d'une SÉRIE TV que des joueurs francophones pourraient dire pour la deviner.

Série : "${work}"

Variantes acceptables : titre français, sigle/abréviation courante, surnom usuel. PAS de variantes triviales (casse/ponctuation). Max 5, pertinentes uniquement.
Réponds UNIQUEMENT par un tableau JSON de chaînes, ex: ["GoT","Le Trône de Fer"]. Si rien de pertinent, [].`;
  try {
    const r = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 250,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = r.content.find((b) => b.type === 'text')?.text ?? '[]';
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const arr = JSON.parse(m[0]) as unknown[];
    return Array.from(
      new Set(
        arr
          .filter((x): x is string => typeof x === 'string')
          .map((s) => s.trim())
          .filter((s) => s && lower(s) !== lower(work)),
      ),
    ).slice(0, 5);
  } catch (err) {
    console.warn(`  work_aliases fail "${work}":`, err instanceof Error ? err.message : err);
    return [];
  }
}

async function main(): Promise<void> {
  const { normal, series, workByKey } = preprocess();
  console.log(`[groupeA] preprocess : series work mappés=${workByKey.size}`);

  // ── NORMAL (11) ──────────────────────────────────────────────────────────
  console.log('\n########## NORMAL (11 playlists) ##########');
  await ingestPlaylists({
    csvPath: normal,
    rollbackPath: `${ROOT}/groupeA-normal-rollback-${STAMP}.json`,
    meta: NORMAL_META,
    campaign: 'groupeA-normal',
  });

  // ── WORK series-tv ───────────────────────────────────────────────────────
  console.log('\n########## WORK series-tv ##########');
  await ingestPlaylists({
    csvPath: series,
    rollbackPath: `${ROOT}/groupeA-series-tv-rollback-${STAMP}.json`,
    meta: SERIES_META,
    campaign: 'groupeA-series-tv',
  });

  // post-pass : work_title (dérivé) + work_aliases (IA) sur les tracks series-tv.
  const prisma = new PrismaClient();
  const pl = await prisma.officialPlaylist.findUnique({
    where: { slug: 'official-pl-series-tv' },
    select: { id: true },
  });
  if (pl) {
    await prisma.officialPlaylist.update({ where: { id: pl.id }, data: { guess_mode: 'work' } });
    const tracks = await prisma.officialPlaylistTrack.findMany({
      where: { playlist_id: pl.id, work_title: null },
      select: { id: true, artist: true, title: true },
    });
    const workOf = new Map<string, string>();
    const works = new Set<string>();
    for (const t of tracks) {
      const w = workByKey.get(dedupKey(t.artist, t.title));
      if (w) {
        workOf.set(t.id, w);
        works.add(w);
      }
    }
    const limit = pLimit(8);
    const aliasByWork = new Map<string, string[]>();
    await Promise.all(
      [...works].map((w) => limit(async () => aliasByWork.set(w, await genWorkAliases(w)))),
    );
    let applied = 0;
    for (const t of tracks) {
      const w = workOf.get(t.id);
      if (!w) continue;
      await prisma.officialPlaylistTrack.update({
        where: { id: t.id },
        data: { work_title: w, work_aliases: aliasByWork.get(w) ?? [] },
      });
      applied++;
    }
    console.log(
      `[groupeA] series-tv post-pass : work_title sur ${applied} tracks (${works.size} séries, ${[...aliasByWork.values()].reduce((s, a) => s + a.length, 0)} aliases)`,
    );
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('[groupeA] fatal:', e);
  process.exitCode = 1;
});
