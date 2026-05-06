/**
 * Routes /api/playlists/* — CRUD playlists et tracks (étape 8).
 *
 *   GET    /                          : liste playlists du tenant + tracks_count
 *   POST   /                          : crée une nouvelle playlist
 *   GET    /:id                       : détails playlist + tracks ordonnés
 *   PATCH  /:id                       : édit name/level/language/is_published/cover_url
 *   DELETE /:id                       : supprime
 *
 *   POST   /:id/tracks                : ajoute un track (lookup via provider actif)
 *   PATCH  /:id/tracks/reorder        : nouvel ordre via { trackIds: [...] }
 *   PATCH  /:id/tracks/:trackId       : édit aliases artiste/titre
 *   DELETE /:id/tracks/:trackId       : supprime
 *
 * Multi-tenant strict : toutes les requêtes vérifient que la playlist
 * appartient à un establishment du workspace courant.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { MusicProviderId } from '@tutti/shared';
import { Level } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireWorkspace } from '../middleware/tenant.js';
import { getProvider } from '../music/registry.js';
import { generateAliases } from '../lib/aliases.js';
import { computeLevelFromPopularities } from '../lib/level.js';

const router: Router = Router();

router.use(requireAuth, requireWorkspace);

// ─── Helpers ──────────────────────────────────────────────────────────────

async function getCurrentEstablishment(
  workspaceId: string,
): Promise<{ id: string; active_providers: string[] } | null> {
  return prisma.establishment.findFirst({
    where: { workspace_id: workspaceId },
    orderBy: { created_at: 'asc' },
    select: { id: true, active_providers: true },
  });
}

async function ensureOwnPlaylist(
  playlistId: string,
  workspaceId: string,
): Promise<{ id: string; establishment_id: string } | null> {
  return prisma.playlist.findFirst({
    where: { id: playlistId, establishment: { workspace_id: workspaceId } },
    select: { id: true, establishment_id: true },
  });
}

async function recomputePlaylistLevel(playlistId: string): Promise<void> {
  const playlistTracks = await prisma.playlistTrack.findMany({
    where: { playlist_id: playlistId },
    select: { track: { select: { popularity: true } } },
  });
  const newLevel = computeLevelFromPopularities(playlistTracks.map((pt) => pt.track.popularity));
  await prisma.playlist.update({
    where: { id: playlistId },
    data: { level: newLevel as Level },
  });
}

/**
 * Cherche un Artist par canonical_name (case-insensitive). Si pas trouvé,
 * le crée avec aliases auto-générés. Le canonical_name stocké est exactement
 * tel que retourné par le provider (avec sa casse d'origine).
 */
async function findOrCreateArtist(canonicalName: string): Promise<{ id: string }> {
  // Essai de match exact (cohérent avec @unique sur canonical_name).
  const existing = await prisma.artist.findUnique({
    where: { canonical_name: canonicalName },
    select: { id: true },
  });
  if (existing) return existing;
  return prisma.artist.create({
    data: {
      canonical_name: canonicalName,
      aliases: generateAliases(canonicalName, 'artist'),
    },
    select: { id: true },
  });
}

/**
 * Cherche un Track par (provider, provider_track_id). Si pas trouvé,
 * le crée — réutilisable d'une playlist à l'autre. Aliases du titre
 * auto-générés.
 */
async function findOrCreateTrack(
  providerId: string,
  providerTrackId: string,
  artistId: string,
  fields: {
    canonical_title: string;
    album: string | null;
    year: number | null;
    popularity: number | null;
    duration_ms: number | null;
    cover_url: string | null;
  },
): Promise<{ id: string }> {
  const existing = await prisma.track.findFirst({
    where: { provider: providerId, provider_track_id: providerTrackId },
    select: { id: true },
  });
  if (existing) return existing;
  return prisma.track.create({
    data: {
      artist_id: artistId,
      provider: providerId,
      provider_track_id: providerTrackId,
      canonical_title: fields.canonical_title,
      aliases: generateAliases(fields.canonical_title),
      album: fields.album,
      year: fields.year,
      popularity: fields.popularity,
      duration_ms: fields.duration_ms,
      cover_url: fields.cover_url,
    },
    select: { id: true },
  });
}

/**
 * Mapping pour servir un PlaylistTrack joint à Track+Artist sous la forme
 * "plate" attendue par le frontend (artist/title comme strings, position au
 * niveau du track). Le frontend ne connaît pas PlaylistTrack.
 */
