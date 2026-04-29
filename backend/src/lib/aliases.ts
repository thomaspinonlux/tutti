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

function basicNormalize(s: string): string {
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
 */
export function generateAliases(raw: string): string[] {
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

  return [...set].filter((s) => s.length >= 2);
}
