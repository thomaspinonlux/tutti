/**
 * appleDeveloperToken.ts — feat/apple-music (étape 3)
 *
 * Mint le "developer token" MusicKit : un JWT ES256 signé avec la clé privée
 * MusicKit (.p8), requis pour :
 *   - initialiser MusicKit JS côté navigateur (lecture host)
 *   - appeler l'Apple Music API (recherche catalogue, cf. AppleMusicProvider)
 *
 * Signature ES256 via le module `crypto` natif de Node (aucune dépendance).
 * Node produit directement la signature au format JOSE (r||s) grâce à
 * `dsaEncoding: 'ieee-p1363'`.
 *
 * Env requis (JAMAIS hardcodé — lu depuis process.env) :
 *   - APPLE_TEAM_ID            : Team ID Apple Developer (iss)
 *   - APPLE_MUSIC_KEY_ID       : Key ID de la clé MusicKit (kid)
 *   - APPLE_MUSIC_PRIVATE_KEY  : contenu du .p8 (PEM PKCS#8). Peut contenir des
 *                                `\n` échappés (env multi-lignes) → convertis
 *                                en vrais retours ligne avant signature.
 *
 * Le token est mis en cache en mémoire et régénéré avant expiration.
 */

import { createSign, createPrivateKey, type KeyObject } from 'node:crypto';

/** Durée de vie du token : 150 jours (< 6 mois, la limite Apple). */
const TOKEN_TTL_SEC = 60 * 60 * 24 * 150;
/** Marge de renouvellement : régénère 1h avant expiration. */
const RENEW_BEFORE_SEC = 60 * 60;

export class AppleTokenError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppleTokenError';
  }
}

let cached: { token: string; exp: number } | null = null;
let keyObjectCache: KeyObject | null = null;

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Le .p8 peut arriver avec des `\n` échappés (env) → vrais retours ligne. */
function normalizePrivateKey(raw: string): string {
  let key = raw.trim();
  if (key.includes('\\n')) key = key.replace(/\\n/g, '\n');
  // Certains hébergeurs entourent la valeur de guillemets — on les retire.
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim();
    if (key.includes('\\n')) key = key.replace(/\\n/g, '\n');
  }
  return key;
}

function getKeyObject(): KeyObject {
  if (keyObjectCache) return keyObjectCache;
  const rawKey = process.env.APPLE_MUSIC_PRIVATE_KEY;
  if (!rawKey) {
    throw new AppleTokenError(
      'APPLE_MUSIC_CONFIG_MISSING',
      'APPLE_MUSIC_PRIVATE_KEY manquant dans l’environnement.',
    );
  }
  try {
    keyObjectCache = createPrivateKey({ key: normalizePrivateKey(rawKey) });
  } catch (err) {
    throw new AppleTokenError(
      'APPLE_MUSIC_KEY_INVALID',
      `Clé privée MusicKit invalide : ${(err as Error).message}`,
    );
  }
  return keyObjectCache;
}

/**
 * Renvoie un developer token MusicKit valide (mis en cache, régénéré avant
 * expiration). Throw AppleTokenError si la config env est incomplète/invalide.
 */
export function getAppleDeveloperToken(): { token: string; expiresAt: Date } {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - RENEW_BEFORE_SEC > now) {
    return { token: cached.token, expiresAt: new Date(cached.exp * 1000) };
  }

  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_MUSIC_KEY_ID;
  if (!teamId || !keyId) {
    throw new AppleTokenError(
      'APPLE_MUSIC_CONFIG_MISSING',
      'APPLE_TEAM_ID / APPLE_MUSIC_KEY_ID manquants dans l’environnement.',
    );
  }

  const exp = now + TOKEN_TTL_SEC;
  const header = { alg: 'ES256', kid: keyId };
  const payload = { iss: teamId, iat: now, exp };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;

  const sign = createSign('SHA256');
  sign.update(signingInput);
  sign.end();
  const signature = sign.sign({ key: getKeyObject(), dsaEncoding: 'ieee-p1363' });

  const token = `${signingInput}.${b64url(signature)}`;
  cached = { token, exp };
  return { token, expiresAt: new Date(exp * 1000) };
}

/** true si la config Apple Music est présente (sans lever d'exception). */
export function isAppleMusicConfigured(): boolean {
  return !!(
    process.env.APPLE_TEAM_ID &&
    process.env.APPLE_MUSIC_KEY_ID &&
    process.env.APPLE_MUSIC_PRIVATE_KEY
  );
}
