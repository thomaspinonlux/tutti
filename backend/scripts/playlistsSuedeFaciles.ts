/**
 * playlistsSuedeFaciles.ts — trois playlists suédoises FACILES, courtes et
 * denses, à la place de la grosse « Suède 🇸🇪 » de 70 titres.
 *
 * Même principe que Dancefloor / Divas / Radio : une manche tire 15 titres au
 * hasard, donc une playlist de 70 sert surtout du deuxième rayon. Trois
 * playlists thématiques de ~25 titres, où chaque titre est un tube, donnent
 * une manche entièrement composée de morceaux que la salle reconnaît.
 *
 * Toutes en ANGLAIS : ce sont des Suédois, mais une salle française les
 * reconnaît sans savoir qu'ils le sont. Le suédois chanté reste dans la
 * playlist « Suède — en suédois », en niveau expert, et n'a rien à faire ici.
 */
import 'dotenv/config';
import { AppleMusicProvider } from '../src/music/apple/AppleMusicProvider.js';
import { prisma } from '../src/lib/prisma.js';

const ECRIRE = process.argv.includes('--ecrire');

const DEFINITIONS = [
  {
    slug: 'official-pl-suede-classiques',
    nom: 'Suède — Les classiques 🇸🇪',
    nomEn: 'Sweden — The Classics 🇸🇪',
    sousTitre: 'ABBA, Roxette, Ace of Base, Europe — les années 70 à 90',
    sousTitreEn: 'ABBA, Roxette, Ace of Base, Europe — the 70s to the 90s',
    requetes: [
      'ABBA Dancing Queen',
      'ABBA Mamma Mia',
      'ABBA Waterloo',
      'ABBA Gimme Gimme Gimme A Man After Midnight',
      'ABBA Super Trouper',
      'ABBA Take A Chance On Me',
      'ABBA Money Money Money',
      'ABBA Voulez-Vous',
      'ABBA SOS',
      'ABBA Chiquitita',
      'Roxette The Look',
      'Roxette Joyride',
      'Roxette Listen To Your Heart',
      'Roxette It Must Have Been Love',
      'Roxette Dressed For Success',
      'Ace of Base All That She Wants',
      'Ace of Base The Sign',
      'Ace of Base Happy Nation',
      'Ace of Base Beautiful Life',
      'Europe The Final Countdown',
      'Europe Carrie',
      'Europe Rock The Night',
      'The Cardigans Lovefool',
      'The Cardigans My Favourite Game',
      'Eagle-Eye Cherry Save Tonight',
      'Neneh Cherry Buffalo Stance',
      'Neneh Cherry 7 Seconds',
      'Rednex Cotton Eye Joe',
      'Dr Alban Its My Life',
      'The Hives Hate To Say I Told You So',
    ],
  },
  {
    slug: 'official-pl-suede-dancefloor',
    nom: 'Suède — Dancefloor 🇸🇪',
    nomEn: 'Sweden — Dancefloor 🇸🇪',
    sousTitre: 'Avicii, Swedish House Mafia, Basshunter — la Suède qui fait danser',
    sousTitreEn: 'Avicii, Swedish House Mafia, Basshunter — Sweden on the floor',
    requetes: [
      'Avicii Wake Me Up',
      'Avicii Levels',
      'Avicii Hey Brother',
      'Avicii The Nights',
      'Avicii Waiting For Love',
      'Avicii Addicted To You',
      'Swedish House Mafia Don’t You Worry Child',
      'Swedish House Mafia Save The World',
      'Swedish House Mafia Greyhound',
      'Swedish House Mafia One',
      'Axwell Ingrosso More Than You Know',
      'Axwell Ingrosso Sun Is Shining',
      'Alesso Heroes we could be',
      'Alesso Calling Lose My Mind',
      'Galantis Runaway U & I',
      'Galantis No Money',
      'Icona Pop I Love It',
      'Icona Pop All Night',
      'Basshunter Boten Anna',
      'Basshunter Now Youre Gone',
      'September Cry For You',
      'Alcazar Crying At The Discoteque',
      'E-Type This Is The Way',
      'Loreen Euphoria',
      'Loreen Tattoo',
      'Måns Zelmerlöw Heroes',
      'Bob Sinclar Love Generation',
      'Robyn Dancing On My Own',
      'Robyn With Every Heartbeat',
    ],
  },
  {
    slug: 'official-pl-suede-pop',
    nom: 'Suède — Pop d’aujourd’hui 🇸🇪',
    nomEn: 'Sweden — Today’s Pop 🇸🇪',
    sousTitre: 'Zara Larsson, Tove Lo, First Aid Kit — la nouvelle vague suédoise',
    sousTitreEn: 'Zara Larsson, Tove Lo, First Aid Kit — the new Swedish wave',
    requetes: [
      'Zara Larsson Lush Life',
      'Zara Larsson Never Forget You',
      'Zara Larsson Symphony',
      'Zara Larsson Uncover',
      'Zara Larsson Ruin My Life',
      'Tove Lo Habits Stay High',
      'Tove Lo Talking Body',
      'Tove Lo Cool Girl',
      'Lykke Li I Follow Rivers',
      'Lykke Li Little Bit',
      'First Aid Kit My Silver Lining',
      'First Aid Kit Emmylou',
      'Miike Snow Genghis Khan',
      'Miike Snow Animal',
      'Little Dragon Twice',
      'Peter Bjorn and John Young Folks',
      'Mando Diao Dance With Somebody',
      'Caesars Jerk It Out',
      'Tove Styrke Say My Name',
      'Seinabo Sey Younger',
      'Benjamin Ingrosso Dance You Off',
      'Molly Sandén Every Single Day',
      'Jens Lekman',
      'Veronica Maggio Hela huset',
      'Avicii SOS',
      'Swedish House Mafia Moth To A Flame',
      'Ghost Square Hammer',
      'Sabaton Primo Victoria',
      'In Flames Take This Life',
    ],
  },
];

