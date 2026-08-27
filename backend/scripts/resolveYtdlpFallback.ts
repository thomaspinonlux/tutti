/**
 * Re-résolution des tracks droppées des 11 playlists bloquées, AVEC le fallback
 * yt-dlp désormais intégré dans _ingestPlaylistsLib. Idempotent (la lib skip les
 * tracks déjà présentes → ne re-tente QUE les droppées). 2 rollbacks JSON.
 *
 * Sources des drops :
 *   - mortes-complement.csv : enfants-4-8-ans, video-games, disney-fr,
 *     afrobeats, chanson-fr-classique + petits top-ups.
 *   - groupeA-complement.csv : gros drops des 6 top-ups (musicals-us,
 *     french-touch, pop-divas, hiphop-fr-2020s, duos-cultes, tubes-de-l-ete).
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
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
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

const META_MORTES: Record<string, PlaylistMeta> = {
  Afrobeats: g('official-pl-afrobeats'),
  'Chanson FR Classique': g('official-pl-chanson-fr-classique'),
  'Disney en français': g('official-pl-disney-fr'),
  'Enfants 4-8 ans': g('official-pl-enfants-4-8-ans'),
  'Jeux Vidéo': g('official-pl-video-games'),
  'Comédies musicales US': g('official-pl-musicals-us'),
  'French Touch & Electro': g('official-pl-french-touch'),
  'Pop Divas': g('official-pl-pop-divas'),
  'Hip-Hop FR 2020': g('official-pl-hiphop-fr-2020s'),
  'Duos cultes': g('official-pl-duos-cultes'),
  "Tubes de l'été": g('official-pl-tubes-de-l-ete'),
};
const META_GROUPEA: Record<string, PlaylistMeta> = {
  'Comédies musicales US': g('official-pl-musicals-us'),
  'French Touch & Electro': g('official-pl-french-touch'),
  'Pop Divas': g('official-pl-pop-divas'),
  'Hip-Hop FR 2020': g('official-pl-hiphop-fr-2020s'),
  'Duos cultes': g('official-pl-duos-cultes'),
  "Tubes de l'été": g('official-pl-tubes-de-l-ete'),
};

console.log('\n########## RE-RÉSO mortes-complement (11) ##########');
await ingestPlaylists({
  csvPath: preprocess(
    `${ROOT}/backend/data/tutti-mortes-complement.csv`,
    `${TMP}/reso-mortes-4col.csv`,
  ),
  rollbackPath: `${ROOT}/ytdlp-reso-mortes-rollback-${STAMP}.json`,
  meta: META_MORTES,
  campaign: 'ytdlp-reso-mortes',
});

console.log('\n########## RE-RÉSO groupeA top-ups (6) ##########');
await ingestPlaylists({
  csvPath: preprocess(
    `${ROOT}/backend/data/tutti-groupeA-complement.csv`,
    `${TMP}/reso-groupeA-4col.csv`,
  ),
  rollbackPath: `${ROOT}/ytdlp-reso-groupeA-rollback-${STAMP}.json`,
  meta: META_GROUPEA,
  campaign: 'ytdlp-reso-groupeA',
});
process.exit(0);
