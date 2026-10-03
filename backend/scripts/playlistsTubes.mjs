/**
 * playlistsTubes.mjs — playlists courtes et denses, 100 % tubes.
 *
 * Constat : les playlists utilisées font 100 à 250 titres et une manche en tire
 * 15 au hasard. Sur 8 988 titres distincts du catalogue, 2 499 n'existent que
 * dans UNE playlist (fonds de tiroir) et seulement 755 dans cinq ou plus. La
 * salle tombe donc surtout sur du pointu, d'où le retour « il manque des titres
 * commerciaux » — alors qu'ils sont là, noyés.
 *
 * Signal de tri, sans jugement de goût : le nombre de playlists où un titre
 * apparaît. Un morceau rangé dans 13 playlists est un standard par
 * construction. On classe par ce nombre, puis on limite à 2 titres par artiste
 * pour éviter qu'un seul nom mange la playlist.
 */
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

const ECRIRE = process.argv.includes('--ecrire');
const CIBLE = 55;

const DEFINITIONS = [
  {
    slug: 'official-pl-dancefloor-tubes',
    nom: 'Dancefloor — Les tubes 🌍',
    nomEn: 'Dancefloor Anthems 🌍',
    sousTitre: 'Ça bouge, et tout le monde reconnaît en trois secondes',
    sousTitreEn: 'Floor-fillers everyone names in three seconds',
    artistes: /^(David Guetta|Calvin Harris|Avicii|Rihanna|Black Eyed Peas|Pitbull|LMFAO|Flo Rida|Sean Paul|Bob Sinclar|Kungs|Ofenbach|Dua Lipa|Daft Punk|Stromae|Madonna|Michael Jackson|Village People|Gloria Gaynor|Bee Gees|Earth, Wind|Chic|Donna Summer|Kool & the Gang|Lou Bega|Las Ketchup|Los del R|Rednex|Aqua|Gala|Haddaway|Eiffel 65|Snap|Technotronic|2 Unlimited|Corona|Modjo|Stardust|Pharrell Williams|Justin Timberlake|Mark Ronson|Bruno Mars|Kaoma|Ricky Martin|Magic System|Yannick|Carrapicho|Scatman|Vengaboys|Alexia|Daddy DJ|Crazy Frog|Benny Benassi|Martin Solveig|Jain|Lost Frequencies|Robin Schulz|Felix Jaehn|OMI|Luis Fonsi|J Balvin|Daddy Yankee)/i,
  },
  {
    slug: 'official-pl-divas-tubes',
    nom: 'Divas — Les tubes 🌍',
    nomEn: 'Divas — The Hits 🌍',
    sousTitre: 'Beyoncé, Rihanna, Gaga, Whitney — les voix que personne ne rate',
    sousTitreEn: 'Beyoncé, Rihanna, Gaga, Whitney — voices nobody misses',
    artistes: /^(Beyonc|Rihanna|Lady Gaga|Madonna|Katy Perry|Whitney Houston|Shakira|Christina Aguilera|Jennifer Lopez|Pink|P!nk|Britney Spears|Kesha|Sia|Destiny|Adele|Dua Lipa|Doja Cat|Amy Winehouse|Alicia Keys|Mariah Carey|Cher|Tina Turner|Donna Summer|Gloria Gaynor|Céline Dion|Celine Dion|Lizzo|Miley Cyrus|Taylor Swift|Ariana Grande|Billie Eilish|Olivia Rodrigo|Aya Nakamura|Angèle|Clara Luciani|Zaz)/i,
  },
  {
    slug: 'official-pl-boys-girls-tubes',
    nom: 'Boys Bands & Girl Bands — Les tubes 🇫🇷🌍',
    nomEn: 'Boy Bands & Girl Bands — The Hits 🇫🇷🌍',
    sousTitre: 'Spice Girls, Backstreet Boys, 2Be3 — la cour de récré des années 90',
    sousTitreEn: 'Spice Girls, Backstreet Boys and the 90s playground',
    sourcePlaylist: 'official-pl-boys-girls-bands',
  },
];

const slug = (v) => (v ?? '').toLowerCase().normalize('NFD')
  .replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]/g, '');
const sansSuffixe = (t) => slug((t ?? '').replace(/\s*[([].*$/, ''));

const pistes = await p.officialPlaylistTrack.findMany({
  where: { is_playable: true, NOT: { apple_music_id: null } },
});
const playlists = await p.officialPlaylist.findMany();
const parSlug = new Map(playlists.map((x) => [x.slug, x.id]));

// Combien de playlists distinctes contiennent ce titre = à quel point c'est un standard.
const presence = new Map();
for (const t of pistes) {
  const k = `${slug(t.artist)}|${sansSuffixe(t.title)}`;
  presence.set(k, (presence.get(k) ?? new Set()).add(t.playlist_id));
}

for (const def of DEFINITIONS) {
  let candidats = pistes;
  if (def.sourcePlaylist) {
    const src = parSlug.get(def.sourcePlaylist);
    candidats = pistes.filter((t) => t.playlist_id === src);
  } else {
    candidats = pistes.filter((t) => def.artistes.test((t.artist ?? '').trim()));
  }

  // un seul exemplaire par titre, le mieux classé
  const parTitre = new Map();
  for (const t of candidats) {
    const k = `${slug(t.artist)}|${sansSuffixe(t.title)}`;
    const score = presence.get(k)?.size ?? 1;
    const actuel = parTitre.get(k);
    if (!actuel || score > actuel.score) parTitre.set(k, { piste: t, score });
  }

  const classes = [...parTitre.values()].sort((a, b) => b.score - a.score);
  const retenus = [];
  const parArtiste = new Map();
  for (const c of classes) {
    const a = slug(c.piste.artist);
    const n = parArtiste.get(a) ?? 0;
    if (n >= 2) continue; // pas plus de deux titres du même nom
    parArtiste.set(a, n + 1);
    retenus.push(c);
    if (retenus.length >= CIBLE) break;
  }

  console.log(`\n=== ${def.nom} — ${retenus.length} titres (sur ${parTitre.size} candidats) ===`);
  for (const r of retenus.slice(0, 18)) {
    console.log(`   [${String(r.score).padStart(2)}] ${r.piste.artist} — ${r.piste.title} (${r.piste.year ?? '?'})`);
  }
  if (retenus.length > 18) console.log(`   … et ${retenus.length - 18} autres`);

  if (!ECRIRE) continue;

  const existe = parSlug.get(def.slug);
  const pl = existe
    ? await p.officialPlaylist.update({ where: { id: existe }, data: { updated_at: new Date() } })
    : await p.officialPlaylist.create({
        data: {
          slug: def.slug, name_fr: def.nom, name_en: def.nomEn,
          locale_primary: 'fr-FR', theme: def.slug.replace('official-pl-', ''),
          difficulty: 'EASY', category: 'originals',
          subtitle_fr: def.sousTitre, subtitle_en: def.sousTitreEn,
          forced_source: 'apple_music', updated_at: new Date(),
        },
      });
  await p.officialPlaylistTrack.deleteMany({ where: { playlist_id: pl.id } });
  let pos = 0;
  for (const r of retenus) {
    const { id, playlist_id, position, created_at, ...reste } = r.piste;
    pos += 1;
    await p.officialPlaylistTrack.create({ data: { ...reste, playlist_id: pl.id, position: pos } });
  }
  await p.officialPlaylist.update({ where: { id: pl.id }, data: { track_count: retenus.length } });
  console.log(`   → écrite (${retenus.length} titres)`);
}
await p.$disconnect();
