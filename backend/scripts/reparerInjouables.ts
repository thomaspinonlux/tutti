/**
 * scripts/reparerInjouables.ts — RÉPARER au lieu d'ÉCARTER.
 *
 * POURQUOI CE SCRIPT EXISTE
 * -------------------------
 * `verifierCatalogueApple.ts` fait un travail de contrôleur : il constate
 * qu'un `apple_music_id` ne joue pas le bon morceau dans la boutique FR, et
 * il met la ligne de côté (`is_playable = false`). Le lancement d'une manche
 * saute ces lignes (`officialPlaylistLaunch.ts`, filtre `is_playable === false`
 * et « pas d'id pour la source active → skip ») : la soirée n'est donc jamais
 * bloquée, mais le morceau disparaît du jeu. Sur « Années 2010 », 13 titres
 * connus manquaient ainsi à l'appel.
 *
 * Ce script fait le travail inverse : pour chaque ligne écartée ou sans
 * identifiant, il DEMANDE À LA BOUTIQUE FR le bon enregistrement, par
 * recherche texte sur « artiste titre », et n'accepte un candidat que s'il
 * passe exactement les mêmes contrôles que le vérificateur (même œuvre, même
 * artiste, durée jouable, album non piégé). Si un candidat convient, il
 * remplace l'identifiant et remet la ligne en jeu. Sinon il ne touche à rien
 * et la ligne part dans le rapport.
 *
 * IL NE DEVINE RIEN : un remplacement n'a lieu que si le candidat satisfait
 * `memeOeuvre` ET `memeArtiste` (fichier `src/lib/comparaisonApple.ts`, partagé avec
 * le vérificateur pour que les deux jugent à l'identique).
 *
 * LE CAS DES PLAYLISTS « DEVINE L'ŒUVRE »
 * ---------------------------------------
 * Toutes les playlists de génériques, de musiques de film et de jeux vidéo
 * sont en `guess_mode = 'work'` : la réponse à trouver est le FILM, la SÉRIE
 * ou le JEU, pas l'interprète. Or Apple Music FR ne porte souvent qu'un
 * ré-enregistrement (le City of Prague Philharmonic Orchestra pour « Back to
 * the Future », 8-Bit Arcade pour Metroid) : le test sur l'artiste refusait
 * tout, et 171 lignes restaient sans identifiant — donc absentes du jeu,
 * puisque le lancement saute une ligne sans identifiant pour la source active.
 *
 * Avec `--mode-oeuvre`, le test sur l'artiste est abandonné et remplacé par un
 * refus des versions détournées (remix, 8-bit, boîte à musique, berceuse,
 * arrangement pour piano) : sur une manche « devine l'œuvre », un
 * ré-enregistrement orchestral se reconnaît, un remix trap ne se reconnaît pas.
 *
 * Usage :
 *   pnpm tsx scripts/reparerInjouables.ts --dry-run
 *   pnpm tsx scripts/reparerInjouables.ts
 *   pnpm tsx scripts/reparerInjouables.ts --json=rapport.json
 *   pnpm tsx scripts/reparerInjouables.ts --limite=50
 *   pnpm tsx scripts/reparerInjouables.ts --mode-oeuvre   # playlists guess_mode=work
 *
 * Env requis : DATABASE_URL + les clés Apple Music (recherche catalogue).
 */

import { writeFileSync } from 'node:fs';
import 'dotenv/config';
import { AppleMusicProvider } from '../src/music/apple/AppleMusicProvider.js';
import { prisma } from '../src/lib/prisma.js';
import {
  ALBUM_PIEGE,
  inclusDans,
  memeArtiste,
  memeOeuvre,
  mots,
  presqueLeMemeTexte,
} from '../src/lib/comparaisonApple.js';

const args = process.argv.slice(2);
const drapeau = (n: string): boolean => args.includes(`--${n}`);
const option = (n: string): string | undefined => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : undefined;
};

const SANS_ECRITURE = drapeau('dry-run');
const SORTIE_JSON = option('json');
const LIMITE = option('limite') ? Number.parseInt(option('limite')!, 10) : undefined;
/** Playlists « devine l'œuvre » : l'interprète n'est pas la réponse. */
const MODE_OEUVRE = drapeau('mode-oeuvre');

/**
 * Versions qui ne se reconnaissent PAS, même quand on cherche l'œuvre et non
 * l'interprète. Un ré-enregistrement orchestral de « Retour vers le futur »
 * reste le thème de Retour vers le futur ; un remix trap d'Among Us, une
 * version boîte à musique ou un arrangement berceuse, non.
 */
