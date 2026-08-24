/**
 * scripts/arbitrateAppleMusic.ts — arbitrage des titres laissés par rematch:apple
 *
 * CONTEXTE
 * --------
 * `rematch:apple --scope=all` (run du 21/08) a traité 3800 morceaux :
 *   3333 inchangés · 118 renseignés · 149 remplacés · **200 REMPLACEMENT REQUIS**.
 * Ce script traite EXACTEMENT ces 200 morceaux (299 lignes de playlist), listés
 * dans `scripts/data/apple-arbitrage-input.tsv` (extrait du log du run).
 *
 * POURQUOI UN 2e SCRIPT (et pas un simple relâchement de rematchAppleMusic.ts)
 * --------------------------------------------------------------------------
 * Le diagnostic de rematch est volontairement strict et produit deux familles
 * de verdicts faux :
 *
 *  1. FAUX POSITIFS « artiste différent » (109 cas). La comparaison est
 *     `norm(apple) === norm(db) || norm(apple).includes(norm(db))`.
 *     Elle échoue sur toutes les variantes d'écriture d'artiste :
 *       « The Pixies » vs « Pixies »          (article)
 *       « 2Pac ft. Dr. Dre » vs « 2Pac »      (featuring côté DB)
 *       « Doja Cat ft. SZA » vs « Doja Cat »  (+ « (feat. SZA) » dans le TITRE)
 *       « Hall & Oates » vs « Daryl Hall & John Oates »
 *       « Derek and the Dominos » vs « Derek & The Dominos »
 *     → l'id actuel est BON, il ne fallait rien changer.
 *
 *  2. FAUX NÉGATIFS de recherche (« aucune version standard trouvée », 142 cas).
 *     Deux causes : (a) le même écart d'artiste fait tomber le score sous le
 *     seuil de 40 (artiste différent = −40) ; (b) VERSION_EXCLUDED_WORDS rejette
 *     les mots « version » et « mix » comme mots entiers, donc « Remastered
 *     Version », « Mono Version », « Single Version » — pourtant des versions
 *     STANDARD — sont éliminés d'office.
 *
 * CE QUE CE SCRIPT AJOUTE
 * -----------------------
 *  · Comparateur d'artiste par ENSEMBLE DE NOMS : article de tête retiré,
 *    séparation sur ft./feat./&/and/x/vs/virgule, égalité / inclusion /
 *    partage du nom principal.
 *  · Comparaison de TITRE insensible aux suffixes « (feat. X) » et aux mentions
 *    de version acceptables.
 *  · CONTRÔLE DU TITRE DE L'ID ACTUEL — absent de rematch:apple. C'est lui qui
 *    attrape « 2 Frères — La promesse » pointant sur « Maudite promesse ».
 *  · Filtre de version reconstruit en ALLOW-FIRST : remaster, mono, stéréo,
 *    single/album/radio version, bonus track, feat., explicit sont ACCEPTÉS ;
 *    live, karaoké, reprise, tribute, instrumental, remix, sped up, nightcore,
 *    unplugged, medley restent REJETÉS.
 *  · 4 requêtes de recherche par titre au lieu d'une seule.
 *  · Les « œuvres » (comptines, comédies musicales, BO — où la colonne artist
 *    porte le nom de l'ŒUVRE et non un interprète) sont isolées dans leur
 *    propre fichier : elles ne sont JAMAIS écrites automatiquement.
 *
 * RÈGLE D'OR CONSERVÉE : on ne remplace jamais un id déjà sain, et on n'écrit
 * jamais un id douteux. Tout ce qui n'est pas certain part en arbitrage humain.
 *
 * SORTIES (dossier backend/exports/)
 * ----------------------------------
 *   apple-arbitrage-keep-<ts>.tsv        id actuel validé — aucune écriture
 *   apple-arbitrage-replace-<ts>.tsv     nouvel id proposé (écrit si --apply)
 *   apple-arbitrage-oeuvres-<ts>.tsv     œuvres — décision humaine requise
 *   apple-arbitrage-unresolved-<ts>.tsv  rien de jouable — à remplacer ou effacer
 *   apple-arbitrage-rollback-<ts>.json   { trackId: ancien apple_music_id }
 *
 * USAGE
 *   pnpm arbitrate:apple                 # dry-run (défaut) — n'écrit RIEN en base
 *   pnpm arbitrate:apple --apply         # écrit apple_music_id des REPLACE
 *   pnpm arbitrate:apple --only="layla"  # un seul cas, pour contrôle
 *
 * ENV : DATABASE_URL + APPLE_TEAM_ID / APPLE_MUSIC_KEY_ID / APPLE_MUSIC_PRIVATE_KEY
 * COÛT : 0 € (API catalogue Apple gratuite, aucune IA).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { AppleMusicProvider } from '../src/music/apple/AppleMusicProvider.js';
import { getAppleDeveloperToken } from '../src/lib/appleDeveloperToken.js';

config();

const prisma = new PrismaClient();
const apple = new AppleMusicProvider('fr');

const THROTTLE_MS = 120;
const SEARCH_LIMIT = 25;
const SCORE_THRESHOLD = 40;

const HERE = dirname(fileURLToPath(import.meta.url));
const INPUT_TSV = resolve(HERE, 'data/apple-arbitrage-input.tsv');
const EXPORT_DIR = resolve(HERE, '../exports');

/* ────────────────────────────── normalisation ───────────────────────────── */

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

