/**
 * officialThemes.ts — feat/tv-host-catalog-parity
 *
 * SOURCE UNIQUE du layout catalogue officiel : groupe les playlists officielles
 * en SECTIONS par catégorie → chacune contient ses THÈMES → chaque thème ses
 * variantes de niveau (easy/medium/hard/mix). Utilisé à la fois par :
 *   - le host (RoundSelectionScreen) — interactif (clic → niveaux ou pick) ;
 *   - le mirror TV (ScreenPlaylistGridView) — read-only + highlight.
 * Les deux passent par <OfficialCatalogSections> alimenté par buildThemeSections
 * → même structure, mêmes sections, mêmes cartes. Un changement ici se reflète
 * automatiquement des deux côtés (plus de divergence host/TV).
 *
 * Le champ `difficulty` de la DB MENT (80s-hard stocké MEDIUM) → le niveau est
 * dérivé du SUFFIXE du slug (-easy/-medium/-hard/-mix), seule source fiable.
 */
import type { LibraryCategoryWithPlaylists, LibraryPlaylistSummary } from './library.js';

export type LevelKey = 'easy' | 'medium' | 'hard' | 'mix';
export const LEVEL_ORDER: Record<LevelKey, number> = { easy: 0, medium: 1, hard: 2, mix: 3 };

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
      g.variants.push({ level: d.level, playlist: p });
    }
    const themes = order.map((k) => map.get(k)!);
    for (const g of themes) {
      g.variants.sort(
        (a, b) => (a.level ? LEVEL_ORDER[a.level] : 9) - (b.level ? LEVEL_ORDER[b.level] : 9),
      );
      // cover = variante Mix si présente, sinon la 1ʳᵉ (après tri).
      g.cover = (g.variants.find((v) => v.level === 'mix') ?? g.variants[0]!).playlist;
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
