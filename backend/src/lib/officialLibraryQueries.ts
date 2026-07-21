/**
 * Lib partagée — queries lecture seule sur la bibliothèque officielle Tutti
 * exposées aux hosts (différent des routes admin /api/admin/library/* qui sont
 * super-admin-only).
 *
 * Filtre les playlists selon la visibilité + statut premium du user :
 *   - public        : visible à tous
 *   - premium_only  : visible uniquement si user a un plan workspace !== 'FREE'
 *   - private       : jamais visible côté host
 *
 * Inclut le calcul des compteurs source (spotify_count, youtube_count) pour
 * permettre l'affichage des badges (Sujet 2 du brief).
 */

import { prisma } from './prisma.js';
import { getCachedPlaylist, setCachedPlaylist } from './playlistCache.js';

export interface LibraryPlaylistSummary {
  id: string;
  slug: string;
  name_fr: string;
  name_en: string;
  description_fr: string | null;
  description_en: string | null;
  locale_primary: string;
  theme: string | null;
  difficulty: string;
  visibility: string;
  track_count: number;
  spotify_count: number;
  youtube_count: number;
  /**
   * feat/thematic-level-filter — répartition des tracks par difficulty
   * (EASY/MEDIUM/EXPERT) au niveau CATALOGUE. Sert au sous-picker de niveau sur
   * les playlists thématiques : affiché SSI ≥2 niveaux ont chacun ≥15 tracks
   * (sinon une seule carte). Les décennies (slug -easy/-medium/-hard) ne
   * l'utilisent pas (niveau = playlist séparée).
   */
  difficulty_counts: { EASY: number; MEDIUM: number; EXPERT: number };
  /**
   * true si premium_only ET user n'a pas le plan premium → playlist affichée
   * grisée côté UI avec cadenas. Le détail (`tracks`) reste 403 pour ces
   * playlists.
   */
  locked: boolean;
  /** feat/playlist-categories-schema — slug de catégorie (nullable legacy). */
  category: string | null;
  /** Ordre dans la catégorie (NULL → trié en fin). */
  position_in_category: number | null;
  /** Sous-titre court FR (affiché sous le titre dans les cards). */
  subtitle_fr: string | null;
  subtitle_en: string | null;
  /** fix/csp-meta-tag-and-cover-fallback — fallback cover si endpoint
   *  /api/library-cover/:slug 404 (DB Railway peut être incomplète vs slugs
   *  importés côté frontend). Frontend peut alors servir cover_fallback_url
   *  ou `https://img.youtube.com/vi/${cover_fallback_youtube_id}/hqdefault.jpg`. */
  cover_fallback_url: string | null;
  cover_fallback_youtube_id: string | null;
  /** feat/guess-work-mode — null (défaut, artist+title) | 'work' (devine l'œuvre). */
  guess_mode: string | null;
}

export interface LibraryPlaylistDetail extends LibraryPlaylistSummary {
  tracks: Array<{
    id: string;
    position: number;
    title: string;
    artist: string;
    year: number | null;
    difficulty: string;
    spotify_id: string | null;
    youtube_id: string | null;
    apple_music_id: string | null;
    cover_url: string | null;
    is_playable: boolean;
    playability_reason: string | null;
    artist_aliases: string[];
    title_aliases: string[];
    /** feat/guess-work-mode — titre de l'œuvre à deviner (si guess_mode='work'). */
    work_title: string | null;
    work_aliases: string[];
  }>;
}

/**
 * feat/thematic-level-filter — compte les tracks par difficulty pour le
 * sous-picker de niveau. Tolérant aux valeurs inconnues (ignorées).
 */
function countDifficulties(tracks: Array<{ difficulty: string }>): {
  EASY: number;
  MEDIUM: number;
  EXPERT: number;
} {
  const counts = { EASY: 0, MEDIUM: 0, EXPERT: 0 };
  for (const t of tracks) {
    if (t.difficulty === 'EASY' || t.difficulty === 'MEDIUM' || t.difficulty === 'EXPERT') {
      counts[t.difficulty] += 1;
    }
  }
  return counts;
}

/**
 * Détecte si le user (via son membership workspace) a accès aux playlists
 * premium_only. V1 : plan workspace !== 'FREE' = premium.
 */
export async function isUserPremium(userId: string): Promise<boolean> {
  const member = await prisma.workspaceMember.findFirst({
    where: { user_id: userId, status: 'APPROVED' },
    include: { workspace: true },
  });
  if (!member) return false;
  return member.workspace.plan !== 'FREE';
}

/**
 * feat/animator-full-control — variante keyée sur un workspace (le master
 * participant n'a PAS de userId, seulement l'établissement→workspace de la
 * session). Même règle premium : plan workspace !== 'FREE'.
 */
export async function isWorkspacePremium(workspaceId: string): Promise<boolean> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { plan: true },
  });
  if (!workspace) return false;
  return workspace.plan !== 'FREE';
}

interface ListFilters {
  locale?: string;
  theme?: string;
  difficulty?: string;
}