/** Nombres écrits en toutes lettres → chiffres (« Trois Cafés Gourmands » =
 *  « 3 Cafés Gourmands »). Uniquement pour la comparaison d'artistes. */
const NUM_WORDS: Record<string, string> = {
  un: '1',
  une: '1',
  deux: '2',
  trois: '3',
  quatre: '4',
  cinq: '5',
  six: '6',
  sept: '7',
  huit: '8',
  neuf: '9',
  dix: '10',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
};

function normArtist(s: string): string {
  return norm(s)
    .split(' ')
    .map((w) => NUM_WORDS[w] ?? w)
    .join(' ')
    .trim();
}

/** Retire l'article de tête (the/les/la/le/los/las) d'un nom normalisé. */
function stripArticle(n: string): string {
  return n.replace(/^(the|les|la|le|los|las|l) /u, '');
}

/**
 * Découpe une chaîne d'artiste en ENSEMBLE DE NOMS normalisés.
 * « Doja Cat ft. SZA » → ['doja cat', 'sza']
 * « Daryl Hall & John Oates » → ['daryl hall', 'john oates']
 * Le 1er élément est le nom PRINCIPAL (celui qui porte le morceau).
 */
function artistNames(raw: string): string[] {
  const cleaned = raw
    .replace(/\((?:feat|ft|featuring|avec|with)[^)]*\)/giu, ' ')
    .replace(/\b(?:feat|ft|featuring|avec|with|vs|versus|and|x)\b/giu, '&')
    .replace(/[,;/]/gu, '&');
  return cleaned
    .split('&')
    .map((p) => stripArticle(normArtist(p)))
    .filter((p) => p.length >= 2);
}

/**
 * Deux NOMS (un seul interprète chacun) désignent-ils la même personne ?
 * Testé sur 44 cas réels tirés du log rematch (voir en-tête).
 *   « Pixies » = « The Pixies »                     (article)
 *   « Deee-Lite » = « Dee-Lite »                    (1 faute)
 *   « Evelyn King » = « Evelyn "Champagne" King »   (mots inclus)
 *   « Saez » = « Damien Saez »                      (patronyme seul)
 *   « Queen » ≠ « Queen Latifah »                   (prénom seul → refusé)
 *   « Bob Marley » ≠ « Ziggy Marley »               (même patronyme, prénom ≠)
 */
