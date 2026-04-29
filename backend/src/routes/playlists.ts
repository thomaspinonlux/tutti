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
  const tracks = await prisma.track.findMany({
    where: { playlist_id: playlistId },
    select: { popularity: true },
  });
  const newLevel = computeLevelFromPopularities(tracks.map((t) => t.popularity));
  await prisma.playlist.update({
    where: { id: playlistId },
    data: { level: newLevel as Level },
  });
}

// ─── GET / — liste ────────────────────────────────────────────────────────

router.get('/', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.workspaceId!;
  try {
    const playlists = await prisma.playlist.findMany({
      where: { establishment: { workspace_id: workspaceId } },
      orderBy: { updated_at: 'desc' },
      include: { _count: { select: { tracks: true } } },
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
        tracks_count: p._count.tracks,
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
    res
      .status(400)
      .json({
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
      include: { tracks: { orderBy: { position: 'asc' } } },
    });
    if (!playlist) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Playlist introuvable' } });
      return;
    }
    res.json({ playlist });
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
    res
      .status(400)
      .json({
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
    res
      .status(400)
      .json({
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

    // Position = max+1 (append à la fin)
    const last = await prisma.track.findFirst({
      where: { playlist_id: id },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const nextPosition = (last?.position ?? -1) + 1;

    const track = await prisma.track.create({
      data: {
        playlist_id: id,
        position: nextPosition,
        provider: meta.provider,
        provider_track_id: meta.provider_track_id,
        artist: meta.artist,
        title: meta.title,
        album: meta.album ?? null,
        year: meta.year ?? null,
        genre: null,
        popularity: meta.popularity ?? null,
        duration_ms: meta.duration_ms ?? null,
        cover_url: meta.cover_url ?? null,
        artist_aliases: generateAliases(meta.artist),
        title_aliases: generateAliases(meta.title),
      },
    });

    await recomputePlaylistLevel(id);
    res.status(201).json({ track });
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
      res
        .status(400)
        .json({
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
      const existing = await prisma.track.findMany({
        where: { playlist_id: playlistId },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((t) => t.id));
      if (
        parsed.data.trackIds.length !== existingIds.size ||
        parsed.data.trackIds.some((id) => !existingIds.has(id))
      ) {
        res
          .status(400)
          .json({
            error: {
              code: 'INVALID_ORDER',
              message: 'La liste fournie ne correspond pas aux tracks existants',
            },
          });
        return;
      }
      // Update en transaction pour garantir l'atomicité.
      await prisma.$transaction(
        parsed.data.trackIds.map((trackId, idx) =>
          prisma.track.update({ where: { id: trackId }, data: { position: idx } }),
        ),
      );
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
      res
        .status(400)
        .json({
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
      const data: { artist_aliases?: string[]; title_aliases?: string[] } = {};
      if (parsed.data.artist_aliases)
        data.artist_aliases = [...new Set(parsed.data.artist_aliases)];
      if (parsed.data.title_aliases) data.title_aliases = [...new Set(parsed.data.title_aliases)];

      const track = await prisma.track.update({
        where: { id: trackId, playlist_id: playlistId },
        data,
      });
      res.json({ track });
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
      await prisma.track.delete({ where: { id: trackId, playlist_id: playlistId } });

      // Réindexer les positions pour rester contigu (0, 1, 2…)
      const remaining = await prisma.track.findMany({
        where: { playlist_id: playlistId },
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      await prisma.$transaction(
        remaining.map((t, idx) =>
          prisma.track.update({ where: { id: t.id }, data: { position: idx } }),
        ),
      );
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
