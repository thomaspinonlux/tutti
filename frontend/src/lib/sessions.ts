/**
 * Wrapper API /api/sessions/* — host ET joueur (le 2nd ne nécessite pas de
 * token Supabase, on s'appuie sur les routes "by-code").
 */

import type {
  BuzzResult,
  CumulativeScore,
  CurrentTrackState,
  GameMode,
  GameType,
  JoinResponse,
  Participant,
  PublicSessionView,
  Session,
  SessionRoundWithPlaylist,
  SessionWithParticipants,
  Team,
} from '@tutti/shared';
import { api } from './api.js';

export interface CreateSessionInput {
  name?: string;
  game_type?: GameType;
  mode?: GameMode;
  teams_config?: Team[];
  language?: 'fr' | 'en';
  question_set_id?: string;
  /** false = mode B "tout le monde joue" (défaut), true = mode A avec animateur. */
  has_animator?: boolean;
}

export async function createSession(input: CreateSessionInput): Promise<Session> {
  const data = await api<{ session: Session }>('/api/sessions', { method: 'POST', body: input });
  return data.session;
}

export async function getSession(
  id: string,
): Promise<{ session: SessionWithParticipants; cumulative: CumulativeScore[] }> {
  return api<{ session: SessionWithParticipants; cumulative: CumulativeScore[] }>(
    `/api/sessions/by-id/${encodeURIComponent(id)}`,
  );
}

export async function endSession(
  id: string,
): Promise<{ session: Session; cumulative: CumulativeScore[] }> {
  return api<{ session: Session; cumulative: CumulativeScore[] }>(
    `/api/sessions/${encodeURIComponent(id)}/end`,
    { method: 'POST' },
  );
}

/** Vue publique (joueur, sans auth). */
export async function getPublicSession(shortCode: string): Promise<PublicSessionView> {
  const data = await api<{ session: PublicSessionView }>(
    `/api/sessions/by-code/${encodeURIComponent(shortCode)}`,
    { anonymous: true },
  );
  return data.session;
}

export async function patchSession(
  id: string,
  patch: Partial<{
    name: string | null;
    mode: GameMode;
    teams_config: Team[] | null;
    language: 'fr' | 'en';
    question_set_id: string | null;
  }>,
): Promise<Session> {
  const data = await api<{ session: Session }>(`/api/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: patch,
  });
  return data.session;
}

export async function startSession(id: string): Promise<Session> {
  const data = await api<{ session: Session }>(`/api/sessions/${encodeURIComponent(id)}/start`, {
    method: 'POST',
  });
  return data.session;
}

// ───── Rounds ─────────────────────────────────────────────────────────────

export async function createRound(
  sessionId: string,
  playlistId: string,
): Promise<SessionRoundWithPlaylist> {
  const data = await api<{ round: SessionRoundWithPlaylist }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/rounds`,
    { method: 'POST', body: { playlist_id: playlistId } },
  );
  return data.round;
}

export async function startRound(
  sessionId: string,
  roundId: string,
): Promise<SessionRoundWithPlaylist> {
  const data = await api<{ round: SessionRoundWithPlaylist }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/rounds/${encodeURIComponent(roundId)}/start`,
    { method: 'POST' },
  );
  return data.round;
}

export async function endRound(
  sessionId: string,
  roundId: string,
): Promise<SessionRoundWithPlaylist> {
  const data = await api<{ round: SessionRoundWithPlaylist }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/rounds/${encodeURIComponent(roundId)}/end`,
    { method: 'POST' },
  );
  return data.round;
}

// ───── Participants ───────────────────────────────────────────────────────

export async function joinSession(
  shortCode: string,
  body: { pseudo: string; team_id?: string | null; fingerprint?: string },
): Promise<JoinResponse> {
  return api<JoinResponse>(`/api/sessions/by-code/${encodeURIComponent(shortCode)}/join`, {
    method: 'POST',
    body,
    anonymous: true,
  });
}

export async function moveParticipantTeam(
  sessionId: string,
  participantId: string,
  teamId: string | null,
): Promise<Participant> {
  const data = await api<{ participant: Participant }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/participants/${encodeURIComponent(participantId)}`,
    { method: 'PATCH', body: { team_id: teamId } },
  );
  return data.participant;
}

export async function kickParticipant(sessionId: string, participantId: string): Promise<void> {
  await api(
    `/api/sessions/${encodeURIComponent(sessionId)}/participants/${encodeURIComponent(participantId)}`,
    { method: 'DELETE' },
  );
}

/**
 * Toggle master sur un participant. Au plus un master par session — si quelqu'un
 * d'autre l'était, il est démasterisé en transaction.
 */
export async function toggleParticipantMaster(
  sessionId: string,
  participantId: string,
): Promise<Participant> {
  const data = await api<{ participant: Participant }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/participants/${encodeURIComponent(participantId)}/master`,
    { method: 'POST' },
  );
  return data.participant;
}

// ───── Gameplay (étape 10) ────────────────────────────────────────────────

export async function playTrack(sessionId: string, roundId: string): Promise<CurrentTrackState> {
  const data = await api<{ state: CurrentTrackState }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/rounds/${encodeURIComponent(roundId)}/play-track`,
    { method: 'POST' },
  );
  return data.state;
}

export async function nextTrack(
  sessionId: string,
  roundId: string,
): Promise<{ state?: CurrentTrackState; ended?: boolean; round?: SessionRoundWithPlaylist }> {
  return api<{ state?: CurrentTrackState; ended?: boolean; round?: SessionRoundWithPlaylist }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/rounds/${encodeURIComponent(roundId)}/next-track`,
    { method: 'POST' },
  );
}

export async function postBuzz(
  sessionId: string,
  roundId: string,
  token: string,
): Promise<{ ok: boolean; buzz_time_ms: number }> {
  return api<{ ok: boolean; buzz_time_ms: number }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/rounds/${encodeURIComponent(roundId)}/buzz`,
    { method: 'POST', body: { token }, anonymous: true },
  );
}

export async function postAnswer(
  sessionId: string,
  roundId: string,
  token: string,
  matched: { matched_artist: boolean; matched_title: boolean },
): Promise<{ result: BuzzResult }> {
  return api<{ result: BuzzResult }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/rounds/${encodeURIComponent(roundId)}/answer`,
    { method: 'POST', body: { token, ...matched }, anonymous: true },
  );
}
