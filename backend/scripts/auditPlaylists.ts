/**
 * auditPlaylists.ts — audit du catalogue officiel.
 *
 * Produit un CSV :
 *   - les morceaux étrangers tombés dans une playlist annoncée 🇫🇷
 *   - les doublons (même chanson deux fois dans une même playlist)
 *   - les années qui ne collent pas à la décennie annoncée
 *   - les morceaux injouables
 *
 * node --import tsx/esm scripts/auditPlaylists.ts > audit.csv
 */
import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';

/** Artistes francophones : ils restent, même quand ils chantent en anglais. */
const FRANCOPHONES = new Set([
  'aldebert & kids united nouvelle génération',
  'alexandra stréliski',
  'anne-marie david',
  'ariane moffatt',
  'au bonheur des dames',
  'aya nakamura',
  'beau dommage',
  'bigflo & oli',
  'black m & ?',
  'bob sinclar',
  'céline dion',
  'charlotte cardin',
  'corey hart',
  'dadju & tayc',
  'daft punk',
  'daft punk ft. pharrell williams',
  'dalida',
  'daniel bélanger',
  'dorothée',
  'éric lapointe',
  'france gall',
  'france gall & daniel balavoine',
  'fredericks goldman jones',
  'garou & céline dion',
  'gilles vigneault',
  'henri dès',
  'isabelle boulay',
  'jj lionel',
  'jean leloup',
  'joe dassin',
  'kaïn',
  'kids united',
  'klô pelgag',
  'koriass',
  'kungs',
  'la chicane',
  'les bb',
  'les charlots',
  'les colocs',
  'les cowboys fringants',
  'les enfoirés',
  'lynda lemay',
  'magic system',
  'manu chao',
  'marie myriam',
  'marie-mai',
  'mc solaar',
  'michel delpech',
  'mitsou',
  'nuance',
  'ofenbach',
  'offenbach',
  'petula clark',
  'phoenix',
  'plastic bertrand',
  'robert charlebois',
  'roch voisine',
  'serge gainsbourg & jane birkin',
  'simple plan',
  'steve waring',
  'zaho',
]);

/** Étrangers non anglophones : à toi de trancher, ils ont marché en France. */
const A_DECIDER = new Set([
  'demis roussos',
  'kaoma',
  'awilo longomba',
  'al bano & romina power',
  'andrea bocelli',
  'alvaro soler',
  'álvaro soler',
  'juanes',
  'chayanne',
  'sergio mendes',
  'carlinhos brown & dj dero',
  'anitta',
  'alexander rybak',
  'barbra streisand & yves montand',
]);

/** Repérés à la main : étrangers absents des playlists internationales. */
const ETRANGERS_SUPPLEMENTAIRES = new Set(['kadavar', 'nada surf']);

const csv = (v: unknown): string => {
  const s = String(v ?? '');
  return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const ligne = (...c: unknown[]): void => console.log(c.map(csv).join(';'));

const sansSuffixe = (t: string): string =>
  t
    .replace(/\s*[([].*$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
const cleArtiste = (a: string): string => a.toLowerCase().replace(/[^a-z0-9]/g, '');

async function main(): Promise<void> {
  const playlists = await prisma.officialPlaylist.findMany({
    select: { id: true, name_fr: true },
  });
  const pistes = await prisma.officialPlaylistTrack.findMany({
    select: {
      id: true,
      playlist_id: true,
      artist: true,
      title: true,
      year: true,
      is_playable: true,
    },
  });
  const nom = new Map(playlists.map((p) => [p.id, p.name_fr]));
  const estFR = (n: string): boolean => n.includes('🇫🇷') && !n.includes('🌍');

  // Artistes présents dans une playlist purement internationale.
  const internationaux = new Set<string>();
  for (const t of pistes) {
    const n = nom.get(t.playlist_id) ?? '';
    if (n.includes('🌍') && !n.includes('🇫🇷'))
      internationaux.add((t.artist ?? '').trim().toLowerCase());
  }

  ligne('categorie', 'playlist', 'artiste', 'titre', 'annee', 'detail');

  // 1. étrangers dans une playlist française
  for (const t of pistes) {
    const n = nom.get(t.playlist_id) ?? '';
    if (!estFR(n)) continue;
    const a = (t.artist ?? '').trim().toLowerCase();
    if (FRANCOPHONES.has(a)) continue;
    const suspect = internationaux.has(a) || ETRANGERS_SUPPLEMENTAIRES.has(a);
    if (!suspect) continue;
    ligne(
      A_DECIDER.has(a) ? 'A DECIDER (etranger non anglophone)' : 'A RETIRER (etranger anglophone)',
      n,
      t.artist,
      t.title,
      t.year ?? '',
      A_DECIDER.has(a)
        ? 'a marche en France, mais pas francophone'
        : 'playlist annoncee 100 % francaise',
    );
  }

  // 2. doublons
  const paquets = new Map<string, typeof pistes>();
  for (const t of pistes) {
    const k = `${t.playlist_id}|${cleArtiste(t.artist ?? '')}|${sansSuffixe(t.title ?? '')}`;
    const l = paquets.get(k) ?? [];
    l.push(t);
    paquets.set(k, l);
  }
  for (const [, l] of paquets) {
    if (l.length < 2) continue;
    const garde = l[0]!;
    for (const t of l.slice(1)) {
      ligne(
        'DOUBLON',
        nom.get(t.playlist_id) ?? '',
        t.artist,
        t.title,
        t.year ?? '',
        `deja present sous « ${garde.title} »`,
      );
    }
  }

  // 3. hors décennie
  //
  // Deux écarts assumés, décidés par Thomas le 02/10/2026 :
  //   - « Années 70 » accepte à partir de 1964 : les classiques rock de la fin
  //     des années 60 (Whole Lotta Love, Born to Be Wild, A Whiter Shade of
  //     Pale…) sont des titres « 70s » pour les joueurs, on les y laisse.
  //   - les playlists « Bandes originales » sont exclues : l'année stockée est
  //     celle de la chanson, pas celle du film (« All Star » 1999 est bien
  //     dans les BO des années 2000 — c'est Shrek, 2001).
  const HORS_REGLE_DECENNIE = /Bandes originales|Musiques? de [Ff]ilm/;
  const bornes: Array<[RegExp, number, number]> = [
    [/Années 60/, 1960, 1969],
    [/Années 70/, 1964, 1979],
    [/Années 80/, 1980, 1989],
    [/Années 90/, 1990, 1999],
    [/Années 2000/, 2000, 2009],
    [/Années 2010/, 2010, 2019],
    [/Années 2020/, 2020, 2100],
  ];
  for (const t of pistes) {
    const n = nom.get(t.playlist_id) ?? '';
    if (HORS_REGLE_DECENNIE.test(n)) continue;
    const b = bornes.find(([r]) => r.test(n));
    if (!b || t.year == null) continue;
    if (t.year < b[1] || t.year > b[2]) {
      ligne('HORS DECENNIE', n, t.artist, t.title, t.year, `attendu entre ${b[1]} et ${b[2]}`);
    }
  }

  // 4. injouables
  for (const t of pistes) {
    if (t.is_playable === false) {
      ligne(
        'INJOUABLE',
        nom.get(t.playlist_id) ?? '',
        t.artist,
        t.title,
        t.year ?? '',
        'ne se lance pas',
      );
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