function nameMatch(x: string, y: string): boolean {
  if (!x || !y) return false;
  if (x === y) return true;
  const cx = x.replace(/ /gu, '');
  const cy = y.replace(/ /gu, '');
  if (cx === cy) return true;
  if (cx.length >= 4 && cy.length >= 4 && levenshtein(cx, cy) <= 1) return true;
  const tx = x.split(' ');
  const ty = y.split(' ');
  // Un nom d'UN seul mot ne matche un nom composé que sur son DERNIER mot
  // (patronyme) : « Saez » = « Damien Saez », mais « Queen » ≠ « Queen Latifah ».
  if (tx.length === 1 || ty.length === 1) {
    const one = (tx.length === 1 ? tx[0] : ty[0]) ?? '';
    const many = tx.length === 1 ? ty : tx;
    return one === many[many.length - 1] && one.length >= 3;
  }
  const sx = new Set(tx);
  const sy = new Set(ty);
  if (tx.every((t) => sy.has(t)) || ty.every((t) => sx.has(t))) return true;
  const lx = tx[tx.length - 1] ?? '';
  const ly = ty[ty.length - 1] ?? '';
  if (lx === ly && lx.length >= 4 && tx[0] === ty[0]) return true;
  return false;
}

/**
 * Deux chaînes d'artiste (potentiellement multi-interprètes) désignent-elles
 * le même interprète principal ?
 */
function sameArtist(a: string, b: string): boolean {
  const A = artistNames(a);
  const B = artistNames(b);
  if (A.length === 0 || B.length === 0) return false;
  const short = A.length <= B.length ? A : B;
  const long = A.length <= B.length ? B : A;
  if (short.every((s) => long.some((l) => nameMatch(s, l)))) return true;
  if (nameMatch(A[0] ?? '', B[0] ?? '')) return true;
  if (A.some((x) => nameMatch(x, B[0] ?? '')) || B.some((y) => nameMatch(y, A[0] ?? ''))) {
    return true;
  }
  // Crédit collectif d'un côté, liste nominative de l'autre :
  // « Fredericks Goldman Jones » = « Carole Fredericks, Jean-Jacques Goldman &
  // Michael Jones ».
  const tokens = (L: string[]): Set<string> =>
    new Set(
      L.join(' ')
        .split(' ')
        .filter((w) => w.length >= 3),
    );
  const tA = tokens(A);
  const tB = tokens(B);
  const shortTok = tA.size <= tB.size ? tA : tB;
  const longTok = tA.size <= tB.size ? tB : tA;
  const shared = [...shortTok].filter((t) => longTok.has(t));
  if (shortTok.size >= 2 && shared.length === shortTok.size) return true;
  return false;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 99;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array<number>(n).fill(0)]);
  for (let j = 0; j <= n; j += 1) d[0]![j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
    }
  }
  return d[m]![n]!;
}

/** Titre débarrassé de ses suffixes de version/featuring, pour comparaison. */
function titleCore(t: string): string {
  return norm(
    t
      .replace(/\([^)]*\)/gu, ' ')
      .replace(/\[[^\]]*\]/gu, ' ')
      .split(/\s[-–—]\s/u)[0] ?? t,
  );
}

/* ─────────────────────────── filtre de version ──────────────────────────── */

/** Segments de version : parenthèses, crochets, après un « - ». */
function versionSegments(title: string): string[] {
  const segs: string[] = [];
  for (const m of title.matchAll(/\(([^)]*)\)/gu)) segs.push(m[1] ?? '');
  for (const m of title.matchAll(/\[([^\]]*)\]/gu)) segs.push(m[1] ?? '');
  const dash = title.split(/\s[-–—]\s/u);
  if (dash.length > 1) segs.push(...dash.slice(1));
  return segs;
}

/**
 * Segments ACCEPTABLES — évalués AVANT les rejets. C'est la correction
 * principale par rapport à rematch:apple, qui rejetait « version » et « mix »
 * comme mots entiers et éliminait donc « Remastered Version », « Mono Version »,
 * « Single Version ».
 */
const VERSION_ALLOW = [
  'radio edit',
  'radio version',
  'single version',
  'album version',
  'original version',
  'original mix',
  'main version',
  'version originale',
  'version francaise',
  'remaster',
  'remastered',
  'remasterise',
  'remasterisee',
  'mono',
  'stereo',
  'bonus track',
  'explicit',
  'deluxe',
  'feat',
  'ft',
  'featuring',
  'avec',
  'from',
  'de la bande originale',
  'bande originale',
  'motion picture',
  'original motion picture soundtrack',
  'original broadway cast',
  'original cast',
];

