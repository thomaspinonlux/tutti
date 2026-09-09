/**
 * Génération d'aliases initiaux pour un track.
 *
 * Quand on ajoute un morceau à une playlist, on pré-remplit les aliases
 * artist/title avec des variantes normalisées : minuscules + sans accents +
 * sans parenthèses ("(Radio Edit)", "(feat. X)"). L'utilisateur peut
 * ensuite enrichir manuellement via l'éditeur d'aliases.
 *
 * Ces aliases servent au matching vocal Whisper en étape 11+.
 */

/**
 * Normalisation canonique d'un alias de matching vocal :
 * minuscules, accents retirés (NFD), parenthèses/crochets retirés,
 * ponctuation (traits d'union inclus) → espaces, espaces réduits.
 *
 * Exporté (basicNormalize) pour que les backfills d'alias écrivent la MÊME
 * forme que l'import initial — une seule source de vérité, cf.
 * scripts/backfillWorkTranslations.ts.
 */
export function basicNormalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/\s*\([^)]*\)\s*/gu, ' ')
    .replace(/\s*\[[^\]]*\]\s*/gu, ' ')
    .replace(/[^a-z0-9' ]+/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Génère les aliases initiaux pour un nom d'artiste / titre.
 * Toujours dédupliqué + jamais vide (au minimum la version normalisée).
 *
 * Règles génériques (artist + title) :
 *   - version originale + version normalisée
 *   - sans article en tête (the/le/la/les)
 *   - sans suffixe feat./ft./& (ne garde que la partie principale)
 *
 * Règles spécifiques artiste (mode='artist') :
 *   - dernier mot (souvent nom de famille — "Cabrel" pour "Francis Cabrel")
 *   - premier mot (souvent prénom — "Francis")
 */
export function generateAliases(raw: string, mode: 'artist' | 'title' = 'title'): string[] {
  const set = new Set<string>();
  const trimmed = raw.trim();
  if (!trimmed) return [];

  set.add(trimmed); // version originale (avec casse + accents)
  set.add(basicNormalize(trimmed));

  // Sans articles "the/le/la/les" en tête, fréquent dans les groupes anglo
  const noLeading = trimmed.replace(/^(the|le|la|les)\s+/iu, '').trim();
  if (noLeading && noLeading !== trimmed) {
    set.add(noLeading);
    set.add(basicNormalize(noLeading));
  }

  // Pour les artistes "X feat. Y" / "X & Y" / "X, Y" → ne garder que X
  const lead = trimmed.split(/\s*(?:feat\.?|ft\.?|featuring|&|,)\s*/iu)[0];
  if (lead && lead !== trimmed) {
    set.add(lead);
    set.add(basicNormalize(lead));
  }

  // Pour un artiste : ajouter dernier + premier mot (nom famille / prénom)
  if (mode === 'artist') {
    const baseForSplit = lead || trimmed;
    const words = baseForSplit.split(/\s+/u).filter((w) => w.length > 0);
    if (words.length >= 2) {
      const last = words[words.length - 1]!;
      const first = words[0]!;
      set.add(last);
      set.add(basicNormalize(last));
      set.add(first);
      set.add(basicNormalize(first));
    }
  }

  return [...set].filter((s) => s.length >= 2);
}

/**
 * fix/alias-de-titre-qui-designent-l-artiste — FILTRE OBLIGATOIRE AVANT
 * D'ÉCRIRE DES ALIAS DE TITRE.
 *
 * Constat du 09/09 : 79,7 % des morceaux avaient, dans leurs alias de TITRE,
 * un alias qui était exactement le nom de l'ARTISTE ("calvin harris" sur
 * « Summer », "major lazer" sur « Lean On », "wiz khalifa" sur « See You
 * Again »). Conséquence en jeu, mesurée sur les buzz de la soirée : un joueur
 * qui donnait le NOM DU GROUPE était compté « titre trouvé » et « artiste non
 * trouvé » — donc jamais de bonus double, et un tableau qui annonçait l'inverse
 * de ce qui avait été dit. 16 460 alias étaient dans ce cas au catalogue.
 *
 * Ces alias venaient d'un enrichissement phonétique, pas de generateAliases.
 * Ce filtre est la garde qui empêche qu'ils reviennent, quelle que soit la
 * source : un alias de titre qui désigne l'artiste est retiré, SAUF s'il
 * partage un mot avec le titre (cas légitime « Rita Mitsouko » pour
 * « Marcia Baïla », ou un titre qui contient vraiment le nom du groupe).
 */
export function retirerAliasDeTitreQuiDesignentLArtiste(
  aliasesTitre: string[],
  titre: string,
  artiste: string,
  aliasesArtiste: string[] = [],
): string[] {
  const formes = new Set(
    [
      ...decouperArtiste(artiste),
      ...aliasesArtiste.map(basicNormalize),
    ].filter((f) => f.length >= 3),
  );
  if (formes.size === 0) return aliasesTitre;
  const motsDuTitre = basicNormalize(titre)
    .split(' ')
    .filter((m) => m.length >= 3);
  return aliasesTitre.filter((alias) => {
    const n = basicNormalize(alias);
    if (!n) return false;
    // Partage un mot avec le titre → c'est bien un alias de titre.
    if (motsDuTitre.some((m) => n.split(' ').includes(m))) return true;
    return !formes.has(n);
  });
}

/**
 * Découpe un nom d'artiste en ses formes utiles : le nom entier, et chaque
 * partie séparée par &, virgule, feat., ft., featuring, avec, vs, x.
 * « Major Lazer & DJ Snake ft. MØ » → ["major lazer dj snake ft mo",
 * "major lazer", "dj snake", "mo"].
 */
export function decouperArtiste(nom: string): string[] {
  const brut = (nom ?? '').trim();
  if (!brut) return [];
  const parts = brut
    .split(/\s*(?:&|,|\/|\+|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bavec\b|\bvs\.?\b|\bwith\b|\sx\s)\s*/giu)
    .map((p) => basicNormalize(p))
    .filter((p) => p.length >= 2);
  return Array.from(new Set([basicNormalize(brut), ...parts])).filter((p) => p.length >= 2);
}
