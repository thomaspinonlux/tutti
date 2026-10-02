/**
 * nettoyerPlaylists.ts — nettoyage du catalogue, avec marche arrière.
 *
 * 1. retire des playlists annoncées 🇫🇷 les artistes étrangers anglophones
 * 2. retire les doublons (même chanson deux fois dans une même playlist)
 * 3. retire les morceaux qu'Apple Music ne sait pas jouer
 * 4. déplace les morceaux hors décennie vers la playlist de leur décennie
 *
 * Tout est écrit dans un fichier de reprise avant la moindre suppression.
 * Les copies des espaces de travail sont nettoyées en même temps, sinon le
 * catalogue serait propre et les parties, non.
 *
 *   node --import tsx/esm scripts/nettoyerPlaylists.ts            # aperçu
 *   node --import tsx/esm scripts/nettoyerPlaylists.ts --ecrire   # applique
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { prisma } from '../src/lib/prisma.js';

const ECRIRE = process.argv.includes('--ecrire');

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
/** Étrangers non anglophones : Thomas tranche, on n'y touche pas. */
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
const ETRANGERS_EN_PLUS = new Set(['kadavar', 'nada surf']);

/** Apple a vraiment essayé et n'a pas pu : ces verdicts-là font foi. */
const INJOUABLE_APPLE = new Set([
  'apple_duree_trop_courte',
  'apple_non_streamable_fr',
  'apple_version_non_originale',
  'apple_joue_un_autre_morceau',
  'apple_id_absent_store_fr',
]);

const slug = (v: string): string =>
  (v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]/g, '');
