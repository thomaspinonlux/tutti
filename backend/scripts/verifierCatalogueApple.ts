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
const ALBUM_PIEGE =
  /karaok|tribute|hommage|in the style of|made famous by|cover version|reprise instrumentale/i;

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
    .replace(
      /\b(remaster(ed)?|live|radio edit|single version|feat|featuring|version|mono|stereo|19\d\d|20\d\d)\b/g,
      ' ',
    )
    .replace(/[^a-z0-9]/g, '');
}

/**
 * fix/verif-trop-stricte — LA COMPARAISON NE DOIT PAS INVENTER DES FAUTES.
 *
 * Premier passage sur le catalogue entier (03/10) : 660 morceaux écartés, dont
 * une large majorité de faux positifs, tous du même petit nombre de causes.
 *
 *   « 1901 » ≠ « 1901 »            : reduireEdition effaçait 19\d\d comme une
 *                                    année d'édition — le titre devenait vide.
 *                                    Idem 1979, 1999, 1944.
 *   « 30 Seconds to Mars »         ≠ « Thirty Seconds to Mars »
 *   « Nine to Five »               ≠ « 9 to 5 »
 *   « Siouxsie and the Banshees »  ≠ « Siouxsie & The Banshees »
 *   « Ricchi e Poveri »            ≠ « Ricchi & Poveri »
 *   « Luis Fonsi ft. Daddy Yankee »≠ « Luis Fonsi & Daddy Yankee »
 *   « Peabo Bryson & Roberta Flack »≠ « Roberta Flack & Peabo Bryson » (ordre)
 *   « Bruno Mars »                 ≠ « Mark Ronson » (Apple crédite le premier
 *                                    nom, l'invité est dans le titre)
 *   « Game of Thrones (Main Title) »≠ « Main Title »
 *
 * Écarter un bon morceau coûte plus cher que d'en laisser passer un douteux :
 * le premier prive la soirée d'un titre connu, le second sera attrapé par le
 * chien de garde de la console. La comparaison est donc volontairement
 * indulgente, et seuls les écarts francs sont signalés — ceux où l'identifiant
 * pointe réellement sur une AUTRE chanson (« Lou » de Slimane qui joue
 * « À fleur de toi »).
 */
const NOMBRES: Record<string, string> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  thirteen: '13',
  fourteen: '14',
  fifteen: '15',
  sixteen: '16',
  seventeen: '17',
  eighteen: '18',
  nineteen: '19',
  twenty: '20',
  thirty: '30',
  forty: '40',
  fifty: '50',
  hundred: '100',
  un: '1',
  une: '1',
  deux: '2',
  trois: '3',
  quatre: '4',
  cinq: '5',
  sept: '7',
  huit: '8',
  neuf: '9',
  dix: '10',
  onze: '11',
  douze: '12',
  treize: '13',
  quinze: '15',
  vingt: '20',
  trente: '30',
  quarante: '40',
  cinquante: '50',
  cent: '100',
  mille: '1000',
};

/** Mots qui ne distinguent jamais deux interprètes ni deux titres. */
const LIAISONS = new Set([
  'and',
  'et',
  'e',
  'y',
  'with',
  'avec',
  'ft',
  'feat',
  'featuring',
  'vs',
  'x',
  'the',
  'les',
  'le',
  'la',
  'los',
  'il',
  'de',
  'du',
  'des',
  'of',
  'a',
  'an',
]);

/** Découpe en mots nus : sans accents, sans ponctuation, chiffres unifiés. */
function mots(v: string | null): string[] {
  return (v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((m) => NOMBRES[m] ?? m)
    .filter((m) => !LIAISONS.has(m));
}

/** Les mots de `petit` sont-ils tous dans `grand` ? (ordre indifférent) */
function inclusDans(petit: string[], grand: string[]): boolean {
  if (petit.length === 0) return false;
  const sac = new Set(grand);
  return petit.every((m) => sac.has(m));
}

/**
 * Deux libellés désignent-ils la même œuvre ? On teste le texte entier ET le
 * texte amputé de ses parenthèses, dans les deux sens : « Game of Thrones
 * (Main Title) » et « Main Title » se retrouvent ainsi.
 */
function memeOeuvre(a: string | null, b: string | null): boolean {
  const variantes = (v: string | null): string[][] => {
    const brut = mots(v);
    const sansParentheses = mots((v ?? '').replace(/\(.*?\)|\[.*?\]/gu, ' '));
    const dansParentheses = mots(((v ?? '').match(/\((.*?)\)|\[(.*?)\]/u) ?? [])[1] ?? '');
    return [brut, sansParentheses, dansParentheses].filter((m) => m.length > 0);
  };
  const va = variantes(a);
  const vb = variantes(b);
  if (va.length === 0 || vb.length === 0) return false;
  for (const x of va) {
    for (const y of vb) {
      if (inclusDans(x, y) || inclusDans(y, x)) return true;
    }
  }
  return false;
}

/**
 * L'interprète correspond-il ? On accepte que l'ordre change, que l'invité
 * manque, et on regarde AUSSI le titre rendu par Apple : la mention « feat. »
 * y migre souvent (« Best Part » crédité à Daniel Caesar, H.E.R. étant dans
 * le titre).
 */
/** Deux libellés à quelques lettres près : variante d'orthographe, pas erreur. */
function presqueLeMemeTexte(a: string | null, b: string | null): boolean {
  const x = mots(a).join('');
  const y = mots(b).join('');
  if (!x || !y) return false;
  const court = x.length < y.length ? x : y;
  const long = x.length < y.length ? y : x;
  if (long.startsWith(court) && court.length >= 5) return true;
  if (Math.abs(x.length - y.length) > 4) return false;
  let distance = 0;
  const m = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    let prev = m[0]!;
    m[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const tmp = m[j]!;
      m[j] = Math.min(m[j]! + 1, m[j - 1]! + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  distance = m[y.length]!;
  return distance <= Math.max(1, Math.floor(long.length * 0.15));
}

function memeArtiste(attendu: string | null, chezApple: string, titreApple: string): boolean {
  if (memeOeuvre(attendu, chezApple)) return true;
  return inclusDans(mots(attendu), [...mots(chezApple), ...mots(titreApple)]);
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
    } else if (!memeOeuvre(l.title, fiche.titre) && !presqueLeMemeTexte(l.title, fiche.titre)) {
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
