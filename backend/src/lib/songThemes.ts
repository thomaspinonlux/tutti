/**
 * songThemes.ts — feat/song-tags-classification (ÉTAPE 1)
 *
 * Vocabulaire canonique des THÈMES portés par `Song.themes[]`.
 * Source de vérité côté code (vs DB libre) — un thème ajouté ici devient
 * disponible immédiatement pour le tagging (ÉTAPE 3), l'UI de vérif (ÉTAPE 4)
 * et les requêtes playlist (ÉTAPE 5).
 *
 * Une playlist = requête (theme, langue, niveau_max) → pool = Songs matchant.
 * Les `family` servent au regroupement visuel dans le filtre de l'UI ; elles
 * ne changent pas la sémantique de matching (un thème reste un slug plat).
 *
 * `is_work: true` → thème "œuvre" : pour ces morceaux la RÉPONSE et l'affichage
 * sont le nom de l'œuvre (`Song.work_title`), pas l'artiste (cf. ÉTAPE 2).
 */

export type SongThemeFamily = 'decade' | 'genre' | 'mood' | 'work' | 'format';

export interface SongThemeDef {
  /** Slug stable stocké dans `Song.themes[]`. */
  slug: string;
  label_fr: string;
  label_en: string;
  family: SongThemeFamily;
  /** Thème "œuvre" : réponse = nom de l'œuvre (work_title) et non l'artiste. */
  is_work?: boolean;
}

