/**
 * src/lib/comparaisonApple.ts — comparaison tolérante entre une ligne du
 * catalogue Tutti et une fiche rendue par la boutique Apple Music.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * Le premier passage de `verifierCatalogueApple.ts` sur le catalogue entier
 * (03/10/2026) a écarté 660 morceaux dont la grande majorité étaient bons :
 * « 1901 » ≠ « 1901 » (l'année d'édition était effacée du titre), « 30 Seconds
 * to Mars » ≠ « Thirty Seconds to Mars », « Siouxsie and the Banshees » ≠
 * « Siouxsie & The Banshees », « Peabo Bryson & Roberta Flack » ≠ « Roberta
 * Flack & Peabo Bryson ». Écarter un bon morceau prive la soirée d'un titre
 * connu : la comparaison doit être indulgente et ne signaler que les écarts
 * francs, ceux où l'identifiant pointe réellement sur une AUTRE chanson.
 *
 * Ces fonctions sont partagées par le contrôle automatique du serveur
 * (`appleCatalogueCheck.ts`), par le vérificateur en ligne de commande (qui
 * écarte) et par les scripts de réparation (qui cherchent le bon
 * identifiant) : tous doivent juger « même morceau » exactement de la même
 * façon, sinon la réparation propose des identifiants que la vérification
 * rejette aussitôt. C'est la raison pour laquelle ce fichier vit dans `src/` :
 * le serveur ne peut pas importer depuis `scripts/`.
 */

/** Albums dont le nom trahit une version qui n'est pas l'originale. */
export const ALBUM_PIEGE =
  /karaok|tribute|hommage|in the style of|made famous by|cover version|reprise instrumentale/i;

/** Mots-nombres ramenés aux chiffres : « nine to five » = « 9 to 5 ». */
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
export function mots(v: string | null): string[] {
  const bruts = (v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((m) => NOMBRES[m] ?? m);
  const utiles = bruts.filter((m) => !LIAISONS.has(m));
  // fix/titres-mots-liaison — UN TITRE PEUT N'ÊTRE FAIT QUE DE MOTS DE LIAISON.
  // « X » (Calogero, Nicky Jam), « Il » (Gérard Lenorman), « La La La »
  // (Naughty Boy) : après le filtrage il ne restait RIEN, la comparaison
  // répondait « titres différents », et trois morceaux parfaitement jouables
  // étaient écartés alors qu'Apple rendait EXACTEMENT le même titre. Quand le
  // filtrage vide la liste, on garde les mots bruts.
  return utiles.length > 0 ? utiles : bruts;
}

/** Les mots de `petit` sont-ils tous dans `grand` ? (ordre indifférent) */
export function inclusDans(petit: string[], grand: string[]): boolean {
  if (petit.length === 0) return false;
  const sac = new Set(grand);
  return petit.every((m) => sac.has(m));
}

/**
 * Deux libellés désignent-ils la même œuvre ? On teste le texte entier ET le
 * texte amputé de ses parenthèses, dans les deux sens : « Game of Thrones
 * (Main Title) » et « Main Title » se retrouvent ainsi.
 */
export function memeOeuvre(a: string | null, b: string | null): boolean {
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

/** Deux libellés à quelques lettres près : variante d'orthographe, pas erreur. */
export function presqueLeMemeTexte(a: string | null, b: string | null): boolean {
  const x = mots(a).join('');
  const y = mots(b).join('');
  if (!x || !y) return false;
  const court = x.length < y.length ? x : y;
  const long = x.length < y.length ? y : x;
  if (long.startsWith(court) && court.length >= 5) return true;
  if (Math.abs(x.length - y.length) > 4) return false;
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
  const distance = m[y.length]!;
  return distance <= Math.max(1, Math.floor(long.length * 0.15));
}

/**
 * L'interprète correspond-il ? On accepte que l'ordre change, que l'invité
 * manque, et on regarde AUSSI le titre rendu par Apple : la mention « feat. »
 * y migre souvent (« Best Part » crédité à Daniel Caesar, H.E.R. étant dans
 * le titre).
 */
export function memeArtiste(
  attendu: string | null,
  chezApple: string,
  titreApple: string,
): boolean {
  if (memeOeuvre(attendu, chezApple)) return true;
  return inclusDans(mots(attendu), [...mots(chezApple), ...mots(titreApple)]);
}
