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
      const msg = (err as Error).message;
      const hint = needsReconnectHint(msg);
      const fullMessage = hint ? `${msg} — ${hint}` : msg;
      res.status(hint ? 409 : 500).json({
        error: {
          code: hint ? 'SPOTIFY_RECONNECT_NEEDED' : 'INTERNAL_ERROR',
          message: fullMessage,
          hint,
        },
      });
    }
  },
);

/** Détecte les messages d'erreur Spotify qui suggèrent un token périmé /
 *  scope manquant / app en mode dev avec user non whitelisté → propose une
 *  reconnexion Spotify. */
function needsReconnectHint(msg: string): string | undefined {
  const m = msg.toLowerCase();
  if (
    m.includes('invalid limit') ||
    m.includes('invalid token') ||
    m.includes('insufficient client scope') ||
    m.includes('access denied') ||
    m.includes('expired')
  ) {
    return 'Reconnecte Spotify (Settings → Disconnect → Reconnect) pour rafraîchir le token avec les nouveaux scopes.';
  }
  return undefined;
}

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
      const msg = (err as Error).message;
      const hint = needsReconnectHint(msg);
      const fullMessage = hint ? `${msg} — ${hint}` : msg;
      res.status(hint ? 409 : 500).json({
        error: {
          code: hint ? 'SPOTIFY_RECONNECT_NEEDED' : 'INTERNAL_ERROR',
          message: fullMessage,
          hint,
        },
      });
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
      const msg = (err as Error).message;
      const hint = needsReconnectHint(msg);
      const fullMessage = hint ? `${msg} — ${hint}` : msg;
      res.status(hint ? 409 : 500).json({
        error: {
          code: hint ? 'SPOTIFY_RECONNECT_NEEDED' : 'INTERNAL_ERROR',
          message: fullMessage,
          hint,
        },
      });
    }
  },
);

// ── GET /playlist/:id/tracks ─────────────────────────────────────────────

const playlistTracksQuerySchema = z.object({
  market: z.string().length(2).optional(),
  // Spotify cap : limit ∈ [1, 50] sur cet endpoint.
  limit: z.coerce.number().int().min(1).max(50).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
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
      const msg = (err as Error).message;
      const hint = needsReconnectHint(msg);
      const fullMessage = hint ? `${msg} — ${hint}` : msg;
      res.status(hint ? 409 : 500).json({
        error: {
          code: hint ? 'SPOTIFY_RECONNECT_NEEDED' : 'INTERNAL_ERROR',
          message: fullMessage,
          hint,
        },
      });
    }
  },
);

// ── GET /_debug ──────────────────────────────────────────────────────────
// Test minimaliste : appelle Spotify avec EXACTEMENT le même format que curl,
// sans passer par SpotifyProvider. Permet d'isoler si le bug vient du
// provider ou de Spotify lui-même (App Dev Mode / user pas whitelist).

router.get(
  '/_debug',
  requireAuth,
  requireWorkspace,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const cred = await prisma.musicProviderCredential.findUnique({
        where: {
          workspace_id_provider: { workspace_id: req.workspaceId!, provider: 'spotify' },
        },
      });
      if (!cred) {
        res.status(409).json({ error: { code: 'NOT_CONNECTED' } });
        return;
      }
      const token = cred.access_token.trim();
      const url =
        'https://api.spotify.com/v1/search?q=stromae&type=track&limit=20&offset=0&market=FR';
      const r = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await r.text();
      const headers: Record<string, string> = {};
      r.headers.forEach((v, k) => {
        headers[k] = v;
      });
      // Test 2 : avec opérateurs de query
      const url2 =
        'https://api.spotify.com/v1/search?q=' +
        encodeURIComponent('artist:"stromae"') +
        '&type=track&limit=20&offset=0&market=FR';
      const r2 = await fetch(url2, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body2 = await r2.text();
      // Test 3 : profil user (vérifie scopes)
      const r3 = await fetch('https://api.spotify.com/v1/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body3 = await r3.text();
      res.json({
        token_length: token.length,
        token_first_10: token.substring(0, 10),
        token_has_whitespace: cred.access_token !== token,
        token_expires_at: cred.expires_at,
        test1_simple_search: {
          url,
          status: r.status,
          headers,
          body_first_500: body.substring(0, 500),
        },
        test2_with_operators: {
          url: url2,
          status: r2.status,
          body_first_500: body2.substring(0, 500),
        },
        test3_me_profile: {
          status: r3.status,
          body_first_500: body3.substring(0, 500),
        },
      });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

export default router;
