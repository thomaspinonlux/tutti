/**
 * Export lecture seule du catalogue complet (canonique = Song).
 * Colonnes : track_id, artist, title, year, playlists (slugs), difficulty_actuel,
 * is_francophone_actuel. Une ligne par Song. N'écrit RIEN en DB.
 * Sortie : <repo>/catalogue-export-<date>.csv
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '../src/lib/prisma.js';

function csv(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main(): Promise<void> {
  const songs = await prisma.song.findMany({
    orderBy: [{ artist: { canonical_name: 'asc' } }, { canonical_title: 'asc' }],
    select: {
      id: true,
      canonical_title: true,
      level: true,
      is_francophone: true,
      artist: { select: { canonical_name: true } },
      catalog_tracks: {
        select: { year: true, playlist: { select: { slug: true } } },
      },
    },
  });

  const header = [
    'track_id',
    'artist',
    'title',
    'year',
    'playlists',
    'difficulty_actuel',
    'is_francophone_actuel',
  ].join(',');

  const lines = songs.map((s) => {
    const year = s.catalog_tracks.find((t) => t.year != null)?.year ?? '';
    const slugs = Array.from(new Set(s.catalog_tracks.map((t) => t.playlist.slug))).sort();
    return [
      csv(s.id),
      csv(s.artist.canonical_name),
      csv(s.canonical_title),
      csv(year),
      csv(slugs.join('|')),
      csv(s.level ?? ''),
      csv(s.is_francophone),
    ].join(',');
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const path = join(process.cwd(), '..', `catalogue-export-${stamp}.csv`);
  writeFileSync(path, [header, ...lines].join('\n') + '\n');
  console.log(`Wrote ${lines.length} rows → catalogue-export-${stamp}.csv`);
  await prisma.$disconnect();
}
void main();