/** Marqueurs REJETÉS : ce sont eux qui produisent le bug « Dragostea ». */
const VERSION_REJECT = [
  'live',
  'en concert',
  'concert',
  'karaoke',
  'karaoké',
  'cover',
  'reprise',
  'acoustic',
  'acoustique',
  'unplugged',
  'tribute',
  'made famous by',
  'made popular by',
  'in the style of',
  'originally performed',
  'as made famous',
  'instrumental',
  'a cappella',
  'acapella',
  'backing track',
  'workout',
  'sped up',
  'speed up',
  'slowed',
  'nightcore',
  'demo',
  'rehearsal',
  'medley',
  'mashup',
  'bootleg',
  'extended',
  'nightclub',
  're-record',
  'rerecord',
  're-recorded',
];

/** Mots entiers rejetés (attrape « Trance Mix », « Club Mix », « 12" Mix »). */
const REJECT_WORDS = ['remix', 'rmx', 'dub', 'edits'];

const ALBUM_REJECT = [
  'karaoke',
  'tribute',
  'made famous',
  'in the style of',
  'originally performed',
];

function hasWord(n: string, w: string): boolean {
  return ` ${n} `.includes(` ${norm(w)} `);
}

/** Renvoie le marqueur indésirable trouvé, ou null si version standard. */
function badVersion(title: string, album: string | undefined): string | null {
  if (album) {
    const a = norm(album);
    for (const bad of ALBUM_REJECT) if (a.includes(norm(bad))) return `album « ${album} » (${bad})`;
  }
  for (const seg of versionSegments(title)) {
    const n = norm(seg);
    if (!n) continue;
    if (VERSION_ALLOW.some((ok) => n.includes(norm(ok)))) continue;
    for (const bad of VERSION_REJECT)
      if (n.includes(norm(bad))) return `« ${seg.trim()} » (${bad})`;
    for (const w of REJECT_WORDS) if (hasWord(n, w)) return `« ${seg.trim()} » (${w})`;
  }
  return null;
}

/* ──────────────────────────────── scoring ───────────────────────────────── */

interface Candidate {
  id: string;
  name: string;
  artist: string;
  album?: string;
  year?: number;
  rank: number;
}

interface Scored extends Candidate {
  score: number;
  reasons: string[];
}

function scoreCandidate(
  c: Candidate,
  wantTitle: string,
  wantArtist: string,
  wantYear: number | null,
  workMode: boolean,
): Scored {
  const reasons: string[] = [];
  let score = 0;

  if (workMode) {
    // Œuvre (comptine, comédie musicale, BO) : l'interprète n'est pas
    // contraint, seul le titre compte. Neutre au score.
    reasons.push('œuvre : artiste non contraint');
  } else if (sameArtist(c.artist, wantArtist)) {
    score += 50;
    reasons.push('artiste OK');
  } else {
    score -= 40;
    reasons.push('ARTISTE DIFFÉRENT');
  }

  const nt = titleCore(c.name);
  const wt = titleCore(wantTitle);
  if (nt === wt) {
    score += 40;
    reasons.push('titre exact');
  } else if (nt.startsWith(wt) || wt.startsWith(nt)) {
    score += 20;
    reasons.push('titre préfixe');
  } else if (nt.includes(wt) || wt.includes(nt)) {
    score += 10;
    reasons.push('titre partiel');
  } else {
    score -= 25;
    reasons.push('TITRE DIVERGENT');
  }

  if (wantYear && c.year) {
    const d = Math.abs(c.year - wantYear);
    if (d === 0) {
      score += 15;
      reasons.push('année exacte');
    } else if (d <= 2) {
      score += 8;
      reasons.push(`année ±${d}`);
    } else if (d > 10) {
      score -= 12;
      reasons.push(`année écart ${d} ans`);
    }
  }

  score += Math.max(0, 10 - c.rank);
  return { ...c, score, reasons };
}