type PlaylistTrackJoined = {
  id: string;
  position: number;
  track: {
    id: string;
    canonical_title: string;
    aliases: string[];
    album: string | null;
    year: number | null;
    genre: string | null;
    popularity: number | null;
    duration_ms: number | null;
    cover_url: string | null;
    provider: string;
    provider_track_id: string;
    created_at: Date;
    artist: { id: string; canonical_name: string; aliases: string[] };
  };
};

function flattenPlaylistTrack(
  pt: PlaylistTrackJoined,
  playlistId: string,
): {
  id: string;
  playlist_id: string;
  position: number;
  artist: string;
  title: string;
  album: string | null;
  year: number | null;
  genre: string | null;
  popularity: number | null;
  duration_ms: number | null;
  cover_url: string | null;
  provider: string;
  provider_track_id: string;
  artist_aliases: string[];
  title_aliases: string[];
  created_at: Date;
} {
  return {
    id: pt.track.id,
    playlist_id: playlistId,
    position: pt.position,
    artist: pt.track.artist.canonical_name,
    title: pt.track.canonical_title,
    album: pt.track.album,
    year: pt.track.year,
    genre: pt.track.genre,
    popularity: pt.track.popularity,
    duration_ms: pt.track.duration_ms,
    cover_url: pt.track.cover_url,
    provider: pt.track.provider,
    provider_track_id: pt.track.provider_track_id,
    artist_aliases: pt.track.artist.aliases,
    title_aliases: pt.track.aliases,
    created_at: pt.track.created_at,
  };
}

// ─── GET / — liste ────────────────────────────────────────────────────────

router.get('/', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.workspaceId!;
  try {
    const playlists = await prisma.playlist.findMany({
      where: {
        establishment: { workspace_id: workspaceId },
        // Hide official Tutti clones (is_official_tutti=true) — créées par
        // POST /api/library/playlists/:id/launch en interne. L'utilisateur ne
        // doit pas les voir dans "Mes playlists".
        is_official_tutti: false,
      },
      orderBy: { updated_at: 'desc' },
      include: { _count: { select: { playlist_tracks: true } } },
    });
    res.json({
      playlists: playlists.map((p) => ({
        id: p.id,
        establishment_id: p.establishment_id,
        name: p.name,
        cover_url: p.cover_url,
        level: p.level,
        language: p.language,
        is_published: p.is_published,
        created_at: p.created_at,
        updated_at: p.updated_at,
        tracks_count: p._count.playlist_tracks,
      })),
    });
  } catch (err: unknown) {
    console.error('[GET /playlists] error:', err);
    res
      .status(500)
      .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur récupération playlists' } });
  }
});

// ─── POST / — création ────────────────────────────────────────────────────

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  language: z.enum(['fr', 'en']).optional(),
  cover_url: z.string().url().optional().nullable(),
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.workspaceId!;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Body invalide',
        details: parsed.error.flatten(),
      },
    });
    return;
  }

  try {
    const est = await getCurrentEstablishment(workspaceId);
    if (!est) {
      res.status(404).json({ error: { code: 'NO_ESTABLISHMENT', message: 'Aucun établissement' } });
      return;
    }
    const playlist = await prisma.playlist.create({
      data: {
        establishment_id: est.id,
        name: parsed.data.name,
        language: parsed.data.language ?? 'fr',
        cover_url: parsed.data.cover_url ?? null,
        level: 'MEDIUM',
      },
    });
    res.status(201).json({ playlist });
  } catch (err: unknown) {
    console.error('[POST /playlists] error:', err);
    res
      .status(500)
      .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur création playlist' } });
  }
});

// ─── GET /:id — détails ───────────────────────────────────────────────────

router.get('/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const workspaceId = req.workspaceId!;
  const id = req.params.id;
  try {
    const playlist = await prisma.playlist.findFirst({
      where: { id, establishment: { workspace_id: workspaceId } },
      include: {
        playlist_tracks: {
          orderBy: { position: 'asc' },
          include: { track: { include: { artist: true } } },
        },
      },
    });
    if (!playlist) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Playlist introuvable' } });
      return;
    }
    // Renvoie la playlist avec les tracks "à plat" pour ne pas casser les
    // consommateurs qui ne connaissent pas PlaylistTrack.
    const { playlist_tracks, ...rest } = playlist;
    res.json({
      playlist: {
        ...rest,
        tracks: playlist_tracks.map((pt) => flattenPlaylistTrack(pt, id)),
      },
    });
  } catch (err: unknown) {
    console.error('[GET /playlists/:id] error:', err);
    res
      .status(500)
      .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur récupération playlist' } });
  }
});

