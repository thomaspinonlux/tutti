/**
 * Helper de signature/vérification de `state` OAuth (anti-CSRF).
 *
 * Encode userId + workspaceId + nonce + exp dans une chaîne signée HMAC.
 * Le state est passé à l'IdP, qui le renvoie au callback. On vérifie
 * la signature, l'expiration, et on récupère le contexte tenant sans DB.
 *
 * Format : `<base64url(payload)>.<base64url(hmac_sha256)>`
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

interface OAuthStatePayload {
  user_id: string;
  workspace_id: string;
  nonce: string;
  exp: number; // unix seconds
}

const DEFAULT_TTL_SECONDS = 600; // 10 minutes

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET manquant dans les env vars');
  }
  return secret;
}

export function signOAuthState(
  input: { userId: string; workspaceId: string },
  ttlSec = DEFAULT_TTL_SECONDS,
): string {
  const payload: OAuthStatePayload = {
    user_id: input.userId,
    workspace_id: input.workspaceId,
    nonce: randomBytes(12).toString('hex'),
    exp: Math.floor(Date.now() / 1000) + ttlSec,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', getSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyOAuthState(state: string): OAuthStatePayload {
  const parts = state.split('.');
  if (parts.length !== 2) {
    throw new Error('State malformé');
  }
  const [body, sig] = parts as [string, string];
  const expected = createHmac('sha256', getSecret()).update(body).digest('base64url');

  // timingSafeEqual évite les timing attacks sur la signature.
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error('State signature invalide');
  }

  const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthStatePayload;
  if (typeof decoded.exp !== 'number' || decoded.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('State expiré');
  }
  if (!decoded.user_id || !decoded.workspace_id) {
    throw new Error('State incomplet');
  }
  return decoded;
}
