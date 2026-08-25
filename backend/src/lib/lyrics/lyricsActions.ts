/**
 * lyricsActions.ts — logique MÉTIER partagée entre la route host et la route
 * master (télécommande). Les deux surfaces font exactement la même chose ;
 * seule l'authentification diffère, elle reste dans les routes.
 *
 * Les trois gardes appliquées avant tout affichage :
 *   1. un morceau est en cours ;
 *   2. il est RÉVÉLÉ (`isTrackAnswerPublic`) — les paroles trahissent la
 *      réponse, jamais d'affichage en phase 1/2 ;
 *   3. des paroles VÉRIFIÉES existent (`status='ok'`).
 * Si l'une manque → 409, aucun affichage. Pas de « meilleur effort ».
 */

import { broadcastToSession } from '../../socket/index.js';
import { getActiveTrack } from '../gameState.js';
import { isTrackAnswerPublic } from '../gameplayCore.js';
import type { GameTrackPhase } from '@tutti/shared';
import { prisma } from '../prisma.js';
import { getUsableLyrics, rejectLyrics } from './lyricsStore.js';
import { setLyricsOverlay, clearLyricsOverlay } from './lyricsOverlayStore.js';

export type LyricsActionError =
  | 'NO_ACTIVE_TRACK'
  | 'LYRICS_NOT_PUBLIC'
  | 'LYRICS_UNAVAILABLE'
  | 'ROUND_NOT_FOUND';

export interface LyricsActionResult {
  ok: boolean;
  error?: LyricsActionError;
}

/** Morceau courant d'une session : round PLAYING + track actif en mémoire. */
async function resolveCurrentTrack(
  sessionId: string,
): Promise<{ provider: string; providerTrackId: string; phase: GameTrackPhase } | null> {
  const round = await prisma.sessionRound.findFirst({
    where: { session_id: sessionId, status: 'PLAYING' },
    select: { id: true },
  });
  if (!round) return null;
  const active = getActiveTrack(round.id);
  if (!active) return null;
  const track = await prisma.track.findUnique({
    where: { id: active.track_id },
    select: { provider: true, provider_track_id: true },
  });
  if (!track) return null;
  return {
    provider: track.provider,
    providerTrackId: track.provider_track_id,
    phase: active.phase,
  };
}

/**
 * Allume/éteint l'overlay paroles. L'extinction est TOUJOURS autorisée (on doit
 * pouvoir masquer même dans un état incohérent) ; seul l'allumage est gardé.
 */
export async function toggleLyricsOverlay(
  sessionId: string,
  on: boolean,
): Promise<LyricsActionResult> {
  if (!on) {
    clearLyricsOverlay(sessionId);
    broadcastToSession(sessionId, 'lyrics:overlay', { on: false });
    return { ok: true };
  }

  const current = await resolveCurrentTrack(sessionId);
  if (!current) return { ok: false, error: 'NO_ACTIVE_TRACK' };
  if (!isTrackAnswerPublic(current.phase)) {
    return { ok: false, error: 'LYRICS_NOT_PUBLIC' };
  }
  const lyrics = await getUsableLyrics(current.provider, current.providerTrackId);
  if (!lyrics) return { ok: false, error: 'LYRICS_UNAVAILABLE' };

  setLyricsOverlay(sessionId, true);
  broadcastToSession(sessionId, 'lyrics:overlay', { on: true });
  return { ok: true };
}

/**
 * « Paroles fausses » : rejet DÉFINITIF des paroles du morceau courant, pour
 * toutes les parties futures. Éteint l'overlay dans la foulée et prévient les
 * clients que le bouton doit disparaître (`available: false`).
 */
export async function rejectCurrentLyrics(sessionId: string): Promise<LyricsActionResult> {
  const current = await resolveCurrentTrack(sessionId);
  if (!current) return { ok: false, error: 'NO_ACTIVE_TRACK' };

  await rejectLyrics(current.provider, current.providerTrackId);
  clearLyricsOverlay(sessionId);
  broadcastToSession(sessionId, 'lyrics:overlay', { on: false, available: false });
  return { ok: true };
}

/** Mappe une erreur métier sur son code HTTP. */
export function lyricsErrorStatus(error: LyricsActionError): number {
  return error === 'ROUND_NOT_FOUND' ? 404 : 409;
}
