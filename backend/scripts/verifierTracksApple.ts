/**
 * scripts/verifierTracksApple.ts — contrôle de la table `tracks`.
 *
 * POURQUOI CE SCRIPT EXISTE
 * -------------------------
 * `official_playlist_tracks` est le catalogue de référence, et il est
 * désormais contrôlé titre par titre. Mais ce n'est pas lui que la partie
 * lit : au lancement d'une manche, `officialPlaylistLaunch.ts` recopie les
 * morceaux dans `tracks` (la fiche du morceau pour un espace de travail) et
 * les relie à `playlist_tracks`. C'est de LÀ que la console tire l'identifiant
 * qu'elle envoie à MusicKit (`gameplayCore.ts`, `track.provider_track_id`),
 * et à ce moment-là PLUS AUCUN filtre de jouabilité ne s'applique.
 *
 * Deux conséquences :
 *   - une fiche créée par la recherche d'un animateur n'a jamais été contrôlée ;
 *   - une fiche recopiée AVANT une correction du catalogue garde l'ancien
 *     identifiant, donc l'ancienne erreur, pour toujours.
 *
 * Au 09/10/2026 : 4 840 fiches Apple Music, aucune horodatée comme vérifiée,
 * dont 933 dont l'identifiant n'existe dans aucune ligne du catalogue.
 *
 * CE QU'IL FAIT, pour chaque fiche `provider = 'apple_music'`
 * -----------------------------------------------------------
 *   1. l'identifiant existe-t-il dans la boutique FR ? (API iTunes Lookup)
 *   2. le titre et l'artiste rendus sont-ils bien ceux de la fiche ?
 *      (mêmes règles que le catalogue — `src/lib/comparaisonApple.ts`)
 *   3. si non : on cherche le bon enregistrement et on CORRIGE l'identifiant ;
 *   4. si la recherche ne donne rien de conforme : `is_playable = false`.
 *
 * Usage :
 *   pnpm tsx scripts/verifierTracksApple.ts --dry-run
 *   pnpm tsx scripts/verifierTracksApple.ts --json=rapport.json
 */

import { writeFileSync } from 'node:fs';
import 'dotenv/config';
import { AppleMusicProvider } from '../src/music/apple/AppleMusicProvider.js';
import { prisma } from '../src/lib/prisma.js';
import {
  ALBUM_PIEGE,
  memeArtiste,
  memeOeuvre,
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

const STOREFRONT = 'FR';
const TAILLE_LOT = 25;
const PAUSE_MS = 250;
const DUREE_MIN_S = 60;

interface FicheApple {
  titre: string;
  artiste: string;
  album: string;
  dureeS: number;
}

/** Interroge la boutique FR pour un lot d'identifiants. */
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
  throw new Error('boutique Apple injoignable après 3 essais');
}

