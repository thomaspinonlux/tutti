/**
 * État applicatif en mémoire pour la boucle de jeu (étape 10, Phase A).
 *
 * V1 : 1 process Railway = OK. Si le process redémarre, l'état du round
 * en cours est perdu (le host doit relancer la manche). Pour la prod
 * scaling horizontale, déplacer dans Redis.
 *
 * Suit qui a buzzé en premier sur quel track, pour empêcher les autres
 * de buzzer pendant que le 1ᵉʳ tente sa réponse.
 */

export type GameTrackPhase = 'listening' | 'buzzed' | 'cooldown';

export interface ActiveTrackState {
  round_id: string;
  track_index: number;
  track_id: string; // ID du Track DB (pas du provider)
  started_at: number; // Date.now() au lancement
  phase: GameTrackPhase;
  /** Participant qui a buzzé en 1ᵉʳ (null = personne pour l'instant). */
  buzzer_id: string | null;
  /** Timestamp du buzz (ms relatifs au started_at). */
  buzz_time_ms: number | null;
}

const activeTracks = new Map<string /* round_id */, ActiveTrackState>();

export function getActiveTrack(roundId: string): ActiveTrackState | null {
  return activeTracks.get(roundId) ?? null;
}

export function setActiveTrack(roundId: string, state: ActiveTrackState): void {
  activeTracks.set(roundId, state);
}

export function clearActiveTrack(roundId: string): void {
  activeTracks.delete(roundId);
}

/**
 * Tente d'enregistrer un buzz. Retourne la state mise à jour si OK,
 * null si la phase n'est pas 'listening' (déjà buzzé / cooldown).
 */
export function tryBuzz(roundId: string, participantId: string): ActiveTrackState | null {
  const state = activeTracks.get(roundId);
  if (!state) return null;
  if (state.phase !== 'listening') return null;
  const buzzTime = Date.now() - state.started_at;
  const updated: ActiveTrackState = {
    ...state,
    phase: 'buzzed',
    buzzer_id: participantId,
    buzz_time_ms: buzzTime,
  };
  activeTracks.set(roundId, updated);
  return updated;
}

export function setCooldown(roundId: string): void {
  const state = activeTracks.get(roundId);
  if (!state) return;
  activeTracks.set(roundId, { ...state, phase: 'cooldown' });
}
