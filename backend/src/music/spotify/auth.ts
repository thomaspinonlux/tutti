/**
 * Flow OAuth Spotify (Authorization Code).
 *
 *   POST /api/auth/spotify/authorize  (auth requise)
 *     → renvoie { authUrl } à laquelle le frontend redirige
 *
 *   GET  /api/auth/spotify/callback   (cross-origin, sans auth header)
 *     → reçoit ?code=... + ?state=... depuis Spotify
 *     → vérifie le state HMAC → exchange code → store credentials
 *     → redirige vers ${FRONTEND_URL}/admin/settings?spotify=connected
 *
 *   GET  /api/auth/spotify/status     (auth requise)
 *     → { connected: boolean, account_email?: string, expires_at? }
 *
 *   DELETE /api/auth/spotify/disconnect (auth requise)
 *     → supprime les credentials du workspace
 *
 * Note : le redirect_uri DOIT matcher exactement celui configuré dans le
 * dashboard Spotify. Spotify n'accepte plus `localhost` — utiliser `127.0.0.1`
 * en dev. Configuré via env var SPOTIFY_REDIRECT_URI.
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { signOAuthState, verifyOAuthState } from '../../lib/oauthState.js';
import { getValidSpotifyAccessToken, SpotifyAuthError } from '../../lib/spotifyToken.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireWorkspace } from '../../middleware/tenant.js';

const router: Router = Router();

const SPOTIFY_AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

// Scopes nécessaires :
//   - user-read-email           : identifier le compte connecté
//   - user-read-private         : profil compte (Premium check, country)
//   - streaming                 : Web Playback SDK (lecture full track)
//   - user-modify-playback-state + user-read-playback-state : contrôle play/pause
//   - playlist-read-private + playlist-read-collaborative : catalogue user (V2+)
//
// Si l'utilisateur a déjà connecté Spotify avec un set de scopes plus
// restreint, il devra se déconnecter/reconnecter pour rafraîchir le token
// avec les nouveaux scopes.
const SPOTIFY_SCOPES = [
  'user-read-email',
  'user-read-private',
  'streaming',
  'user-modify-playback-state',
  'user-read-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
].join(' ');

function getConfig(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  frontendUrl: string;
} {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  // Default 127.0.0.1 (et pas localhost) car Spotify ne l'accepte plus.
  const redirectUri =
    process.env.SPOTIFY_REDIRECT_URI ?? 'http://127.0.0.1:3001/api/auth/spotify/callback';
  const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';

  if (!clientId || !clientSecret) {
    throw new Error('SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET manquants');
  }
  return { clientId, clientSecret, redirectUri, frontendUrl };
}

// ───── POST /authorize ────────────────────────────────────────────────────

router.post('/authorize', requireAuth, requireWorkspace, (req: Request, res: Response): void => {
  const userId = req.userId;
  const workspaceId = req.workspaceId;
  if (!userId || !workspaceId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth requise' } });
    return;
  }

  try {
    const { clientId, redirectUri } = getConfig();
    const state = signOAuthState({ userId, workspaceId });
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: SPOTIFY_SCOPES,
      state,
      show_dialog: 'true', // forcer le re-consent pour permettre changement de compte
    });
    const authUrl = `${SPOTIFY_AUTHORIZE_URL}?${params.toString()}`;
    console.info('[spotify authorize] Demande OAuth pour user', userId);
    console.info('[spotify authorize] Scopes demandés:', SPOTIFY_SCOPES);
    console.info('[spotify authorize] URL complète:', authUrl);
    res.json({ authUrl });
  } catch (err: unknown) {
    console.error('[spotify authorize] error:', err);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Configuration Spotify incomplète côté serveur' },
    });
  }
});

// ───── GET /callback ──────────────────────────────────────────────────────

router.get('/callback', async (req: Request, res: Response): Promise<void> => {
  const code = typeof req.query.code === 'string' ? req.query.code : null;
  const state = typeof req.query.state === 'string' ? req.query.state : null;
  const error = typeof req.query.error === 'string' ? req.query.error : null;

  const { frontendUrl, redirectUri, clientId, clientSecret } = (() => {
    try {
      return getConfig();
    } catch {
      return {
        frontendUrl: 'http://localhost:5173',
        redirectUri: '',
        clientId: '',
        clientSecret: '',
      };
    }
  })();

  const settle = (status: 'connected' | 'error', detail?: string): void => {
    const params = new URLSearchParams({ spotify: status });
    if (detail) params.set('detail', detail);
    res.redirect(`${frontendUrl}/admin/settings?${params.toString()}`);
  };

  if (error) {
    settle('error', error);
    return;
  }
  if (!code || !state) {
    settle('error', 'missing_code_or_state');
    return;
  }

  let context: { user_id: string; workspace_id: string };
  try {
    context = verifyOAuthState(state);
  } catch (err: unknown) {
    console.warn('[spotify callback] state invalide:', (err as Error).message);
    settle('error', 'invalid_state');
    return;
  }

  try {
    // Exchange code → access_token + refresh_token
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }).toString(),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      console.warn('[spotify callback] token exchange failed:', tokenRes.status, text);
      settle('error', 'token_exchange_failed');
      return;
    }

    const tokenJson = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      scope: string;
      token_type: string;
    };

    // Log scopes effectivement accordés par Spotify (vs ceux demandés)
    console.info('[spotify callback] Scopes demandés :', SPOTIFY_SCOPES);
    console.info('[spotify callback] Scopes accordés :', tokenJson.scope);
    const requested = new Set(SPOTIFY_SCOPES.split(' '));
    const granted = new Set(tokenJson.scope.split(' '));
    const missing = [...requested].filter((s) => !granted.has(s));
    if (missing.length > 0) {
      console.warn(
        '[spotify callback] ⚠️ Scopes MANQUANTS (Spotify ne les a pas accordés) :',
        missing.join(', '),
      );
    } else {
      console.info('[spotify callback] ✓ Tous les scopes demandés ont été accordés');
    }

    // Récupérer l'email du compte (info utile pour l'UI)
    let accountEmail: string | null = null;
    try {
      const meRes = await fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      });
      if (meRes.ok) {
        const me = (await meRes.json()) as { email?: string };
        accountEmail = me.email ?? null;
      }
    } catch {
      // best effort
    }

    const expiresAt = new Date(Date.now() + tokenJson.expires_in * 1000);

    await prisma.musicProviderCredential.upsert({
      where: {
        workspace_id_provider: {
          workspace_id: context.workspace_id,
          provider: 'spotify',
        },
      },
      create: {
        workspace_id: context.workspace_id,
        provider: 'spotify',
        access_token: tokenJson.access_token,
        refresh_token: tokenJson.refresh_token,
        expires_at: expiresAt,
        account_email: accountEmail,
      },
      update: {
        access_token: tokenJson.access_token,
        refresh_token: tokenJson.refresh_token,
        expires_at: expiresAt,
        account_email: accountEmail,
      },
    });

    settle('connected');
  } catch (err: unknown) {
    console.error('[spotify callback] error:', err);
    settle('error', 'internal');
  }
});

// ───── GET /status ────────────────────────────────────────────────────────

router.get(
  '/status',
  requireAuth,
  requireWorkspace,
  async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId;
    if (!workspaceId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth requise' } });
      return;
    }

    try {
      const cred = await prisma.musicProviderCredential.findUnique({
        where: {
          workspace_id_provider: {
            workspace_id: workspaceId,
            provider: 'spotify',
          },
        },
        select: { account_email: true, expires_at: true, created_at: true },
      });
      res.json({
        connected: !!cred,
        account_email: cred?.account_email ?? null,
        expires_at: cred?.expires_at ?? null,
        connected_at: cred?.created_at ?? null,
      });
    } catch (err: unknown) {
      console.error('[spotify status] error:', err);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur statut Spotify' } });
    }
  },
);

// ───── GET /token ─────────────────────────────────────────────────────────
// Renvoie un access token valide (refresh transparent côté serveur) pour
// initialiser le Web Playback SDK côté navigateur du host. Ne PAS exposer
// le refresh_token, et ne pas mettre cet endpoint en cache.

router.get(
  '/token',
  requireAuth,
  requireWorkspace,
  async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId;
    if (!workspaceId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth requise' } });
      return;
    }
    try {
      const token = await getValidSpotifyAccessToken(workspaceId);
      res.set('Cache-Control', 'no-store');
      res.json({
        access_token: token.access_token,
        expires_at: token.expires_at.toISOString(),
        account_email: token.account_email,
      });
    } catch (err: unknown) {
      if (err instanceof SpotifyAuthError) {
        if (err.code === 'NOT_CONNECTED' || err.code === 'NO_REFRESH_TOKEN') {
          res.status(409).json({ error: { code: err.code, message: err.message } });
          return;
        }
      }
      console.error('[spotify token] error:', err);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur token Spotify' } });
    }
  },
);

// ───── GET /token-public/:workspaceId ────────────────────────────────────
// feat/tv-audio-output — endpoint PUBLIC (sans auth) qui renvoie un access
// token Spotify pour le workspace. Utilisé par la TV ouverte via tv_code
// sur un appareil séparé, sans cookies admin.
//
// Trust model : équivalent à GET /screen-state/:workspaceId (déjà public).
// Quiconque connaît le workspaceId peut lire l'état → peut aussi obtenir le
// token Spotify. Gating supplémentaire : on EXIGE qu'une session
// WAITING/PLAYING existe pour ce workspace (anti-zombie + force que l'admin
// ait démarré une partie).
//
// Le token retourné a les scopes Web Playback (streaming + control), donc
// il permet de jouer/contrôler la lecture Spotify avec le compte Premium
// du workspace owner. C'est le même token que reçoit le host.

router.get(
  '/token-public/:workspaceId',
  async (req: Request<{ workspaceId: string }>, res: Response): Promise<void> => {
    const workspaceId = req.params.workspaceId;
    try {
      // Gate : require active session in this workspace.
      const session = await prisma.session.findFirst({
        where: {
          establishment: { workspace_id: workspaceId },
          status: { in: ['WAITING', 'PLAYING'] },
        },
        select: { id: true },
      });
      if (!session) {
        res
          .status(404)
          .json({ error: { code: 'NO_ACTIVE_SESSION', message: 'Aucune session active' } });
        return;
      }
      const token = await getValidSpotifyAccessToken(workspaceId);
      res.set('Cache-Control', 'no-store');
      res.json({
        access_token: token.access_token,
        expires_at: token.expires_at.toISOString(),
        account_email: token.account_email,
      });
    } catch (err: unknown) {
      if (err instanceof SpotifyAuthError) {
        if (err.code === 'NOT_CONNECTED' || err.code === 'NO_REFRESH_TOKEN') {
          res.status(409).json({ error: { code: err.code, message: err.message } });
          return;
        }
      }
      console.error('[spotify token-public] error:', err);
      res
        .status(500)
        .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur token Spotify (TV)' } });
    }
  },
);

// ───── DELETE /disconnect ─────────────────────────────────────────────────

router.delete(
  '/disconnect',
  requireAuth,
  requireWorkspace,
  async (req: Request, res: Response): Promise<void> => {
    const workspaceId = req.workspaceId;
    if (!workspaceId) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth requise' } });
      return;
    }
    try {
      await prisma.musicProviderCredential.deleteMany({
        where: { workspace_id: workspaceId, provider: 'spotify' },
      });
      // Si l'establishment utilisait Spotify dans ses sources actives, le retire
      // pour éviter les erreurs côté UI. Si plus rien, retombe sur 'demo'.
      const ests = await prisma.establishment.findMany({
        where: { workspace_id: workspaceId },
        select: { id: true, active_providers: true },
      });
      for (const e of ests) {
        const without = e.active_providers.filter((p) => p !== 'spotify');
        const next = without.length > 0 ? without : ['demo'];
        await prisma.establishment.update({
          where: { id: e.id },
          data: { active_providers: next },
        });
      }
      res.json({ ok: true });
    } catch (err: unknown) {
      console.error('[spotify disconnect] error:', err);
      res
        .status(500)
        .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur déconnexion Spotify' } });
    }
  },
);

export default router;
