/**
 * useTvAudioFlags — feat/tv-audio-output
 *
 * Hook host-side : poll screen-state toutes les 3s pour récupérer les flags
 * d'audio routing maintenus par le backend :
 *   - audio_target      ('host' | 'tv') — défini par le HOST (POST audio-target)
 *   - tv_audio_armed    (boolean)        — défini par la TV (clic activer son)
 *   - tv_spotify_ready  (boolean)        — défini par la TV (Spotify SDK ready)
 *
 * Le host a besoin des 2 derniers pour calculer le sink (cf. lib/audioSink).
 * 3s = TTL backend 60s / 20 → garantit que les flags restent frais sans
 * pression réseau. Désactivé tant que `enabled=false` (ex: hors gameplay).
 *
 * Pas de socket — le polling suffit pour ce signal "rare" (toggle UI). Pour
 * une latence sub-100ms on pourrait écouter `screen-state:focus-changed` sur
 * le socket host existant, mais inutile pour ce flow.
 */

import { useEffect, useState } from 'react';
import { getScreenState } from './screenState.js';
import type { AudioTarget } from './audioSink.js';

const POLL_INTERVAL_MS = 3000;

export interface TvAudioFlags {
  audio_target: AudioTarget;
  tv_audio_armed: boolean;
  tv_spotify_ready: boolean;
}

const DEFAULT_FLAGS: TvAudioFlags = {
  audio_target: 'host',
  tv_audio_armed: false,
  tv_spotify_ready: false,
};

export function useTvAudioFlags(enabled: boolean): TvAudioFlags {
  const [flags, setFlags] = useState<TvAudioFlags>(DEFAULT_FLAGS);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const pull = async (): Promise<void> => {
      try {
        const state = await getScreenState();
        if (cancelled) return;
        // Seuls les états PLAYING/PAUSED portent ces flags. Sinon → défaut host.
        if (state.state === 'PLAYING' || state.state === 'PAUSED') {
          setFlags({
            audio_target: state.audio_target,
            tv_audio_armed: state.tv_audio_armed,
            tv_spotify_ready: state.tv_spotify_ready,
          });
        }
      } catch {
        // Best-effort : keep last value on failure.
      }
    };

    void pull();
    const id = window.setInterval(() => void pull(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled]);

  return flags;
}
