/**
 * Factories Socket.IO client + persistance de l'identité joueur.
 *
 * Cf. docs/PLAYER_RESILIENCE.md pour le rationale complet.
 *
 * Stratégie :
 *   - Reconnection auto agressive (Infinity, base 2s, cap 30s)
 *   - Persistance localStorage par short_code (multi-sessions OK)
 *   - Le JWT participant a un TTL de 24h ; on garde l'identité tant que
 *     le serveur l'accepte (validation au handshake)
 */

import { io, type Socket } from 'socket.io-client';
import { supabase } from './supabase.js';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:3001';

const RECONNECT_OPTS = {
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 2000,
  reconnectionDelayMax: 30000,
} as const;

// ─── Persistance par session (localStorage) ───────────────────────────────

export interface ParticipantContext {
  token: string;
  participantId: string;
  sessionId: string;
  pseudo: string;
  teamId: string | null;
}

function storageKey(shortCode: string): string {
  return `tutti.player.${shortCode.toUpperCase()}`;
}

export function saveParticipantContext(shortCode: string, ctx: ParticipantContext): void {
  try {
    window.localStorage.setItem(storageKey(shortCode), JSON.stringify(ctx));
  } catch {
    // Quota / private mode — on log mais on ne bloque pas le jeu.
    // eslint-disable-next-line no-console
    console.warn('[tutti] localStorage indisponible : la reconnexion auto sera dégradée.');
  }
}

export function readParticipantContext(shortCode: string): ParticipantContext | null {
  try {
    const raw = window.localStorage.getItem(storageKey(shortCode));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ParticipantContext>;
    if (
      typeof parsed.token === 'string' &&
      typeof parsed.participantId === 'string' &&
      typeof parsed.sessionId === 'string' &&
      typeof parsed.pseudo === 'string'
    ) {
      return {
        token: parsed.token,
        participantId: parsed.participantId,
        sessionId: parsed.sessionId,
        pseudo: parsed.pseudo,
        teamId: parsed.teamId ?? null,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function clearParticipantContext(shortCode: string): void {
  try {
    window.localStorage.removeItem(storageKey(shortCode));
  } catch {
    /* ignore */
  }
}

// ─── Factories ────────────────────────────────────────────────────────────

export async function connectAsHost(): Promise<Socket> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Auth Supabase requise pour Socket.IO host');
  return io(SOCKET_URL, {
    auth: { token, role: 'host' },
    transports: ['websocket', 'polling'],
    ...RECONNECT_OPTS,
  });
}

export function connectAsParticipant(token: string): Socket {
  return io(SOCKET_URL, {
    auth: { token, role: 'participant' },
    transports: ['websocket', 'polling'],
    ...RECONNECT_OPTS,
  });
}

/**
 * Spectator anonyme — utilisé par /screen TV (cast par code).
 * Read-only : reçoit les broadcasts mais ne peut pas émettre.
 */
export function connectAsSpectator(shortCode: string): Socket {
  return io(SOCKET_URL, {
    auth: { role: 'spectator', shortCode: shortCode.toUpperCase() },
    transports: ['websocket', 'polling'],
    ...RECONNECT_OPTS,
  });
}
