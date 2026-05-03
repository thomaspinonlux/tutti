/**
 * useYouTubePlayer — Phase 3b
 *
 * Charge l'IFrame Player API de YouTube et expose une interface alignée sur
 * useSpotifyPlayer (status, positionMs, durationMs, isPlaying, play/pause).
 *
 * Anti-pub : on utilise les paramètres `start` et `end` du player pour
 * couper directement aux secondes utiles. Par défaut on saute les 15
 * premières secondes (intro) et on coupe à 60s (durée d'écoute Tutti).
 *
 * Le player a besoin d'un élément DOM cible (id `youtube-player-host` par
 * défaut). Un <div /> doit exister dans le rendu pour que l'API puisse y
 * monter l'iframe.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const IFRAME_API_URL = 'https://www.youtube.com/iframe_api';
const SCRIPT_ID = 'youtube-iframe-api';
const DEFAULT_CONTAINER_ID = 'youtube-player-host';

/** États de lecture YouTube IFrame API. */
const YT_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

export type YouTubePlayerStatus = 'idle' | 'loading_api' | 'ready' | 'error';

export interface UseYouTubePlayerOptions {
  enabled: boolean;
  /** ID du div container (défaut: youtube-player-host). */
  containerId?: string;
  /** Démarre la lecture en sautant les N premières secondes (défaut 15). */
  defaultStartSec?: number;
  /** Coupe la lecture à N secondes (défaut 60 = durée d'écoute Tutti). */
  defaultEndSec?: number;
}

export interface UseYouTubePlayerResult {
  status: YouTubePlayerStatus;
  error: string | null;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  /** Charge un videoId et démarre lecture (avec start/end anti-pub). */
  play: (videoId: string, opts?: { startSec?: number; endSec?: number }) => Promise<boolean>;
  pause: () => void;
  resume: () => void;
  /** Repart à 0 (post-startSec). */
  restart: () => void;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

let apiLoadPromise: Promise<void> | null = null;

function loadIframeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('SSR'));
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (apiLoadPromise) return apiLoadPromise;

  apiLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      // déjà inséré, attendre callback global
    } else {
      const tag = document.createElement('script');
      tag.id = SCRIPT_ID;
      tag.src = IFRAME_API_URL;
      tag.async = true;
      tag.onerror = () => reject(new Error('Failed to load YouTube IFrame API'));
      document.head.appendChild(tag);
    }
    // YouTube appelle ce callback global une fois prêt
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = (): void => {
      prev?.();
      resolve();
    };
  });
  return apiLoadPromise;
}

export function useYouTubePlayer(opts: UseYouTubePlayerOptions): UseYouTubePlayerResult {
  const {
    enabled,
    containerId = DEFAULT_CONTAINER_ID,
    defaultStartSec = 15,
    defaultEndSec = 60,
  } = opts;
  const [status, setStatus] = useState<YouTubePlayerStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerRef = useRef<any>(null);
  const tickRef = useRef<number | null>(null);
  const lastVideoRef = useRef<{ id: string; startSec: number; endSec: number } | null>(null);

  // ── Init iframe API + player ──────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setStatus('loading_api');
    setError(null);

    loadIframeApi()
      .then(() => {
        if (cancelled) return;
        const container = document.getElementById(containerId);
        if (!container) {
          setError(`Container #${containerId} introuvable`);
          setStatus('error');
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const YT = (window as any).YT;
        playerRef.current = new YT.Player(containerId, {
          height: '0',
          width: '0',
          playerVars: {
            controls: 0,
            disablekb: 1,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
          },
          events: {
            onReady: () => {
              if (cancelled) return;
              setStatus('ready');
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onStateChange: (e: any) => {
              if (cancelled) return;
              const st = e.data;
              if (st === YT_STATE.PLAYING) {
                setIsPlaying(true);
                if (playerRef.current?.getDuration) {
                  setDurationMs(Math.round(playerRef.current.getDuration() * 1000));
                }
              } else if (st === YT_STATE.PAUSED) {
                setIsPlaying(false);
              } else if (st === YT_STATE.ENDED) {
                setIsPlaying(false);
              }
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onError: (e: any) => {
              if (cancelled) return;
              setError(`YT player error code ${e.data}`);
              setStatus('error');
            },
          },
        });
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setStatus('error');
      });

    return () => {
      cancelled = true;
      if (playerRef.current?.destroy) {
        try {
          playerRef.current.destroy();
        } catch {
          // ignore
        }
        playerRef.current = null;
      }
    };
  }, [enabled, containerId]);

  // ── Tick 250ms : interpole position quand isPlaying ───────────────────
  useEffect(() => {
    if (!enabled) return;
    const tick = (): void => {
      const p = playerRef.current;
      if (!p?.getCurrentTime) return;
      try {
        setPositionMs(Math.round(p.getCurrentTime() * 1000));
      } catch {
        // ignore — le player peut throw entre 2 frames
      }
    };
    tickRef.current = window.setInterval(tick, 250);
    return () => {
      if (tickRef.current !== null) {
        window.clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [enabled]);

  // ── Actions ───────────────────────────────────────────────────────────
  const play = useCallback(
    async (videoId: string, o?: { startSec?: number; endSec?: number }): Promise<boolean> => {
      const p = playerRef.current;
      if (!p?.loadVideoById) return false;
      const startSec = o?.startSec ?? defaultStartSec;
      const endSec = o?.endSec ?? defaultEndSec;
      lastVideoRef.current = { id: videoId, startSec, endSec };
      try {
        p.loadVideoById({
          videoId,
          startSeconds: startSec,
          endSeconds: endSec,
        });
        setIsPlaying(true);
        return true;
      } catch (err) {
        setError((err as Error).message);
        return false;
      }
    },
    [defaultStartSec, defaultEndSec],
  );

  const pause = useCallback((): void => {
    playerRef.current?.pauseVideo?.();
  }, []);

  const resume = useCallback((): void => {
    playerRef.current?.playVideo?.();
  }, []);

  const restart = useCallback((): void => {
    const last = lastVideoRef.current;
    const p = playerRef.current;
    if (!last || !p?.seekTo) return;
    try {
      p.seekTo(last.startSec, true);
      p.playVideo?.();
    } catch {
      // ignore
    }
  }, []);

  return {
    status,
    error,
    isPlaying,
    positionMs,
    durationMs,
    play,
    pause,
    resume,
    restart,
  };
}
