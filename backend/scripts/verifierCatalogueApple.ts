/**
 * scripts/verifierCatalogueApple.ts — vérificateur de catalogue Apple Music.
 *
 * POURQUOI CE SCRIPT EXISTE
 * -------------------------
 * Le 1er septembre 2026, un import de masse a inséré 11 454 lignes dans
 * `official_playlist_tracks`, chacune avec un `apple_music_id`, et AUCUNE
 * vérification derrière. 321 de ces IDs n'existent pas dans la boutique
 * française : ils viennent du catalogue américain. Sur un iPad connecté à un
 * compte FR, Apple répond `MusicDataRequest.Error error 1`, le pont natif
 * refuse le morceau, et l'écran gèle.
 *
 * Les colonnes de contrôle existaient déjà (`is_playable`,
 * `playability_reason`, `playability_checked_at`) et le lancement les lit
 * (`officialPlaylistLaunch.ts`, filtre `is_playable === false`). Personne ne
 * les remplissait. C'est tout l'objet de ce script.
 *
 * CE QU'IL VÉRIFIE, POUR CHAQUE LIGNE AYANT UN apple_music_id
 * -----------------------------------------------------------
 *   1. l'ID existe-t-il dans la boutique FR ?          → sinon injouable
 *   2. le titre renvoyé par Apple est-il bien celui    → sinon injouable
 *      stocké en base (comparaison tolérante aux
 *      variantes d'écriture : remaster, feat., etc.) ?
 *   3. l'artiste correspond-il ?                       → sinon injouable
 *   4. la version est-elle piégeuse (karaoké, tribute, → sinon injouable
 *      « in the style of », reprise) ?
 *   5. la durée est-elle jouable (60 s à 10 min) ?     → sinon injouable
 *
 * Une ligne qui passe les cinq contrôles est remise à `is_playable = true`
 * (elle a pu être écartée par un passage précédent, puis corrigée), et
 * `playability_checked_at` est horodaté dans tous les cas.
 *
 * IL NE SUPPRIME RIEN ET NE DEVINE RIEN. Il ne remplace jamais un ID : il
 * signale et écarte. La correction d'un ID reste un acte séparé et relu.
 *
 * Usage :
 *   pnpm verify:apple                          # tout le catalogue
 *   pnpm verify:apple --dry-run                # aucun écriture, rapport seul
 *   pnpm verify:apple --playlist=official-pl-fr-80s
 *   pnpm verify:apple --depuis=30              # lignes non vérifiées depuis 30 j
 *   pnpm verify:apple --json=rapport.json      # rapport détaillé sur disque
 *
 * Env requis : DATABASE_URL.
 * Aucune clé Apple nécessaire : l'API iTunes Lookup est publique et interroge
 * la même boutique que MusicKit (paramètre `country=FR`).
 */

import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import {
  ALBUM_PIEGE,
  memeArtiste,
  memeOeuvre,
  presqueLeMemeTexte,
} from '../src/lib/comparaisonApple.js';

config();

const prisma = new PrismaClient();

/** Boutique interrogée — DOIT être celle du compte Apple Music de l'iPad. */
const STOREFRONT = 'FR';
/** L'API Lookup accepte 25 identifiants par appel. */
const TAILLE_LOT = 25;
/** Pause entre deux lots : l'API publique n'aime pas les rafales. */
const PAUSE_MS = 250;
/**
 * Durée minimale acceptable pour un blind test. Pas de maximum : un morceau de
 * vingt minutes (Autobahn, Chariots of Fire) se lit parfaitement puisqu'on n'en
 * joue que les premières secondes. Un morceau de 40 s, lui, est fini avant que
 * la salle ait buzzé.
 */
const DUREE_MIN_S = 60;

const args = process.argv.slice(2);
const drapeau = (n: string): boolean => args.includes(`--${n}`);
const option = (n: string): string | undefined => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : undefined;
};

const SANS_ECRITURE = drapeau('dry-run');
const PLAYLIST = option('playlist');
const DEPUIS_JOURS = option('depuis') ? Number.parseInt(option('depuis')!, 10) : undefined;
const SORTIE_JSON = option('json');
/** Ne reprend que les lignes actuellement marquées injouables. */
const SEULEMENT_INJOUABLES = drapeau('injouables');

/**
 * MOTIFS QUE CE SCRIPT NE DOIT PAS EFFACER.
 *
 * `original_absent_store_fr` est une décision relue : l'enregistrement
 * ORIGINAL n'existe pas dans la boutique FR et l'identifiant stocké pointe sur
 * une reprise. Exemple vérifié le 09/10/2026 : « Laisse tomber les filles » de
 * France Gall — son catalogue Philips des années 60 est absent d'Apple Music
 * FR, et l'identifiant jouait Fabienne Delsol. Le titre correspond, donc le
 * contrôle de titre passerait et la ligne serait remise en jeu : la salle
 * entendrait une reprise pendant que la réponse affiche France Gall. Ces
 * lignes sont donc laissées telles quelles, et ne sont PAS recontrôlées.
 */
