/**
 * Helper centralisé pour récupérer un access token Spotify valide pour un
 * workspace, en gérant le refresh OAuth automatiquement.
 *
 * Utilisé par :
 *   - SpotifyProvider (recherche / getTrack côté backend)
 *   - GET /api/auth/spotify/token (le frontend host pour initialiser
 *     le Web Playback SDK et faire des PUT /me/player/play depuis le navigateur)
 */

import { prisma } from './prisma.js';

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const REFRESH_BUFFER_SEC = 60; // refresh quand il reste < 60s

export interface SpotifyAccessToken {
  access_token: string;
  expires_at: Date;
  scope: string | null;
  account_email: string | null;
}

export class SpotifyAuthError extends Error {
  constructor(
    public readonly code:
      | 'NOT_CONNECTED'
      | 'NO_REFRESH_TOKEN'
      | 'REFRESH_FAILED'
      | 'CONFIG_MISSING',
    message: string,
  ) {
    super(message);
    this.name = 'SpotifyAuthError';
  }
}

/**
 * Retourne un access token valide pour le workspace, en rafraîchissant si
 * besoin. Lève SpotifyAuthError si aucun lien Spotify ou si refresh impossible.
 */
export async function getValidSpotifyAccessToken(workspaceId: string): Promise<SpotifyAccessToken> {
  const cred = await prisma.musicProviderCredential.findUnique({
    where: {
      workspace_id_provider: {
        workspace_id: workspaceId,
        provider: 'spotify',
      },
    },
  });
  if (!cred) {
    throw new SpotifyAuthError('NOT_CONNECTED', 'Spotify non connecté pour ce workspace');
  }

  const expiresAt = cred.expires_at;
  const expiresInSec = expiresAt ? (expiresAt.getTime() - Date.now()) / 1000 : -1;

  if (expiresAt && expiresInSec > REFRESH_BUFFER_SEC) {
    return {
      access_token: cred.access_token,
      expires_at: expiresAt,
      scope: null,
      account_email: cred.account_email,
    };
  }

  if (!cred.refresh_token) {
    throw new SpotifyAuthError(
      'NO_REFRESH_TOKEN',
      'Aucun refresh_token Spotify — reconnexion requise',
    );
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new SpotifyAuthError(
      'CONFIG_MISSING',
      'SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET manquants',
    );
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: cred.refresh_token,
  });

  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new SpotifyAuthError(
      'REFRESH_FAILED',
      `Spotify refresh failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }

  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    scope?: string;
  };

  const newExpiresAt = new Date(Date.now() + json.expires_in * 1000);
  await prisma.musicProviderCredential.update({
    where: {
      workspace_id_provider: {
        workspace_id: workspaceId,
        provider: 'spotify',
      },
    },
    data: {
      access_token: json.access_token,
      refresh_token: json.refresh_token ?? cred.refresh_token,
      expires_at: newExpiresAt,
    },
  });

  return {
    access_token: json.access_token,
    expires_at: newExpiresAt,
    scope: json.scope ?? null,
    account_email: cred.account_email,
  };
}
