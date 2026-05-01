/**
 * Routes /api/spotify/* — passthrough vers Spotify Web API pour la création
 * de playlists Tutti (recherche avancée + import depuis playlists Spotify).
 *
 *   GET /search-tracks       : recherche tracks avec filters (artist, track,
 *                              year_min/max, genre, market)
 *   GET /my-playlists        : liste mes playlists Spotify (paginé)
 *   GET /search-playlists    : recherche playlists publiques
 *   GET /playlist/:id/tracks : tracks d'une playlist Spotify (paginé)
 *
 * Auth Supabase requise + workspace + Spotify connecté.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireWorkspace } from '../middleware/tenant.js';
import { SpotifyProvider } from '../music/spotify/SpotifyProvider.js';

const router: Router = Router();

async function getSpotifyProvider(workspaceId: string): Promise<SpotifyProvider | null> {
  const cred = await prisma.musicProviderCredential.findUnique({
    where: { workspace_id_provider: { workspace_id: workspaceId, provider: 'spotify' } },
  });
  if (!cred) return null;
  return new SpotifyProvider(workspaceId, {
    access_token: cred.access_token,
    refresh_token: cred.refresh_token,
    expires_at: cred.expires_at,
  });
}

// ── GET /search-tracks ────────────────────────────────────────────────────

const searchTracksSchema = z.object({
  artist: z.string().trim().max(100).optional(),
  track: z.string().trim().max(200).optional(),
  year_min: z.coerce.number().int().min(1900).max(2100).optional(),
  year_max: z.coerce.number().int().min(1900).max(2100).optional(),
  genre: z.string().trim().max(50).optional(),
  market: z.string().length(2).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(1000).default(0),
});

router.get(
  '/search-tracks',
  requireAuth,
  requireWorkspace,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = searchTracksSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Query invalide' } });
      return;
    }
    try {
      const provider = await getSpotifyProvider(req.workspaceId!);
      if (!provider) {
        res.status(409).json({ error: { code: 'NOT_CONNECTED', message: 'Spotify non connecté' } });
        return;
      }
      const result = await provider.searchTracksAdvanced(parsed.data);
      res.json(result);
    } catch (err: unknown) {
      console.error('[GET /api/spotify/search-tracks]', err);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: (err as Error).message } });
    }
  },
);

// ── GET /my-playlists ─────────────────────────────────────────────────────

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

router.get(
  '/my-playlists',
  requireAuth,
  requireWorkspace,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = paginationSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Query invalide' } });
      return;
    }
    try {
      const provider = await getSpotifyProvider(req.workspaceId!);
      if (!provider) {
        res.status(409).json({ error: { code: 'NOT_CONNECTED', message: 'Spotify non connecté' } });
        return;
      }
      const result = await provider.getMyPlaylists(parsed.data);
      res.json(result);
    } catch (err: unknown) {
      console.error('[GET /api/spotify/my-playlists]', err);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: (err as Error).message } });
    }
  },
);

// ── GET /search-playlists ────────────────────────────────────────────────

const searchPlaylistsSchema = z.object({
  q: z.string().trim().min(1).max(100),
  market: z.string().length(2).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(1000).default(0),
});

router.get(
  '/search-playlists',
  requireAuth,
  requireWorkspace,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = searchPlaylistsSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Query invalide' } });
      return;
    }
    try {
      const provider = await getSpotifyProvider(req.workspaceId!);
      if (!provider) {
        res.status(409).json({ error: { code: 'NOT_CONNECTED', message: 'Spotify non connecté' } });
        return;
      }
      const result = await provider.searchPlaylists({
        query: parsed.data.q,
        market: parsed.data.market,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      });
      res.json(result);
    } catch (err: unknown) {
      console.error('[GET /api/spotify/search-playlists]', err);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: (err as Error).message } });
    }
  },
);

// ── GET /playlist/:id/tracks ─────────────────────────────────────────────

const playlistTracksQuerySchema = z.object({
  market: z.string().length(2).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

router.get(
  '/playlist/:id/tracks',
  requireAuth,
  requireWorkspace,
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const parsed = playlistTracksQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Query invalide' } });
      return;
    }
    try {
      const provider = await getSpotifyProvider(req.workspaceId!);
      if (!provider) {
        res.status(409).json({ error: { code: 'NOT_CONNECTED', message: 'Spotify non connecté' } });
        return;
      }
      const result = await provider.getPlaylistTracks(req.params.id, parsed.data);
      res.json(result);
    } catch (err: unknown) {
      console.error('[GET /api/spotify/playlist/:id/tracks]', err);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: (err as Error).message } });
    }
  },
);

export default router;