/* ─────────────────────────────── recherche ──────────────────────────────── */

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 4 formulations de requête au lieu d'une. Apple renvoie des résultats très
 * différents selon l'ordre des termes et la présence du featuring.
 */
function queryVariants(title: string, artist: string, workMode: boolean): string[] {
  const primary = artistNames(artist)[0] ?? artist;
  const tCore = title.replace(/\([^)]*\)/gu, ' ').trim();
  const qs = [
    `${artist} ${title}`,
    `${primary} ${tCore}`,
    `${tCore} ${primary}`,
    ...(workMode ? [tCore] : []),
  ];
  return [...new Set(qs.map((q) => q.replace(/\s+/gu, ' ').trim()).filter(Boolean))];
}

interface SearchOutcome {
  best: Scored | null;
  scanned: number;
  rejectedVersion: number;
  rejectedArtist: number;
  runnerUp: Scored | null;
}

async function searchBest(
  title: string,
  artist: string,
  year: number | null,
  workMode: boolean,
  excludeId: string | null,
): Promise<SearchOutcome> {
  const seen = new Map<string, Candidate>();
  for (const q of queryVariants(title, artist, workMode)) {
    let results;
    try {
      results = await apple.search(q, { limit: SEARCH_LIMIT });
    } catch {
      await sleep(THROTTLE_MS);
      continue;
    }
    results.forEach((r, i) => {
      if (!seen.has(r.provider_track_id)) {
        seen.set(r.provider_track_id, {
          id: r.provider_track_id,
          name: r.title,
          artist: r.artist,
          album: r.album,
          year: r.year,
          rank: i,
        });
      }
    });
    await sleep(THROTTLE_MS);
    // Sortie anticipée : un candidat parfait dès la 1re requête évite 3 appels.
    const quick = [...seen.values()]
      .filter((c) => c.id !== excludeId && !badVersion(c.name, c.album))
      .map((c) => scoreCandidate(c, title, artist, year, workMode))
      .sort((a, b) => b.score - a.score)[0];
    if (quick && quick.score >= 90) {
      return {
        best: quick,
        scanned: seen.size,
        rejectedVersion: 0,
        rejectedArtist: 0,
        runnerUp: null,
      };
    }
  }

  let rejectedVersion = 0;
  let rejectedArtist = 0;
  const kept: Scored[] = [];
  for (const c of seen.values()) {
    if (c.id === excludeId) continue;
    if (badVersion(c.name, c.album)) {
      rejectedVersion += 1;
      continue;
    }
    const s = scoreCandidate(c, title, artist, year, workMode);
    if (s.reasons.includes('ARTISTE DIFFÉRENT')) rejectedArtist += 1;
    if (s.score >= SCORE_THRESHOLD) kept.push(s);
  }
  kept.sort((a, b) => b.score - a.score);
  return {
    best: kept[0] ?? null,
    scanned: seen.size,
    rejectedVersion,
    rejectedArtist,
    runnerUp: kept[1] ?? null,
  };
}

/* ────────────────────────────────── I/O ─────────────────────────────────── */

interface InputRow {
  artist: string;
  title: string;
  year: number | null;
  currentId: string | null;
  problem: string;
  playlists: string;
}

function readInput(): InputRow[] {
  if (!existsSync(INPUT_TSV)) {
    throw new Error(`Fichier d'entrée introuvable : ${INPUT_TSV}`);
  }
  const lines = readFileSync(INPUT_TSV, 'utf8').split('\n').filter(Boolean);
  const rows: InputRow[] = [];
  for (const line of lines.slice(1)) {
    const [artist, title, year, , currentId, problem, , playlists] = line.split('\t');
    if (!artist || !title) continue;
    rows.push({
      artist,
      title,
      year: year ? Number.parseInt(year, 10) : null,
      currentId: currentId && currentId !== '' ? currentId : null,
      problem: problem ?? '',
      playlists: playlists ?? '',
    });
  }
  return rows;
}

