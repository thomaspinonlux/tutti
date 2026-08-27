/**
 * Re-ingestion mainstream (kpop/bresil/quebec/tiktok-viral) — COMPLÉTER.
 * CSV : tutti-mainstream-kpop-bresil-quebec-tiktok.csv (5 col).
 * Tourne avec le filtre YouTube ASSOUPLI (_ingestPlaylistsLib : seuil 0.5
 * normalisé, forbidden-si-absent-du-source, try-next-embeddable).
 * Dédup (artist,title) → n'ajoute que les nouvelles. Rollback JSON.
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
function preprocess5to4(srcPath: string, dstPath: string): string {
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

const meta: Record<string, PlaylistMeta> = {
  'K-Pop': {
    slug: 'official-pl-kpop',
    name_en: 'K-Pop',
    sub_fr: '',
    sub_en: '',
    category: 'genres',
  },
  Brésil: {
    slug: 'official-pl-bresil',
    name_en: 'Brazil',
    sub_fr: '',
    sub_en: '',
    category: 'genres',
  },
  'Québec & Franco': {
    slug: 'official-pl-quebec',
    name_en: 'Québec & Franco',
    sub_fr: '',
    sub_en: '',
    category: 'genres',
  },
  'TikTok & Viral': {
    slug: 'official-pl-tiktok-viral',
    name_en: 'TikTok & Viral',
    sub_fr: '',
    sub_en: '',
    category: 'genres',
  },
};

const csv4 = preprocess5to4(
  `${ROOT}/backend/data/tutti-mainstream-kpop-bresil-quebec-tiktok.csv`,
  `${TMP}/mainstream-4col.csv`,
);
await ingestPlaylists({
  csvPath: csv4,
  rollbackPath: `${ROOT}/mainstream-kpop-bresil-quebec-tiktok-rollback-${STAMP}.json`,
  meta,
  campaign: 'mainstream-kpop-bresil-quebec-tiktok',
});
process.exit(0);
