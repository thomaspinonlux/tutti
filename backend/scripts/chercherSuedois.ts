/**
 * chercherSuedois.ts — cherche dans la boutique Apple Music FR des titres
 * suédois absents du catalogue Tutti.
 *
 * Deux familles, qui n'ont pas du tout le même usage en blind test :
 *   ANGLAIS  — artistes suédois qui chantent en anglais. Reconnaissables par
 *              n'importe quelle salle française.
 *   SUEDOIS  — titres chantés en suédois. Ne marchent que devant un public
 *              suédois (ou pour une manche « deviner le pays »).
 */
import 'dotenv/config';
import { AppleMusicProvider } from '../src/music/apple/AppleMusicProvider.js';
import { prisma } from '../src/lib/prisma.js';

const slug = (v: string): string =>
  (v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]/g, '');
const sansSuffixe = (t: string): string => slug((t ?? '').replace(/\s*[([].*$/, ''));

const ANGLAIS: string[] = [
  'Robyn Dancing On My Own',
  'Robyn With Every Heartbeat',
  'The Cardigans My Favourite Game',
  'The Cardigans Erase Rewind',
  'Tove Lo Talking Body',
  'Tove Lo Stay High',
  'Neneh Cherry Buffalo Stance',
  'Neneh Cherry 7 Seconds',
  'Lykke Li I Follow Rivers',
  'First Aid Kit My Silver Lining',
  'First Aid Kit Emmylou',
  'Mando Diao Dance With Somebody',
  'Miike Snow Genghis Khan',
  'Little Dragon Twice',
  'Peter Bjorn and John Young Folks',
  'Avicii Hey Brother',
  'Avicii The Nights',
  'Swedish House Mafia Greyhound',
  'Axwell Ingrosso More Than You Know',
  'Alesso Heroes',
  'Galantis Runaway U & I',
  'Zara Larsson Lush Life',
  'Icona Pop All Night',
  'Ace of Base Beautiful Life',
  'Ace of Base Happy Nation',
  'Roxette Joyride',
  'Roxette Listen To Your Heart',
  'Europe Carrie',
  'ABBA Super Trouper',
  'ABBA Take A Chance On Me',
  'ABBA Chiquitita',
  'The Hives Tick Tick Boom',
  'Eagle-Eye Cherry Falling In Love Again',
  'Caesars Jerk It Out',
  'Jens Lekman',
  'Seinabo Sey Younger',
  'Tove Styrke Say My Name',
  'Benjamin Ingrosso Dance You Off',
  'Sabaton Primo Victoria',
  'In Flames Take This Life',
  'Ghost Square Hammer',
];

const SUEDOIS: string[] = [
  'Håkan Hellström Kär i en ängel',
  'Håkan Hellström Det kommer aldrig va över för mig',
  'Veronica Maggio Jag kommer',
  'Veronica Maggio Välkommen in',
  'Kent Dom andra',
  'Kent 747',
  'Kent Utan dina andetag',
  'Laleh Some Die Young',
  'Laleh Bada nakna',
  'Gyllene Tider Sommartider',
  'Gyllene Tider Flickan i en Cole Porter-sång',
  'Tomas Ledin Sommaren är kort',
  'Carola Fångad av en stormvind',
  'Molly Sandén Du',
  'Cornelis Vreeswijk Somliga går med trasiga skor',
  'Bo Kaspers Orkester Hon är så söt',
  'Lars Winnerbäck Elegi',
  'Magnus Uggla Jag mår illa',
  'Thorleifs',
  'Vikingarna',
  'Markoolio Vi drar till fjällen',
  'Rix FM',
  'Miss Li Bonnie & Clyde',
  'Timbuktu Alla vill till himmelen',
  'Petter Logiskt',
  'Håkan Hellström Känn ingen sorg för mig Göteborg',
];

async function main(): Promise<void> {
  const apple = new AppleMusicProvider('fr');

  const existants = new Set(
    (await prisma.officialPlaylistTrack.findMany({ select: { artist: true, title: true } })).map(
      (t) => `${slug(t.artist)}|${sansSuffixe(t.title)}`,
    ),
  );

  for (const [famille, requetes] of [
    ['CHANTÉ EN ANGLAIS', ANGLAIS],
    ['CHANTÉ EN SUÉDOIS', SUEDOIS],
  ] as const) {
    console.log(`\n========== ${famille} ==========`);
    for (const q of requetes) {
      try {
        const res = await apple.search(q, { limit: 1 });
        const t = res[0];
        if (!t) {
          console.log(`   ABSENT DE LA BOUTIQUE FR   « ${q} »`);
          continue;
        }
        const cle = `${slug(t.artist)}|${sansSuffixe(t.title)}`;
        const etat = existants.has(cle) ? 'DÉJÀ DANS TUTTI' : 'À AJOUTER      ';
        console.log(`   ${etat}  ${t.artist} — ${t.title}  [${t.provider_track_id}]`);
      } catch (err: unknown) {
        console.log(`   ERREUR  « ${q} » : ${(err as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, 120));
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