/**
 * feat/animator-full-control — cœur partagé entre les variantes user- et
 * workspace- de la liste. Le statut premium est calculé par l'appelant (via
 * isUserPremium ou isWorkspacePremium) pour éviter de dupliquer la projection.
 */
async function listVisiblePlaylistsCore(
  premium: boolean,
  filters: ListFilters = {},
): Promise<LibraryPlaylistSummary[]> {
  const where: Record<string, unknown> = {
    visibility: { in: ['public', 'premium_only'] },
  };
  if (filters.locale) where.locale_primary = filters.locale;
  if (filters.theme) where.theme = filters.theme;
  if (filters.difficulty) where.difficulty = filters.difficulty.toUpperCase();

  const playlists = await prisma.officialPlaylist.findMany({
    where,
    orderBy: { updated_at: 'desc' },
    include: {
      _count: { select: { tracks: true } },
      // fix/csp-meta-tag-and-cover-fallback — fetch position (pour trier 1ʳᵉ
      // track) + cover_url + youtube_id pour permettre au frontend de servir
      // un thumbnail YT direct si le backend /api/library-cover/:slug 404.
      tracks: {
        select: {
          spotify_id: true,
          youtube_id: true,
          cover_url: true,
          position: true,
          difficulty: true,
        },
        orderBy: { position: 'asc' },
      },
    },
  });

  return playlists.map((p) => {
    const spotify_count = p.tracks.filter((t) => t.spotify_id !== null).length;
    const youtube_count = p.tracks.filter((t) => t.youtube_id !== null).length;
    // 1ʳᵉ track avec cover_url OU youtube_id pour fallback frontend.
    const firstWithMedia = p.tracks.find((t) => t.cover_url || t.youtube_id) ?? null;
    return {
      id: p.id,
      slug: p.slug,
      name_fr: p.name_fr,
      name_en: p.name_en,
      description_fr: p.description_fr,
      description_en: p.description_en,
      locale_primary: p.locale_primary,
      theme: p.theme,
      difficulty: p.difficulty,
      visibility: p.visibility,
      track_count: p._count.tracks,
      spotify_count,
      youtube_count,
      difficulty_counts: countDifficulties(p.tracks),
      locked: p.visibility === 'premium_only' && !premium,
      category: p.category,
      position_in_category: p.position_in_category,
      subtitle_fr: p.subtitle_fr,
      subtitle_en: p.subtitle_en,
      cover_fallback_url: firstWithMedia?.cover_url ?? null,
      cover_fallback_youtube_id: firstWithMedia?.youtube_id ?? null,
      guess_mode: p.guess_mode,
    };
  });
}

/**
 * Liste les playlists officielles visibles pour un user.
 *   - Toujours inclut les `public`
 *   - Inclut `premium_only` si user premium (sinon : inclut MAIS marquées `locked: true`)
 *   - Exclut les `private` toujours
 */
export async function listVisiblePlaylists(
  userId: string,
  filters: ListFilters = {},
): Promise<LibraryPlaylistSummary[]> {
  const premium = await isUserPremium(userId);
  return listVisiblePlaylistsCore(premium, filters);
}

/**
 * feat/animator-full-control — même sortie que listVisiblePlaylists mais le
 * statut premium est déduit du plan du workspace (pour le master participant,
 * qui n'a pas de userId). Contrat identique (LibraryPlaylistSummary[]).
 */
export async function listVisiblePlaylistsForWorkspace(
  workspaceId: string,
  filters: ListFilters = {},
): Promise<LibraryPlaylistSummary[]> {
  const premium = await isWorkspacePremium(workspaceId);
  return listVisiblePlaylistsCore(premium, filters);
}

/**
 * feat/tv-grid-mirror — liste publique (sans auth) des playlists officielles
 * pour l'écran TV. La TV mirrore la grille de l'animateur, donc on renvoie le
 * MÊME ensemble qu'un host FREE : `public` + `premium_only` (ces dernières
 * marquées `locked: true`, comme côté host non-premium). `private` exclues.
 * Aucune donnée sensible (juste métadonnées : titre, cover, compteurs ; le
 * détail tracks reste protégé). Pas de filtres : la TV affiche toute la grille.
 */
export async function listPublicPlaylists(): Promise<LibraryPlaylistSummary[]> {
  const playlists = await prisma.officialPlaylist.findMany({
    where: { visibility: { in: ['public', 'premium_only'] } },
    orderBy: { updated_at: 'desc' },
    include: {
      _count: { select: { tracks: true } },
      tracks: {
        select: {
          spotify_id: true,
          youtube_id: true,
          cover_url: true,
          position: true,
          difficulty: true,
        },
        orderBy: { position: 'asc' },
      },
    },
  });

  return playlists.map((p) => {
    const spotify_count = p.tracks.filter((t) => t.spotify_id !== null).length;
    const youtube_count = p.tracks.filter((t) => t.youtube_id !== null).length;
    const firstWithMedia = p.tracks.find((t) => t.cover_url || t.youtube_id) ?? null;
    return {
      id: p.id,
      slug: p.slug,
      name_fr: p.name_fr,
      name_en: p.name_en,
      description_fr: p.description_fr,
      description_en: p.description_en,
      locale_primary: p.locale_primary,
      theme: p.theme,
      difficulty: p.difficulty,
      visibility: p.visibility,
      track_count: p._count.tracks,
      spotify_count,
      youtube_count,
      difficulty_counts: countDifficulties(p.tracks),
      // TV = vue anonyme (non-premium) → premium_only verrouillées.
      locked: p.visibility === 'premium_only',
      category: p.category,
      position_in_category: p.position_in_category,
      subtitle_fr: p.subtitle_fr,
      subtitle_en: p.subtitle_en,
      cover_fallback_url: firstWithMedia?.cover_url ?? null,
      cover_fallback_youtube_id: firstWithMedia?.youtube_id ?? null,
      guess_mode: p.guess_mode,
    };
  });
}

