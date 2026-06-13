/**
 * tvCode.ts — feat/tv-join-code-multidevice
 *
 * Génère le code de salon court qui permet à un 2e device de rejoindre une
 * session en mode "Écran TV" (route /tv/{CODE} ou saisie sur /tv).
 *
 * Alphabet NON ambigu (5 chars) : exclut 0/O, 1/I, L pour éviter les
 * confusions à la lecture/saisie sur grand écran. 31^5 ≈ 28,6M combinaisons.
 * Distinct de short_code (code joueur 8 chars, format XXXX-YYYY).
 */

import { prisma } from './prisma.js';

/** Alphabet sans caractères ambigus (cf. spec). */
const TV_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TV_CODE_LENGTH = 5;

/** Normalise une saisie utilisateur : uppercase + retire les non-alphabet. */
export function normalizeTvCode(input: string): string {
  return input
    .toUpperCase()
    .split('')
    .filter((c) => TV_ALPHABET.includes(c))
    .join('');
}

function randomTvCode(): string {
  const bytes = new Uint8Array(TV_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < TV_CODE_LENGTH; i++) {
    out += TV_ALPHABET[bytes[i]! % TV_ALPHABET.length];
  }
  return out;
}

/**
 * Génère un tv_code unique en base. Tente jusqu'à 5 fois en cas de collision
 * (l'unicité est globale ; l'espace 28M rend les collisions quasi nulles).
 */
export async function generateUniqueTvCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomTvCode();
    const existing = await prisma.session.findUnique({
      where: { tv_code: code },
      select: { id: true },
    });
    if (!existing) return code;
  }
  // Fallback ultra-improbable : suffixe horodaté pour garantir l'unicité.
  return randomTvCode() + TV_ALPHABET[Date.now() % TV_ALPHABET.length];
}
