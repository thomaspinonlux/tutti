/**
 * Normalisation et fuzzy matching pour le DemoProvider.
 *
 * Le matching de la recherche utilisateur ("oasis wonderwall") doit tolérer :
 *   - les accents (é → e)
 *   - la casse (Oasis = oasis)
 *   - les caractères spéciaux ([feat. X] → "")
 *   - les variations d'apostrophe (' / ’)
 *
 * La même fonction sera réutilisée par les `track_aliases` côté DB
 * (étape 8 — playlists Tracks) pour matcher les réponses parlées.
 */

export function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD') // décomposer les accents
    .replace(/[̀-ͯ]/gu, '') // supprimer les diacritiques
    .replace(/[‘’‚‛`]/gu, "'") // unifier apostrophes
    .replace(/\s*\([^)]*\)\s*/gu, ' ') // supprimer (radio edit), (feat. X)…
    .replace(/\s*\[[^\]]*\]\s*/gu, ' ')
    .replace(/[^a-z0-9' ]+/giu, ' ') // ne garder que lettres/chiffres/apostrophe
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Score de pertinence simple : combien de tokens de la query
 * sont présents dans le haystack. Préfère les correspondances
 * de tokens entiers et bonus si l'ordre est respecté.
 */
export function scoreMatch(haystack: string, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const haystackTokens = haystack.split(' ');

  let hits = 0;
  let lastIdx = -1;
  let orderedBonus = 0;
  for (const tok of queryTokens) {
    const idx = haystackTokens.findIndex((h, i) => i > lastIdx && h.includes(tok));
    if (idx !== -1) {
      hits++;
      orderedBonus += 1;
      lastIdx = idx;
    } else if (haystackTokens.some((h) => h.includes(tok))) {
      hits += 0.5;
    }
  }
  return (hits / queryTokens.length) * 100 + orderedBonus;
}