// ─── PATCH /:id ──────────────────────────────────────────────────────────

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  language: z.enum(['fr', 'en']).optional(),
  cover_url: z.string().url().nullable().optional(),
  is_published: z.boolean().optional(),
  level: z.enum(['EASY', 'MEDIUM', 'EXPERT']).optional(),
});

router.patch('/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const workspaceId = req.workspaceId!;
  const id = req.params.id;
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Body invalide',
        details: parsed.error.flatten(),
      },
    });
    return;
  }
  try {
    const own = await ensureOwnPlaylist(id, workspaceId);
    if (!own) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Playlist introuvable' } });
      return;
    }
    const playlist = await prisma.playlist.update({
      where: { id },
      data: parsed.data as { level?: Level } & typeof parsed.data,
    });
    res.json({ playlist });
  } catch (err: unknown) {
    console.error('[PATCH /playlists/:id] error:', err);
    res
      .status(500)
      .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur mise à jour playlist' } });
  }
});

// ─── DELETE /:id ─────────────────────────────────────────────────────────

router.delete('/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const workspaceId = req.workspaceId!;
  const id = req.params.id;
  try {
    const own = await ensureOwnPlaylist(id, workspaceId);
    if (!own) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Playlist introuvable' } });
      return;
    }
    await prisma.playlist.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err: unknown) {
    console.error('[DELETE /playlists/:id] error:', err);
    res
      .status(500)
      .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur suppression playlist' } });
  }
});

// ─── POST /:id/tracks — ajoute via provider actif ────────────────────────

const addTrackSchema = z.object({
  provider: z.enum(['demo', 'spotify', 'deezer', 'apple_music']),
  provider_track_id: z.string().min(1).max(128),
});

router.post('/:id/tracks', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const workspaceId = req.workspaceId!;
  const id = req.params.id;
  const parsed = addTrackSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Body invalide',
        details: parsed.error.flatten(),
      },
    });
    return;
  }
  try {
    const own = await ensureOwnPlaylist(id, workspaceId);
    if (!own) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Playlist introuvable' } });
      return;
    }

    // Récupère les détails complets via le provider (autorité externe).
    const credentials = await prisma.musicProviderCredential.findUnique({
      where: {
        workspace_id_provider: { workspace_id: workspaceId, provider: parsed.data.provider },
      },
    });
    const providerInst = getProvider(parsed.data.provider, {
      workspaceId,
      credentials: credentials
        ? {
            access_token: credentials.access_token,
            refresh_token: credentials.refresh_token,
            expires_at: credentials.expires_at,
          }
        : null,
    });
    const meta = await providerInst.getTrack(parsed.data.provider_track_id);
    if (!meta) {
      res
        .status(404)
        .json({ error: { code: 'TRACK_NOT_FOUND', message: 'Morceau introuvable côté provider' } });
      return;
    }

    // 1) Lookup ou crée l'Artist (catalogue partagé global, aliases globaux).
    const artist = await findOrCreateArtist(meta.artist);
    // 2) Lookup ou crée le Track (catalogue partagé via provider+provider_track_id).
    const track = await findOrCreateTrack(meta.provider, meta.provider_track_id, artist.id, {
      canonical_title: meta.title,
      album: meta.album ?? null,
      year: meta.year ?? null,
      popularity: meta.popularity ?? null,
      duration_ms: meta.duration_ms ?? null,
      cover_url: meta.cover_url ?? null,
    });
    // 3) Vérifie qu'il n'est pas déjà dans cette playlist (idempotence).
    const alreadyIn = await prisma.playlistTrack.findUnique({
      where: { playlist_id_track_id: { playlist_id: id, track_id: track.id } },
      select: { id: true },
    });
    if (alreadyIn) {
      res
        .status(409)
        .json({ error: { code: 'TRACK_ALREADY_IN_PLAYLIST', message: 'Déjà dans la playlist' } });
      return;
    }
    // 4) Append à la fin.
    const last = await prisma.playlistTrack.findFirst({
      where: { playlist_id: id },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const nextPosition = (last?.position ?? -1) + 1;
    await prisma.playlistTrack.create({
      data: { playlist_id: id, track_id: track.id, position: nextPosition },
    });
    await recomputePlaylistLevel(id);

    // Réponse "à plat" cohérente avec GET /:id.
    const created = await prisma.playlistTrack.findUnique({
      where: { playlist_id_track_id: { playlist_id: id, track_id: track.id } },
      include: { track: { include: { artist: true } } },
    });
    if (!created) {
      res
        .status(500)
        .json({ error: { code: 'INTERNAL_ERROR', message: 'Track créé introuvable' } });
      return;
    }
    res.status(201).json({ track: flattenPlaylistTrack(created, id) });
  } catch (err: unknown) {
    console.error('[POST /playlists/:id/tracks] error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur ajout morceau' } });
  }
});

