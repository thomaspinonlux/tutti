/**
 * officialThemes.ts — feat/host-tv-catalog-parity-v2
 *
 * SOURCE UNIQUE du layout catalogue officiel : groupe les playlists officielles
 * en SECTIONS par catégorie → chacune ses THÈMES → chaque thème ses variantes
 * de niveau (easy/medium/hard/mix). Consommée par :
 *   - host (RoundSelectionScreen) — interactif (clic → niveaux ou pick) ;
 *   - mirror TV (ScreenPlaylistGridView) — read-only + highlight.
 * Les deux passent par <OfficialCatalogSections> alimenté par buildThemeSections
 * → même structure, mêmes sections, mêmes cartes (un changement ici se reflète
 * automatiquement des deux côtés, plus de divergence host/TV).
 *
 * Note : le champ `difficulty` de la DB MENT (80s-hard stocké MEDIUM) → le
 * niveau est dérivé du SUFFIXE du slug (-easy/-medium/-hard/-mix), seule
 * source fiable.
 */
import type { LibraryCategoryWithPlaylists, LibraryPlaylistSummary } from './library.js';

export type LevelKey = 'easy' | 'medium' | 'hard' | 'mix';
export const LEVEL_ORDER: Record<LevelKey, number> = { easy: 0, medium: 1, hard: 2, mix: 3 };

// feat/thematic-level-filter — seuil mini de tracks par niveau pour proposer le
// sous-picker (et garde-fou backend au tirage). Le sous-picker n'apparaît que si
// ≥2 niveaux atteignent ce seuil chacun ; sinon la thématique reste une carte.
export const THEMATIC_LEVEL_MIN = 15;
// Mapping niveau-carte (LevelKey) → difficulty catalogue. Le suffixe slug des
// DÉCENNIES utilise 'hard' ; le champ difficulty catalogue utilise 'EXPERT'.
const LEVEL_TO_DIFFICULTY: Record<'easy' | 'medium' | 'hard', 'EASY' | 'MEDIUM' | 'EXPERT'> = {
  easy: 'EASY',
  medium: 'MEDIUM',
  hard: 'EXPERT',
};

export function deriveTheme(
  slug: string,
  nameFr: string,
): { key: string; name: string; level: LevelKey | null } {
  const base = slug.replace(/^official-pl-/, '');
  const m = base.match(/^(.+)-(easy|medium|hard|mix)$/);
  if (m) {
    return {
      key: m[1]!,
      name: nameFr
        .replace(/\s*[—–-]\s*(Facile|Moyen|Difficile|Mix|Easy|Medium|Hard)\s*$/i, '')
        .trim(),
      level: m[2] as LevelKey,
    };
  }
  return { key: base, name: nameFr, level: null };
}

export interface ThemeVariant {
  level: LevelKey | null;
  playlist: LibraryPlaylistSummary;
  /**
   * feat/thematic-level-filter — id STABLE pour key React + ancre mirror
   * (`data-focus-playlist-id`). Décennies : = playlist.id (1 playlist/niveau →
   * INCHANGÉ, mirror #121 identique). Thématique éclatée : `${id}::${level}`
   * (mêmes playlist.id sur plusieurs cartes → besoin d'un id unique distinct).
   */
  variantId: string;
  /**
   * feat/thematic-level-filter — difficulty à passer au launch (clone-filtré).
   * Défini UNIQUEMENT pour les cartes de niveau d'une thématique éclatée
   * (easy/medium/hard). undefined pour Mix et pour les décennies (le niveau y
   * est déjà une playlist séparée → pas de filtre difficulty).
   */
  difficulty?: 'EASY' | 'MEDIUM' | 'EXPERT';
  /** Nb de tracks de ce niveau (affichage). undefined → playlist.track_count. */
  count?: number;
}
export interface ThemeGroup {
  key: string;
  name: string;
  /** Playlist représentative pour la cover (variante Mix si dispo, sinon 1ʳᵉ). */
  cover: LibraryPlaylistSummary;
  variants: ThemeVariant[];
}
export interface CategoryThemeSection {
  slug: string;
  label_fr: string;
  label_en: string;
  themes: ThemeGroup[];
}