const VERSION_DETOURNEE =
  /remix|8\s*-?\s*bit|chiptune|lo\s*-?\s*fi|jazz version|music box|bo[iî]te [aà] musique|lullab|berceuse|felt piano|arr\.? for piano|piano (arrangement|rendition|version)|a cappella|acoustic|metal version|epic version|cover/i;

/**
 * Marque d'une source légitime pour une œuvre : la bande originale elle-même,
 * ou une édition qui dit de quel film / série / jeu elle vient.
 *
 * Sans ce garde-fou, l'essai à blanc du 09/10 proposait « PING PONG » de
 * Tiakola pour le thème de Pong, « I Get Lost (Main Title) » d'Eric Clapton
 * pour le générique de Lost, et « Peaceful Sleep » pour « Lisa » de NieR.
 * Chercher l'œuvre sans vérifier la source, c'est remplacer une erreur par
 * une autre.
 */
/**
 * Mots qui ne désignent aucune œuvre en particulier. « Theme », « Main
 * Title », « Générique » : s'ils sont seuls, tout correspond à tout.
 *
 * L'essai à blanc du 09/10 proposait « Theme (From "American Beauty") » pour
 * le générique d'Urgences, et « Peaceful Sleep (From "Nier Automata") » pour
 * « Lisa » de NieR : dans les deux cas le mot distinctif de NOTRE titre
 * (« ER », « Lisa ») était absent du candidat. On l'exige désormais.
 */
const MOTS_CREUX = new Set([
  'theme',
  'themes',
  'title',
  'titles',
  'main',
  'opening',
  'ending',
  'credits',
  'intro',
  'generique',
  'generiques',
  'soundtrack',
  'ost',
  'song',
  'musique',
  'music',
  'bande',
  'originale',
  'original',
  'version',
  'from',
]);

