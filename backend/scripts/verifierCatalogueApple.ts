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

config();

const prisma = new PrismaClient();

/** Boutique interrogée — DOIT être celle du compte Apple Music de l'iPad. */
const STOREFRONT = 'FR';
/** L'API Lookup accepte 25 identifiants par appel. */
const TAILLE_LOT = 25;
/** Pause entre deux lots : l'API publique n'aime pas les rafales. */
const PAUSE_MS = 250;
/** Bornes de durée acceptables pour un blind test. */
const DUREE_MIN_S = 60;
const DUREE_MAX_S = 600;
/** Albums dont le nom trahit une version qui n'est pas l'originale. */
const ALBUM_PIEGE = /karaok|tribute|hommage|in the style of|made famous by|cover version|reprise instrumentale/i;

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

/** Réduit un libellé à sa substance : minuscules, sans accents ni ponctuation. */
function reduire(s: string | null): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Même chose, mais en retirant AUSSI ce qui distingue deux éditions du même
 * morceau : parenthèses, crochets, mentions de remaster, de version, d'année.
 * « Livin' on a Prayer » et « Livin' On a Prayer (2018 Remaster) » se
 * ramènent au même texte — ce sont bien le même enregistrement pour un joueur.
 */
function reduireEdition(s: string | null): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(remaster(ed)?|live|radio edit|single version|feat|featuring|version|mono|stereo|19\d\d|20\d\d)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '');
}

/** Vrai si l'un des deux libellés contient l'autre — tolérant aux éditions. */
function memeOeuvre(a: string | null, b: string | null): boolean {
  const x = reduireEdition(a);
  const y = reduireEdition(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

interface FicheApple {
  titre: string;
  artiste: string;
  album: string;
  dureeS: number;
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
  const lignes = await prisma.officialPlaylistTrack.findMany({
    where: {
      apple_music_id: { not: null },
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
      playlist: { select: { slug: true } },
    },
    orderBy: [{ playlist_id: 'asc' }, { position: 'asc' }],
  });

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

  for (const l of lignes) {
    const appleId = l.apple_music_id!;
    if (lotsPerdus.has(appleId)) continue; // non conclu → on ne touche à rien
    const fiche = catalogue.get(appleId);
    let motif: string | null = null;
    let detail: string | undefined;

    if (!fiche) {
      motif = 'apple_id_absent_store_fr';
      detail = `absent de la boutique ${STOREFRONT}`;
    } else if (!memeOeuvre(l.title, fiche.titre)) {
      motif = 'apple_titre_different';
      detail = `Apple joue « ${fiche.titre} »`;
    } else if (!memeOeuvre(l.artist, fiche.artiste)) {
      motif = 'apple_artiste_different';
      detail = `Apple crédite « ${fiche.artiste} »`;
    } else if (ALBUM_PIEGE.test(fiche.album)) {
      motif = 'apple_version_non_originale';
      detail = `album « ${fiche.album} »`;
    } else if (fiche.dureeS > 0 && (fiche.dureeS < DUREE_MIN_S || fiche.dureeS > DUREE_MAX_S)) {
      motif = 'apple_duree_hors_bornes';
      detail = `${fiche.dureeS} s`;
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
    writeFileSync(SORTIE_JSON, JSON.stringify({ aEcarter, total: verdicts.length }, null, 1));
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
  const PAQUET = 200;

  for (let i = 0; i < aEcarter.length; i += PAQUET) {
    await Promise.all(
      aEcarter.slice(i, i + PAQUET).map((v) =>
        prisma.officialPlaylistTrack.update({
          where: { id: v.id },
          data: {
            is_playable: false,
            playability_reason: v.motif,
            playability_checked_at: maintenant,
          },
        }),
      ),
    );
  }

  for (let i = 0; i < aRetablir.length; i += PAQUET) {
    await Promise.all(
      aRetablir.slice(i, i + PAQUET).map((v) =>
        prisma.officialPlaylistTrack.update({
          where: { id: v.id },
          data: {
            is_playable: true,
            playability_reason: null,
            playability_checked_at: maintenant,
          },
        }),
      ),
    );
  }

  console.info(`[VérifApple] écrit : ${aEcarter.length} écarté(s), ${aRetablir.length} confirmé(s).`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[VérifApple] échec :', err);
  await prisma.$disconnect();
  process.exit(1);
});
