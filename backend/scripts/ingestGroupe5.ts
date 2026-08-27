/**
 * Ingestion GROUPÉE de 5 CSV 3-niveaux / 80x3 (campagne sous-picker thématiques).
 *
 *   tutti-3niveaux-soul-disco   → Soul & R&B (existe), Disco & Funk (existe)
 *   tutti-3niveaux-latino-italie→ Latino (existe), Italie (existe)
 *   tutti-80x3-rock-electro     → Rock (CRÉER), Electro & EDM (existe)
 *   tutti-80x3-francais-metal   → Variété Française (CRÉER), Metal (existe)
 *   tutti-80x3-rapus-pop        → Rap US / Hip-Hop (existe), Pop (CRÉER)
 *
 * Colonnes CSV : slug, playlist, artist, title, level (EASY/MEDIUM/EXPERT).
 * Logique partagée (upsert slug/name, dédup (artist,title), résolution
 * youtube_id via search + classify + drop invalides, difficulty per-track,
 * reuse catalogue, rollback JSON) : _ingestPlaylistsLib.ts.
 *
 * Quota YouTube : la lib stoppe proprement à QUOTA et marque le reste en échec.
 * Idempotent : re-run pour continuer (skip ce qui est déjà en playlist).
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

// ── Adaptateur format CSV ────────────────────────────────────────────────
// La lib partagée attend 4 colonnes (playlist,artist,title,level) et son
// levelFromCsv ne connaît que EASY / HARD (→EXPERT) / défaut MEDIUM. Nos CSV
// ont 5 colonnes (slug,playlist,artist,title,level) avec level EXPERT littéral.
// On pré-traite : drop la colonne slug (redondante avec META name→slug) +
// traduit EXPERT→HARD pour que la lib le mappe sur EXPERT.
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
function preprocess5to4(srcPath: string, dstPath: string): string {
  const lines = readFileSync(srcPath, 'utf8').split('\n');
  const out = ['playlist,artist,title,level'];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const c = parseCsvLine(line); // [slug, playlist, artist, title, level]
    if (c.length < 5) continue;
    const playlist = (c[1] ?? '').trim();
    const artist = (c[2] ?? '').trim();
    const title = (c[3] ?? '').trim();
    const lvl = (c[4] ?? '').trim().toUpperCase();
    const libLevel = lvl === 'EXPERT' ? 'HARD' : lvl; // EXPERT→HARD (lib map), EASY/MEDIUM passthrough
    out.push([playlist, artist, title, libLevel].map(csvField).join(','));
  }
  writeFileSync(dstPath, out.join('\n'));
  return dstPath;
}

interface Campaign {
  campaign: string;
  csv: string;
  meta: Record<string, PlaylistMeta>;
}

const CAMPAIGNS: Campaign[] = [
  {
    campaign: '3niveaux-soul-disco',
    csv: 'tutti-3niveaux-soul-disco.csv',
    meta: {
      'Soul & R&B': {
        slug: 'official-pl-soul-rnb',
        name_en: 'Soul & R&B',
        sub_fr: 'Aretha, Marvin, Stevie — la soul et le R&B, 3 niveaux',
        sub_en: 'Aretha, Marvin, Stevie — soul and R&B across 3 levels',
        category: 'genres',
      },
      'Disco & Funk': {
        slug: 'official-pl-disco-funk',
        name_en: 'Disco & Funk',
        sub_fr: 'Du Studio 54 au funk — boule à facettes, 3 niveaux',
        sub_en: 'From Studio 54 to funk — mirror ball, 3 levels',
        category: 'genres',
      },
    },
  },
  {
    campaign: '3niveaux-latino-italie',
    csv: 'tutti-3niveaux-latino-italie.csv',
    meta: {
      Latino: {
        slug: 'official-pl-latino',
        name_en: 'Latino',
        sub_fr: 'Du reggaetón au son cubain — 3 niveaux',
        sub_en: 'From reggaetón to son cubano — 3 levels',
        category: 'genres',
      },
      Italie: {
        slug: 'official-pl-italie',
        name_en: 'Italia',
        sub_fr: 'Cutugno, Ramazzotti, Måneskin — la botte au complet',
        sub_en: 'Cutugno, Ramazzotti, Måneskin — full Italian songbook',
        category: 'genres',
      },
    },
  },
  {
    campaign: '80x3-rock-electro',
    csv: 'tutti-80x3-rock-electro.csv',
    meta: {
      Rock: {
        slug: 'official-pl-rock',
        name_en: 'Rock',
        sub_fr: 'Des classiques aux pépites — le rock, 3 niveaux',
        sub_en: 'From classics to deep cuts — rock across 3 levels',
        category: 'genres',
      },
      'Electro & EDM': {
        slug: 'official-pl-electro-edm',
        name_en: 'Electro & EDM',
        sub_fr: 'De la house à l’EDM — le dancefloor, 3 niveaux',
        sub_en: 'From house to EDM — the dancefloor, 3 levels',
        category: 'genres',
      },
    },
  },
  {
    campaign: '80x3-francais-metal',
    csv: 'tutti-80x3-francais-metal.csv',
    meta: {
      'Variété Française': {
        slug: 'official-pl-variete-francaise',
        name_en: 'French Variété',
        sub_fr: 'De Cloclo à aujourd’hui — la variété française, 3 niveaux',
        sub_en: 'From Cloclo to today — French variété, 3 levels',
        category: 'genres',
      },
      Metal: {
        slug: 'official-pl-metal',
        name_en: 'Metal',
        sub_fr: 'Du hard au heavy — le metal, 3 niveaux',
        sub_en: 'From hard to heavy — metal across 3 levels',
        category: 'genres',
      },
    },
  },
  {
    campaign: '80x3-rapus-pop',
    csv: 'tutti-80x3-rapus-pop.csv',
    meta: {
      'Rap US / Hip-Hop': {
        slug: 'official-pl-rap-us',
        name_en: 'US Rap / Hip-Hop',
        sub_fr: 'De la East Coast à Atlanta — le rap US, 3 niveaux',
        sub_en: 'From East Coast to Atlanta — US rap, 3 levels',
        category: 'genres',
      },
      Pop: {
        slug: 'official-pl-pop',
        name_en: 'Pop',
        sub_fr: 'Les tubes pop d’hier à aujourd’hui — 3 niveaux',
        sub_en: 'Pop hits from then to now — 3 levels',
        category: 'genres',
      },
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
