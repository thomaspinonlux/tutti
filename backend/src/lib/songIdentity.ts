/**
 * src/lib/songIdentity.ts — « EST-CE LA MÊME CHANSON ? »
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * Règle de jeu demandée par Thomas : dans UNE MÊME PARTIE, une chanson ne
 * passe JAMAIS deux fois — ni dans la même manche, ni d'une manche à l'autre.
 *
 * Partie du 16/10/2026 au Komptoir : « Under Pressure » est sorti deux fois
 * dans la même manche (Queen, puis Queen & David Bowie), et « Just Can't Get
 * Enough » / « Rock the Night » sont repassés d'une manche à l'autre. Cause :
 * chaque playlist pointe sur SON exemplaire Apple Music (album original,
 * best-of, remaster…). Les identifiants diffèrent, `song_id` est souvent vide,
 * donc le filtre par identifiant laissait passer la même chanson.
 *
 * On compare donc la chanson elle-même : titre nettoyé + au moins un artiste
 * en commun. Deux reprises par des artistes différents (Cohen / Buckley pour
 * « Hallelujah ») restent deux chansons distinctes.
 *
 * Module PUR (aucune dépendance) → testé dans songIdentity.test.ts.
 */

const ACCENTS = /[̀-ͯ]/g;

function basic(s: string): string {
  return s
    .normalize('NFD')
    .replace(ACCENTS, '')
    .toLowerCase()
    .replace(/[’'`´]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Titre réduit à la chanson : on retire tout ce qui décrit une ÉDITION
 * (parenthèses, crochets, « - Remastered 2011 », « feat. X »…).
 */
export function songTitleKey(title: string | null | undefined): string {
  let t = (title ?? '').trim();
  // Parenthèses / crochets : (Remastered), [Radio Edit], (feat. X)…
  t = t.replace(/\s*[([{][^)\]}]*[)\]}]/g, ' ');
  // Suffixe après tiret : « Song - 2011 Remaster », « Song – Radio Edit »
  t = t.replace(/\s+[-–—]\s+.*$/, '');
  // feat. resté hors parenthèses
  t = t.replace(/\s+(feat\.?|ft\.?|featuring)\s+.*$/i, '');
  const key = basic(t);
  // Titre fait uniquement de parenthèses (rare) : on garde le titre brut.
  return key || basic(title ?? '');
}

const SEPARATEURS =
  /\s*(?:,|&|\+|\/|;|\bfeat\.?|\bft\.?|\bfeaturing\b|\bavec\b|\bwith\b|\band\b|\bet\b|\bx\b|\bvs\.?)\s*/i;

/** Chaque artiste crédité, normalisé (« Queen & David Bowie » → queen, david bowie). */
export function artistKeys(artist: string | null | undefined): string[] {
  const raw = (artist ?? '').trim();
  if (!raw) return [];
  const parts = raw
    .split(new RegExp(SEPARATEURS.source, 'gi'))
    .map((p) => basic(p).replace(/^the /, ''))
    .filter((p) => p.length > 0);
  const out = new Set(parts);
  // Le nom complet compte aussi (groupes au nom composé : « Earth, Wind & Fire »).
  const full = basic(raw).replace(/^the /, '');
  if (full) out.add(full);
  return [...out];
}

/**
 * Mots d'artiste trop courants pour identifier quelqu'un (« The Jimi Hendrix
 * Experience » et « Jimi Hendrix » partagent « hendrix » ; « London Symphony
 * Orchestra » ne doit rien partager avec « Royal Philharmonic Orchestra »).
 */
const MOTS_VIDES = new Set([
  'the', 'and', 'les', 'feat', 'featuring', 'with', 'avec', 'orchestra', 'orchestre', 'symphony',
  'symphonic', 'philharmonic', 'philharmonique', 'national', 'royal', 'london', 'city', 'cast',
  'band', 'chorus', 'choir', 'ensemble', 'music', 'original', 'bande', 'originale', 'soundtrack',
  'motion', 'picture', 'version', 'group', 'brothers', 'sisters', 'boys', 'girls', 'big', 'lil',
  'little', 'des', 'del', 'los', 'las', 'his', 'her', 'their', 'friends', 'crew', 'gang',
]);

/** Crédits génériques : l'interprète n'est pas connu, seul le titre compte. */
const CREDIT_GENERIQUE = /^(bande originale|disney|comptine|soundtrack|original soundtrack|various artists|artistes divers|cast|.* cast)$/;

/** « P!nk » s'écrit aussi « Pink ». */
function artisteNormalise(artist: string | null | undefined): string {
  return basic((artist ?? '').replace(/!/g, 'i'));
}

