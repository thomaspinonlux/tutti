/**
 * src/lib/appleCatalogueCheck.ts — contrôle automatique du catalogue Apple.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * Thomas, le 09/10/2026 : « pourquoi à chaque fois que je demande il y a des
 * corrections ? pourquoi n'es-tu pas capable de tout checker en une seule
 * fois ? »
 *
 * La vraie réponse : le catalogue DÉRIVE tout seul, et personne ne regarde.
 * Un import de masse prend le premier résultat rendu par la recherche Apple,
 * un disque sort du catalogue français, un éditeur remplace une édition par
 * une autre. Chaque contrôle manuel ne vaut donc que pour le jour où il a été
 * lancé, et il faut le redemander. Un contrôle qui tourne tout seul, lui, ne
 * se redemande pas.
 *
 * CE QU'IL FAIT
 * -------------
 * Toutes les six heures, il reprend au plus `TAILLE_PASSAGE` lignes du
 * catalogue dont la dernière vérification remonte à plus de 30 jours, et
 * redemande à la boutique FR ce que joue vraiment leur identifiant. Les règles
 * sont exactement celles du vérificateur en ligne de commande
 * (`scripts/verifierCatalogueApple.ts`), parce que les deux importent la même
 * comparaison. En régime permanent, chaque titre est donc revu au moins une
 * fois par mois sans que personne ne le demande.
 *
 * CE QU'IL NE FAIT PAS, VOLONTAIREMENT
 * ------------------------------------
 * Il ne remplace JAMAIS un identifiant. Remplacer, c'est choisir un autre
 * enregistrement : cela se relit. Il se contente d'écarter du jeu ce qui ne
 * joue pas le bon morceau — le lancement d'une manche saute les lignes
 * `is_playable = false` — et de laisser une trace dans les journaux. La
 * réparation reste un acte lancé à la main, avec son rapport.
 *
 * Il ne touche pas non plus aux lignes dont le motif a été posé par un humain
 * (`MOTIFS_PROTEGES`) : une décision relue ne doit pas être effacée par une
 * machine.
 *
 * ET IL NE TOURNE JAMAIS PENDANT UNE PARTIE
 * -----------------------------------------
 * Thomas, le 09/10/2026 : « que se passe-t-il si l'on joue pendant ce
 * temps-là ? »
 *
 * Une manche en cours ne lit PAS cette table : au lancement, les morceaux ont
 * été recopiés dans `tracks`, et c'est de là que vient l'identifiant envoyé à
 * MusicKit. Écrire ici ne peut donc pas couper le son d'une soirée.
 *
 * Mais la base est ouverte avec `connection_limit=1` : tout le serveur passe
 * par UNE seule connexion. Une écriture de masse n'interromprait pas la
 * musique, elle ferait attendre quelques dizaines de millisecondes le buzz
 * qui arrive au même instant. Pour une poignée de titres revus, ce n'est pas
 * un échange acceptable.
 *
 * Donc : avant chaque passage, et de nouveau entre chaque lot, on regarde
 * s'il y a une partie en cours. Si oui, on s'arrête net et on revient plus
 * tard — le catalogue peut attendre six heures, pas la salle.
 */

import { prisma } from './prisma.js';
import { ALBUM_PIEGE, memeOeuvre, presqueLeMemeTexte } from './comparaisonApple.js';

/** Boutique interrogée — DOIT être celle du compte Apple Music de l'iPad. */
const STOREFRONT = 'FR';
/** L'API Lookup accepte 25 identifiants par appel. */
const TAILLE_LOT = 25;
/** Pause entre deux lots : l'API publique n'aime pas les rafales. */
const PAUSE_MS = 400;
/** Durée minimale jouable en blind test. */
const DUREE_MIN_S = 60;
/** Au-delà de ce délai, une ligne est due pour un nouveau contrôle. */
const PERIME_APRES_JOURS = 30;
/**
 * Lignes reprises à chaque passage. 1 000 lignes toutes les six heures
 * suffisent à revoir les 24 000 du catalogue en moins d'une semaine, sans
 * jamais peser sur la boutique ni sur la base.
 */
const TAILLE_PASSAGE = 1_000;
/** Motifs posés par une relecture humaine : la machine n'y touche pas. */
const MOTIFS_PROTEGES = ['original_absent_store_fr'];

