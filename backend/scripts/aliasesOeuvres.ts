/**
 * Remplit les alias des playlists en mode « œuvre » (guess_mode='work') :
 *   - artist_aliases / title_aliases via generateAliases (déterministe, zéro API)
 *   - work_aliases : ajoute la forme normalisée du work_title + de chaque alias
 * Idempotent. Aucun alias existant n'est supprimé.
 */
import { PrismaClient } from '@prisma/client';
import { generateAliases, basicNormalize } from '../src/lib/aliases.js';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const ecrire = process.argv.includes('--write');
  const pls = await prisma.officialPlaylist.findMany({
    where: { guess_mode: 'work' },
    select: { id: true, slug: true, visibility: true },
  });
  let vus = 0;
  let modifies = 0;
  for (const pl of pls) {
    const tracks = await prisma.officialPlaylistTrack.findMany({
      where: { playlist_id: pl.id },
      select: { id: true, title: true, artist: true, work_title: true, artist_aliases: true, title_aliases: true, work_aliases: true },
    });
    let n = 0;
    for (const t of tracks) {
      vus++;
      const artist = Array.from(new Set([...t.artist_aliases, ...generateAliases(t.artist ?? '', 'artist')])).filter(Boolean);
      const title = Array.from(new Set([...t.title_aliases, ...generateAliases(t.title ?? '', 'title')])).filter(Boolean);
      const workBase = t.work_title ? [...t.work_aliases, ...generateAliases(t.work_title, 'title')] : t.work_aliases;
      const work = Array.from(new Set([...workBase, ...workBase.map(basicNormalize)])).filter(Boolean);
      const change =
        artist.length !== t.artist_aliases.length ||
        title.length !== t.title_aliases.length ||
        work.length !== t.work_aliases.length;
      if (!change) continue;
      n++;
      modifies++;
      if (ecrire) {
        await prisma.officialPlaylistTrack.update({
          where: { id: t.id },
          data: { artist_aliases: artist, title_aliases: title, work_aliases: work, aliases_source: 'auto-oeuvres-20260904' },
        });
      }
    }
    console.log(`${pl.slug.padEnd(40)} ${pl.visibility.padEnd(8)} ${tracks.length.toString().padStart(4)} titres  ${n.toString().padStart(4)} a completer`);
  }
  console.log(`\n${vus} titres vus, ${modifies} ${ecrire ? 'mis a jour' : 'a mettre a jour (essai a blanc, ajoute --write)'}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