// ─── PATCH /:id/tracks/reorder ───────────────────────────────────────────

const reorderSchema = z.object({
  trackIds: z.array(z.string().uuid()).min(1).max(500),
});

router.patch(
  '/:id/tracks/reorder',
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const playlistId = req.params.id;
    const parsed = reorderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Body invalide',
          details: parsed.error.flatten(),
        },
      });
      return;
    }
    try {
      const own = await ensureOwnPlaylist(playlistId, workspaceId);
      if (!own) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Playlist introuvable' } });
        return;
      }
      const existing = await prisma.playlistTrack.findMany({
        where: { playlist_id: playlistId },
        select: { track_id: true },
      });
      const existingIds = new Set(existing.map((pt) => pt.track_id));
      if (
        parsed.data.trackIds.length !== existingIds.size ||
        parsed.data.trackIds.some((id) => !existingIds.has(id))
      ) {
        res.status(400).json({
          error: {
            code: 'INVALID_ORDER',
            message: 'La liste fournie ne correspond pas aux tracks existants',
          },
        });
        return;
      }
      // Update en transaction. Pour éviter le conflit sur l'unique
      // (playlist_id, position), on met d'abord toutes les positions à
      // -idx-1000 puis la bonne valeur en 2 étapes.
      await prisma.$transaction([
        ...parsed.data.trackIds.map((trackId, idx) =>
          prisma.playlistTrack.update({
            where: { playlist_id_track_id: { playlist_id: playlistId, track_id: trackId } },
            data: { position: -idx - 1000 },
          }),
        ),
        ...parsed.data.trackIds.map((trackId, idx) =>
          prisma.playlistTrack.update({
            where: { playlist_id_track_id: { playlist_id: playlistId, track_id: trackId } },
            data: { position: idx },
          }),
        ),
      ]);
      res.json({ ok: true });
    } catch (err: unknown) {
      console.error('[PATCH /playlists/:id/tracks/reorder] error:', err);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur réorganisation' } });
    }
  },
);

// ─── PATCH /:id/tracks/:trackId — édit aliases ───────────────────────────

const trackPatchSchema = z.object({
  artist_aliases: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  title_aliases: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
});

router.patch(
  '/:id/tracks/:trackId',
  async (req: Request<{ id: string; trackId: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const { id: playlistId, trackId } = req.params;
    const parsed = trackPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Body invalide',
          details: parsed.error.flatten(),
        },
      });
      return;
    }
    try {
      const own = await ensureOwnPlaylist(playlistId, workspaceId);
      if (!own) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Playlist introuvable' } });
        return;
      }
      // Vérif que ce track est bien dans cette playlist (sinon on n'autorise pas
      // l'édition même si le track existe globalement — on protège le tenant).
      const link = await prisma.playlistTrack.findUnique({
        where: { playlist_id_track_id: { playlist_id: playlistId, track_id: trackId } },
        include: { track: { include: { artist: true } } },
      });
      if (!link) {
        res
          .status(404)
          .json({ error: { code: 'NOT_FOUND', message: 'Track non lié à cette playlist' } });
        return;
      }

      // Aliases artiste = global (sur Artist), aliases titre = global (sur Track).
      // ⚠ Ces aliases sont partagés avec tout le monde qui réutilise ce track/artist.
      // C'est voulu : auto-apprentissage continu.
      if (parsed.data.artist_aliases) {
        await prisma.artist.update({
          where: { id: link.track.artist_id },
          data: { aliases: [...new Set(parsed.data.artist_aliases)] },
        });
      }
      if (parsed.data.title_aliases) {
        await prisma.track.update({
          where: { id: trackId },
          data: { aliases: [...new Set(parsed.data.title_aliases)] },
        });
      }
      const fresh = await prisma.playlistTrack.findUnique({
        where: { playlist_id_track_id: { playlist_id: playlistId, track_id: trackId } },
        include: { track: { include: { artist: true } } },
      });
      res.json({ track: fresh ? flattenPlaylistTrack(fresh, playlistId) : null });
    } catch (err: unknown) {
      console.error('[PATCH /tracks/:trackId] error:', err);
      res
        .status(500)
        .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur mise à jour morceau' } });
    }
  },
);