interface FicheApple {
  titre: string;
  album: string;
  dureeS: number;
}

async function interroger(ids: string[]): Promise<Map<string, FicheApple> | null> {
  const url = `https://itunes.apple.com/lookup?id=${ids.join(',')}&country=${STOREFRONT}&entity=song`;
  for (let essai = 1; essai <= 3; essai += 1) {
    try {
      const rep = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!rep.ok) throw new Error(`HTTP ${rep.status}`);
      const corps = (await rep.json()) as { results?: Array<Record<string, unknown>> };
      const trouve = new Map<string, FicheApple>();
      for (const r of corps.results ?? []) {
        trouve.set(String(r.trackId), {
          titre: String(r.trackName ?? ''),
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
  return null;
}

/**
 * Une partie est-elle en cours ? Une session `PLAYING` suffit : on ne prend
 * aucun risque sur l'unique connexion à la base pendant une soirée.
 *
 * Une session oubliée en `PLAYING` ne peut pas bloquer le contrôle pour
 * toujours : `sessionAutoClose.ts` ferme toute session sans activité depuis
 * deux heures.
 */
async function partieEnCours(): Promise<boolean> {
  const n = await prisma.session.count({ where: { status: 'PLAYING' } });
  return n > 0;
}

export interface BilanControle {
  examinees: number;
  conformes: number;
  ecartees: number;
  nonConclues: number;
  parMotif: Record<string, number>;
  /** Passage abandonné parce qu'une partie a commencé. */
  reporte: boolean;
}

export async function controlerCatalogueApple(origine = 'cron'): Promise<BilanControle> {
  const vide: BilanControle = {
    examinees: 0,
    conformes: 0,
    ecartees: 0,
    nonConclues: 0,
    parMotif: {},
    reporte: true,
  };
  if (await partieEnCours()) {
    console.info(`[Cron][AppleCatalogue:${origine}] partie en cours — passage reporté`);
    return vide;
  }

  const perime = new Date(Date.now() - PERIME_APRES_JOURS * 86_400_000);
  const lignes = await prisma.officialPlaylistTrack.findMany({
    where: {
      apple_music_id: { not: null },
      OR: [{ playability_checked_at: null }, { playability_checked_at: { lt: perime } }],
    },
    select: {
      id: true,
      title: true,
      title_aliases: true,
      apple_music_id: true,
      playability_reason: true,
    },
    orderBy: { playability_checked_at: { sort: 'asc', nulls: 'first' } },
    take: TAILLE_PASSAGE,
  });

  // Un `NOT IN` SQL écarterait aussi les lignes dont le motif est NULL : le
  // filtre se fait donc ici, où `null` reste `null`.
  const aVoir = lignes.filter((l) => !MOTIFS_PROTEGES.includes(l.playability_reason ?? ''));
  const bilan: BilanControle = {
    examinees: aVoir.length,
    conformes: 0,
    ecartees: 0,
    nonConclues: 0,
    parMotif: {},
    reporte: false,
  };
  if (aVoir.length === 0) return bilan;

  const ids = [...new Set(aVoir.map((l) => l.apple_music_id!))];
  const catalogue = new Map<string, FicheApple>();
  const lotsPerdus = new Set<string>();
  for (let i = 0; i < ids.length; i += TAILLE_LOT) {
    // Une soirée peut commencer pendant le passage : on relâche la main sans
    // rien écrire. Les lignes déjà interrogées seront reprises au passage
    // suivant, leur date de contrôle n'ayant pas bougé.
    if (i % (TAILLE_LOT * 10) === 0 && (await partieEnCours())) {
      console.info(
        `[Cron][AppleCatalogue:${origine}] partie démarrée — passage interrompu à ${i}/${ids.length}`,
      );
      return { ...bilan, reporte: true };
    }
    const lot = ids.slice(i, i + TAILLE_LOT);
    const trouve = await interroger(lot);
    if (trouve === null) {
      for (const id of lot) lotsPerdus.add(id);
    } else {
      for (const [k, v] of trouve) catalogue.set(k, v);
    }
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  const conformes: string[] = [];
  const parMotif = new Map<string, string[]>();
  for (const l of aVoir) {
    const appleId = l.apple_music_id!;
    if (lotsPerdus.has(appleId)) {
      bilan.nonConclues += 1;
      continue;
    }
    const fiche = catalogue.get(appleId);
    let motif: string | null = null;
    if (!fiche) {
      motif = 'apple_id_absent_store_fr';
    } else if (
      ![l.title, ...l.title_aliases].some(
        (c) => memeOeuvre(c, fiche.titre) || presqueLeMemeTexte(c, fiche.titre),
      )
    ) {
      motif = 'apple_titre_different';
    } else if (ALBUM_PIEGE.test(fiche.album)) {
      motif = 'apple_version_non_originale';
    } else if (fiche.dureeS > 0 && fiche.dureeS < DUREE_MIN_S) {
      motif = 'apple_duree_trop_courte';
    }
    if (motif === null) conformes.push(l.id);
    else parMotif.set(motif, [...(parMotif.get(motif) ?? []), l.id]);
  }

  const maintenant = new Date();
  for (let i = 0; i < conformes.length; i += 500) {
    await prisma.officialPlaylistTrack.updateMany({
      where: { id: { in: conformes.slice(i, i + 500) } },
      data: { is_playable: true, playability_reason: null, playability_checked_at: maintenant },
    });
  }
  for (const [motif, liste] of parMotif) {
    for (let i = 0; i < liste.length; i += 500) {
      await prisma.officialPlaylistTrack.updateMany({
        where: { id: { in: liste.slice(i, i + 500) } },
        data: { is_playable: false, playability_reason: motif, playability_checked_at: maintenant },
      });
    }
    bilan.parMotif[motif] = liste.length;
    bilan.ecartees += liste.length;
  }
  bilan.conformes = conformes.length;

  console.info(
    `[Cron][AppleCatalogue:${origine}] ${bilan.examinees} examinée(s), ` +
      `${bilan.conformes} conforme(s), ${bilan.ecartees} écartée(s)` +
      (bilan.nonConclues > 0 ? `, ${bilan.nonConclues} non conclue(s) (réseau)` : '') +
      (bilan.ecartees > 0 ? ` — ${JSON.stringify(bilan.parMotif)}` : ''),
  );
  return bilan;
}

// ───── Cron (in-process) ──────────────────────────────────────────────────
//
// Même forme que youtubeRefresh et sessionAutoClose : pas de dépendance
// node-cron pour un seul travail. En multi-instance, basculer sur Railway
// Cron pour éviter N passages en parallèle.

const INTERVALLE_MS = 6 * 60 * 60 * 1000; // 6 h
/** Un passage reporté pour cause de partie en cours revient au bout de ça. */
const REESSAI_MS = 30 * 60 * 1000; // 30 min
let minuterie: ReturnType<typeof setInterval> | null = null;

/**
 * Lance un passage, et si une partie l'a empêché, en reprogramme un dans une
 * demi-heure. Une soirée dure deux ou trois heures : sans ce rattrapage, un
 * établissement qui joue tous les soirs ferait sauter un passage sur deux.
 */
function passer(origine: string): void {
  void controlerCatalogueApple(origine)
    .then((bilan) => {
      if (bilan.reporte) setTimeout(() => passer('rattrapage'), REESSAI_MS);
    })
    .catch((err) => {
      console.error(`[Cron][AppleCatalogue:${origine}] passage en échec`, err);
    });
}

export function startAppleCatalogueCron(): void {
  if (minuterie) {
    console.warn('[Cron][AppleCatalogue] déjà démarré, on ne relance pas');
    return;
  }
  console.info(
    `[Cron][AppleCatalogue] programmé toutes les ${INTERVALLE_MS / 3_600_000} h, ` +
      'jamais pendant une partie',
  );
  // Premier passage 15 min après le démarrage : le boot et les migrations
  // d'abord, et on évite de taper la boutique à chaque redéploiement.
  setTimeout(() => passer('demarrage'), 15 * 60 * 1000);
  minuterie = setInterval(() => passer('cron'), INTERVALLE_MS);
}

export function stopAppleCatalogueCron(): void {
  if (minuterie) {
    clearInterval(minuterie);
    minuterie = null;
    console.info('[Cron][AppleCatalogue] arrêté');
  }
}
