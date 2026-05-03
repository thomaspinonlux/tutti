/**
 * Flow OAuth Google / YouTube — Phase 3.5
 *
 *   POST /api/auth/youtube/authorize      (auth requise)
 *     → renvoie { authUrl } à laquelle le frontend redirige
 *
 *   GET  /api/auth/youtube/callback       (cross-origin, sans auth header)
 *     → reçoit ?code=... + ?state=... depuis Google
 *     → vérifie le state HMAC → exchange code → store credentials sur le
 *       WorkspaceMember du user
 *     → tente de détecter le statut Premium (best-effort, défaut false)
 *     → redirige vers ${FRONTEND_URL}/admin/account?youtube=connected
 *
 *   GET  /api/auth/youtube/status         (auth requise)
 *     → { connected, account_email?, premium?, connected_at? }
 *
 *   DELETE /api/auth/youtube/disconnect   (auth requise)
 *     → supprime les credentials YouTube du WorkspaceMember
 *
 * Variables d'env requises :
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REDIRECT_URI (ex: https://api.tuttiparty.app/api/auth/youtube/callback)
 *
 * Premier crédential à créer dans Google Cloud Console → APIs & Services →
 * Credentials → OAuth 2.0 Client ID type "Web application".
 *
 * Note importante : la détection Premium n'a pas d'API publique fiable.
 * V1 : on stocke premium=false par défaut, l'utilisateur peut toggle
 * manuellement via PATCH /api/auth/youtube/premium si nécessaire.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { signOAuthState, verifyOAuthState } from '../lib/oauthState.js';
import { requireAuth } from '../middleware/auth.js';
import { requireWorkspace } from '../middleware/tenant.js';

const router: Router = Router();

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

// Scope minimal pour identifier le compte + lire les playlists publiques.
// `youtube.readonly` permet de lister les playlists et videos de l'utilisateur,
// pas suffisant pour détecter Premium directement (pas d'API publique).
const SCOPES = ['https://www.googleapis.com/auth/youtube.readonly', 'email', 'profile'];

function getCredentials(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI manquants');
  }
  return { clientId, clientSecret, redirectUri };
}

// ── POST /authorize ───────────────────────────────────────────────────────

router.post(
  '/authorize',
  requireAuth,
  requireWorkspace,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { clientId, redirectUri } = getCredentials();
      const state = signOAuthState({
        userId: req.userId!,
        workspaceId: req.workspaceId!,
      });
      const url = new URL(GOOGLE_AUTHORIZE_URL);
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', SCOPES.join(' '));
      url.searchParams.set('access_type', 'offline');
      url.searchParams.set('prompt', 'consent'); // force refresh_token au 2e auth
      url.searchParams.set('state', state);
      res.json({ authUrl: url.toString() });
    } catch (err: unknown) {
      console.error('[POST /api/auth/youtube/authorize]', err);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: (err as Error).message } });
    }
  },
);

// ── GET /callback (Google → backend) ──────────────────────────────────────

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
}

interface GoogleUserInfo {
  id: string;
  email: string;
  verified_email: boolean;
  name?: string;
  picture?: string;
}

router.get('/callback', async (req: Request, res: Response): Promise<void> => {
  const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
  const code = String(req.query.code ?? '');
  const state = String(req.query.state ?? '');
  const error = req.query.error ? String(req.query.error) : null;

  if (error) {
    res.redirect(`${FRONTEND_URL}/admin/account?youtube=error&reason=${encodeURIComponent(error)}`);
    return;
  }
  if (!code || !state) {
    res.redirect(`${FRONTEND_URL}/admin/account?youtube=error&reason=missing_params`);
    return;
  }

  try {
    const verified = verifyOAuthState(state);
    const { clientId, clientSecret, redirectUri } = getCredentials();

    // Exchange code → tokens
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      console.error('[YT callback] token exchange failed:', tokenRes.status, body);
      res.redirect(`${FRONTEND_URL}/admin/account?youtube=error&reason=token_exchange`);
      return;
    }
    const tokens = (await tokenRes.json()) as GoogleTokenResponse;
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    // Récupère email du compte
    const userInfoRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const userInfo = userInfoRes.ok ? ((await userInfoRes.json()) as GoogleUserInfo) : null;

    // Détection Premium (best-effort) — V1 : pas d'API publique fiable, on
    // marque premium=false et l'utilisateur peut toggle manuellement.
    // V2 : tester un endpoint Premium-restricted ou proxy front-end signal.
    const premium = await detectYouTubePremium(tokens.access_token);

    // Met à jour le WorkspaceMember du user
    await prisma.workspaceMember.updateMany({
      where: { user_id: verified.user_id, workspace_id: verified.workspace_id },
      data: {
        youtube_access_token: tokens.access_token,
        youtube_refresh_token: tokens.refresh_token ?? undefined,
        youtube_token_expires_at: expiresAt,
        youtube_premium: premium,
        youtube_connected_at: new Date(),
        youtube_account_email: userInfo?.email ?? null,
      },
    });

    res.redirect(`${FRONTEND_URL}/admin/account?youtube=connected`);
  } catch (err: unknown) {
    console.error('[YT callback]', err);
    res.redirect(
      `${FRONTEND_URL}/admin/account?youtube=error&reason=${encodeURIComponent((err as Error).message)}`,
    );
  }
});

// ── GET /status ───────────────────────────────────────────────────────────

router.get('/status', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const member = await prisma.workspaceMember.findFirst({
    where: { user_id: req.userId! },
    select: {
      youtube_connected_at: true,
      youtube_account_email: true,
      youtube_premium: true,
      youtube_token_expires_at: true,
    },
  });
  if (!member?.youtube_connected_at) {
    res.json({ connected: false });
    return;
  }
  res.json({
    connected: true,
    account_email: member.youtube_account_email,
    premium: member.youtube_premium,
    connected_at: member.youtube_connected_at,
    expires_at: member.youtube_token_expires_at,
  });
});

// ── DELETE /disconnect ────────────────────────────────────────────────────

router.delete('/disconnect', requireAuth, async (req: Request, res: Response): Promise<void> => {
  await prisma.workspaceMember.updateMany({
    where: { user_id: req.userId! },
    data: {
      youtube_access_token: null,
      youtube_refresh_token: null,
      youtube_token_expires_at: null,
      youtube_premium: false,
      youtube_connected_at: null,
      youtube_account_email: null,
    },
  });
  res.json({ ok: true });
});

// ── PATCH /premium — toggle manuel Premium (faute d'API détection fiable) ─

const premiumPatchSchema = z.object({
  premium: z.boolean(),
});

router.patch('/premium', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = premiumPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'premium boolean requis' } });
    return;
  }
  await prisma.workspaceMember.updateMany({
    where: { user_id: req.userId! },
    data: { youtube_premium: parsed.data.premium },
  });
  res.json({ ok: true, premium: parsed.data.premium });
});

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Best-effort detection du statut Premium. Aucune API publique fiable :
 * Google n'expose pas isPremiumMember sur l'API YouTube Data v3.
 *
 * Stratégie V1 : on lit le profil utilisateur via /channels?mine=true&part=brandingSettings
 * et on retourne false par défaut. L'utilisateur peut basculer manuellement
 * via PATCH /premium.
 *
 * V2 : essai sur l'endpoint youtubei (interne, non-public) ou détection
 * indirecte via tentative de lecture d'un contenu Premium-only.
 */
async function detectYouTubePremium(_accessToken: string): Promise<boolean> {
  // V1 placeholder : pas de détection fiable
  return false;
}

export default router;
