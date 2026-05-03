/**
 * Helpers partagés entre la route gameplay (host, mode A) et sessionMaster
 * (master, mode B). Sans contrôle d'auth — c'est aux routes appelantes de
 * vérifier que l'appel est autorisé.
 *
 * Concentre :
 *   - le lookup d'un round avec ses tracks ordonnés
 *   - la construction + broadcast du CurrentTrackState
 *   - l'avance au prochain track avec auto-end de round si plus de tracks
 *   - la révélation manuelle (master "Réponse") sans buzz ni score
 */

import type { CurrentTrackState } from '@tutti/shared';
import { prisma } from './prisma.js';
import { broadcastToSession } from '../socket/index.js';
import {
  clearActiveTrack,
  setActiveTrack,
  setPhase3Revealed,
  getActiveTrack,
} from './gameState.js';

export const LISTEN_DURATION_MS = 30_000; // 30s par défaut V1

// Inclut la playlist avec ses morceaux ordonnés. Track relie maintenant un
// Artist (catalogue partagé), donc on l'inclut aussi pour avoir artist.canonical_name.
const ROUND_INCLUDE = {
  playlist: {
    include: {
      playlist_tracks: {
        orderBy: { position: 'asc' as const },
        include: { track: { include: { artist: true } } },
      },
    },
  },
} as const;

export type RoundWithTracks = NonNullable<Awaited<ReturnType<typeof findRoundForSession>>>;

const PLAYLIST_LIGHT = {
  id: true,
  name: true,
  level: true,
  _count: { select: { playlist_tracks: true } },
} as const;

/**
 * Cherche un round dans une session donnée, sans contrôle workspace. Utilisé
 * par la route master où le contrôle d'autorisation se fait via JWT
 * participant + flag is_master.
 */
export async function findRoundForSession(roundId: string, sessionId: string) {
  return prisma.sessionRound.findFirst({
    where: { id: roundId, session_id: sessionId },
    include: ROUND_INCLUDE,
  });
}

/**
 * Variante workspace-scoped pour la route host (mode A). Le contrôle se fait
 * via l'auth Supabase + appartenance au workspace.
 */
export async function findRoundForWorkspace(
  roundId: string,
  sessionId: string,
  workspaceId: string,
) {
  return prisma.sessionRound.findFirst({
    where: {
      id: roundId,
      session_id: sessionId,
      session: { establishment: { workspace_id: workspaceId } },
    },
    include: ROUND_INCLUDE,
  });
}

/**
 * Construit un CurrentTrackState à partir d'un round + index, met à jour la
 * gameState en mémoire, persiste le current_track_index, et broadcast
 * 'track:start' à toute la session.
 *
 * Retourne null si l'index est out-of-range (pas de track à cette position).
 */
export async function buildAndBroadcastTrack(
  sessionId: string,
  round: RoundWithTracks,
  trackIndex: number,
): Promise<CurrentTrackState | null> {
  const playlistTrack = round.playlist.playlist_tracks[trackIndex];
  if (!playlistTrack) return null;
  const track = playlistTrack.track;

  const nowMs = Date.now();
  const state: CurrentTrackState = {
    round_id: round.id,
    track_index: trackIndex,
    track_id: track.id,
    provider: track.provider as CurrentTrackState['provider'],
    provider_track_id: track.provider_track_id,
    artist: track.artist.canonical_name,
    title: track.canonical_title,
    album: track.album,
    year: track.year,
    cover_url: track.cover_url,
    started_at: new Date(nowMs).toISOString(),
    duration_ms: track.duration_ms,
    phase: 'phase1',
    phase2_started_at: null,
    correct_answers: [],
  };

  setActiveTrack(round.id, {
    round_id: round.id,
    track_index: trackIndex,
    track_id: track.id,
    started_at_ms: nowMs,
  });

  await prisma.sessionRound.update({
    where: { id: round.id },
    data: { current_track_index: trackIndex },
  });

  broadcastToSession(sessionId, 'track:start', { state });
  return state;
}

