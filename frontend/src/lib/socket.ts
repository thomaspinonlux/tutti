/**
 * Factories Socket.IO client — 2 modes d'auth :
 *   - host : passe le JWT Supabase courant (lu via supabase.auth.getSession)
 *   - participant : passe le token signé reçu après /join (stocké en localStorage)
 *
 * Usage type :
 *   const socket = await connectAsHost();
 *   socket.emit('session:join', { sessionId }, (resp) => { ... });
 *   socket.on('participant:joined', (payload) => { ... });
 */

import { io, type Socket } from 'socket.io-client';
import { supabase } from './supabase.js';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:3001';

const PARTICIPANT_TOKEN_KEY = 'tutti.participant.token';
const PARTICIPANT_SESSION_KEY = 'tutti.participant.session';

export function saveParticipantContext(token: string, sessionId: string): void {
  window.localStorage.setItem(PARTICIPANT_TOKEN_KEY, token);
  window.localStorage.setItem(PARTICIPANT_SESSION_KEY, sessionId);
}

export function readParticipantContext(): { token: string; sessionId: string } | null {
  const token = window.localStorage.getItem(PARTICIPANT_TOKEN_KEY);
  const sessionId = window.localStorage.getItem(PARTICIPANT_SESSION_KEY);
  if (!token || !sessionId) return null;
  return { token, sessionId };
}

export function clearParticipantContext(): void {
  window.localStorage.removeItem(PARTICIPANT_TOKEN_KEY);
  window.localStorage.removeItem(PARTICIPANT_SESSION_KEY);
}

export async function connectAsHost(): Promise<Socket> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Auth Supabase requise pour Socket.IO host');
  return io(SOCKET_URL, {
    auth: { token, role: 'host' },
    transports: ['websocket', 'polling'],
    reconnection: true,
  });
}

export function connectAsParticipant(token: string): Socket {
  return io(SOCKET_URL, {
    auth: { token, role: 'participant' },
    transports: ['websocket', 'polling'],
    reconnection: true,
  });
}
