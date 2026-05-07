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
   * true si premium_only ET user n'a pas le plan premium → playlist affichée
   * grisée côté UI avec cadenas. Le détail (`tracks`) reste 403 pour ces
   * playlists.
   */
  locked: boolean;
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
    cover_url: string | null;
    artist_aliases: string[];
    title_aliases: string[];
  }>;
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

interface ListFilters {
  locale?: string;
  theme?: string;
  difficulty?: string;
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
      tracks: { select: { spotify_id: true, youtube_id: true } },
    },
  });

  return playlists.map((p) => {
    const spotify_count = p.tracks.filter((t) => t.spotify_id !== null).length;
    const youtube_count = p.tracks.filter((t) => t.youtube_id !== null).length;
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
      locked: p.visibility === 'premium_only' && !premium,
    };
  });
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

  const playlist = await prisma.officialPlaylist.findUnique({
    where: { id: playlistId },
    include: {
      tracks: { orderBy: { position: 'asc' } },
    },
  });
  if (!playlist) return null;
  if (playlist.visibility === 'private') return null;
  if (playlist.visibility === 'premium_only' && !premium) return null;

  const spotify_count = playlist.tracks.filter((t) => t.spotify_id !== null).length;
  const youtube_count = playlist.tracks.filter((t) => t.youtube_id !== null).length;

  return {
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
    locked: false,
    tracks: playlist.tracks.map((t) => ({
      id: t.id,
      position: t.position,
      title: t.title,
      artist: t.artist,
      year: t.year,
      difficulty: t.difficulty,
      spotify_id: t.spotify_id,
      youtube_id: t.youtube_id,
      cover_url: t.cover_url,
      artist_aliases: t.artist_aliases,
      title_aliases: t.title_aliases,
    })),
  };
}
