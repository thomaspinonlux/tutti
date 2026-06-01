/**
 * playlistCategories.ts — feat/playlist-categories-schema
 *
 * Catalogue canonique des catégories OfficialPlaylist (inspiration
 * "This Is Blind Test" : groupes horizontaux LES CLASSIQUES, LES ORIGINAUX,
 * INTERDIT AUX +30 ANS, etc.).
 *
 * Source de vérité côté code (vs DB) — modifiable via PR. Une catégorie ajoutée
 * ici devient disponible immédiatement (les playlists doivent ensuite être
 * réaffectées via admin ou backfill SQL).
 *
 * L'ordre `order` détermine l'ordre vertical d'apparition à l'écran.
 */

export interface PlaylistCategoryDef {
  /** Slug stable (clé en DB `OfficialPlaylist.category`). */
  slug: string;
  label_fr: string;
  label_en: string;
  description_fr: string;
  description_en: string;
  /** Ordre d'affichage (plus petit = plus haut). */
  order: number;
}

/**
 * Ordre stratégique :
 *   1. classics      — accroche universelle, premier vu = familier
 *   2. originals     — différenciation Tutti
 *   3. forbidden_30  — clin d'œil humoristique fort
 *   4. wedding       — gros usage B2C
 *   5. decades       — universel décennies
 *   6. genres        — drill-down musical
 *   7. special       — thématiques niche
 */
export const PLAYLIST_CATEGORIES: PlaylistCategoryDef[] = [
  {
    slug: 'classics',
    label_fr: 'LES CLASSIQUES',
    label_en: 'THE CLASSICS',
    description_fr: 'Les incontournables du blind test',
    description_en: 'Blind test essentials',
    order: 1,
  },
  {
    slug: 'originals',
    label_fr: 'LES ORIGINAUX',
    label_en: 'THE ORIGINALS',
    description_fr: 'Les thématiques originales Tutti',
    description_en: 'Tutti original themes',
    order: 2,
  },
  {
    slug: 'forbidden_30',
    label_fr: 'INTERDIT AUX +30 ANS',
    label_en: 'NO BOOMERS ALLOWED',
    description_fr: 'Une seule règle : pas de musique de vieux',
    description_en: 'One rule: no old people music',
    order: 3,
  },
  {
    slug: 'wedding',
    label_fr: 'MARIAGE & CÉRÉMONIE',
    label_en: 'WEDDING & CEREMONY',
    description_fr: 'Pour les grands événements',
    description_en: 'For the big events',
    order: 4,
  },
  {
    slug: 'decades',
    label_fr: 'ÉPOQUES',
    label_en: 'DECADES',
    description_fr: 'Décennies emblématiques',
    description_en: 'Emblematic decades',
    order: 5,
  },
  {
    slug: 'genres',
    label_fr: 'GENRES',
    label_en: 'GENRES',
    description_fr: 'Par style musical',
    description_en: 'By musical style',
    order: 6,
  },
  {
    slug: 'special',
    label_fr: 'SPÉCIAL',
    label_en: 'SPECIAL',
    description_fr: 'Eurovision, Disney, Films…',
    description_en: 'Eurovision, Disney, Movies…',
    order: 7,
  },
];

/** Catégorie fallback pour les playlists sans `category` set en DB. */
export const UNCATEGORIZED_CATEGORY: PlaylistCategoryDef = {
  slug: 'uncategorized',
  label_fr: 'AUTRES',
  label_en: 'OTHER',
  description_fr: 'Sans catégorie',
  description_en: 'Uncategorized',
  order: 999,
};

/** Lookup map (slug → def) pour résolution rapide. */
export const PLAYLIST_CATEGORIES_BY_SLUG = new Map<string, PlaylistCategoryDef>(
  PLAYLIST_CATEGORIES.map((c) => [c.slug, c]),
);

export function getCategoryDef(slug: string | null | undefined): PlaylistCategoryDef {
  if (!slug) return UNCATEGORIZED_CATEGORY;
  return PLAYLIST_CATEGORIES_BY_SLUG.get(slug) ?? UNCATEGORIZED_CATEGORY;
}