const slug = (v: string): string =>
  (v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]/g, '');
const sansSuffixe = (t: string): string => slug((t ?? '').replace(/\s*[([].*$/, ''));

async function main(): Promise<void> {
  const apple = new AppleMusicProvider('fr');

  for (const def of DEFINITIONS) {
    const retenus: Array<{
      id: string;
      artist: string;
      title: string;
      year: number | null;
      cover: string | null;
    }> = [];
    const vus = new Set<string>();
    for (const q of def.requetes) {
      try {
        const [t] = await apple.search(q, { limit: 1 });
        if (!t) {
          console.log(`   introuvable : ${q}`);
          continue;
        }
        const cle = `${slug(t.artist)}|${sansSuffixe(t.title)}`;
        if (vus.has(cle)) continue;
        vus.add(cle);
        retenus.push({
          id: t.provider_track_id,
          artist: t.artist,
          title: t.title,
          year: t.year ?? null,
          cover: t.cover_url ?? null,
        });
      } catch (err: unknown) {
        console.log(`   erreur « ${q} » : ${(err as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 120));
    }

    console.log(`\n=== ${def.nom} — ${retenus.length} titres ===`);
    for (const r of retenus) console.log(`   ${r.artist} — ${r.title} (${r.year ?? '?'})`);
    if (!ECRIRE) continue;

    const existante = await prisma.officialPlaylist.findFirst({ where: { slug: def.slug } });
    const pl = existante
      ? await prisma.officialPlaylist.update({
          where: { id: existante.id },
          data: { updated_at: new Date() },
        })
      : await prisma.officialPlaylist.create({
          data: {
            slug: def.slug,
            name_fr: def.nom,
            name_en: def.nomEn,
            locale_primary: 'fr-FR',
            theme: def.slug.replace('official-pl-', ''),
            difficulty: 'EASY',
            category: 'genres',
            subtitle_fr: def.sousTitre,
            subtitle_en: def.sousTitreEn,
            forced_source: 'apple_music',
            updated_at: new Date(),
          },
        });
    await prisma.officialPlaylistTrack.deleteMany({ where: { playlist_id: pl.id } });
    let pos = 0;
    for (const r of retenus) {
      pos += 1;
      await prisma.officialPlaylistTrack.create({
        data: {
          playlist_id: pl.id,
          position: pos,
          title: r.title,
          artist: r.artist,
          year: r.year,
          apple_music_id: r.id,
          cover_url: r.cover,
          is_playable: true,
          playability_checked_at: new Date(),
        },
      });
    }
    await prisma.officialPlaylist.update({
      where: { id: pl.id },
      data: { track_count: retenus.length },
    });
    console.log(`   → écrite (${retenus.length} titres)`);
  }

  // La grosse « Suède 🇸🇪 » de 70 titres est remplacée par les trois ci-dessus :
  // à 70 titres, une manche de 15 tirait surtout du deuxième rayon.
  if (ECRIRE) {
    const generique = await prisma.officialPlaylist.findFirst({
      where: { slug: 'official-pl-suede-tubes' },
    });
    if (generique) {
      await prisma.officialPlaylistTrack.deleteMany({ where: { playlist_id: generique.id } });
      await prisma.officialPlaylist.delete({ where: { id: generique.id } });
      console.log(
        '\n« Suède 🇸🇪 » (70 titres) supprimée — remplacée par les trois playlists ci-dessus.',
      );
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
