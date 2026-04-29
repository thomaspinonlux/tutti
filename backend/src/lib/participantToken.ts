/**
 * JWT HMAC-SHA256 court pour les participants joueurs.
 *
 * Les joueurs ne sont pas dans Supabase Auth — ils sont identifiés par
 * leur ID dans la table `participants`. Quand on appelle POST /sessions/:code/join,
 * on crée un participant et on retourne un token signé qui contient son ID.
 *
 * Le frontend stocke ce token et l'envoie en handshake Socket.IO + en
 * header Authorization pour les requêtes subséquentes.
 *
 * TTL : 24h (durée raisonnable pour une soirée de blind test).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

interface ParticipantTokenPayload {
  participant_id: string;
  session_id: string;
  exp: number;
}

const DEFAULT_TTL_SECONDS = 24 * 3600;

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET manquant');
  return secret;
}

export function signParticipantToken(
  input: { participantId: string; sessionId: string },
  ttlSec = DEFAULT_TTL_SECONDS,
): string {
  const payload: ParticipantTokenPayload = {
    participant_id: input.participantId,
    session_id: input.sessionId,
    exp: Math.floor(Date.now() / 1000) + ttlSec,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', getSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyParticipantToken(token: string): ParticipantTokenPayload {
  const parts = token.split('.');
  if (parts.length !== 2) throw new Error('Token participant malformé');
  const [body, sig] = parts as [string, string];
  const expected = createHmac('sha256', getSecret()).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error('Signature token participant invalide');
  }
  const decoded = JSON.parse(
    Buffer.from(body, 'base64url').toString('utf8'),
  ) as ParticipantTokenPayload;
  if (typeof decoded.exp !== 'number' || decoded.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token participant expiré');
  }
  if (!decoded.participant_id || !decoded.session_id)
    throw new Error('Token participant incomplet');
  return decoded;
}