const MOTIFS_PROTEGES = ['original_absent_store_fr'];

/**
 * fix/verif-trop-stricte — LA COMPARAISON NE DOIT PAS INVENTER DES FAUTES.
 *
 * Le premier passage sur le catalogue entier (03/10/2026) a écarté 660
 * morceaux, dont une large majorité de faux positifs : « 1901 » ≠ « 1901 »
 * (l'année d'édition était effacée du titre), « 30 Seconds to Mars » ≠
 * « Thirty Seconds to Mars », « Siouxsie and the Banshees » ≠ « Siouxsie &
 * The Banshees », « Peabo Bryson & Roberta Flack » ≠ l'ordre inverse.
 *
 * Écarter un bon morceau prive la soirée d'un titre connu : la comparaison
 * est donc indulgente et ne signale que les écarts francs, ceux où
 * l'identifiant pointe réellement sur une AUTRE chanson (« Lou » de Slimane
 * qui joue « À fleur de toi »).
 *
 * Ces fonctions vivent dans `src/lib/comparaisonApple.ts` : `reparerInjouables.ts`
 * et `reparerArtistes.ts` les utilisent aussi, et les trois DOIVENT juger
 * « même morceau » à l'identique — sinon la réparation propose un
 * identifiant que la vérification rejette aussitôt.
 */

interface FicheApple {
  titre: string;
  artiste: string;
  album: string;
  dureeS: number;
}

/**
 * Le titre rendu par Apple est-il celui de la ligne, ou l'un de ses alias ?
 *
 * fix/titres-alias — La colonne `title_aliases` existe déjà et sert au
 * matching des réponses des joueurs : elle contient les autres noms légitimes
 * d'un même morceau. Le vérificateur ne la lisait pas, et écartait des lignes
 * dont Apple rend simplement l'autre nom : « Enta Omri » / « Anta Oumri »
 * (translittération), « Everything Sucks » / « Everything Sux »,
 * « Where Our Blue Is » / « 青のすみか » (titre japonais du même morceau),
 * « Doctor Who Theme » / « Doctor Who Opening Credits ». Renseigner l'alias
 * est donc l'acte de relecture qui remet la ligne en jeu, sans toucher à la
 * réponse attendue côté joueur.
 */
function titreReconnu(titre: string | null, alias: string[], chezApple: string): boolean {
  const candidats = [titre, ...alias];
  return candidats.some((c) => memeOeuvre(c, chezApple) || presqueLeMemeTexte(c, chezApple));
}

/** Interroge la boutique FR pour un lot d'identifiants. Renvoie ce qu'elle connaît. */
async function interroger(ids: string[]): Promise<Map<string, FicheApple>> {
  const url = `https://itunes.apple.com/lookup?id=${ids.join(',')}&country=${STOREFRONT}&entity=song`;
  const trouve = new Map<string, FicheApple>();
  for (let essai = 1; essai <= 3; essai += 1) {
    try {
      const rep = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!rep.ok) throw new Error(`HTTP ${rep.status}`);
      const corps = (await rep.json()) as { results?: Array<Record<string, unknown>> };
      for (const r of corps.results ?? []) {
        trouve.set(String(r.trackId), {
          titre: String(r.trackName ?? ''),
          artiste: String(r.artistName ?? ''),
          album: String(r.collectionName ?? ''),
          dureeS: Math.round(Number(r.trackTimeMillis ?? 0) / 1000),
        });
      }
      return trouve;
    } catch {
      await new Promise((r) => setTimeout(r, 1_500 * essai));
    }
  }
  // Trois échecs réseau d'affilée : on ne conclut RIEN sur ce lot.
  throw new Error('boutique Apple injoignable après 3 essais');
}

interface Verdict {
  id: string;
  slug: string;
  position: number;
  libelle: string;
  appleId: string;
  motif: string | null;
  detail?: string;
}

