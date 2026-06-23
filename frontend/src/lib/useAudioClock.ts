/**
 * useAudioClock — feat/host-tv-perfect-sync (F3)
 *
 * Horloge audio DÉCOUPLÉE, identique sur l'iPad host et la TV. Calcule l'elapsed
 * du morceau à partir de l'état serveur (jamais du currentTime d'un lecteur
 * local) :
 *
 *   elapsed = is_paused ? audio_position_ms
 *                       : audio_position_ms + (now − audio_anchor_at)
 *
 * `audio_position_ms` / `audio_anchor_at` viennent du serveur (CurrentTrackState
 * + events track:seek pour seek/pause/resume). `started_at` (ancre buzz) n'est
 * jamais utilisé ici. → les 2 barres bougent pareil quel que soit le sink, la
 * pause fige les deux, un seek recale les deux.
 *
 * Tick 250ms quand !is_paused ; figé quand is_paused (zéro tick).
 */
import { useEffect, useMemo, useState } from 'react';

export function useAudioClock(
  audioPositionMs: number | null | undefined,
  audioAnchorAt: string | null | undefined,
  isPaused: boolean,
): number {
  const basePos = typeof audioPositionMs === 'number' ? audioPositionMs : 0;
  const anchorMs = useMemo(() => {
    const t = audioAnchorAt ? Date.parse(audioAnchorAt) : NaN;
    return Number.isFinite(t) ? t : Date.now();
  }, [audioAnchorAt]);

  const compute = (): number => (isPaused ? basePos : basePos + (Date.now() - anchorMs));

  const [elapsed, setElapsed] = useState<number>(() => Math.max(0, compute()));

  useEffect(() => {
    setElapsed(Math.max(0, compute()));
    if (isPaused) return; // figé : pas de tick
    const id = window.setInterval(() => {
      setElapsed(Math.max(0, basePos + (Date.now() - anchorMs)));
    }, 250);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePos, anchorMs, isPaused]);

  return elapsed;
}
