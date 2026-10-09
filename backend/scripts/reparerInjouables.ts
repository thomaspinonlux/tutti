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
 * `memeOeuvre` ET `memeArtiste` (fichier `_comparaisonApple.ts`, partagé avec
 * le vérificateur pour que les deux jugent à l'identique).
 *
 * Usage :
 *   pnpm tsx scripts/reparerInjouables.ts --dry-run
 *   pnpm tsx scripts/reparerInjouables.ts
 *   pnpm tsx scripts/reparerInjouables.ts --json=rapport.json
 *   pnpm tsx scripts/reparerInjouables.ts --limite=50
 *
 * Env requis : DATABASE_URL + les clés Apple Music (recherche catalogue).
 */

import { writeFileSync } from 'node:fs';
import 'dotenv/config';
import { AppleMusicProvider } from '../src/music/apple/AppleMusicProvider.js';
import { prisma } from '../src/lib/prisma.js';
import { ALBUM_PIEGE, memeArtiste, memeOeuvre, presqueLeMemeTexte } from './_comparaisonApple.js';

const args = process.argv.slice(2);
const drapeau = (n: string): boolean => args.includes(`--${n}`);
const option = (n: string): string | undefined => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : undefined;
};

const SANS_ECRITURE = drapeau('dry-run');
const SORTIE_JSON = option('json');
const LIMITE = option('limite') ? Number.parseInt(option('limite')!, 10) : undefined;

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
      candidats = await apple.search(`${l.artist} ${l.title}`, { limit: 10 });
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
      if (!memeArtiste(l.artist, c.artist, c.title)) return false;
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
