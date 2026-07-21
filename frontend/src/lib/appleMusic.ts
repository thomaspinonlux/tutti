/**
 * appleMusic.ts — client des routes /api/auth/apple/* (feat/apple-music étape 4).
 *
 * Le developer token (JWT app-level) est minté côté backend ; MusicKit JS s'en
 * sert pour s'initialiser + appeler l'Apple Music API. Le Music User Token
 * (compte abonné du host) est obtenu côté navigateur via MusicKit.authorize()
 * puis persité via connectAppleMusic().
 */

import { api } from './api.js';

export async function getAppleDeveloperToken(): Promise<{ token: string; expires_at: string }> {
  return api('/api/auth/apple/developer-token');
}

export interface AppleMusicStatus {
  connected: boolean;
  configured: boolean;
  account_email: string | null;
  expires_at: string | null;
  connected_at: string | null;
}

export async function getAppleMusicStatus(): Promise<AppleMusicStatus> {
  return api('/api/auth/apple/status');
}

export async function connectAppleMusic(
  musicUserToken: string,
): Promise<{ ok: boolean; expires_at: string }> {
  return api('/api/auth/apple/connect', {
    method: 'POST',
    body: { music_user_token: musicUserToken },
  });
}

export async function disconnectAppleMusic(): Promise<void> {
  await api('/api/auth/apple/disconnect', { method: 'DELETE' });
}

export interface ApplePublicTokens {
  developer_token: string;
  developer_token_expires_at: string;
  music_user_token: string;
  music_user_token_expires_at: string | null;
}

/** feat/tv-audio-output — tokens pour la TV publique (gated session active). */
export async function getApplePublicTokens(workspaceId: string): Promise<ApplePublicTokens> {
  return api(`/api/auth/apple/token-public/${encodeURIComponent(workspaceId)}`);
}