/**
 * feat/animator-full-control — cœur partagé entre les variantes user- et
 * workspace- du détail. Le statut premium est calculé par l'appelant. Retourne
 * null si non trouvée OU si accès refusé (private, ou premium_only sans premium).
 */
async function getVisiblePlaylistDetailCore(
  premium: boolean,
  playlistId: string,
): Promise<LibraryPlaylistDetail | null> {
  // feat/playlist-cache-and-availability-check — premier round-trip DB
  // léger : fetch uniquement updated_at + visibility pour décider du cache
  // HIT/MISS. Si cache HIT, on évite le include tracks (le coût principal).
  const meta = await prisma.officialPlaylist.findUnique({
    where: { id: playlistId },
    select: { id: true, updated_at: true, visibility: true },
  });
  if (!meta) return null;
  if (meta.visibility === 'private') return null;
  if (meta.visibility === 'premium_only' && !premium) return null;

  const cached = getCachedPlaylist<LibraryPlaylistDetail>(playlistId, meta.updated_at);
  if (cached) return cached;

  // Cache MISS : full fetch + projection.
  const playlist = await prisma.officialPlaylist.findUnique({
    where: { id: playlistId },
    include: {
      tracks: { orderBy: { position: 'asc' } },
    },
  });
  if (!playlist) return null;

  const spotify_count = playlist.tracks.filter((t) => t.spotify_id !== null).length;
  const youtube_count = playlist.tracks.filter((t) => t.youtube_id !== null).length;

  const firstWithMedia = playlist.tracks.find((t) => t.cover_url || t.youtube_id) ?? null;

  const detail: LibraryPlaylistDetail = {
    id: playlist.id,
    slug: playlist.slug,
    name_fr: playlist.name_fr,
    name_en: playlist.name_en,
    description_fr: playlist.description_fr,
    description_en: playlist.description_en,
    locale_primary: playlist.locale_primary,
    theme: playlist.theme,
    difficulty: playlist.difficulty,
    visibility: playlist.visibility,
    track_count: playlist.tracks.length,
    spotify_count,
    youtube_count,
    difficulty_counts: countDifficulties(playlist.tracks),
    locked: false,
    category: playlist.category,
    position_in_category: playlist.position_in_category,
    subtitle_fr: playlist.subtitle_fr,
    subtitle_en: playlist.subtitle_en,
    cover_fallback_url: firstWithMedia?.cover_url ?? null,
    cover_fallback_youtube_id: firstWithMedia?.youtube_id ?? null,
    guess_mode: playlist.guess_mode,
    tracks: playlist.tracks.map((t) => ({
      id: t.id,
      position: t.position,
      title: t.title,
      artist: t.artist,
      year: t.year,
      difficulty: t.difficulty,
      spotify_id: t.spotify_id,
      youtube_id: t.youtube_id,
      apple_music_id: t.apple_music_id,
      cover_url: t.cover_url,
      is_playable: t.is_playable,
      playability_reason: t.playability_reason,
      artist_aliases: t.artist_aliases,
      title_aliases: t.title_aliases,
      work_title: t.work_title,
      work_aliases: t.work_aliases,
    })),
  };
  setCachedPlaylist(playlistId, detail, playlist.updated_at);
  return detail;
}

/**
 * Détail d'une playlist officielle. Retourne null si non trouvée OU si l'user
 * n'a pas accès (private, ou premium_only sans premium).
 */
export async function getVisiblePlaylistDetail(
  userId: string,
  playlistId: string,
): Promise<LibraryPlaylistDetail | null> {
  const premium = await isUserPremium(userId);
  return getVisiblePlaylistDetailCore(premium, playlistId);
}

/**
 * feat/animator-full-control — même détail que getVisiblePlaylistDetail mais le
 * statut premium est déduit du plan du workspace (pour le master participant,
 * qui n'a pas de userId). Contrat identique (LibraryPlaylistDetail | null).
 */
export async function getVisiblePlaylistDetailForWorkspace(
  workspaceId: string,
  playlistId: string,
): Promise<LibraryPlaylistDetail | null> {
  const premium = await isWorkspacePremium(workspaceId);
  return getVisiblePlaylistDetailCore(premium, playlistId);
}
