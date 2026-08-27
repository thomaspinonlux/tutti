/**
 * Ingest tutti-mortes-complement.csv — complète des playlists existantes
 * (filtre YouTube assoupli). Tout = COMPLETE (remaps vers slugs existants,
 * 0 création → 0 doublon) :
 *   - disney-fr, afrobeats, chanson-fr-classique : slug direct.
 *   - "Enfants 4-8 ans" → official-pl-enfants-4-8-ans (slug réel ≠ enfants-4-8).
 *   - "Jeux Vidéo"      → official-pl-video-games   (slug réel ≠ jeux-video).
 *   - top-ups Groupe A : duos-cultes, french-touch, hiphop-fr-2020s,
 *     italie-classique, musicals-us, pop-divas, tubes-de-l-ete.
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
const csvField = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
function preprocess(srcPath: string, dstPath: string): string {
  const lines = readFileSync(srcPath, 'utf8').split('\n');
  const out = ['playlist,artist,title,level'];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const c = parseCsvLine(line);
    if (c.length < 5) continue;
    const lvl = (c[4] ?? '').trim().toUpperCase();
    out.push(
      [
        (c[1] ?? '').trim(),
        (c[2] ?? '').trim(),
        (c[3] ?? '').trim(),
        lvl === 'EXPERT' ? 'HARD' : lvl,
      ]
        .map(csvField)
        .join(','),
    );
  }
  writeFileSync(dstPath, out.join('\n'));
  return dstPath;
}
const g = (slug: string): PlaylistMeta => ({
  slug,
  name_en: '',
  sub_fr: '',
  sub_en: '',
  category: 'genres',
});

const meta: Record<string, PlaylistMeta> = {
  Afrobeats: g('official-pl-afrobeats'),
  'Chanson FR Classique': g('official-pl-chanson-fr-classique'),
  'Disney en français': g('official-pl-disney-fr'),
  'Enfants 4-8 ans': g('official-pl-enfants-4-8-ans'),
  'Jeux Vidéo': g('official-pl-video-games'),
  'Duos cultes': g('official-pl-duos-cultes'),
  'French Touch & Electro': g('official-pl-french-touch'),
  'Hip-Hop FR 2020': g('official-pl-hiphop-fr-2020s'),
  'Italie classique': g('official-pl-italie-classique'),
  'Comédies musicales US': g('official-pl-musicals-us'),
  'Pop Divas': g('official-pl-pop-divas'),
  "Tubes de l'été": g('official-pl-tubes-de-l-ete'),
};

const csv4 = preprocess(
  `${ROOT}/backend/data/tutti-mortes-complement.csv`,
  `${TMP}/mortes-4col.csv`,
);
await ingestPlaylists({
  csvPath: csv4,
  rollbackPath: `${ROOT}/mortes-complement-rollback-${STAMP}.json`,
  meta,
  campaign: 'mortes-complement',
});
process.exit(0);
