/**
 * Ingestion GROUPÉE des 6 CSV NORMAUX (mode standard, 5 colonnes
 * slug,playlist,artist,title,level). Voir ingestGroupe5.ts — même preprocess
 * (drop colonne slug, EXPERT→HARD) + _ingestPlaylistsLib (upsert slug/name sans
 * clobber, dédup (artist,title), résolution youtube_id search+classify+drop,
 * difficulty per-track, reuse catalogue, rollback JSON par CSV).
 *
 * Le CSV WORK (anime/jeux-tv) est traité séparément : ingestWorkAnime.ts.
 *
 * Jetable (campagne). Un rollback JSON par CSV.
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
loadEnv({ path: '/Users/thomaspinon/Documents/Claude Code/tutti/credentials.env.local' });
import { readFileSync, writeFileSync } from 'node:fs';
import { ingestPlaylists, type PlaylistMeta } from './_ingestPlaylistsLib.js';

const ROOT = '/Users/thomaspinon/Documents/Claude Code/tutti';
const TMP =
  '/private/tmp/claude-501/-Users-thomaspinon-Documents-Claude-Code/a9f75dfd-8016-4626-91ce-ab632973c807/scratchpad';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');

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
function csvField(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
// 5 col (slug,playlist,artist,title,level) → 4 col (playlist,artist,title,level)
// + EXPERT→HARD (levelFromCsv de la lib ne connaît que EASY/HARD/défaut MEDIUM).
function preprocess5to4(srcPath: string, dstPath: string): string {
  const lines = readFileSync(srcPath, 'utf8').split('\n');
  const out = ['playlist,artist,title,level'];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const c = parseCsvLine(line);
    if (c.length < 5) continue;
    const lvl = (c[4] ?? '').trim().toUpperCase();
    const libLevel = lvl === 'EXPERT' ? 'HARD' : lvl;
    out.push(
      [(c[1] ?? '').trim(), (c[2] ?? '').trim(), (c[3] ?? '').trim(), libLevel]
        .map(csvField)
        .join(','),
    );
  }
  writeFileSync(dstPath, out.join('\n'));
  return dstPath;
}

const g = (slug: string, name_en: string, sub_fr: string, category = 'genres'): PlaylistMeta => ({
  slug,
  name_en,
  sub_fr,
  sub_en: sub_fr,
  category,
});

interface Campaign {
  campaign: string;
  csv: string;
  meta: Record<string, PlaylistMeta>;
}

const CAMPAIGNS: Campaign[] = [
  {
    campaign: 'reggae-country-hardrock',
    csv: 'tutti-80x3-reggae-country-hardrock.csv',
    meta: {
      Reggae: g('official-pl-reggae', 'Reggae', 'Du roots au dancehall — 3 niveaux'),
      Country: g('official-pl-country', 'Country', 'Nashville et au-delà — 3 niveaux'),
      'Hard Rock 80s': g(
        'official-pl-hard-rock-80s',
        'Hard Rock 80s',
        'Le hard rock des années 80 — 3 niveaux',
      ),
    },
  },
  {
    campaign: 'topup-latino-italie',
    csv: 'tutti-topup-latino-italie.csv',
    meta: {
      Latino: g('official-pl-latino', 'Latino', 'Du reggaetón au son cubain — 3 niveaux'),
      Italie: g('official-pl-italie', 'Italia', 'Cutugno, Ramazzotti, Måneskin — 3 niveaux'),
    },
  },
  {
    campaign: 'complement-decennies',
    csv: 'tutti-complement-decennies.csv',
    meta: {
      'Années 70': g(
        'official-pl-70s',
        'The 70s',
        'Le meilleur des années 70 — 3 niveaux',
        'decades',
      ),
      'Années 80': g(
        'official-pl-80s',
        'The 80s',
        'Le meilleur des années 80 — 3 niveaux',
        'decades',
      ),
      'Années 90': g(
        'official-pl-90s',
        'The 90s',
        'Le meilleur des années 90 — 3 niveaux',
        'decades',
      ),
      'Années 2000': g(
        'official-pl-2000s',
        'The 2000s',
        'Le meilleur des années 2000 — 3 niveaux',
        'decades',
      ),
      'Années 2010': g(
        'official-pl-2010s',
        'The 2010s',
        'Le meilleur des années 2010 — 3 niveaux',
        'decades',
      ),
    },
  },
  {
    campaign: 'orig-kpop-bresil',
    csv: 'tutti-orig-kpop-bresil.csv',
    meta: {
      'K-Pop': g(
        'official-pl-kpop',
        'K-Pop',
        'De la première à la dernière génération — 3 niveaux',
      ),
      Brésil: g('official-pl-bresil', 'Brazil', 'Du samba à la funk carioca — 3 niveaux'),
    },
  },
  {
    campaign: 'orig-quebec-rai-tiktok-sample',
    csv: 'tutti-orig-quebec-rai-tiktok-sample.csv',
    meta: {
      'Québec & Franco': g(
        'official-pl-quebec',
        'Québec & Franco',
        'La chanson québécoise et franco — 3 niveaux',
      ),
      'Raï & Oriental': g(
        'official-pl-rai-oriental',
        'Raï & Oriental',
        'Du raï à la pop orientale — 3 niveaux',
      ),
      'TikTok & Viral': g(
        'official-pl-tiktok-viral',
        'TikTok & Viral',
        'Les sons devenus viraux — 3 niveaux',
      ),
      'Le Sample': g(
        'official-pl-le-sample',
        'The Sample',
        'Tubes bâtis sur un sample — 3 niveaux',
      ),
    },
  },
  {
    campaign: 'decennie-2020s',
    csv: 'tutti-decennie-2020s.csv',
    meta: {
      'Années 2020': g(
        'official-pl-2020s',
        'The 2020s',
        'Le meilleur des années 2020 — 3 niveaux',
        'decades',
      ),
    },
  },
];

for (const c of CAMPAIGNS) {
  console.log(`\n\n########## CAMPAGNE ${c.campaign} (${c.csv}) ##########`);
  const csv4 = preprocess5to4(`${ROOT}/backend/data/${c.csv}`, `${TMP}/${c.campaign}-4col.csv`);
  await ingestPlaylists({
    csvPath: csv4,
    rollbackPath: `${ROOT}/${c.campaign}-rollback-${STAMP}.json`,
    meta: c.meta,
    campaign: c.campaign,
  });
}
process.exit(0);