async function main(): Promise<void> {
  const fiches = await prisma.track.findMany({
    where: { provider: 'apple_music' },
    select: {
      id: true,
      canonical_title: true,
      provider_track_id: true,
      is_playable: true,
      artist: { select: { canonical_name: true } },
    },
    orderBy: { created_at: 'asc' },
    ...(LIMITE ? { take: LIMITE } : {}),
  });

  console.info(
    `[VérifTracks] ${fiches.length} fiche(s) Apple Music à contrôler sur la boutique ${STOREFRONT}` +
      (SANS_ECRITURE ? ' — SANS ÉCRITURE' : ''),
  );
  if (fiches.length === 0) {
    await prisma.$disconnect();
    return;
  }

  // 1. Lecture en lots : une seule requête pour 25 identifiants.
  const ids = [...new Set(fiches.map((f) => f.provider_track_id))];
  const catalogue = new Map<string, FicheApple>();
  const lotsPerdus = new Set<string>();
  for (let i = 0; i < ids.length; i += TAILLE_LOT) {
    const lot = ids.slice(i, i + TAILLE_LOT);
    try {
      const trouve = await interroger(lot);
      for (const [k, v] of trouve) catalogue.set(k, v);
    } catch {
      for (const id of lot) lotsPerdus.add(id);
    }
    if (i % 500 === 0) console.info(`[VérifTracks] ${i}/${ids.length} identifiants interrogés`);
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  // 2. Verdict fiche par fiche.
  const conformes: string[] = [];
  const aReparer: typeof fiches = [];
  const journal: Array<Record<string, unknown>> = [];

  for (const f of fiches) {
    if (lotsPerdus.has(f.provider_track_id)) continue; // non conclu → on ne touche à rien
    const fiche = catalogue.get(f.provider_track_id);
    const libelle = `${f.canonical_title} — ${f.artist.canonical_name}`;
    if (!fiche) {
      aReparer.push(f);
      journal.push({ libelle, motif: 'absent_store_fr' });
      continue;
    }
    const titreOk =
      memeOeuvre(f.canonical_title, fiche.titre) ||
      presqueLeMemeTexte(f.canonical_title, fiche.titre);
    if (!titreOk) {
      aReparer.push(f);
      journal.push({ libelle, motif: 'titre_different', joue: fiche.titre });
      continue;
    }
    if (ALBUM_PIEGE.test(fiche.album)) {
      aReparer.push(f);
      journal.push({ libelle, motif: 'version_non_originale', album: fiche.album });
      continue;
    }
    if (fiche.dureeS > 0 && fiche.dureeS < DUREE_MIN_S) {
      aReparer.push(f);
      journal.push({ libelle, motif: 'duree_trop_courte', duree: fiche.dureeS });
      continue;
    }
    // L'écart d'artiste seul ne condamne pas (même règle que le catalogue).
    conformes.push(f.id);
  }

  console.info(
    `[VérifTracks] ${conformes.length} conforme(s), ${aReparer.length} à reprendre` +
      (lotsPerdus.size > 0 ? `, ${lotsPerdus.size} non conclu(s) (réseau)` : ''),
  );

  // 3. Tentative de réparation par recherche, puis exclusion si rien ne convient.
  const apple = new AppleMusicProvider('fr');
  let repares = 0;
  const aEcarter: Array<{ id: string; motif: string }> = [];

  for (let i = 0; i < aReparer.length; i += 1) {
    const f = aReparer[i]!;
    if (i > 0 && i % 25 === 0) console.info(`[VérifTracks] réparation ${i}/${aReparer.length}…`);
    let candidats: Awaited<ReturnType<AppleMusicProvider['search']>> = [];
    try {
      candidats = await apple.search(`${f.artist.canonical_name} ${f.canonical_title}`, {
        limit: 10,
      });
    } catch {
      continue; // réseau : on ne conclut pas
    }
    await new Promise((r) => setTimeout(r, 120));

    const bon = candidats.find((c) => {
      const titreOk =
        memeOeuvre(f.canonical_title, c.title) || presqueLeMemeTexte(f.canonical_title, c.title);
      if (!titreOk) return false;
      if (!memeArtiste(f.artist.canonical_name, c.artist, c.title)) return false;
      if (ALBUM_PIEGE.test(c.album ?? '')) return false;
      const dureeS = Math.round((c.duration_ms ?? 0) / 1000);
      if (dureeS > 0 && dureeS < DUREE_MIN_S) return false;
      return Boolean(c.provider_track_id);
    });

    if (!bon) {
      aEcarter.push({ id: f.id, motif: 'apple_introuvable_store_fr' });
      continue;
    }
    repares += 1;
    journal.push({
      libelle: `${f.canonical_title} — ${f.artist.canonical_name}`,
      verdict: 'repare',
      ancienId: f.provider_track_id,
      nouvelId: bon.provider_track_id,
    });
    if (!SANS_ECRITURE) {
      // La contrainte (provider, provider_track_id) est unique : si une fiche
      // porte déjà le bon identifiant, on ne peut pas en créer une seconde.
      // Dans ce cas la fiche fautive est simplement écartée, et le doublon
      // reste la seule porteuse de l'identifiant.
      const doublon = await prisma.track.findFirst({
        where: { provider: 'apple_music', provider_track_id: bon.provider_track_id },
        select: { id: true },
      });
      if (doublon && doublon.id !== f.id) {
        aEcarter.push({ id: f.id, motif: 'apple_doublon_identifiant' });
        repares -= 1;
        continue;
      }
      await prisma.track.update({
        where: { id: f.id },
        data: {
          provider_track_id: bon.provider_track_id,
          cover_url: bon.cover_url ?? undefined,
          is_playable: true,
          playability_reason: null,
          playability_checked_at: new Date(),
        },
      });
    }
  }

  if (!SANS_ECRITURE) {
    const maintenant = new Date();
    for (let i = 0; i < conformes.length; i += 500) {
      await prisma.track.updateMany({
        where: { id: { in: conformes.slice(i, i + 500) } },
        data: { is_playable: true, playability_reason: null, playability_checked_at: maintenant },
      });
    }
    const parMotif = new Map<string, string[]>();
    for (const e of aEcarter) parMotif.set(e.motif, [...(parMotif.get(e.motif) ?? []), e.id]);
    for (const [motif, liste] of parMotif) {
      for (let i = 0; i < liste.length; i += 500) {
        await prisma.track.updateMany({
          where: { id: { in: liste.slice(i, i + 500) } },
          data: {
            is_playable: false,
            playability_reason: motif,
            playability_checked_at: maintenant,
          },
        });
      }
      console.info(`[VérifTracks] écarté ${liste.length} × ${motif}`);
    }
  }

  console.info(
    `[VérifTracks] ${conformes.length} confirmée(s), ${repares} réparée(s), ${aEcarter.length} écartée(s).`,
  );
  if (SORTIE_JSON) {
    writeFileSync(SORTIE_JSON, JSON.stringify(journal, null, 1));
    console.info(`[VérifTracks] rapport → ${SORTIE_JSON}`);
  }
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[VérifTracks] échec :', err);
  await prisma.$disconnect();
  process.exit(1);
});
