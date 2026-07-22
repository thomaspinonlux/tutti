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

/** Ré-emballe un corps base64 en PEM propre (lignes de 64 chars) sous le label
 *  donné (ex. "PRIVATE KEY"). */
function wrapPem(label: string, base64Body: string): string {
  const body = base64Body.replace(/\s+/g, '');
  const lines = body.match(/.{1,64}/g)?.join('\n') ?? body;
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
}

/**
 * Normalise APPLE_MUSIC_PRIVATE_KEY quel que soit le format de stockage (env
 * Railway aplatit souvent les retours ligne du .p8). Gère :
 *   1. `\n` littéraux (échappés) → vrais retours ligne.
 *   2. Clé aplatie sur une ligne (headers présents mais body collé) →
 *      reconstruit le PEM avec un body wrappé à 64 chars.
 *   3. Clé déjà bien formatée → laissée telle quelle (re-wrap idempotent).
 *   4. Base64 complet du .p8 SANS header → décodé d'abord ; si le décodé
 *      contient un header PEM on le prend, sinon on wrappe le body en PEM.
 */
function normalizePrivateKey(raw: string): { key: string; caseUsed: string } {
  let key = raw.trim();
  let caseUsed = '3:pem-asis';
  // Retire des guillemets d'enrobage éventuels (certains hébergeurs).
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1).trim();
    caseUsed = 'quoted';
  }
  // 1. `\n` littéraux → vrais retours ligne.
  if (key.includes('\\n')) {
    key = key.replace(/\\n/g, '\n');
    caseUsed = '1:unescaped-\\n';
  }

  // 4. Aucun header PEM → peut être le .p8 encodé en base64 entier. On tente un
  //    décodage : si le résultat contient un header, on l'utilise.
  if (!key.includes('BEGIN')) {
    try {
      const decoded = Buffer.from(key.replace(/\s+/g, ''), 'base64').toString('utf8');
      if (decoded.includes('BEGIN')) {
        key = decoded.trim();
        caseUsed = '4a:base64-full-p8';
      }
    } catch {
      /* pas du base64 valide → on continue avec la valeur brute */
    }
  }

  // 2 + 3. Si un bloc PEM est présent (même aplati), on le ré-emballe proprement
  //        (extrait le label + le body, re-wrappe à 64 chars). Idempotent.
  const block = key.match(/-----BEGIN ([A-Z0-9 ]+?)-----([\s\S]*?)-----END \1-----/);
  if (block) {
    if (caseUsed === '3:pem-asis' || caseUsed === 'quoted') caseUsed = '2/3:pem-rewrap';
    return { key: wrapPem(block[1]!.trim(), block[2]!), caseUsed };
  }

  // Pas de header du tout mais une valeur non vide → on suppose que c'est le
  // body base64 nu de la clé PKCS#8 (.p8) → on l'emballe en PEM PRIVATE KEY.
  if (key.length > 0 && !key.includes('BEGIN')) {
    return { key: wrapPem('PRIVATE KEY', key), caseUsed: '4b:base64-body-wrap' };
  }

  return { key, caseUsed: 'none' };
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
    keyObjectCache = createPrivateKey({ key: normalizePrivateKey(rawKey).key });
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

/**
 * Log clair au démarrage : valide le parsing de la clé privée MusicKit sans
 * jeter (utile pour diagnostiquer un .p8 mal formaté en env). À appeler une
 * fois au boot du serveur.
 */
export function logAppleMusicKeyStatus(): void {
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_MUSIC_KEY_ID;
  const rawKey = process.env.APPLE_MUSIC_PRIVATE_KEY;
  if (!teamId || !keyId || !rawKey) {
    console.info(
      `[Apple] non configuré — teamId=${teamId ? 'set' : 'MISSING'} keyId=${
        keyId ? 'set' : 'MISSING'
      } privateKey=${rawKey ? 'set' : 'MISSING'}`,
    );
    return;
  }
  // Diagnostic SANS jamais afficher la clé : uniquement des méta-infos.
  const trimmed = rawKey.trim();
  const norm = normalizePrivateKey(rawKey);
  console.info(
    `[Apple] key diag — rawLength=${rawKey.length} · hasBEGIN=${trimmed.includes('BEGIN')} · ` +
      `hasLiteral\\n=${trimmed.includes('\\n')} · hasRealNewlines=${trimmed.includes('\n')} · ` +
      `startsWithQuote=${trimmed.startsWith('"') || trimmed.startsWith("'")} · ` +
      `caseUsed=${norm.caseUsed} · normalizedHasBEGIN=${norm.key.includes('BEGIN')} · ` +
      `normalizedLines=${norm.key.split('\n').length}`,
  );
  try {
    getKeyObject(); // parse + met en cache la clé normalisée
    console.info('[Apple] key format: OK');
  } catch (err) {
    const msg = err instanceof AppleTokenError ? err.message : (err as Error).message;
    console.error(`[Apple] key format: ERREUR — ${msg}`);
  }
}
