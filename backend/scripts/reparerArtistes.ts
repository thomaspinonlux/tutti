/**
 * scripts/reparerArtistes.ts — RETROUVER L'ORIGINAL quand l'identifiant joue
 * une reprise.
 *
 * POURQUOI CE SCRIPT EXISTE
 * -------------------------
 * `verifierCatalogueApple.ts` ne condamne plus un écart d'artiste : dans notre
 * catalogue le champ artiste vaut souvent « Comptine », « Disney » ou
 * « Bande originale », Apple rend alors l'interprète réel, et l'écart est
 * mécanique. Ces lignes partent donc dans un rapport « à relire » (239 au
 * passage du 09/10) au lieu d'être écartées — un bon morceau écarté coûte plus
 * cher qu'un morceau douteux laissé en jeu.
 *
 * Mais la relecture de ce rapport montre une poignée de VRAIS cas, où
 * l'identifiant joue une reprise à la place de l'original :
 *
 *   « Vivo per lei » d'Hélène Ségara      → Apple joue une reprise russe
 *   « Laisse tomber les filles », France Gall → Apple joue Fabienne Delsol
 *   « Running Up That Hill », Kate Bush   → Apple joue Kim Petras
 *   « Rockin' Around the Christmas Tree », Brenda Lee → Apple joue « Roy M »
 *
 * Ce script reprend ce rapport et, pour chaque ligne, cherche dans la boutique
 * FR un enregistrement du MÊME titre par l'artiste ATTENDU. Le test sur
 * l'artiste est ici VOLONTAIREMENT STRICT (l'inverse du vérificateur) : on ne
 * remplace que si le nom stocké se retrouve dans le nom rendu par Apple. Donc
 * « Pink » face à « P!nk » ne trouve rien et la ligne reste telle quelle —
 * c'est le résultat voulu, puisqu'elle était déjà bonne.
 *
 * IL NE SUPPRIME RIEN, IL NE DEVINE RIEN. Pas de candidat strict = pas de
 * changement, et la ligne part dans le rapport.
 *
 * Usage :
 *   pnpm tsx scripts/reparerArtistes.ts --rapport=/tmp/verif-apple-0910.json --dry-run
 *   pnpm tsx scripts/reparerArtistes.ts --rapport=/tmp/verif-apple-0910.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import 'dotenv/config';
import { AppleMusicProvider } from '../src/music/apple/AppleMusicProvider.js';
import { prisma } from '../src/lib/prisma.js';
import {
  ALBUM_PIEGE,
  inclusDans,
  memeOeuvre,
  mots,
  presqueLeMemeTexte,
} from './_comparaisonApple.js';

const args = process.argv.slice(2);
const drapeau = (n: string): boolean => args.includes(`--${n}`);
const option = (n: string): string | undefined => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : undefined;
};

const SANS_ECRITURE = drapeau('dry-run');
const RAPPORT = option('rapport');
const SORTIE_JSON = option('json');
const DUREE_MIN_S = 60;
const PAUSE_MS = 120;

interface LigneRapport {
  id: string;
  slug: string;
  libelle: string;
  appleId: string;
  detail?: string;
}

async function main(): Promise<void> {
  if (!RAPPORT) {
    console.error('[RéparArtistes] --rapport=<fichier json du vérificateur> est requis.');
    process.exit(1);
  }
  const brut = JSON.parse(readFileSync(RAPPORT, 'utf8')) as { aRelire?: LigneRapport[] };
  const aRelire = brut.aRelire ?? [];
  console.info(
    `[RéparArtistes] ${aRelire.length} ligne(s) signalée(s) « artiste différent »` +
      (SANS_ECRITURE ? ' — SANS ÉCRITURE' : ''),
  );
  if (aRelire.length === 0) {
    await prisma.$disconnect();
    return;
  }

  const apple = new AppleMusicProvider('fr');
  const journal: Array<Record<string, unknown>> = [];
  let remplaces = 0;

  for (let i = 0; i < aRelire.length; i += 1) {
    const r = aRelire[i]!;
    if (i > 0 && i % 25 === 0) console.info(`[RéparArtistes] ${i}/${aRelire.length}…`);

    const ligne = await prisma.officialPlaylistTrack.findUnique({
      where: { id: r.id },
      select: { id: true, title: true, artist: true, apple_music_id: true },
    });
    if (!ligne) continue;

    // L'artiste attendu est-il un libellé générique ? Alors l'écart est normal
    // (Apple rend l'interprète réel) et il n'y a rien à réparer.
    const GENERIQUE =
      /^(comptine|comptines|bande originale|bo|disney|pixar|generique|génerique|générique|cast|chorale|anonyme|traditionnel|divers|various)/i;
    if (GENERIQUE.test(ligne.artist ?? '')) {
      journal.push({
        slug: r.slug,
        libelle: r.libelle,
        verdict: 'ignore',
        detail: 'artiste generique',
      });
      continue;
    }

    let candidats: Awaited<ReturnType<AppleMusicProvider['search']>> = [];
    try {
      candidats = await apple.search(`${ligne.artist} ${ligne.title}`, { limit: 10 });
    } catch (err) {
      journal.push({
        slug: r.slug,
        libelle: r.libelle,
        verdict: 'echec',
        detail: (err as Error).message,
      });
      continue;
    }
    await new Promise((res) => setTimeout(res, PAUSE_MS));

    // Test STRICT sur l'artiste : le nom stocké doit se retrouver dans le nom
    // rendu par Apple (ordre indifférent, invité toléré), sinon on ne touche
    // à rien.
    const bon = candidats.find((c) => {
      const titreOk = memeOeuvre(ligne.title, c.title) || presqueLeMemeTexte(ligne.title, c.title);
      if (!titreOk) return false;
      if (!inclusDans(mots(ligne.artist), mots(c.artist))) return false;
      if (ALBUM_PIEGE.test(c.album ?? '')) return false;
      const dureeS = Math.round((c.duration_ms ?? 0) / 1000);
      if (dureeS > 0 && dureeS < DUREE_MIN_S) return false;
      return Boolean(c.provider_track_id);
    });

    if (!bon) {
      journal.push({
        slug: r.slug,
        libelle: r.libelle,
        verdict: 'inchange',
        detail: r.detail ?? '',
      });
      continue;
    }
    if (bon.provider_track_id === ligne.apple_music_id) {
      journal.push({ slug: r.slug, libelle: r.libelle, verdict: 'deja_bon', detail: bon.artist });
      continue;
    }

    journal.push({
      slug: r.slug,
      libelle: r.libelle,
      verdict: 'remplace',
      ancienId: ligne.apple_music_id,
      nouvelId: bon.provider_track_id,
      detail: `${r.detail ?? ''} → « ${bon.title} » — ${bon.artist}`,
    });
    remplaces += 1;

    if (!SANS_ECRITURE) {
      await prisma.officialPlaylistTrack.update({
        where: { id: ligne.id },
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

  const compte = new Map<string, number>();
  for (const j of journal) {
    const v = String(j.verdict);
    compte.set(v, (compte.get(v) ?? 0) + 1);
  }
  console.info(`[RéparArtistes] ${remplaces} identifiant(s) remplacé(s).`);
  for (const [v, n] of [...compte].sort((a, b) => b[1] - a[1])) {
    console.info(`             ${String(n).padStart(5)}  ${v}`);
  }
  for (const j of journal.filter((x) => x.verdict === 'remplace')) {
    console.info(`  ${j.slug} | ${j.libelle} | ${j.detail}`);
  }

  if (SORTIE_JSON) {
    writeFileSync(SORTIE_JSON, JSON.stringify(journal, null, 1));
    console.info(`[RéparArtistes] rapport → ${SORTIE_JSON}`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[RéparArtistes] échec :', err);
  await prisma.$disconnect();
  process.exit(1);
});
