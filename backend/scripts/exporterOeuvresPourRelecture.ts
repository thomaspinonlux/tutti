/**
 * scripts/exporterOeuvresPourRelecture.ts — SORTIR LES PLAYLISTS « DEVINE
 * L'ŒUVRE » POUR RELECTURE HUMAINE.
 *
 * Thomas veut vérifier de ses yeux que chaque film est accepté en français ET
 * en anglais. Ce script ne modifie rien : il écrit un JSON (chanson,
 * compositeur, film attendu, autres noms acceptés) que le générateur de PDF
 * met en page.
 *
 *   npx tsx scripts/exporterOeuvresPourRelecture.ts
 *   → backend/exports/oeuvres-<date>.json
 */
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { writeFileSync, mkdirSync } from 'node:fs';

config();
const prisma = new PrismaClient();

async function main(): Promise<void> {
  const playlists = await prisma.officialPlaylist.findMany({
    where: { guess_mode: 'work' },
    select: {
      slug: true,
      name_fr: true,
      visibility: true,
      difficulty: true,
      forced_source: true,
      tracks: {
        select: {
          position: true,
          title: true,
          artist: true,
          work_title: true,
          work_aliases: true,
          title_aliases: true,
          year: true,
          apple_music_id: true,
          is_playable: true,
        },
        orderBy: { position: 'asc' },
      },
    },
    orderBy: { name_fr: 'asc' },
  });

  mkdirSync('exports', { recursive: true });
  const chemin = `exports/oeuvres-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(chemin, JSON.stringify({ genere_le: new Date().toISOString(), playlists }, null, 1), 'utf-8');
  const total = playlists.reduce((n, p) => n + p.tracks.length, 0);
  console.log(`${playlists.length} playlists, ${total} pistes → ${chemin}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
