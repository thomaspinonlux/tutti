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

export interface SongInfo {
  title: string | null | undefined;
  artist: string | null | undefined;
}

/** Index des chansons déjà vues : titre → ensembles d'artistes. */
export class SongRegistry {
  private byTitle = new Map<string, Set<string>[]>();

  add(info: SongInfo): void {
    const t = songTitleKey(info.title);
    if (!t) return;
    const list = this.byTitle.get(t) ?? [];
    list.push(new Set(artistKeys(info.artist)));
    this.byTitle.set(t, list);
  }

  has(info: SongInfo): boolean {
    const t = songTitleKey(info.title);
    if (!t) return false;
    const list = this.byTitle.get(t);
    if (!list) return false;
    const keys = artistKeys(info.artist);
    // Artiste inconnu des deux côtés : même titre = même chanson.
    if (keys.length === 0) return true;
    return list.some((set) => set.size === 0 || keys.some((k) => set.has(k)));
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