/**
 * "Recommencer le morceau" — reset gameState (phase=phase1, started_at=now,
 * vide buzzes/answers) ET re-broadcast 'track:start' avec nouveau state pour
 * que les clients se synchronisent (timer reset, phase reset, audio seek 0).
 *
 * Conserve track_id + track_index (même morceau). N'utilise PAS d'event
 * spécial 'track:restart' — single source of truth = track:start.
 *
 * Bug 1.3 : si la session est en pause, on la dépause + broadcast
 * session:resumed AVANT le track:start. Sinon les clients reçoivent le
 * track:start mais Spotify reste paused (is_paused=true bloque play).
 */
export async function restartCurrentTrackAndBroadcast(
  sessionId: string,
  round: RoundWithTracks,
): Promise<CurrentTrackState | null> {
  const current = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { is_paused: true },
  });
  if (current?.is_paused) {
    await prisma.session.update({
      where: { id: sessionId },
      data: { is_paused: false },
    });
    broadcastToSession(sessionId, 'session:resumed', { session_id: sessionId });
  }
  // Le track courant = round.current_track_index
  return buildAndBroadcastTrack(sessionId, round, round.current_track_index);
}

/**
 * Avance au track suivant. Si on a dépassé la dernière piste, termine le round
 * automatiquement (status ENDED + broadcast 'round:ended').
 *
 * Retourne :
 *   - { ended: true,  round: enriched }  si le round est terminé
 *   - { ended: false, state }            si un nouveau track est démarré
 */
export async function advanceToNextOrEndRound(
  sessionId: string,
  round: RoundWithTracks,
): Promise<
  { ended: true; round: EnrichedEndedRound | null } | { ended: false; state: CurrentTrackState }
> {
  const nextIndex = round.current_track_index + 1;
  if (nextIndex < round.playlist.playlist_tracks.length) {
    const state = await buildAndBroadcastTrack(sessionId, round, nextIndex);
    if (!state) {
      // ne devrait pas arriver, on a déjà vérifié l'index
      return { ended: false, state: state as never };
    }
    return { ended: false, state };
  }
  // Plus de tracks → auto-end du round
  return { ended: true, round: await endRoundInternal(sessionId, round.id) };
}

export interface EnrichedEndedRound {
  id: string;
  session_id: string;
  playlist_id: string;
  position: number;
  status: string;
  current_track_index: number;
  started_at: Date | null;
  ended_at: Date | null;
  created_at: Date;
  playlist: { id: string; name: string; level: string; tracks_count: number };
}

/**
 * Persiste le passage d'un round à ENDED, clear la gameState, et broadcast
 * 'round:ended'. Ne touche pas à la session globale.
 */
export async function endRoundInternal(
  sessionId: string,
  roundId: string,
): Promise<EnrichedEndedRound | null> {
  await prisma.sessionRound.update({
    where: { id: roundId },
    data: { status: 'ENDED', ended_at: new Date() },
  });
  clearActiveTrack(roundId);
  const updated = await prisma.sessionRound.findUnique({
    where: { id: roundId },
    include: { playlist: { select: PLAYLIST_LIGHT } },
  });
  const enriched: EnrichedEndedRound | null = updated
    ? {
        ...updated,
        playlist: {
          id: updated.playlist.id,
          name: updated.playlist.name,
          level: updated.playlist.level,
          tracks_count: updated.playlist._count.playlist_tracks,
        },
      }
    : null;
  broadcastToSession(sessionId, 'round:ended', { round: enriched });
  return enriched;
}

/**
 * Master "Réponse" : personne n'a buzzé, on révèle manuellement le morceau.
 * Passe la phase à 'cooldown', broadcast 'track:revealed' avec artist/title,
 * AUCUN ScoreEvent créé (0 point).
 *
 * Renvoie false si la phase n'est pas 'listening' (déjà buzzé / cooldown /
 * pas de track actif).
 */
