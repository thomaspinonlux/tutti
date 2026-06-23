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
 * feat/host-tv-perfect-sync (F1) — MUTE INSTANTANÉ : en plus du poll 3s (filet),
 * on écoute le socket host `screen-state:focus-changed` qui porte les MÊMES
 * flags audio (broadcastés par le backend à chaque POST audio-target /
 * tv-audio-armed / tv-spotify-ready). On merge les champs présents instantanément
 * (latence <150ms) → le host recalcule le sink et coupe son lecteur local DÈS que
 * la TV s'arme, sans attendre le prochain poll. Plus de double son ≤3s.
 */

import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
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

export function useTvAudioFlags(enabled: boolean, socket?: Socket | null): TvAudioFlags {
  const [flags, setFlags] = useState<TvAudioFlags>(DEFAULT_FLAGS);

  // Poll 3s — filet de sécurité (source de vérité = backend store).
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

  // F1 — mute instantané : merge les flags audio portés par le broadcast socket
  // `screen-state:focus-changed` (payload PARTIEL : seuls les champs changés sont
  // présents → on ne touche que ceux-là, on ignore les events focus/qr/playlist).
  useEffect(() => {
    if (!enabled || !socket) return;
    const onFocusChanged = (payload: unknown): void => {
      if (!payload || typeof payload !== 'object') return;
      const p = payload as Record<string, unknown>;
      setFlags((f) => {
        const next: TvAudioFlags = { ...f };
        if (p.audio_target === 'host' || p.audio_target === 'tv')
          next.audio_target = p.audio_target;
        if (typeof p.tv_audio_armed === 'boolean') next.tv_audio_armed = p.tv_audio_armed;
        if (typeof p.tv_spotify_ready === 'boolean') next.tv_spotify_ready = p.tv_spotify_ready;
        return next;
      });
    };
    socket.on('screen-state:focus-changed', onFocusChanged);
    return () => {
      socket.off('screen-state:focus-changed', onFocusChanged);
    };
  }, [enabled, socket]);

  return flags;
}