// ─── DELETE /:id/tracks/:trackId ─────────────────────────────────────────

router.delete(
  '/:id/tracks/:trackId',
  async (req: Request<{ id: string; trackId: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const { id: playlistId, trackId } = req.params;
    try {
      const own = await ensureOwnPlaylist(playlistId, workspaceId);
      if (!own) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Playlist introuvable' } });
        return;
      }
      // On supprime UNIQUEMENT le lien (PlaylistTrack), pas le Track global —
      // il peut être référencé par d'autres playlists.
      await prisma.playlistTrack.delete({
        where: { playlist_id_track_id: { playlist_id: playlistId, track_id: trackId } },
      });

      // Réindexer les positions pour rester contigu (0, 1, 2…)
      const remaining = await prisma.playlistTrack.findMany({
        where: { playlist_id: playlistId },
        orderBy: { position: 'asc' },
        select: { track_id: true },
      });
      await prisma.$transaction([
        // Phase 1 : positions négatives temporaires pour éviter conflit unique.
        ...remaining.map((pt, idx) =>
          prisma.playlistTrack.update({
            where: { playlist_id_track_id: { playlist_id: playlistId, track_id: pt.track_id } },
            data: { position: -idx - 1000 },
          }),
        ),
        ...remaining.map((pt, idx) =>
          prisma.playlistTrack.update({
            where: { playlist_id_track_id: { playlist_id: playlistId, track_id: pt.track_id } },
            data: { position: idx },
          }),
        ),
      ]);
      await recomputePlaylistLevel(playlistId);

      res.json({ ok: true });
    } catch (err: unknown) {
      console.error('[DELETE /tracks/:trackId] error:', err);
      res
        .status(500)
        .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur suppression morceau' } });
    }
  },
);

// ── POST /:id/import-tracks (bulk) ───────────────────────────────────────
// Import en lot — ajoute jusqu'à 500 tracks Spotify dans la playlist Tutti.
// Idempotent : skip les tracks déjà dans la playlist (par provider+id).
// Auto-create Artist + Track + aliases.

const importTracksSchema = z.object({
  provider: z.enum(['demo', 'spotify', 'youtube', 'deezer', 'apple_music']),
  /** Liste de provider_track_id à importer (max 500). */
  provider_track_ids: z.array(z.string().min(1).max(128)).min(1).max(500),
});