/**
 * Phase 2.3 — snapshot CurrentTrackState pour restore au reload.
 *
 * Construit un CurrentTrackState complet à partir :
 *  - de l'état mémoire (phase, phase2_started_at, correct_answers, started_at)
 *  - des métadonnées DB (artist, title, year, cover_url, duration_ms)
 *
 * Retourne null si :
 *  - le round n'a pas d'activeTrack en mémoire (backend redémarré, ou round
 *    pas encore lancé via play-track),
 *  - ou si le track DB est introuvable.
 *
 * Pas de broadcast — usage côté handshake socket pour rehydrater le frontend.
 */
export async function buildCurrentTrackStateSnapshot(
  roundId: string,
): Promise<CurrentTrackState | null> {
  const active = getActiveTrack(roundId);
  if (!active) return null;
  const track = await prisma.track.findUnique({
    where: { id: active.track_id },
    include: { artist: { select: { canonical_name: true } } },
  });
  if (!track) return null;
  return {
    round_id: active.round_id,
    track_index: active.track_index,
    track_id: track.id,
    provider: track.provider as CurrentTrackState['provider'],
    provider_track_id: track.provider_track_id,
    artist: track.artist.canonical_name,
    title: track.canonical_title,
    album: track.album,
    year: track.year,
    cover_url: track.cover_url,
    started_at: new Date(active.started_at_ms).toISOString(),
    duration_ms: track.duration_ms,
    phase: active.phase,
    phase2_started_at: active.phase2_started_at_ms
      ? new Date(active.phase2_started_at_ms).toISOString()
      : null,
    correct_answers: active.correct_answers.map((a) => ({
      participant_id: a.participant_id,
      pseudo: a.pseudo,
      team_id: a.team_id,
      position: a.position,
      answered_at_ms: a.answered_at_ms,
      matched_artist: a.matched_artist,
      matched_title: a.matched_title,
      score: a.score,
      score_position: a.score_position,
      score_title_bonus: a.score_title_bonus,
      score_speed_bonus: a.score_speed_bonus,
    })),
  };
}

export async function revealCurrentTrack(
  sessionId: string,
  roundId: string,
): Promise<{ artist: string; title: string; track_index: number } | null> {
  const active = getActiveTrack(roundId);
  // "Donner la réponse" : permis en phase1 (personne n'a buzzé) et phase2
  // (fenêtre retardataires — abrège l'attente). Refusé en phase3+ (déjà révélé).
  if (!active || (active.phase !== 'phase1' && active.phase !== 'phase2')) return null;

  const track = await prisma.track.findUnique({
    where: { id: active.track_id },
    select: { canonical_title: true, artist: { select: { canonical_name: true } } },
  });
  if (!track) return null;

  setPhase3Revealed(roundId);
  const payload = {
    round_id: roundId,
    track_index: active.track_index,
    artist: track.artist.canonical_name,
    title: track.canonical_title,
  };
  // Bug fix — broadcast track:phase_changed AVANT track:revealed pour que
  // les clients (HostPage, ScreenPage, PlayPage) mettent à jour
  // currentTrack.phase en 'phase3-revealed' et fassent transitionner leur
  // UI (ResultPanel, FindersRecap, ValidatedBanner phase3, etc.).
  // Sans cet event, lastReveal était bien set mais phase restait phase1/2.
  broadcastToSession(sessionId, 'track:phase_changed', {
    round_id: roundId,
    phase: 'phase3-revealed',
    artist: track.artist.canonical_name,
    title: track.canonical_title,
  });
  broadcastToSession(sessionId, 'track:revealed', payload);
  return {
    artist: track.artist.canonical_name,
    title: track.canonical_title,
    track_index: active.track_index,
  };
}
