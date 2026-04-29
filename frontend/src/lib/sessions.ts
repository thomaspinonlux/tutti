/**
 * Wrapper API /api/sessions/* — host ET joueur (le 2nd ne nécessite pas de
 * token Supabase, on s'appuie sur les routes "by-code").
 */

import type {
  GameMode,
  GameType,
  JoinResponse,
  Participant,
  PublicSessionView,
  Session,
  SessionWithParticipants,
  Team,
} from '@tutti/shared';
import { api } from './api.js';

export interface CreateSessionInput {
  game_type?: GameType;
  mode?: GameMode;
  teams_config?: Team[];
  language?: 'fr' | 'en';
  playlist_id?: string;
  question_set_id?: string;
}

export async function createSession(input: CreateSessionInput): Promise<Session> {
  const data = await api<{ session: Session }>('/api/sessions', { method: 'POST', body: input });
  return data.session;
}

export async function getSession(id: string): Promise<SessionWithParticipants> {
  const data = await api<{ session: SessionWithParticipants }>(
    `/api/sessions/by-id/${encodeURIComponent(id)}`,
  );
  return data.session;
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
    mode: GameMode;
    teams_config: Team[] | null;
    language: 'fr' | 'en';
    playlist_id: string | null;
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
