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
// Tests ciblés : isole le bug "Invalid limit" sur /v1/search.

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
      const auth = { Authorization: `Bearer ${token}` };

      // Test 1 : profil user — récupère country pour test ciblé
      const r1 = await fetch('https://api.spotify.com/v1/me', { method: 'GET', headers: auth });
      const body1 = await r1.text();
      let userCountry: string | null = null;
      try {
        userCountry = (JSON.parse(body1) as { country?: string }).country ?? null;
      } catch {
        /* ignore */
      }

      // Test 2 : search SANS market (utilise pays compte par défaut)
      const url2 = 'https://api.spotify.com/v1/search?q=stromae&type=track&limit=20';
      const r2 = await fetch(url2, { method: 'GET', headers: auth });
      const body2 = await r2.text();

      // Test 3 : search avec market=FR (forcé)
      const url3 = 'https://api.spotify.com/v1/search?q=stromae&type=track&limit=20&market=FR';
      const r3 = await fetch(url3, { method: 'GET', headers: auth });
      const body3 = await r3.text();

      // Test 4 : search avec market = pays user
      let body4 = '';
      let url4 = '';
      let r4Status = 0;
      if (userCountry) {
        url4 = `https://api.spotify.com/v1/search?q=stromae&type=track&limit=20&market=${userCountry}`;
        const r4 = await fetch(url4, { method: 'GET', headers: auth });
        r4Status = r4.status;
        body4 = await r4.text();
      }

      // Test 5 : search via module natif https (bypass undici)
      const test5: { status: number; body_first_500: string; method: string } = {
        status: 0,
        body_first_500: '',
        method: 'native_https',
      };
      try {
        const { request: httpsRequest } = await import('node:https');
        await new Promise<void>((resolve, reject) => {
          const req = httpsRequest(
            {
              host: 'api.spotify.com',
              path: '/v1/search?q=stromae&type=track&limit=20&market=FR',
              method: 'GET',
              headers: { Authorization: `Bearer ${token}` },
            },
            (httpRes) => {
              test5.status = httpRes.statusCode ?? 0;
              const chunks: Buffer[] = [];
              httpRes.on('data', (c: Buffer) => chunks.push(c));
              httpRes.on('end', () => {
                test5.body_first_500 = Buffer.concat(chunks).toString('utf8').slice(0, 500);
                resolve();
              });
              httpRes.on('error', reject);
            },
          );
          req.on('error', reject);
          req.end();
        });
      } catch (err) {
        test5.body_first_500 = `ERROR: ${(err as Error).message}`;
      }

      // Test 6 : minimal possible search (que q + type)
      const url6 = 'https://api.spotify.com/v1/search?q=stromae&type=track';
      const r6 = await fetch(url6, { method: 'GET', headers: auth });
      const body6 = await r6.text();

      // Tests 7-10 : vary limit values + check headers
      const variations: Array<{ name: string; url: string }> = [
        { name: 'limit=1', url: 'https://api.spotify.com/v1/search?q=stromae&type=track&limit=1' },
        {
          name: 'limit=10',
          url: 'https://api.spotify.com/v1/search?q=stromae&type=track&limit=10',
        },
        {
          name: 'limit=50',
          url: 'https://api.spotify.com/v1/search?q=stromae&type=track&limit=50',
        },
        {
          name: 'limit=20_offset=0',
          url: 'https://api.spotify.com/v1/search?q=stromae&type=track&limit=20&offset=0',
        },
        {
          name: 'with_include_external',
          url: 'https://api.spotify.com/v1/search?q=stromae&type=track&limit=20&include_external=audio',
        },
        {
          name: 'different_query',
          url: 'https://api.spotify.com/v1/search?q=hello&type=track&limit=20',
        },
      ];
      const variants: Record<
        string,
        {
          url: string;
          status: number;
          body_first_300: string;
          ratelimit?: string;
          retry_after?: string;
        }
      > = {};
      for (const v of variations) {
        const r = await fetch(v.url, { method: 'GET', headers: auth });
        const txt = await r.text();
        variants[v.name] = {
          url: v.url,
          status: r.status,
          body_first_300: txt.substring(0, 300),
          ratelimit:
            r.headers.get('x-ratelimit-remaining') ?? r.headers.get('retry-after') ?? undefined,
          retry_after: r.headers.get('retry-after') ?? undefined,
        };
      }

      res.json({
        token_length: token.length,
        token_has_whitespace: cred.access_token !== token,
        token_expires_at: cred.expires_at,
        test1_me_profile: {
          status: r1.status,
          country: userCountry,
          body_first_500: body1.substring(0, 500),
        },
        test2_search_no_market: {
          url: url2,
          status: r2.status,
          body_first_500: body2.substring(0, 500),
        },
        test3_search_market_FR: {
          url: url3,
          status: r3.status,
          body_first_500: body3.substring(0, 500),
        },
        test4_search_market_user_country: userCountry
          ? { url: url4, status: r4Status, body_first_500: body4.substring(0, 500) }
          : { skipped: 'no country in profile' },
        test5_native_https_search: test5,
        test6_minimal_search: {
          url: url6,
          status: r6.status,
          body_first_500: body6.substring(0, 500),
        },
        variations: variants,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  },
);

export default router;
