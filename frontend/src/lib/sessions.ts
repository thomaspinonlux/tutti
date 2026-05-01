/**
 * Wrapper API /api/sessions/* — host ET joueur (le 2nd ne nécessite pas de
 * token Supabase, on s'appuie sur les routes "by-code").
 */

import type {
  BuzzResult,
  CumulativeScore,
  CurrentQuestionState,
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

/** Snapshot complet de la session pour le screen TV (read-only, sans auth). */
export async function getSessionSnapshot(
  shortCode: string,
): Promise<{ session: SessionWithParticipants; cumulative: CumulativeScore[] }> {
  return api<{ session: SessionWithParticipants; cumulative: CumulativeScore[] }>(
    `/api/sessions/by-code/${encodeURIComponent(shortCode)}/snapshot`,
    { anonymous: true },
  );
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

export async function skipTrack(
  sessionId: string,
  roundId: string,
): Promise<{ state?: CurrentTrackState; ended?: boolean; round?: SessionRoundWithPlaylist }> {
  return api<{ state?: CurrentTrackState; ended?: boolean; round?: SessionRoundWithPlaylist }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/rounds/${encodeURIComponent(roundId)}/skip-track`,
    { method: 'POST' },
  );
}

export async function giveAnswer(
  sessionId: string,
  roundId: string,
): Promise<{ reveal: { artist: string; title: string; track_index: number } }> {
  return api<{ reveal: { artist: string; title: string; track_index: number } }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/rounds/${encodeURIComponent(roundId)}/give-answer`,
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

// ───── Host (Supabase auth) — pause/resume/restart audio ──────────────────

export async function hostPauseSession(sessionId: string, roundId: string): Promise<void> {
  await api(
    `/api/sessions/${encodeURIComponent(sessionId)}/rounds/${encodeURIComponent(roundId)}/pause`,
    { method: 'POST' },
  );
}

export async function hostResumeSession(sessionId: string, roundId: string): Promise<void> {
  await api(
    `/api/sessions/${encodeURIComponent(sessionId)}/rounds/${encodeURIComponent(roundId)}/resume`,
    { method: 'POST' },
  );
}

export async function hostRestartTrack(sessionId: string, roundId: string): Promise<void> {
  await api(
    `/api/sessions/${encodeURIComponent(sessionId)}/rounds/${encodeURIComponent(roundId)}/restart-track`,
    { method: 'POST' },
  );
}

// ───── Tutti Quizz gameplay (étape 15) ────────────────────────────────────

export async function playQuestion(
  sessionId: string,
  questionIndex: number,
): Promise<CurrentQuestionState> {
  const data = await api<{ state: CurrentQuestionState }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/quizz/play-question`,
    { method: 'POST', body: { question_index: questionIndex } },
  );
  return data.state;
}

export async function nextQuestion(sessionId: string): Promise<{
  state?: CurrentQuestionState;
  ended?: boolean;
  session?: Session;
  cumulative?: CumulativeScore[];
}> {
  return api<{
    state?: CurrentQuestionState;
    ended?: boolean;
    session?: Session;
    cumulative?: CumulativeScore[];
  }>(`/api/sessions/${encodeURIComponent(sessionId)}/quizz/next-question`, {
    method: 'POST',
  });
}

export async function revealQuestion(sessionId: string): Promise<void> {
  await api(`/api/sessions/${encodeURIComponent(sessionId)}/quizz/reveal-question`, {
    method: 'POST',
  });
}

export async function submitQuizzAnswer(
  sessionId: string,
  token: string,
  value: string,
): Promise<{ ok: boolean; allAnswered: boolean }> {
  return api<{ ok: boolean; allAnswered: boolean }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/quizz/submit-answer`,
    { method: 'POST', body: { token, value }, anonymous: true },
  );
}

// ───── Master actions (mode B — joueur master pilote depuis son tel) ─────

export interface MasterPlaylistEntry {
  id: string;
  name: string;
  description: string | null;
  cover_url: string | null;
  level: string;
  language: string;
  is_express: boolean;
  is_official_tutti: boolean;
  tracks_count: number;
}

export async function masterListScores(
  sessionId: string,
  token: string,
): Promise<CumulativeScore[]> {
  const data = await api<{ cumulative: CumulativeScore[] }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/master/scores`,
    { method: 'POST', body: { token }, anonymous: true },
  );
  return data.cumulative;
}

export async function masterListPlaylists(
  sessionId: string,
  token: string,
): Promise<MasterPlaylistEntry[]> {
  const data = await api<{ playlists: MasterPlaylistEntry[] }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/master/playlists`,
    { method: 'POST', body: { token }, anonymous: true },
  );
  return data.playlists;
}

export async function masterNextTrack(
  sessionId: string,
  roundId: string,
  token: string,
): Promise<{ state?: CurrentTrackState; ended?: boolean; round?: SessionRoundWithPlaylist }> {
  return api(`/api/sessions/${encodeURIComponent(sessionId)}/master/next-track`, {
    method: 'POST',
    body: { token, round_id: roundId },
    anonymous: true,
  });
}

export async function masterSkipTrack(
  sessionId: string,
  roundId: string,
  token: string,
): Promise<{ state?: CurrentTrackState; ended?: boolean; round?: SessionRoundWithPlaylist }> {
  return api(`/api/sessions/${encodeURIComponent(sessionId)}/master/skip-track`, {
    method: 'POST',
    body: { token, round_id: roundId },
    anonymous: true,
  });
}

export async function masterGiveAnswer(
  sessionId: string,
  roundId: string,
  token: string,
): Promise<{ reveal: { artist: string; title: string; track_index: number } }> {
  return api(`/api/sessions/${encodeURIComponent(sessionId)}/master/give-answer`, {
    method: 'POST',
    body: { token, round_id: roundId },
    anonymous: true,
  });
}
// Alias rétrocompat — anciens consommateurs.
export const masterReveal = masterGiveAnswer;

export async function masterPause(sessionId: string, token: string): Promise<void> {
  await api(`/api/sessions/${encodeURIComponent(sessionId)}/master/pause`, {
    method: 'POST',
    body: { token },
    anonymous: true,
  });
}

export async function masterResume(sessionId: string, token: string): Promise<void> {
  await api(`/api/sessions/${encodeURIComponent(sessionId)}/master/resume`, {
    method: 'POST',
    body: { token },
    anonymous: true,
  });
}

export async function masterRestartTrack(
  sessionId: string,
  roundId: string,
  token: string,
): Promise<void> {
  await api(`/api/sessions/${encodeURIComponent(sessionId)}/master/restart-track`, {
    method: 'POST',
    body: { token, round_id: roundId },
    anonymous: true,
  });
}

export async function masterEndRound(
  sessionId: string,
  roundId: string,
  token: string,
): Promise<void> {
  await api(`/api/sessions/${encodeURIComponent(sessionId)}/master/end-round`, {
    method: 'POST',
    body: { token, round_id: roundId },
    anonymous: true,
  });
}

export async function masterEndSession(
  sessionId: string,
  token: string,
): Promise<{ session: Session; cumulative: CumulativeScore[] }> {
  return api(`/api/sessions/${encodeURIComponent(sessionId)}/master/end-session`, {
    method: 'POST',
    body: { token },
    anonymous: true,
  });
}

export async function masterPickRound(
  sessionId: string,
  playlistId: string,
  token: string,
): Promise<{ round: SessionRoundWithPlaylist; state: CurrentTrackState | null }> {
  return api(`/api/sessions/${encodeURIComponent(sessionId)}/master/pick-round`, {
    method: 'POST',
    body: { token, playlist_id: playlistId },
    anonymous: true,
  });
}

export async function masterAdjustPoints(
  sessionId: string,
  token: string,
  args: { target_participant_id: string; delta: number; reason?: string },
): Promise<void> {
  await api(`/api/sessions/${encodeURIComponent(sessionId)}/master/adjust-points`, {
    method: 'POST',
    body: { token, ...args },
    anonymous: true,
  });
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

// ───── Tutti Quizz — master actions (mode B) ──────────────────────────────

export async function masterPlayQuestion(
  sessionId: string,
  token: string,
  questionIndex = 0,
): Promise<{ state: CurrentQuestionState }> {
  return api<{ state: CurrentQuestionState }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/master/quizz/play-question`,
    { method: 'POST', body: { token, question_index: questionIndex }, anonymous: true },
  );
}

export async function masterNextQuestion(
  sessionId: string,
  token: string,
): Promise<{
  state?: CurrentQuestionState;
  ended?: boolean;
  session?: Session;
  cumulative?: CumulativeScore[];
}> {
  return api(`/api/sessions/${encodeURIComponent(sessionId)}/master/quizz/next-question`, {
    method: 'POST',
    body: { token },
    anonymous: true,
  });
}

export async function masterRevealQuestion(sessionId: string, token: string): Promise<void> {
  await api(`/api/sessions/${encodeURIComponent(sessionId)}/master/quizz/reveal-question`, {
    method: 'POST',
    body: { token },
    anonymous: true,
  });
}