router.post(
  '/:id/import-tracks',
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const id = req.params.id;
    const parsed = importTracksSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Body invalide',
          details: parsed.error.flatten(),
        },
      });
      return;
    }
    try {
      const own = await ensureOwnPlaylist(id, workspaceId);
      if (!own) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Playlist introuvable' } });
        return;
      }
      const credentials = await prisma.musicProviderCredential.findUnique({
        where: {
          workspace_id_provider: { workspace_id: workspaceId, provider: parsed.data.provider },
        },
      });
      const providerInst = getProvider(parsed.data.provider, {
        workspaceId,
        credentials: credentials
          ? {
              access_token: credentials.access_token,
              refresh_token: credentials.refresh_token,
              expires_at: credentials.expires_at,
            }
          : null,
      });

      // Position de départ pour les nouveaux ajouts
      const last = await prisma.playlistTrack.findFirst({
        where: { playlist_id: id },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      let nextPosition = (last?.position ?? -1) + 1;

      let imported = 0;
      let skipped = 0;
      const errors: Array<{ provider_track_id: string; error: string }> = [];

      for (const providerTrackId of parsed.data.provider_track_ids) {
        try {
          const meta = await providerInst.getTrack(providerTrackId);
          if (!meta) {
            errors.push({ provider_track_id: providerTrackId, error: 'NOT_FOUND' });
            continue;
          }
          const artist = await findOrCreateArtist(meta.artist);
          const track = await findOrCreateTrack(meta.provider, meta.provider_track_id, artist.id, {
            canonical_title: meta.title,
            album: meta.album ?? null,
            year: meta.year ?? null,
            popularity: meta.popularity ?? null,
            duration_ms: meta.duration_ms ?? null,
            cover_url: meta.cover_url ?? null,
          });
          // Idempotence : skip si déjà dans cette playlist
          const alreadyIn = await prisma.playlistTrack.findUnique({
            where: { playlist_id_track_id: { playlist_id: id, track_id: track.id } },
            select: { id: true },
          });
          if (alreadyIn) {
            skipped++;
            continue;
          }
          await prisma.playlistTrack.create({
            data: { playlist_id: id, track_id: track.id, position: nextPosition },
          });
          nextPosition++;
          imported++;
        } catch (err: unknown) {
          errors.push({
            provider_track_id: providerTrackId,
            error: err instanceof Error ? err.message : 'UNKNOWN',
          });
        }
      }

      if (imported > 0) await recomputePlaylistLevel(id);
      res.json({ imported, skipped, errors });
    } catch (err: unknown) {
      console.error('[POST /playlists/:id/import-tracks]', err);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur import bulk' } });
    }
  },
);

// ── POST /duplicates-check ───────────────────────────────────────────────
// Vérifie pour une liste de tracks (artist+title) ceux qui sont déjà dans
// au moins une playlist du workspace. Retourne pour chaque un flag + nom
// de la playlist cible.

const duplicatesCheckSchema = z.object({
  candidates: z
    .array(
      z.object({
        provider_track_id: z.string().optional(),
        artist: z.string().min(1).max(120),
        title: z.string().min(1).max(200),
      }),
    )
    .min(1)
    .max(500),
});

router.post('/duplicates-check', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.workspaceId!;
  const parsed = duplicatesCheckSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Body invalide' } });
    return;
  }
  try {
    // Charge tous les playlist_tracks du workspace avec artist+title
    // Relation : PlaylistTrack → Playlist → Establishment (workspace_id)
    const allInWorkspace = await prisma.playlistTrack.findMany({
      where: { playlist: { establishment: { workspace_id: workspaceId } } },
      include: {
        playlist: { select: { id: true, name: true } },
        track: {
          select: {
            canonical_title: true,
            artist: { select: { canonical_name: true } },
          },
        },
      },
    });
    // Indexe par clé normalisée (artist+title)
    const normalize = (s: string): string =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\s*\([^)]*\)\s*/g, ' ')
        .replace(/[^a-z0-9 ]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const index = new Map<string, { playlist_id: string; playlist_name: string }>();
    for (const pt of allInWorkspace) {
      const key = `${normalize(pt.track.artist.canonical_name)}|${normalize(pt.track.canonical_title)}`;
      if (!index.has(key)) {
        index.set(key, { playlist_id: pt.playlist.id, playlist_name: pt.playlist.name });
      }
    }
    const results = parsed.data.candidates.map((c) => {
      const key = `${normalize(c.artist)}|${normalize(c.title)}`;
      const found = index.get(key);
      return {
        provider_track_id: c.provider_track_id,
        artist: c.artist,
        title: c.title,
        duplicate: !!found,
        existing_playlist: found ?? null,
      };
    });
    res.json({ results });
  } catch (err: unknown) {
    console.error('[POST /playlists/duplicates-check]', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur duplicates check' } });
  }
});

// ─── Phase 5 — Partage par code court ────────────────────────────────────

import { randomBytes } from 'node:crypto';

function generateShareCode(): string {
  // 6 chars alphabet sans ambiguïtés
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[bytes[i]! % alphabet.length];
  return out;
}

const createShareBody = z.object({
  max_uses: z.number().int().min(1).max(10000).optional(),
  expires_at: z
    .string()
    .datetime()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined)),
});