const SOURCE_LEGITIME =
  /original (motion picture |television (series )?|game |video game |)sound ?track|bande[-\s]originale|\bost\b|\(from ["«\u201c]|\(de ["«\u201c]|\(extrait d/i;

/** Bornes de durée acceptables pour un blind test (mêmes que le vérificateur). */
const DUREE_MIN_S = 60;
/** Pause entre deux recherches : l'API catalogue n'aime pas les rafales. */
const PAUSE_MS = 120;

interface Ligne {
  id: string;
  title: string;
  artist: string;
  apple_music_id: string | null;
  playability_reason: string | null;
  playlist: { slug: string };
}

interface Issue {
  slug: string;
  libelle: string;
  motifInitial: string | null;
  verdict: 'repare' | 'echec';
  ancienId: string | null;
  nouvelId?: string;
  detail: string;
}

async function main(): Promise<void> {
  const lignes = (await prisma.officialPlaylistTrack.findMany({
    where: {
      ...(MODE_OEUVRE
        ? { playlist: { guess_mode: 'work' } }
        : { NOT: { playlist: { guess_mode: 'work' } } }),
      OR: [
        {
          is_playable: false,
          NOT: { playability_reason: { startsWith: 'hors-sujet' } },
          // `original_absent_store_fr` = décision relue : l'original n'est pas
          // dans la boutique FR. Inutile de le rechercher à chaque passage.
          playability_reason: { not: 'original_absent_store_fr' },
        },
        { apple_music_id: null },
      ],
    },
    select: {
      id: true,
      title: true,
      artist: true,
      apple_music_id: true,
      playability_reason: true,
      playlist: { select: { slug: true } },
    },
    orderBy: [{ playlist_id: 'asc' }, { position: 'asc' }],
    ...(LIMITE ? { take: LIMITE } : {}),
  })) as Ligne[];

  console.info(
    `[Réparation] ${lignes.length} ligne(s) hors jeu à retrouver dans la boutique FR` +
      (SANS_ECRITURE ? ' — SANS ÉCRITURE' : ''),
  );
  if (lignes.length === 0) {
    await prisma.$disconnect();
    return;
  }

  const apple = new AppleMusicProvider('fr');
  const issues: Issue[] = [];
  let repares = 0;

  for (let i = 0; i < lignes.length; i += 1) {
    const l = lignes[i]!;
    const libelle = `${l.title} — ${l.artist}`;
    if (i > 0 && i % 25 === 0) console.info(`[Réparation] ${i}/${lignes.length}…`);

    let candidats: Awaited<ReturnType<AppleMusicProvider['search']>> = [];
    try {
      // En mode œuvre, le champ artiste vaut souvent « Bande originale » :
      // l'ajouter à la requête ne fait que brouiller la recherche.
      const requete = MODE_OEUVRE ? l.title : `${l.artist} ${l.title}`;
      candidats = await apple.search(requete, { limit: 10 });
    } catch (err) {
      issues.push({
        slug: l.playlist.slug,
        libelle,
        motifInitial: l.playability_reason,
        verdict: 'echec',
        ancienId: l.apple_music_id,
        detail: `recherche impossible : ${(err as Error).message}`,
      });
      continue;
    }
    await new Promise((r) => setTimeout(r, PAUSE_MS));

    // Un candidat n'est retenu que s'il passe les contrôles du vérificateur.
    const bon = candidats.find((c) => {
      const titreOk = memeOeuvre(l.title, c.title) || presqueLeMemeTexte(l.title, c.title);
      if (!titreOk) return false;
      if (MODE_OEUVRE) {
        // L'interprète n'est pas la réponse, mais la SOURCE doit rester
        // crédible : soit le compositeur / la distribution attendus, soit une
        // édition qui se présente comme la bande originale de l'œuvre.
        const sourceOk =
          memeArtiste(l.artist, c.artist, c.title) ||
          SOURCE_LEGITIME.test(`${c.title} ${c.album ?? ''}`);
        if (!sourceOk) return false;
        // Le ou les mots qui DÉSIGNENT l'œuvre doivent se retrouver chez le
        // candidat, titre ou album. Sans cela « Theme » correspond à tout.
        const significatifs = mots(l.title).filter((m) => !MOTS_CREUX.has(m));
        if (
          significatifs.length > 0 &&
          !inclusDans(significatifs, mots(`${c.title} ${c.album ?? ''}`))
        ) {
          return false;
        }
        // Une version détournée ne se reconnaît pas, même pour l'œuvre.
        if (VERSION_DETOURNEE.test(`${c.title} ${c.album ?? ''} ${c.artist}`)) return false;
      } else if (!memeArtiste(l.artist, c.artist, c.title)) {
        return false;
      }
      if (ALBUM_PIEGE.test(c.album ?? '')) return false;
      const dureeS = Math.round((c.duration_ms ?? 0) / 1000);
      if (dureeS > 0 && dureeS < DUREE_MIN_S) return false;
      return Boolean(c.provider_track_id);
    });

    if (!bon) {
      issues.push({
        slug: l.playlist.slug,
        libelle,
        motifInitial: l.playability_reason,
        verdict: 'echec',
        ancienId: l.apple_music_id,
        detail:
          candidats.length === 0
            ? 'aucun résultat dans la boutique FR'
            : `aucun candidat conforme (ex. « ${candidats[0]!.title} » — ${candidats[0]!.artist})`,
      });
      continue;
    }

    issues.push({
      slug: l.playlist.slug,
      libelle,
      motifInitial: l.playability_reason,
      verdict: 'repare',
      ancienId: l.apple_music_id,
      nouvelId: bon.provider_track_id,
      detail: `→ « ${bon.title} » — ${bon.artist}`,
    });
    repares += 1;

    if (!SANS_ECRITURE) {
      await prisma.officialPlaylistTrack.update({
        where: { id: l.id },
        data: {
          apple_music_id: bon.provider_track_id,
          cover_url: bon.cover_url ?? undefined,
          is_playable: true,
          playability_reason: null,
          playability_checked_at: new Date(),
        },
      });
    }
  }

  const echecs = issues.filter((x) => x.verdict === 'echec');
  console.info(
    `[Réparation] ${repares} ligne(s) remise(s) en jeu, ${echecs.length} sans solution.`,
  );

  const parMotif = new Map<string, number>();
  for (const e of echecs) {
    const k = e.motifInitial ?? 'sans_identifiant';
    parMotif.set(k, (parMotif.get(k) ?? 0) + 1);
  }
  for (const [m, n] of [...parMotif].sort((a, b) => b[1] - a[1])) {
    console.info(`             ${String(n).padStart(5)}  ${m}`);
  }

  if (SORTIE_JSON) {
    writeFileSync(SORTIE_JSON, JSON.stringify(issues, null, 1));
    console.info(`[Réparation] rapport détaillé → ${SORTIE_JSON}`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[Réparation] échec :', err);
  await prisma.$disconnect();
  process.exit(1);
});
