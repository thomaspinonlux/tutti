/**
 * playlistsSuede.ts — deux playlists suédoises, construites depuis la boutique
 * Apple Music FR.
 *
 * Pourquoi DEUX et pas une : en blind test, « musique suédoise » recouvre deux
 * choses qui n'ont rien à voir devant une salle.
 *
 *   Suède 🇸🇪        — des Suédois qui chantent en ANGLAIS. ABBA, Roxette,
 *                      Avicii, Robyn, The Cardigans. N'importe quelle salle
 *                      française les reconnaît ; beaucoup ignorent même qu'ils
 *                      sont suédois, ce qui fait une bonne anecdote d'animateur.
 *   Suède en suédois — chanté en SUÉDOIS. Håkan Hellström, Kent, Veronica
 *                      Maggio, Gyllene Tider. Injouable devant un public
 *                      français, parfait devant un public suédois ou pour une
 *                      soirée à thème.
 *
 * La recherche se fait sur la vitrine FR : un titre rendu par cette recherche
 * est, par construction, disponible dans la boutique française. C'est une
 * garantie plus forte que la vérification a posteriori qu'on fait ailleurs.
 */
import 'dotenv/config';
import { AppleMusicProvider } from '../src/music/apple/AppleMusicProvider.js';
import { prisma } from '../src/lib/prisma.js';

const ECRIRE = process.argv.includes('--ecrire');

const EN_ANGLAIS: string[] = [
  'ABBA Dancing Queen',
  'ABBA Mamma Mia',
  'ABBA Waterloo',
  'ABBA Gimme Gimme Gimme',
  'ABBA Super Trouper',
  'ABBA Take A Chance On Me',
  'ABBA Money Money Money',
  'Roxette The Look',
  'Roxette Joyride',
  'Roxette Listen To Your Heart',
  'Roxette It Must Have Been Love',
  'Ace of Base All That She Wants',
  'Ace of Base The Sign',
  'Ace of Base Happy Nation',
  'Ace of Base Beautiful Life',
  'Europe The Final Countdown',
  'Europe Carrie',
  'Europe Rock The Night',
  'Avicii Wake Me Up',
  'Avicii Levels',
  'Avicii Hey Brother',
  'Avicii The Nights',
  'Avicii Waiting For Love',
  'Swedish House Mafia Don’t You Worry Child',
  'Swedish House Mafia Save The World',
  'Swedish House Mafia Greyhound',
  'Axwell Ingrosso More Than You Know',
  'Alesso Heroes',
  'Galantis Runaway U & I',
  'Robyn Dancing On My Own',
  'Robyn With Every Heartbeat',
  'The Cardigans Lovefool',
  'The Cardigans My Favourite Game',
  'The Cardigans Erase Rewind',
  'Tove Lo Habits Stay High',
  'Tove Lo Talking Body',
  'Zara Larsson Lush Life',
  'Zara Larsson Never Forget You',
  'Zara Larsson Symphony',
  'Icona Pop I Love It',
  'Icona Pop All Night',
  'Neneh Cherry Buffalo Stance',
  'Neneh Cherry 7 Seconds',
  'Lykke Li I Follow Rivers',
  'First Aid Kit My Silver Lining',
  'First Aid Kit Emmylou',
  'Mando Diao Dance With Somebody',
  'Miike Snow Genghis Khan',
  'Little Dragon Twice',
  'Peter Bjorn and John Young Folks',
  'Caesars Jerk It Out',
  'Eagle-Eye Cherry Save Tonight',
  'Eagle-Eye Cherry Falling In Love Again',
  'The Hives Hate To Say I Told You So',
  'The Hives Tick Tick Boom',
  'Rednex Cotton Eye Joe',
  'Dr Alban Its My Life',
  'Basshunter Boten Anna',
  'E-Type This Is The Way',
  'Alcazar Crying At The Discoteque',
  'September Cry For You',
  'Loreen Euphoria',
  'Loreen Tattoo',
  'Måns Zelmerlöw Heroes',
  'Tove Styrke Say My Name',
  'Seinabo Sey Younger',
  'Benjamin Ingrosso Dance You Off',
  'Sabaton Primo Victoria',
  'In Flames Take This Life',
  'Ghost Square Hammer',
];

const EN_SUEDOIS: string[] = [
  'Håkan Hellström Känn Ingen Sorg För Mig Göteborg',
  'Håkan Hellström Kär i en ängel',
  'Håkan Hellström Det kommer aldrig va över för mig',
  'Veronica Maggio Jag kommer',
  'Veronica Maggio Välkommen in',
  'Veronica Maggio Måndagsbarn',
  'Veronica Maggio Sergels torg',
  'Kent Dom andra',
  'Kent 747',
  'Kent Utan dina andetag',
  'Kent Musik non stop',
  'Laleh Some Die Young',
  'Laleh Goliat',
  'Gyllene Tider Sommartider',
  'Gyllene Tider Flickan i en Cole Porter-sång',
  'Gyllene Tider Kung av sand',
  'Tomas Ledin Sommaren är kort',
  'Tomas Ledin Du kan lita på mej',
  'Carola Fångad av en stormvind',
  'Cornelis Vreeswijk Somliga går med trasiga skor',
  'Bo Kaspers Orkester Hon är så söt',
  'Lars Winnerbäck Elegi',
  'Lars Winnerbäck Sämre än du',
  'Magnus Uggla Jag mår illa',
  'Magnus Uggla Varning på stan',
  'Vikingarna Djingis Khan',
  'Markoolio Vi drar till fjällen',
  'Timbuktu Alla vill till himmelen men ingen vill dö',
  'Petter Logiskt',
  'Molly Sandén Som du vill',
  'Ulf Lundell Öppna landskap',
  'Håkan Hellström Du är snart där',
  'Veronica Maggio Hela huset',
  'Miss Li Komplicerad',
  'Norlie & KKV Fy fan',
  'Danny Saucedo Tokyo',
  'Zara Larsson Uncover',
  'Darin Mamma Mia',
];

const DEFINITIONS = [
  {
    slug: 'official-pl-suede-tubes',
    nom: 'Suède 🇸🇪',
    nomEn: 'Sweden 🇸🇪',
    sousTitre: 'ABBA, Roxette, Avicii, Robyn — la Suède que tout le monde connaît sans le savoir',
    sousTitreEn: 'ABBA, Roxette, Avicii, Robyn — Sweden you already know',
    requetes: EN_ANGLAIS,
    difficulte: 'EASY' as const,
  },
  {
    slug: 'official-pl-suede-en-suedois',
    nom: 'Suède — en suédois 🇸🇪',
    nomEn: 'Sweden — sung in Swedish 🇸🇪',
    sousTitre: 'Håkan Hellström, Kent, Veronica Maggio — pour un public suédois',
    sousTitreEn: 'Håkan Hellström, Kent, Veronica Maggio — for a Swedish crowd',
    requetes: EN_SUEDOIS,
    difficulte: 'EXPERT' as const,
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
    for (const r of retenus.slice(0, 12))
      console.log(`   ${r.artist} — ${r.title} (${r.year ?? '?'})`);
    if (retenus.length > 12) console.log(`   … et ${retenus.length - 12} autres`);
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
            difficulty: def.difficulte,
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
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