/**
 * feat/thematic-level-filter — éclate une thématique en variantes de niveau si
 * sa répartition difficulty le justifie. Retourne null si la règle n'est pas
 * remplie (< 2 niveaux à ≥ THEMATIC_LEVEL_MIN) → le thème reste une carte.
 *
 * Variantes produites (ordonnées) : une carte par niveau ATTEIGNANT le seuil
 * (Facile/Moyen/Expert) + toujours une carte Mix (tous niveaux). On masque les
 * niveaux sous le seuil pour ne jamais proposer une carte qui retomberait en
 * fallback Mix côté backend.
 */
export function expandThematicLevels(p: LibraryPlaylistSummary): ThemeVariant[] | null {
  const counts = p.difficulty_counts;
  if (!counts) return null;
  const levels: Array<{ level: 'easy' | 'medium' | 'hard'; count: number }> = [
    { level: 'easy', count: counts.EASY },
    { level: 'medium', count: counts.MEDIUM },
    { level: 'hard', count: counts.EXPERT },
  ];
  const qualifying = levels.filter((l) => l.count >= THEMATIC_LEVEL_MIN);
  if (qualifying.length < 2) return null; // règle : ≥2 niveaux ≥15 → sinon une carte
  const variants: ThemeVariant[] = qualifying.map((l) => ({
    level: l.level,
    playlist: p,
    variantId: `${p.id}::${l.level}`,
    difficulty: LEVEL_TO_DIFFICULTY[l.level],
    count: l.count,
  }));
  // Carte Mix (tous niveaux) — difficulty undefined → clone complet côté backend.
  variants.push({
    level: 'mix',
    playlist: p,
    variantId: `${p.id}::mix`,
    count: p.track_count,
  });
  return variants;
}

/**
 * Groupe les catégories (déjà filtrées par recherche/provider) en sections de
 * thèmes. Préserve l'ordre des catégories tel que renvoyé par le backend
 * (PLAYLIST_CATEGORIES.order). Drop les catégories vides.
 */
export function buildThemeSections(
  categories: LibraryCategoryWithPlaylists[],
): CategoryThemeSection[] {
  const sections: CategoryThemeSection[] = [];
  for (const cat of categories) {
    const map = new Map<string, ThemeGroup>();
    const order: string[] = [];
    for (const p of cat.playlists) {
      const d = deriveTheme(p.slug, p.name_fr);
      let g = map.get(d.key);
      if (!g) {
        g = { key: d.key, name: d.name, cover: p, variants: [] };
        map.set(d.key, g);
        order.push(d.key);
      }
      g.variants.push({ level: d.level, playlist: p, variantId: p.id });
    }
    const themes = order.map((k) => map.get(k)!);
    for (const g of themes) {
      g.variants.sort(
        (a, b) => (a.level ? LEVEL_ORDER[a.level] : 9) - (b.level ? LEVEL_ORDER[b.level] : 9),
      );
      // cover = variante Mix si présente, sinon la 1ʳᵉ (après tri).
      g.cover = (g.variants.find((v) => v.level === 'mix') ?? g.variants[0]!).playlist;
      // feat/thematic-level-filter — éclate une THÉMATIQUE plate (1 seule
      // variante, sans suffixe slug de niveau) en sous-cartes Facile/Moyen/
      // Expert/Mix SSI ≥2 niveaux ont chacun ≥15 tracks (champ difficulty
      // catalogue, fiable pour les thématiques curées). Sinon : laissée telle
      // quelle → une seule carte (legacy plates tout-MEDIUM incluses).
      // Décennies (variantes slug, level ≠ null) : jamais touchées.
      if (g.variants.length === 1 && g.variants[0]!.level === null) {
        const expanded = expandThematicLevels(g.variants[0]!.playlist);
        if (expanded) g.variants = expanded;
      }
    }
    if (themes.length > 0) {
      sections.push({ slug: cat.slug, label_fr: cat.label_fr, label_en: cat.label_en, themes });
    }
  }
  return sections;
}

/** Aplatit les sections en map key→ThemeGroup (lookup du thème sélectionné). */
export function flattenThemes(sections: CategoryThemeSection[]): Map<string, ThemeGroup> {
  const m = new Map<string, ThemeGroup>();
  for (const s of sections) for (const t of s.themes) m.set(t.key, t);
  return m;
}