/** POST /api/playlists/:id/share — génère un code de partage */
router.post('/:id/share', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const workspaceId = req.workspaceId!;
  const ok = await ensureOwnPlaylist(req.params.id, workspaceId);
  if (!ok) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Playlist introuvable' } });
    return;
  }
  const parsed = createShareBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Body invalide' } });
    return;
  }
  // Tentative max 5x si collision
  let code = generateShareCode();
  for (let i = 0; i < 5; i++) {
    const exists = await prisma.playlistShareCode.findUnique({ where: { code } });
    if (!exists) break;
    code = generateShareCode();
  }
  const entry = await prisma.playlistShareCode.create({
    data: {
      code,
      playlist_id: req.params.id,
      created_by: req.userId!,
      max_uses: parsed.data.max_uses,
      expires_at: parsed.data.expires_at,
    },
  });
  res.status(201).json({ share: entry });
});

/** GET /api/playlists/share/:code — preview (auth requise pour limiter abuse) */
router.get('/share/:code', async (req: Request<{ code: string }>, res: Response): Promise<void> => {
  const code = req.params.code.toUpperCase();
  const share = await prisma.playlistShareCode.findUnique({
    where: { code },
  });
  if (!share) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Code introuvable' } });
    return;
  }
  if (share.expires_at && share.expires_at <= new Date()) {
    res.status(410).json({ error: { code: 'EXPIRED', message: 'Code expiré' } });
    return;
  }
  if (share.max_uses && share.uses_count >= share.max_uses) {
    res
      .status(410)
      .json({ error: { code: 'EXHAUSTED', message: 'Code épuisé (utilisations max atteintes)' } });
    return;
  }
  const playlist = await prisma.playlist.findUnique({
    where: { id: share.playlist_id },
    include: {
      _count: { select: { playlist_tracks: true } },
    },
  });
  if (!playlist) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Playlist source supprimée' } });
    return;
  }
  res.json({
    code: share.code,
    playlist: {
      id: playlist.id,
      name: playlist.name,
      description: playlist.description,
      cover_url: playlist.cover_url,
      level: playlist.level,
      language: playlist.language,
      tracks_count: playlist._count.playlist_tracks,
    },
    uses_count: share.uses_count,
    max_uses: share.max_uses,
    expires_at: share.expires_at,
  });
});

/** POST /api/playlists/share/:code/import — clone playlist dans le workspace caller */
router.post(
  '/share/:code/import',
  async (req: Request<{ code: string }>, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId!;
    const code = req.params.code.toUpperCase();
    const share = await prisma.playlistShareCode.findUnique({ where: { code } });
    if (!share) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Code introuvable' } });
      return;
    }
    if (share.expires_at && share.expires_at <= new Date()) {
      res.status(410).json({ error: { code: 'EXPIRED', message: 'Code expiré' } });
      return;
    }
    if (share.max_uses && share.uses_count >= share.max_uses) {
      res.status(410).json({ error: { code: 'EXHAUSTED', message: 'Code épuisé' } });
      return;
    }
    const source = await prisma.playlist.findUnique({
      where: { id: share.playlist_id },
      include: {
        playlist_tracks: {
          orderBy: { position: 'asc' },
          include: { track: true },
        },
      },
    });
    if (!source) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Playlist source supprimée' } });
      return;
    }
    const establishment = await getCurrentEstablishment(workspaceId);
    if (!establishment) {
      res.status(404).json({ error: { code: 'NO_ESTABLISHMENT', message: "Pas d'établissement" } });
      return;
    }
    // Clone playlist + relink playlist_tracks vers les Track partagés (catalogue
    // global). Pas de nouveau Track créé : on réutilise le catalogue.
    const cloned = await prisma.$transaction(async (tx) => {
      const newPlaylist = await tx.playlist.create({
        data: {
          establishment_id: establishment.id,
          name: `${source.name} (importée)`,
          description: source.description,
          cover_url: source.cover_url,
          level: source.level,
          language: source.language,
          is_published: false, // l'animateur doit valider avant publish
          is_express: source.is_express,
        },
      });
      if (source.playlist_tracks.length > 0) {
        await tx.playlistTrack.createMany({
          data: source.playlist_tracks.map((pt, idx) => ({
            playlist_id: newPlaylist.id,
            track_id: pt.track_id,
            position: idx,
          })),
        });
      }
      await tx.playlistShareCode.update({
        where: { id: share.id },
        data: { uses_count: { increment: 1 } },
      });
      return newPlaylist;
    });
    res.status(201).json({ playlist: cloned, tracks_imported: source.playlist_tracks.length });
  },
);

export default router;

// Re-export for type checking only — callers should import from @tutti/shared.
export type { MusicProviderId };
