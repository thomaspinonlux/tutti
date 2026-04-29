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
): Promise<{ id: string; active_provider: string } | null> {
  return prisma.establishment.findFirst({
    where: { workspace_id: workspaceId },
    orderBy: { created_at: 'asc' },
    select: { id: true, active_provider: true },
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
      aliases: generateAliases(canonicalName),
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
      where: { establishment: { workspace_id: workspaceId } },
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

export default router;

// Re-export for type checking only — callers should import from @tutti/shared.
export type { MusicProviderId };
