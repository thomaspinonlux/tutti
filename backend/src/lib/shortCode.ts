/**
 * Générateur de short_code pour les sessions, format `XXXX-YYYY`.
 *
 *   - XXXX : 4 lettres dérivées du nom de l'établissement (uppercase, alphanum,
 *            paddé/coupé). Permet aux joueurs de reconnaître où ils jouent.
 *   - YYYY : 4 chars alphanum random (sans 0/O/I/1 pour éviter les confusions).
 *
 * Exemples : "KOMP-7K2X", "BARZ-9HM4".
 */

import { prisma } from './prisma.js';

const RANDOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0, O, I, 1

function buildPrefix(establishmentName: string): string {
  const cleaned = establishmentName
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[^A-Z0-9]/giu, '');
  if (cleaned.length >= 4) return cleaned.slice(0, 4);
  // Pad avec X si trop court (ex. "BAR" → "BARX")
  return (cleaned + 'XXXX').slice(0, 4);
}

function randomSuffix(length = 4): string {
  let out = '';
  const bytes = new Uint8Array(length);
  // Node 20+ : crypto.getRandomValues sur webcrypto global
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i++) {
    out += RANDOM_ALPHABET[bytes[i]! % RANDOM_ALPHABET.length];
  }
  return out;
}

/**
 * Génère un short_code unique en base. Tente jusqu'à 5 fois en cas de collision.
 */
export async function generateUniqueShortCode(establishmentName: string): Promise<string> {
  const prefix = buildPrefix(establishmentName);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = `${prefix}-${randomSuffix()}`;
    const existing = await prisma.session.findUnique({ where: { short_code: code } });
    if (!existing) return code;
  }
  // Si on collide 5 fois (statistiquement quasi impossible avec 32^4 combinaisons),
  // ajouter un 5ᵉ char.
  return `${prefix}-${randomSuffix(5)}`;
}