const sansSuffixe = (t: string): string => slug((t ?? '').replace(/\s*[([].*$/, ''));

const DECENNIES: Array<[RegExp, number, number, string]> = [
  [/Années 60/, 1960, 1969, 'Années 60'],
  [/Années 70/, 1970, 1979, 'Années 70'],
  [/Années 80/, 1980, 1989, 'Années 80'],
  [/Années 90/, 1990, 1999, 'Années 90'],
  [/Années 2000/, 2000, 2009, 'Années 2000'],
  [/Années 2010/, 2010, 2019, 'Années 2010'],
  [/Années 2020/, 2020, 2100, 'Années 2020'],
];
/**
 * Deux écarts assumés, décidés par Thomas le 02/10/2026.
 *
 * TOLERANCE_DEBUT : une playlist « Années 70 » garde les classiques rock de
 * 1964-1969 (Whole Lotta Love, Born to Be Wild, A Whiter Shade of Pale…) —
 * pour un joueur ce sont des titres « 70s ». La tolérance ne vaut que pour
 * décider si un morceau est à sa place, jamais pour choisir sa destination.
 *
 * HORS_REGLE_DECENNIE : dans les playlists de bandes originales, l'année
 * stockée est celle de la chanson, pas celle du film (« All Star » 1999 est
 * bien dans les BO des années 2000 — c'est Shrek, 2001).
 */
const TOLERANCE_DEBUT: Record<string, number> = { 'Années 70': 1964 };
const HORS_REGLE_DECENNIE = /Bandes originales|Musiques? de [Ff]ilm/;

const decennieDe = (an: number): string | null => {
  const d = DECENNIES.find(([, min, max]) => an >= min && an <= max);
  return d ? d[3] : null;
};

async function main(): Promise<void> {
  const playlists = await prisma.officialPlaylist.findMany({ select: { id: true, name_fr: true } });
  const nom = new Map(playlists.map((p) => [p.id, p.name_fr]));
  const parNom = new Map(playlists.map((p) => [p.name_fr, p.id]));
  const pistes = await prisma.officialPlaylistTrack.findMany();

  const internationaux = new Set<string>();
  for (const t of pistes) {
    const n = nom.get(t.playlist_id) ?? '';
    if (n.includes('🌍') && !n.includes('🇫🇷'))
      internationaux.add((t.artist ?? '').trim().toLowerCase());
  }
  const estFR = (n: string): boolean => n.includes('🇫🇷') && !n.includes('🌍');

  const aRetirer = new Map<string, { piste: (typeof pistes)[number]; motif: string }>();

  // 1 — étrangers dans une playlist française
  for (const t of pistes) {
    const n = nom.get(t.playlist_id) ?? '';
    if (!estFR(n)) continue;
    const a = (t.artist ?? '').trim().toLowerCase();
    if (FRANCOPHONES.has(a) || A_DECIDER.has(a)) continue;
    if (internationaux.has(a) || ETRANGERS_EN_PLUS.has(a)) {
      aRetirer.set(t.id, { piste: t, motif: 'artiste étranger dans une playlist française' });
    }
  }

  // 2 — doublons : on garde la première occurrence
  const paquets = new Map<string, typeof pistes>();
  for (const t of pistes) {
    const k = `${t.playlist_id}|${slug(t.artist ?? '')}|${sansSuffixe(t.title ?? '')}`;
    const l = paquets.get(k) ?? [];
    l.push(t);
    paquets.set(k, l);
  }
  for (const [, l] of paquets) {
    if (l.length < 2) continue;
    // on garde le titre le plus complet : c'est celui qui porte le sous-titre
    const trie = [...l].sort((a, b) => (b.title ?? '').length - (a.title ?? '').length);
    for (const t of trie.slice(1)) {
      if (!aRetirer.has(t.id)) aRetirer.set(t.id, { piste: t, motif: 'doublon' });
    }
  }

  // 3 — injouables constatés par Apple
  for (const t of pistes) {
    if (t.is_playable === false && INJOUABLE_APPLE.has(t.playability_reason ?? '')) {
      if (!aRetirer.has(t.id))
        aRetirer.set(t.id, { piste: t, motif: `injouable (${t.playability_reason})` });
    }
  }

  // 4 — hors décennie : on déplace quand la bonne playlist existe
  const aDeplacer: Array<{
    piste: (typeof pistes)[number];
    de: string;
    vers: string;
    versId: string;
  }> = [];
  const sansDestination: Array<{ piste: (typeof pistes)[number]; de: string }> = [];
  for (const t of pistes) {
    if (aRetirer.has(t.id) || t.year == null) continue;
    const n = nom.get(t.playlist_id) ?? '';
    if (HORS_REGLE_DECENNIE.test(n)) continue;
    const d = DECENNIES.find(([r]) => r.test(n));
    if (!d) continue;
    if (t.year >= (TOLERANCE_DEBUT[d[3]] ?? d[1]) && t.year <= d[2]) continue;
    const bonne = decennieDe(t.year);
    if (!bonne) {
      sansDestination.push({ piste: t, de: n });
      continue;
    }
    const cible = n.replace(d[3], bonne);
    const cibleId = parNom.get(cible);
    if (!cibleId || cibleId === t.playlist_id) {
      sansDestination.push({ piste: t, de: n });
      continue;
    }
    const dejaLa = pistes.some(
      (p) =>
        p.playlist_id === cibleId &&
        slug(p.artist ?? '') === slug(t.artist ?? '') &&
        sansSuffixe(p.title ?? '') === sansSuffixe(t.title ?? ''),
    );
    if (dejaLa) {
      aRetirer.set(t.id, { piste: t, motif: `hors décennie, déjà présent dans « ${cible} »` });
      continue;
    }
    aDeplacer.push({ piste: t, de: n, vers: cible, versId: cibleId });
  }

  const reprise = {
    date: new Date().toISOString(),
    retires: [...aRetirer.values()].map(({ piste, motif }) => ({
      ...piste,
      _motif: motif,
      _playlist: nom.get(piste.playlist_id),
    })),
    deplaces: aDeplacer.map((d) => ({
      id: d.piste.id,
      de: d.de,
      vers: d.vers,
      artiste: d.piste.artist,
      titre: d.piste.title,
      annee: d.piste.year,
    })),
  };
  const chemin = `../Claude outputs/nettoyage-playlists-reprise-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(chemin, JSON.stringify(reprise, null, 1));

  console.log(`à retirer   : ${aRetirer.size}`);
  console.log(`à déplacer  : ${aDeplacer.length}`);
  console.log(`sans destination (on ne touche pas) : ${sansDestination.length}`);
  console.log(`fichier de reprise : ${chemin}`);

  if (!ECRIRE) {
    console.log('\naperçu seulement — relancer avec --ecrire');
    await prisma.$disconnect();
    return;
  }

  // ── catalogue officiel ───────────────────────────────────────────────────
  await prisma.officialPlaylistTrack.deleteMany({ where: { id: { in: [...aRetirer.keys()] } } });
  // Le déplacement doit prendre une position libre : la playlist d'arrivée a
  // déjà quelqu'un à l'ancienne place.
  const dernierePosition = new Map<string, number>();
  for (const p of pistes) {
    const v = dernierePosition.get(p.playlist_id) ?? 0;
    if ((p.position ?? 0) > v) dernierePosition.set(p.playlist_id, p.position ?? 0);
  }
  for (const d of aDeplacer) {
    const suivante = (dernierePosition.get(d.versId) ?? 0) + 1;
    dernierePosition.set(d.versId, suivante);
    await prisma.officialPlaylistTrack.update({
      where: { id: d.piste.id },
      data: { playlist_id: d.versId, position: suivante },
    });
  }

  // ── copies des espaces de travail ────────────────────────────────────────
  // Elles sont rattachées par le NOM de la playlist et la paire artiste+titre.
  const copies = await prisma.playlist.findMany({
    where: { is_official_tutti: true },
    select: { id: true, name: true },
  });
  const copiesParNom = new Map<string, string[]>();
  for (const c of copies) copiesParNom.set(c.name, [...(copiesParNom.get(c.name) ?? []), c.id]);

  let retiresCopies = 0;
  for (const { piste } of aRetirer.values()) {
    const ids = copiesParNom.get(nom.get(piste.playlist_id) ?? '') ?? [];
    if (ids.length === 0) continue;
    const liens = await prisma.playlistTrack.findMany({
      where: { playlist_id: { in: ids } },
      select: {
        id: true,
        track: { select: { canonical_title: true, artist: { select: { canonical_name: true } } } },
      },
    });
    const cibles = liens
      .filter(
        (l) =>
          slug(l.track.artist.canonical_name) === slug(piste.artist ?? '') &&
          sansSuffixe(l.track.canonical_title) === sansSuffixe(piste.title ?? ''),
      )
      .map((l) => l.id);
    if (cibles.length > 0) {
      const r = await prisma.playlistTrack.deleteMany({ where: { id: { in: cibles } } });
      retiresCopies += r.count;
    }
  }
  console.log(`retirés des copies des espaces : ${retiresCopies}`);
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