/** Playlists dont la colonne `artist` porte le nom d'une ŒUVRE, pas d'un interprète. */
const WORK_PLAYLIST_HINTS = ['comédies musicales', 'comedies musicales', 'comptines', 'enfants'];
const WORK_ARTIST_HINTS = ['comptine', 'cast', 'traditionnel', 'bande originale'];

function isWorkEntry(r: InputRow): boolean {
  const pl = norm(r.playlists);
  const ar = norm(r.artist);
  return (
    WORK_PLAYLIST_HINTS.some((h) => pl.includes(norm(h))) ||
    WORK_ARTIST_HINTS.some((h) => ar.includes(norm(h)))
  );
}

function tsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => c.replace(/[\t\n]/gu, ' ')).join('\t')).join('\n') + '\n';
}

/* ──────────────────────────────── main ──────────────────────────────────── */

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.split('=').slice(1).join('=').toLowerCase() : null;

  console.info(
    `[Arbitrage] start | apply=${apply} | only=${only ?? 'none'} | seuil=${SCORE_THRESHOLD}`,
  );
  console.info('[Arbitrage] Coût : 0 € (API catalogue Apple gratuite, pas d’IA).');

  // ── PRÉ-VOL : sans developer token, chaque titre serait faussement classé
  // « rien de jouable ». On échoue AVANT le premier appel, pas après 200.
  try {
    const { token, expiresAt } = getAppleDeveloperToken();
    console.info(
      `[Arbitrage] Developer token Apple OK (…${token.slice(-8)}, expire le ${expiresAt.toISOString().slice(0, 10)}).`,
    );
  } catch (err) {
    console.error(
      `\n[Arbitrage] ARRÊT — pas de developer token Apple : ${err instanceof Error ? err.message : 'erreur inconnue'}`,
    );
    console.error(
      '  Il faut APPLE_TEAM_ID, APPLE_MUSIC_KEY_ID et APPLE_MUSIC_PRIVATE_KEY dans\n' +
        '  l’environnement (backend/.env ou variables exportées). Aucune écriture n’a eu lieu.',
    );
    process.exitCode = 1;
    return;
  }

  let input = readInput();
  if (only) {
    input = input.filter(
      (r) => r.artist.toLowerCase().includes(only) || r.title.toLowerCase().includes(only),
    );
  }
  console.info(`[Arbitrage] ${input.length} morceaux en entrée`);

  // Lignes DB réelles, indexées par clé (artiste|titre) normalisée.
  const dbRows = await prisma.officialPlaylistTrack.findMany({
    select: {
      id: true,
      title: true,
      artist: true,
      year: true,
      apple_music_id: true,
      playlist: { select: { name_fr: true } },
    },
  });
  const byKey = new Map<string, typeof dbRows>();
  for (const t of dbRows) {
    const k = `${norm(t.artist)}|${norm(t.title)}`;
    const arr = byKey.get(k) ?? [];
    arr.push(t);
    byKey.set(k, arr);
  }

  const keep: string[][] = [
    ['artiste', 'titre', 'id conservé', 'titre Apple', 'artiste Apple', 'motif'],
  ];
  const replace: string[][] = [
    [
      'artiste',
      'titre',
      'ancien id',
      'nouvel id',
      'titre Apple',
      'artiste Apple',
      'album',
      'année',
      'score',
      'motifs',
      'lignes',
    ],
  ];
  const works: string[][] = [
    [
      'œuvre',
      'titre',
      'id actuel',
      'candidat',
      'titre Apple',
      'interprète Apple',
      'album',
      'score',
      'lignes',
    ],
  ];
  const unresolved: string[][] = [
    [
      'artiste',
      'titre',
      'id actuel',
      'candidats scannés',
      'rejetés version',
      'rejetés artiste',
      'lignes',
      'playlists',
    ],
  ];
  const rollback: Record<string, string | null> = {};

  let missingInDb = 0;
  let apiErrors = 0;
  let consecutiveErrors = 0;
  let written = 0;

  for (const [idx, r] of input.entries()) {
    const key = `${norm(r.artist)}|${norm(r.title)}`;
    const group = byKey.get(key) ?? [];
    if (group.length === 0) {
      missingInDb += 1;
      console.warn(`⚠️  ABSENT DE LA BASE — ${r.artist} — ${r.title} (déjà corrigé ou supprimé ?)`);
      continue;
    }
    const dbTrack = group[0]!;
    const currentId = dbTrack.apple_music_id;
    const year = dbTrack.year ?? r.year;
    const workMode = isWorkEntry(r);
    const label = `${r.artist} — ${r.title}`;
    const progress = `[${idx + 1}/${input.length}]`;

    // ── 1. Re-diagnostic de l'id actuel avec les règles assouplies ────────
    // Conservé hors du try : sert aussi de repli si la recherche ne donne rien.
    let curTitleOk = false;
    let curVersionOk = false;
    let curLabel = '';
    if (currentId) {
      try {
        const cur = await apple.getTrack(currentId);
        await sleep(THROTTLE_MS);
        if (cur) {
          const versionIssue = badVersion(cur.title, cur.album);
          const artistOk = workMode || sameArtist(cur.artist, dbTrack.artist);
          const titleOk =
            titleCore(cur.title) === titleCore(dbTrack.title) ||
            titleCore(cur.title).startsWith(titleCore(dbTrack.title)) ||
            titleCore(dbTrack.title).startsWith(titleCore(cur.title));
          if (!versionIssue && artistOk && titleOk) {
            keep.push([
              r.artist,
              r.title,
              currentId,
              cur.title,
              cur.artist,
              workMode
                ? 'œuvre : titre conforme'
                : 'faux positif rematch (variante de nom d’artiste)',
            ]);
            console.info(
              `✅ ${progress} CONSERVÉ — ${label}\n   ${currentId} → « ${cur.title} » — ${cur.artist}`,
            );
            continue;
          }
          curTitleOk = titleOk;
          curVersionOk = !versionIssue;
          curLabel = `« ${cur.title} » — ${cur.artist}`;
          console.info(
            `🔎 ${progress} ${label}\n   id actuel ${currentId} → « ${cur.title} » — ${cur.artist}` +
              `\n   défaut : ${versionIssue ?? (!artistOk ? 'artiste réellement différent' : 'TITRE différent')}`,
          );
        } else {
          console.info(
            `🔎 ${progress} ${label}\n   id actuel ${currentId} introuvable au catalogue`,
          );
        }
      } catch (err) {
        apiErrors += 1;
        consecutiveErrors += 1;
        console.error(
          `[Arbitrage] ERREUR lookup ${label} : ${err instanceof Error ? err.message : 'inconnue'}`,
        );
        if (consecutiveErrors >= 5) {
          console.error(
            '[Arbitrage] ARRÊT — 5 erreurs API consécutives. Rien d’exploitable, on ne continue pas.',
          );
          break;
        }
        await sleep(THROTTLE_MS);
        continue;
      }
      consecutiveErrors = 0;
    } else {
      console.info(`🔎 ${progress} ${label}\n   aucun apple_music_id`);
    }

    // ── 2. Recherche d'un remplaçant ──────────────────────────────────────
    let outcome: SearchOutcome;
    try {
      outcome = await searchBest(dbTrack.title, dbTrack.artist, year, workMode, currentId);
    } catch (err) {
      apiErrors += 1;
      consecutiveErrors += 1;
      console.error(
        `[Arbitrage] ERREUR recherche ${label} : ${err instanceof Error ? err.message : 'inconnue'}`,
      );
      if (consecutiveErrors >= 5) {
        console.error(
          '[Arbitrage] ARRÊT — 5 erreurs API consécutives. Rien d’exploitable, on ne continue pas.',
        );
        break;
      }
      continue;
    }
    consecutiveErrors = 0;

    if (!outcome.best) {
      // Repli : rien de mieux trouvé, mais l'id actuel joue LE BON TITRE dans
      // une version standard — seul le crédit d'interprète diffère (« Hélène »
      // pour « Hélène Rollès », « disiz » pour « Disiz la Peste »). Le morceau
      // est jouable : on le garde, en le marquant À CONFIRMER.
      if (currentId && curTitleOk && curVersionOk) {
        keep.push([
          r.artist,
          r.title,
          currentId,
          curLabel,
          '',
          'À CONFIRMER — titre et version conformes, interprète crédité autrement sur Apple',
        ]);
        console.info(`   ✅ conservé À CONFIRMER — ${currentId} → ${curLabel}`);
        continue;
      }
      unresolved.push([
        r.artist,
        r.title,
        currentId ?? '',
        String(outcome.scanned),
        String(outcome.rejectedVersion),
        String(outcome.rejectedArtist),
        String(group.length),
        r.playlists,
      ]);
      console.info(
        `   ❌ rien de jouable (${outcome.scanned} candidats, ${outcome.rejectedVersion} rejetés version, ${outcome.rejectedArtist} artiste)`,
      );
      continue;
    }

    const b = outcome.best;

    // Les œuvres ne sont JAMAIS écrites automatiquement : l'interprète n'étant
    // pas contraint, seul un humain peut valider « qui » doit chanter.
    if (workMode) {
      works.push([
        r.artist,
        r.title,
        currentId ?? '',
        b.id,
        b.name,
        b.artist,
        b.album ?? '',
        String(b.score),
        String(group.length),
      ]);
      console.info(
        `   🎭 œuvre — candidat ${b.id} → « ${b.name} » — ${b.artist} (score ${b.score})`,
      );
      continue;
    }

    replace.push([
      r.artist,
      r.title,
      currentId ?? '',
      b.id,
      b.name,
      b.artist,
      b.album ?? '',
      b.year ? String(b.year) : '',
      String(b.score),
      b.reasons.join(' / '),
      String(group.length),
    ]);
    console.info(
      `   🔄 REMPLACER → ${b.id} → « ${b.name} » — ${b.artist}${b.album ? ` [${b.album}]` : ''} (score ${b.score} : ${b.reasons.join(', ')})`,
    );

    if (apply) {
      for (const g of group) rollback[g.id] = g.apple_music_id;
      await prisma.officialPlaylistTrack.updateMany({
        where: { id: { in: group.map((g) => g.id) } },
        data: { apple_music_id: b.id },
      });
      written += group.length;
    }
  }

  /* ───────────────────────────── écriture ──────────────────────────────── */

  if (!existsSync(EXPORT_DIR)) mkdirSync(EXPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
  const out = (name: string): string => resolve(EXPORT_DIR, `apple-arbitrage-${name}-${stamp}`);

  writeFileSync(`${out('keep')}.tsv`, tsv(keep), 'utf8');
  writeFileSync(`${out('replace')}.tsv`, tsv(replace), 'utf8');
  writeFileSync(`${out('oeuvres')}.tsv`, tsv(works), 'utf8');
  writeFileSync(`${out('unresolved')}.tsv`, tsv(unresolved), 'utf8');
  if (apply) writeFileSync(`${out('rollback')}.json`, JSON.stringify(rollback, null, 2), 'utf8');

  console.info('\n[Arbitrage] ═══════════ SUMMARY ═══════════');
  console.info(`  Morceaux en entrée      : ${input.length}`);
  console.info(`  CONSERVÉS (faux positif): ${keep.length - 1}`);
  console.info(`  À REMPLACER             : ${replace.length - 1}`);
  console.info(`  ŒUVRES (décision Thomas): ${works.length - 1}`);
  console.info(`  NON RÉSOLUS             : ${unresolved.length - 1}`);
  console.info(`  Absents de la base      : ${missingInDb}`);
  console.info(
    `  Lignes écrites          : ${apply ? written : '0 (DRY-RUN — relancer avec --apply)'}`,
  );
  console.info(`  Erreurs API             : ${apiErrors}`);
  console.info(`\n  Fichiers : ${EXPORT_DIR}/apple-arbitrage-*-${stamp}.*`);
  console.info('[Arbitrage] ════════════════════════════════');
}

main()
  .catch((err) => {
    console.error('[Arbitrage] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
