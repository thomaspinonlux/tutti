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
  RoundProgramResponse,
  Session,
  SessionRoundWithPlaylist,
  SessionWithParticipants,
  Team,
} from '@tutti/shared';
import { api } from './api.js';
import type { LibraryPlaylistSummary } from './library.js';

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

export interface CurrentActiveSession {
  id: string;
  short_code: string;
  name: string | null;
  status: 'WAITING' | 'PLAYING' | 'ENDED';
  game_type: GameType;
  mode: GameMode;
  started_at: string | null;
  created_at: string;
  participants_count: number;
}

/** Récupère la session active du workspace (WAITING ou PLAYING) ou null. */
export async function getCurrentSession(): Promise<CurrentActiveSession | null> {
  try {
    const data = await api<{ session: CurrentActiveSession } | null>('/api/sessions/current');
    return data?.session ?? null;
  } catch {
    return null;
  }
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

// feat/round-end-rankings — résultats fin de manche (RoundIntermissionScreen).
export interface RoundRankingEntry {
  participant_id: string;
  pseudo: string;
  points: number;
  rank: number;
}
export interface CumulativeRankingEntry {
  participant_id: string;
  pseudo: string;
  total_points: number;
  rank: number;
}
export interface FastestPlayer {
  participant_id: string;
  pseudo: string;
  avg_buzz_ms: number;
  first_buzz_count: number;
  buzz_count: number;
}
export interface RoundResults {
  round_id: string;
  round_position: number;
  round_ranking: RoundRankingEntry[];
  cumulative_ranking: CumulativeRankingEntry[];
  fastest_player: FastestPlayer | null;
}

export async function getRoundResults(sessionId: string, roundId: string): Promise<RoundResults> {
  return api<RoundResults>(
    `/api/sessions/${encodeURIComponent(sessionId)}/rounds/${encodeURIComponent(roundId)}/results`,
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

/**
 * GET /api/sessions/:id/rounds/:rid/program — Phase 2.1
 * Programme complet de la manche (tracks + statut PLAYED/CURRENT/UPCOMING).
 */
export async function getRoundProgram(
  sessionId: string,
  roundId: string,
): Promise<RoundProgramResponse> {
  return api<RoundProgramResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/rounds/${encodeURIComponent(roundId)}/program`,
  );
}

/**
 * Feature 3 — édition manuelle des points par l'animateur (mode A).
 * delta peut être négatif. broadcast scores:invalidated → tous les clients
 * rafraîchissent leur cumulative.
 */
export async function hostAdjustPoints(
  sessionId: string,
  participantId: string,
  delta: number,
  reason?: string,
): Promise<void> {
  await api(
    `/api/sessions/${encodeURIComponent(sessionId)}/players/${encodeURIComponent(participantId)}/score`,
    { method: 'PATCH', body: { delta, reason } },
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

/**
 * feat/sans-animateur — la télécommande demande un seek (avance/recul ±10s →
 * position absolue en ms). Broadcast track:seek → la console applique sur SON
 * lecteur. La télécommande n'émet aucun son.
 */
export async function masterSeek(
  sessionId: string,
  token: string,
  positionMs: number,
): Promise<void> {
  await api(`/api/sessions/${encodeURIComponent(sessionId)}/master/seek`, {
    method: 'POST',
    body: { token, position_ms: Math.max(0, Math.round(positionMs)) },
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

/**
 * feat/animator-full-control — l'animateur (master) liste la BIBLIOTHÈQUE
 * OFFICIELLE (visibilité déterminée par le workspace de la session, pas un user).
 */
export async function masterListOfficialPlaylists(
  sessionId: string,
  token: string,
  provider?: 'youtube' | 'spotify',
): Promise<LibraryPlaylistSummary[]> {
  const data = await api<{ playlists: LibraryPlaylistSummary[] }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/master/library/playlists`,
    { method: 'POST', body: { token, ...(provider ? { provider } : {}) }, anonymous: true },
  );
  return data.playlists;
}

/**
 * feat/animator-full-control — l'animateur clone + lance une playlist officielle
 * (source + niveau) → même effet que le launch host. Réponse identique à
 * masterPickRound ({round, state}) → le front traite les 2 pareil.
 */
export async function masterLaunchOfficial(
  sessionId: string,
  playlistId: string,
  token: string,
  preferProvider: 'youtube' | 'spotify' = 'youtube',
  difficulty?: 'EASY' | 'MEDIUM' | 'EXPERT',
): Promise<{ round: SessionRoundWithPlaylist; state: CurrentTrackState | null }> {
  return api(
    `/api/sessions/${encodeURIComponent(sessionId)}/master/library/playlists/${encodeURIComponent(playlistId)}/launch`,
    {
      method: 'POST',
      body: { token, preferProvider, ...(difficulty ? { difficulty } : {}) },
      anonymous: true,
    },
  );
}

/**
 * feat/animator-tv-library — l'animateur pousse la playlist qu'il regarde dans
 * la biblio → la TV (/screen) affiche la grille catalogue + surligne cette
 * playlist (même canal que le host). `null` = sort de la sélection.
 */
export async function masterSetScreenFocus(
  sessionId: string,
  token: string,
  playlistId: string | null,
): Promise<void> {
  await api(`/api/sessions/${encodeURIComponent(sessionId)}/master/screen/focus`, {
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