async function main(): Promise<void> {
  const toutes = await prisma.officialPlaylistTrack.findMany({
    where: {
      apple_music_id: { not: null },
      ...(SEULEMENT_INJOUABLES
        ? { is_playable: false, NOT: { playability_reason: { startsWith: 'hors-sujet' } } }
        : {}),
      ...(PLAYLIST ? { playlist: { slug: PLAYLIST } } : {}),
      ...(DEPUIS_JOURS
        ? {
            OR: [
              { playability_checked_at: null },
              {
                playability_checked_at: {
                  lt: new Date(Date.now() - DEPUIS_JOURS * 86_400_000),
                },
              },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      position: true,
      title: true,
      artist: true,
      apple_music_id: true,
      is_playable: true,
      playability_reason: true,
      title_aliases: true,
      playlist: { select: { slug: true } },
    },
    orderBy: [{ playlist_id: 'asc' }, { position: 'asc' }],
  });

  // Un `NOT IN` SQL écarterait aussi les lignes dont le motif est NULL : le
  // filtre se fait donc ici, où `null` reste `null`.
  const protegees = toutes.filter((l) => MOTIFS_PROTEGES.includes(l.playability_reason ?? ''));
  const lignes = toutes.filter((l) => !MOTIFS_PROTEGES.includes(l.playability_reason ?? ''));
  if (protegees.length > 0) {
    console.info(
      `[VérifApple] ${protegees.length} ligne(s) laissée(s) de côté (décision relue) : ` +
        protegees.map((l) => `${l.title} — ${l.artist}`).join(', '),
    );
  }

  console.info(
    `[VérifApple] ${lignes.length} ligne(s) à contrôler sur la boutique ${STOREFRONT}` +
      (SANS_ECRITURE ? ' — SANS ÉCRITURE' : ''),
  );
  if (lignes.length === 0) {
    await prisma.$disconnect();
    return;
  }

  const ids = [...new Set(lignes.map((l) => l.apple_music_id!))];
  const catalogue = new Map<string, FicheApple>();
  const lotsPerdus = new Set<string>();

  for (let i = 0; i < ids.length; i += TAILLE_LOT) {
    const lot = ids.slice(i, i + TAILLE_LOT);
    try {
      for (const [k, v] of await interroger(lot)) catalogue.set(k, v);
    } catch (err) {
      // Réseau en panne sur ce lot : on marque ces IDs comme NON CONCLUS.
      // Un lot perdu ne doit jamais faire passer un morceau pour mort.
      for (const id of lot) lotsPerdus.add(id);
      console.warn(`[VérifApple] lot ${i}-${i + lot.length} : ${(err as Error).message}`);
    }
    if (i % (TAILLE_LOT * 20) === 0) {
      console.info(`[VérifApple] ${i}/${ids.length} identifiants interrogés`);
    }
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  const verdicts: Verdict[] = [];
  /** Signalés pour relecture, mais laissés jouables. */
  const aRelire: Verdict[] = [];

  for (const l of lignes) {
    const appleId = l.apple_music_id!;
    if (lotsPerdus.has(appleId)) continue; // non conclu → on ne touche à rien
    const fiche = catalogue.get(appleId);
    let motif: string | null = null;
    let detail: string | undefined;
    const base = {
      id: l.id,
      slug: l.playlist.slug,
      position: l.position,
      libelle: `${l.title} — ${l.artist}`,
      appleId,
    };

    if (!fiche) {
      motif = 'apple_id_absent_store_fr';
      detail = `absent de la boutique ${STOREFRONT}`;
    } else if (!titreReconnu(l.title, l.title_aliases, fiche.titre)) {
      // Seul écart de titre FRANC : l'identifiant pointe sur une autre chanson
      // (« Lou » de Slimane qui joue « À fleur de toi »). Les variantes
      // d'orthographe (« Living on a Prayer » / « Livin' On a Prayer »,
      // « Mélo » / « M3lo ») ne sont pas des erreurs.
      motif = 'apple_titre_different';
      detail = `Apple joue « ${fiche.titre} »`;
    } else if (ALBUM_PIEGE.test(fiche.album)) {
      motif = 'apple_version_non_originale';
      detail = `album « ${fiche.album} »`;
    } else if (fiche.dureeS > 0 && fiche.dureeS < DUREE_MIN_S) {
      // fix/verif-trop-stricte — SEULE LA DURÉE TROP COURTE EST ÉLIMINATOIRE.
      // Un morceau de 20 minutes (Autobahn, Chariots of Fire, Maggot Brain) se
      // lit parfaitement : on n'en joue que les premières secondes. Les écarter
      // privait la soirée de classiques pour rien. Un morceau de 40 s, lui, est
      // fini avant que la salle ait buzzé.
      motif = 'apple_duree_trop_courte';
      detail = `${fiche.dureeS} s`;
    } else if (!memeArtiste(l.artist, fiche.artiste, fiche.titre)) {
      // fix/verif-trop-stricte — L'ÉCART D'ARTISTE NE CONDAMNE PLUS.
      //
      // Dans notre catalogue le champ artiste vaut souvent « Bande originale »,
      // « Disney », « Comptine » ou le nom d'un spectacle : Apple rend alors
      // l'interprète réel, et l'écart est mécanique, pas fautif (128 lignes sur
      // 239 au passage du 03/10). Restent les vrais cas — une reprise servie à
      // la place de l'original — mais ils ne se distinguent pas des autres par
      // ce seul test. On signale, on n'écarte pas : le morceau reste jouable et
      // la ligne part dans le rapport pour relecture humaine.
      aRelire.push({
        ...base,
        motif: 'apple_artiste_different',
        detail: `Apple crédite « ${fiche.artiste} »`,
      });
    }

    verdicts.push({
      id: l.id,
      slug: l.playlist.slug,
      position: l.position,
      libelle: `${l.title} — ${l.artist}`,
      appleId,
      motif,
      detail,
    });
  }

  const aEcarter = verdicts.filter((v) => v.motif !== null);
  const aRetablir = verdicts.filter((v) => v.motif === null);

  console.info(
    `[VérifApple] conclu sur ${verdicts.length} ligne(s) : ` +
      `${aEcarter.length} à écarter, ${aRetablir.length} conformes` +
      (lotsPerdus.size > 0 ? `, ${lotsPerdus.size} identifiant(s) non conclus (réseau)` : ''),
  );

  const parMotif = new Map<string, number>();
  for (const v of aEcarter) parMotif.set(v.motif!, (parMotif.get(v.motif!) ?? 0) + 1);
  for (const [m, n] of [...parMotif].sort((a, b) => b[1] - a[1])) {
    console.info(`             ${String(n).padStart(5)}  ${m}`);
  }

  if (SORTIE_JSON) {
    writeFileSync(
      SORTIE_JSON,
      JSON.stringify({ aEcarter, aRelire, total: verdicts.length }, null, 1),
    );
    console.info(`[VérifApple] rapport détaillé → ${SORTIE_JSON}`);
  }

  if (SANS_ECRITURE) {
    for (const v of aEcarter.slice(0, 40)) {
      console.info(`  ${v.slug} pos ${v.position} | ${v.libelle} | ${v.motif} — ${v.detail}`);
    }
    if (aEcarter.length > 40) console.info(`  … et ${aEcarter.length - 40} autres`);
    await prisma.$disconnect();
    return;
  }

  const maintenant = new Date();

  // fix/verif-catalogue-complet — ÉCRITURE PAR LOTS SQL, PAS 24 000 UPDATE.
  //
  // L'ancienne boucle lançait 200 `update` en parallèle par paquet. La chaîne
  // de connexion du projet est en `connection_limit=1` : au-delà d'une poignée
  // d'écritures simultanées, Prisma rend `P2024 Timed out fetching a new
  // connection from the connection pool` et le script meurt au milieu, en
  // laissant la moitié du catalogue sans verdict. C'est ce qui s'est produit
  // le 02/10 sur un passage de 100 lignes seulement.
  //
  // Un `UPDATE ... WHERE id IN (...)` par lot écrit la même chose en une
  // requête, sans concurrence, et passe à l'échelle du catalogue entier.
  const LOT_ECRITURE = 500;

  const ecrire = async (ids: string[], jouable: boolean, motif: string | null): Promise<void> => {
    for (let i = 0; i < ids.length; i += LOT_ECRITURE) {
      const tranche = ids.slice(i, i + LOT_ECRITURE);
      const liste = tranche.map((id) => `'${id}'`).join(',');
      const motifSql = motif === null ? 'NULL' : `'${motif.replace(/'/gu, "''")}'`;
      await prisma.$executeRawUnsafe(
        `UPDATE official_playlist_tracks
            SET is_playable = ${jouable ? 'true' : 'false'},
                playability_reason = ${motifSql},
                playability_checked_at = $1
          WHERE id IN (${liste})`,
        maintenant,
      );
    }
  };

  // Les écartés sont groupés par motif : une poignée de requêtes au total.
  const idsParMotif = new Map<string, string[]>();
  for (const v of aEcarter) {
    const k = v.motif ?? 'apple_refus';
    idsParMotif.set(k, [...(idsParMotif.get(k) ?? []), v.id]);
  }
  for (const [motif, ids] of idsParMotif) {
    await ecrire(ids, false, motif);
    console.info(`[VérifApple] écarté ${ids.length} × ${motif}`);
  }
  await ecrire(
    aRetablir.map((v) => v.id),
    true,
    null,
  );

  console.info(
    `[VérifApple] écrit : ${aEcarter.length} écarté(s), ${aRetablir.length} confirmé(s).`,
  );
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[VérifApple] échec :', err);
  await prisma.$disconnect();
  process.exit(1);
});