function artistTokens(artist: string | null | undefined): Set<string> {
  const out = new Set<string>();
  const mots = artisteNormalise(artist).split(' ').filter((w) => w.length > 0);
  for (const w of mots) {
    if (w.length >= 3 && !MOTS_VIDES.has(w)) out.add(w);
  }
  // Sigle : « OMD » = « Orchestral Manoeuvres in the Dark ».
  const sigle = mots
    .filter((w) => w.length >= 3 && !MOTS_VIDES.has(w))
    .map((w) => w[0])
    .join('');
  if (sigle.length >= 2) out.add(`#${sigle}`);
  if (mots.length === 1 && mots[0]!.length >= 2 && mots[0]!.length <= 5) out.add(`#${mots[0]}`);
  return out;
}

function creditGenerique(artist: string | null | undefined): boolean {
  const b = basic(artist ?? '').replace(/^the /, '');
  return b.length === 0 || CREDIT_GENERIQUE.test(b);
}

export interface SongInfo {
  title: string | null | undefined;
  artist: string | null | undefined;
}

/** Index des chansons déjà vues : titre → ensembles d'artistes. */
interface Entree {
  keys: Set<string>;
  tokens: Set<string>;
  generique: boolean;
}

export class SongRegistry {
  private byTitle = new Map<string, Entree[]>();

  private entree(info: SongInfo): Entree {
    return {
      keys: new Set(artistKeys((info.artist ?? '').replace(/!/g, 'i'))),
      tokens: artistTokens(info.artist),
      generique: creditGenerique(info.artist),
    };
  }

  add(info: SongInfo): void {
    const t = songTitleKey(info.title);
    if (!t) return;
    const list = this.byTitle.get(t) ?? [];
    list.push(this.entree(info));
    this.byTitle.set(t, list);
  }

  has(info: SongInfo): boolean {
    const t = songTitleKey(info.title);
    if (!t) return false;
    const list = this.byTitle.get(t);
    if (!list) return false;
    const e = this.entree(info);
    return list.some((p) => {
      // Crédit générique d'un côté (« Bande originale », « Disney ») : même titre = même chanson.
      if (e.generique || p.generique) return true;
      // Un artiste crédité en commun (« Queen » / « Queen & David Bowie »).
      for (const k of e.keys) if (p.keys.has(k)) return true;
      // Un nom propre en commun (« Jimi Hendrix » / « The Jimi Hendrix Experience »,
      // « Khaled » / « Cheb Khaled & Faudel »).
      for (const k of e.tokens) if (p.tokens.has(k)) return true;
      return false;
    });
  }
}

/**
 * Garde l'ordre de `ids` et retire toute entrée dont la chanson est déjà dans
 * `already` (morceaux joués plus tôt dans la partie) ou déjà gardée plus haut
 * dans la liste (doublon dans la même playlist).
 */
export function dedupeBySong(
  ids: string[],
  infoById: Map<string, SongInfo>,
  already?: SongRegistry,
): string[] {
  const registry = already ?? new SongRegistry();
  const seenLocal = new SongRegistry();
  const out: string[] = [];
  for (const id of ids) {
    const info = infoById.get(id);
    if (!info) {
      out.push(id);
      continue;
    }
    if (registry.has(info) || seenLocal.has(info)) continue;
    seenLocal.add(info);
    out.push(id);
  }
  return out;
}

/**
 * feat/un-artiste-par-manche — UN SEUL TITRE PAR ARTISTE dans une manche.
 *
 * Partie du 23/10/2026 au Komptoir : « The Cranberries » est sorti 5 fois sur
 * 15 titres dans la manche « Rock — Années 90 — International ». Règle de
 * Thomas : un artiste ne passe qu'UNE fois par manche.
 *
 * Garde l'ordre de `ids` (déjà mélangé par l'appelant → le titre gardé pour
 * chaque artiste est tiré au hasard) et écarte tout titre dont un artiste
 * crédité est déjà présent (« Queen » / « Queen & David Bowie » = même artiste).
 * Les crédits génériques (« Bande originale », « Disney », « Comptine »…) ne
 * comptent pas comme un artiste.
 */
export function onePerArtist(ids: string[], infoById: Map<string, SongInfo>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const info = infoById.get(id);
    if (!info || creditGenerique(info.artist)) {
      out.push(id);
      continue;
    }
    const keys = artistKeys((info.artist ?? '').replace(/!/g, 'i'));
    if (keys.some((k) => seen.has(k))) continue;
    for (const k of keys) seen.add(k);
    out.push(id);
  }
  return out;
}
