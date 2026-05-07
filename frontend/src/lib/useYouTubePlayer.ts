/**
 * useYouTubePlayer — Phase 3b
 *
 * Charge l'IFrame Player API de YouTube et expose une interface alignée sur
 * useSpotifyPlayer (status, positionMs, durationMs, isPlaying, play/pause).
 *
 * Bug 1 (fix/critical-bugs-v3) — défault startSec=0 (au lieu de 15).
 * Hypothèse historique : sauter 15s pour passer le pre-roll ad. Avec un
 * compte YouTube Premium, pas de pre-roll → la musique commençait à 0:15
 * au lieu de 0:00. La cap end à 60s (durée d'écoute Tutti) reste.
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
  /** Démarre la lecture en sautant les N premières secondes (défaut 0). */
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
  /** Bug 4 — débloque audio YouTube depuis un clic user direct. */
  unblockAudio: () => void;
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

/**
 * Bug 2 (fix/critical-bugs-v3) — race condition : refresh nécessaire pour
 * lancer la musique sur la 1ère session.
 *
 * Cause : si le script `iframe_api` était déjà injecté par une 1ère mount
 * + le callback global onYouTubeIframeAPIReady déjà appelé une fois (avant
 * notre re-registration), aucune autre invocation ne se fait → la promise
 * ne résout jamais → status reste 'loading_api' → play() ignoré.
 *
 * Fix : ajout d'un safety net polling — si après 5s `window.YT.Player` est
 * dispo mais le callback n'a pas tiré, on résout quand même.
 */
function loadIframeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('SSR'));
  if (window.YT && window.YT.Player) {
    console.info('[YT API] Ready (already loaded)');
    return Promise.resolve();
  }
  if (apiLoadPromise) return apiLoadPromise;

  apiLoadPromise = new Promise<void>((resolve, reject) => {
    let resolved = false;
    const safeResolve = (reason: string): void => {
      if (resolved) return;
      resolved = true;
      console.info(`[YT API] Ready (${reason})`);
      resolve();
    };

    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      console.info('[YT API] Script already in DOM, waiting for ready');
    } else {
      console.info('[YT API] Injecting script', IFRAME_API_URL);
      const tag = document.createElement('script');
      tag.id = SCRIPT_ID;
      tag.src = IFRAME_API_URL;
      tag.async = true;
      tag.onerror = () => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Failed to load YouTube IFrame API'));
        }
      };
      document.head.appendChild(tag);
    }

    // Hook officiel YouTube — appelé une seule fois quand l'API est prête
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = (): void => {
      prev?.();
      safeResolve('onYouTubeIframeAPIReady fired');
    };

    // Safety net : poll window.YT.Player toutes les 100ms pendant 5s.
    // Couvre le cas où le callback global a déjà tiré avant qu'on register.
    const startedAt = Date.now();
    const pollId = window.setInterval(() => {
      if (resolved) {
        window.clearInterval(pollId);
        return;
      }
      if (window.YT && window.YT.Player) {
        window.clearInterval(pollId);
        safeResolve('safety net poll detected YT.Player');
        return;
      }
      if (Date.now() - startedAt > 5000) {
        window.clearInterval(pollId);
        if (!resolved) {
          // Dernier check au timeout, sinon reject
          if (window.YT && window.YT.Player) {
            safeResolve('safety net timeout, YT.Player available');
          } else {
            resolved = true;
            reject(new Error('YouTube IFrame API not ready after 5s'));
          }
        }
      }
    }, 100);
  });
  return apiLoadPromise;
}

export function useYouTubePlayer(opts: UseYouTubePlayerOptions): UseYouTubePlayerResult {
  const {
    enabled,
    containerId = DEFAULT_CONTAINER_ID,
    defaultStartSec = 0,
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
        console.info(`[Player] Created on #${containerId}`);
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
              console.info('[Player] Ready');
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
      if (!p?.loadVideoById) {
        console.warn(`[Player] play(${videoId}) ignored — player not ready`);
        return false;
      }
      const startSec = o?.startSec ?? defaultStartSec;
      const endSec = o?.endSec ?? defaultEndSec;
      lastVideoRef.current = { id: videoId, startSec, endSec };
      console.info(`[Player] Loading video ${videoId} (startSec=${startSec}, endSec=${endSec})`);
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

  /**
   * Bug 4 — fallback audio bloqué côté YouTube. À appeler depuis un clic
   * user direct (button onClick). Re-tape playVideo() pour débloquer la
   * pipeline iframe iOS/Chrome.
   */
  const unblockAudio = useCallback((): void => {
    const p = playerRef.current;
    if (!p) return;
    try {
      // Si un track est en cours, juste playVideo. Sinon, refresh la lecture
      // depuis le dernier videoId connu (lastVideoRef).
      const last = lastVideoRef.current;
      if (last && p.loadVideoById) {
        p.loadVideoById({
          videoId: last.id,
          startSeconds: last.startSec,
          endSeconds: last.endSec,
        });
      } else {
        p.playVideo?.();
      }
      setIsPlaying(true);
    } catch (err) {
      console.warn('[YouTube] unblockAudio failed:', err);
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
    unblockAudio,
  };
}