export const SONG_THEMES: SongThemeDef[] = [
  // ── Décennies ───────────────────────────────────────────────────────────
  { slug: 'annees_60', label_fr: 'Années 60', label_en: '60s', family: 'decade' },
  { slug: 'annees_70', label_fr: 'Années 70', label_en: '70s', family: 'decade' },
  { slug: 'annees_80', label_fr: 'Années 80', label_en: '80s', family: 'decade' },
  { slug: 'annees_90', label_fr: 'Années 90', label_en: '90s', family: 'decade' },
  { slug: 'annees_2000', label_fr: 'Années 2000', label_en: '2000s', family: 'decade' },
  { slug: 'annees_2010', label_fr: 'Années 2010', label_en: '2010s', family: 'decade' },
  { slug: 'annees_2020', label_fr: 'Années 2020', label_en: '2020s', family: 'decade' },

  // ── Genres ──────────────────────────────────────────────────────────────
  { slug: 'rock', label_fr: 'Rock', label_en: 'Rock', family: 'genre' },
  { slug: 'metal', label_fr: 'Metal & Hard Rock', label_en: 'Metal & Hard Rock', family: 'genre' },
  { slug: 'punk', label_fr: 'Punk Rock', label_en: 'Punk Rock', family: 'genre' },
  {
    slug: 'new_wave',
    label_fr: 'New Wave & Synthpop',
    label_en: 'New Wave & Synthpop',
    family: 'genre',
  },
  { slug: 'britpop', label_fr: 'Britpop', label_en: 'Britpop', family: 'genre' },
  { slug: 'disco_funk', label_fr: 'Disco & Funk', label_en: 'Disco & Funk', family: 'genre' },
  { slug: 'italo_disco', label_fr: 'Italo Disco', label_en: 'Italo Disco', family: 'genre' },
  { slug: 'electro_edm', label_fr: 'Electro & EDM', label_en: 'Electro & EDM', family: 'genre' },
  { slug: 'french_touch', label_fr: 'French Touch', label_en: 'French Touch', family: 'genre' },
  { slug: 'rap_fr', label_fr: 'Rap Français', label_en: 'French Rap', family: 'genre' },
  { slug: 'rap_us', label_fr: 'Rap US', label_en: 'US Rap', family: 'genre' },
  { slug: 'hiphop_fr', label_fr: 'Hip-Hop FR', label_en: 'French Hip-Hop', family: 'genre' },
  { slug: 'reggae', label_fr: 'Reggae', label_en: 'Reggae', family: 'genre' },
  { slug: 'soul_rnb', label_fr: 'Soul & R&B', label_en: 'Soul & R&B', family: 'genre' },
  { slug: 'country', label_fr: 'Country', label_en: 'Country', family: 'genre' },
  { slug: 'latino', label_fr: 'Latino', label_en: 'Latino', family: 'genre' },
  { slug: 'afrobeats', label_fr: 'Afrobeats', label_en: 'Afrobeats', family: 'genre' },

  // ── Ambiances / occasions ─────────────────────────────────────────────────
  { slug: 'apero', label_fr: 'Apéro & Afterwork', label_en: 'Drinks & Afterwork', family: 'mood' },
  { slug: 'ete', label_fr: 'Été — Piscine & Apéro', label_en: 'Summer', family: 'mood' },
  { slug: 'roadtrip', label_fr: 'Roadtrip', label_en: 'Roadtrip', family: 'mood' },
  { slug: 'anniversaire', label_fr: 'Anniversaire', label_en: 'Birthday', family: 'mood' },
  { slug: 'mariage', label_fr: 'Mariage', label_en: 'Wedding', family: 'mood' },
  {
    slug: 'amour',
    label_fr: "Chansons d'amour / Saint-Valentin",
    label_en: 'Love Songs',
    family: 'mood',
  },
  { slug: 'halloween', label_fr: 'Halloween', label_en: 'Halloween', family: 'mood' },
  { slug: 'noel', label_fr: 'Noël', label_en: 'Christmas', family: 'mood' },
  { slug: 'nouvel_an', label_fr: 'Nouvel An', label_en: 'New Year', family: 'mood' },
  {
    slug: 'chants_stade',
    label_fr: 'Chants de stade',
    label_en: 'Stadium Anthems',
    family: 'mood',
  },
  { slug: 'karaoke', label_fr: 'Karaoké', label_en: 'Karaoke', family: 'mood' },
  { slug: 'boomers', label_fr: 'Boomers (60 ans et +)', label_en: 'Boomers (60+)', family: 'mood' },
  { slug: 'enfants', label_fr: 'Enfants (4–8 ans)', label_en: 'Kids (4–8)', family: 'mood' },

  // ── Œuvres (réponse = nom de l'œuvre) ─────────────────────────────────────
  {
    slug: 'cinema',
    label_fr: 'Musique de Film',
    label_en: 'Movie Soundtracks',
    family: 'work',
    is_work: true,
  },
  {
    slug: 'series_tv',
    label_fr: 'Génériques de Séries TV',
    label_en: 'TV Series Themes',
    family: 'work',
    is_work: true,
  },
  {
    slug: 'dessins_animes',
    label_fr: 'Dessins animés (Club Dorothée)',
    label_en: 'Cartoons',
    family: 'work',
    is_work: true,
  },
  { slug: 'disney', label_fr: 'Disney', label_en: 'Disney', family: 'work', is_work: true },
  {
    slug: 'jeux_video',
    label_fr: 'Jeux Vidéo',
    label_en: 'Video Games',
    family: 'work',
    is_work: true,
  },
  {
    slug: 'comedies_musicales',
    label_fr: 'Comédies musicales',
    label_en: 'Musicals',
    family: 'work',
    is_work: true,
  },
  { slug: 'james_bond', label_fr: 'James Bond', label_en: 'James Bond', family: 'work' },
  { slug: 'eurovision', label_fr: 'Eurovision', label_en: 'Eurovision', family: 'work' },

  // ── Formats ───────────────────────────────────────────────────────────────
  {
    slug: 'one_hit_wonders',
    label_fr: 'One-Hit Wonders',
    label_en: 'One-Hit Wonders',
    family: 'format',
  },
  { slug: 'duos', label_fr: 'Duos cultes', label_en: 'Iconic Duets', family: 'format' },
  { slug: 'reprises', label_fr: 'Reprises célèbres', label_en: 'Famous Covers', family: 'format' },
  {
    slug: 'boys_girls_bands',
    label_fr: 'Boys Bands & Girl Bands',
    label_en: 'Boy & Girl Bands',
    family: 'format',
  },
  { slug: 'pubs', label_fr: 'Pubs cultes', label_en: 'Iconic Ads', family: 'format' },
  {
    slug: 'chanson_fr_classique',
    label_fr: 'Chanson Française Classique',
    label_en: 'French Classics',
    family: 'format',
  },
  {
    slug: 'italie_classique',
    label_fr: 'Italie classique',
    label_en: 'Italian Classics',
    family: 'format',
  },
];

/** Set des slugs valides — validation rapide (tagging, API, UI). */
export const SONG_THEME_SLUGS: ReadonlySet<string> = new Set(SONG_THEMES.map((t) => t.slug));

/** Slugs des thèmes "œuvre" (réponse = work_title). */
export const WORK_THEME_SLUGS: ReadonlySet<string> = new Set(
  SONG_THEMES.filter((t) => t.is_work).map((t) => t.slug),
);

const THEME_BY_SLUG: ReadonlyMap<string, SongThemeDef> = new Map(
  SONG_THEMES.map((t) => [t.slug, t]),
);

export function isValidThemeSlug(slug: string): boolean {
  return SONG_THEME_SLUGS.has(slug);
}

export function getSongTheme(slug: string): SongThemeDef | undefined {
  return THEME_BY_SLUG.get(slug);
}
