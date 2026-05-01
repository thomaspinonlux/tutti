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
