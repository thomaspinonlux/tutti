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
  /**
   * Bug autoplay v6 (fix/cross-browser-autoplay-unlock) — primitive
   * d'unlock SYNCHRONE appelée depuis un click handler direct user. Le
   * tap consomme le user gesture pour le contexte audio du document.
   * Tente playVideo() puis pauseVideo() 50ms plus tard sur le SDK déjà
   * monté. No-op si SDK pas encore prêt (pas d'erreur).
   * Pour Safari + content blockers : combiné avec un Audio() silent qui
   * agit en parallèle (caller side).
   */
  warmupSync: () => void;
  /**
   * Lit l'état courant du player YT (UNSTARTED=-1, ENDED=0, PLAYING=1,
   * PAUSED=2, BUFFERING=3, CUED=5). null si player pas instancié.
   * Utilisé par PreGameStartScreen pour détecter unlock raté après 1.5s.
   */
  getPlayerState: () => number | null;
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
  // Problème B (fix/playback-and-zombies-v4) — flag pour déclencher
  // playVideo() depuis l'event onStateChange CUED. cueVideoById met le
  // player en CUED sans démarrer la lecture ; on appelle playVideo() au
  // moment où l'état CUED est atteint pour garantir le lancement.
  const pendingPlayAfterCueRef = useRef(false);

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
              const stateMap: Record<number, string> = {
                [-1]: 'UNSTARTED',
                [0]: 'ENDED',
                [1]: 'PLAYING',
                [2]: 'PAUSED',
                [3]: 'BUFFERING',
                [5]: 'CUED',
              };
              const stateName = stateMap[st as number] ?? `UNKNOWN(${st})`;
              console.info(`[Player] State ${stateName}`);

              if (st === YT_STATE.CUED && pendingPlayAfterCueRef.current) {
                // Problème B — état CUED atteint après cueVideoById, on
                // déclenche maintenant playVideo() depuis ce handler.
                pendingPlayAfterCueRef.current = false;
                console.info('[Player] PlayVideo called (after CUED)');
                try {
                  playerRef.current?.playVideo?.();
                } catch (err) {
                  console.warn('[Player] playVideo after CUED failed:', err);
                }
                return;
              }

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
      if (!p?.cueVideoById || !p?.playVideo) {
        console.warn(`[Player] play(${videoId}) ignored — player not ready`);
        return false;
      }
      const startSec = o?.startSec ?? defaultStartSec;
      const endSec = o?.endSec ?? defaultEndSec;
      lastVideoRef.current = { id: videoId, startSec, endSec };
      console.info(`[Player] CueVideo ${videoId} (startSec=${startSec}, endSec=${endSec})`);
      try {
        // Problème B (fix/playback-and-zombies-v4) — flow explicite en 2
        // étapes : cueVideoById met le player en CUED (vidéo prête mais
        // pas en lecture), puis le handler onStateChange CUED appelle
        // playVideo() → garantit que la lecture démarre depuis un état
        // connu, même au 1er morceau de la session.
        //
        // Avant : loadVideoById tentait load+autoplay en même temps.
        // Sur 1ère vidéo après init du player, l'autoplay échouait
        // silencieusement (état UNSTARTED → BUFFERING parfois sans
        // PLAYING) → 1er morceau muet.
        pendingPlayAfterCueRef.current = true;
        p.cueVideoById({
          videoId,
          startSeconds: startSec,
          endSeconds: endSec,
        });
        // Belt-and-suspenders : si le player est déjà CUED ou PAUSED, le
        // onStateChange ne re-fire pas → on appelle playVideo direct
        // après un micro-delay pour couvrir le cas idempotent.
        window.setTimeout(() => {
          if (!pendingPlayAfterCueRef.current) return;
          const currentState = p.getPlayerState?.();
          console.info(`[Player] Belt-and-suspenders check (state=${currentState ?? 'unknown'})`);
          if (
            currentState === YT_STATE.CUED ||
            currentState === YT_STATE.PAUSED ||
            currentState === YT_STATE.UNSTARTED
          ) {
            pendingPlayAfterCueRef.current = false;
            console.info('[Player] PlayVideo called (belt-and-suspenders timeout)');
            try {
              p.playVideo?.();
            } catch (err) {
              console.warn('[Player] playVideo timeout fallback failed:', err);
            }
          }
        }, 600);
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

  /**
   * Bug autoplay v6 — playVideo() SYNC depuis click handler pour libérer
   * l'autoplay policy navigateur. Suivi d'un pauseVideo() après 50ms pour
   * ne pas démarrer la vraie lecture (qui sera déclenchée plus tard via
   * play() une fois le 1er track sélectionné). Le tap suffit à dire au
   * browser "ok l'user veut de l'audio dans cette page".
   */
  const warmupSync = useCallback((): void => {
    const p = playerRef.current;
    if (!p) {
      console.info('[YouTube] warmupSync : player pas encore instancié, skip');
      return;
    }
    try {
      // playVideo synchrone — déclenche autoplay claim côté browser.
      // Si pas de video chargée, no-op silencieux côté SDK.
      if (typeof p.playVideo === 'function') {
        p.playVideo();
        console.info('[YouTube] warmupSync : playVideo() appelé sync');
      }
    } catch (err) {
      console.warn('[YouTube] warmupSync playVideo failed:', err);
    }
    // Pause 50ms plus tard pour ne pas démarrer une lecture parasite.
    window.setTimeout(() => {
      try {
        playerRef.current?.pauseVideo?.();
        console.info('[YouTube] warmupSync : pauseVideo() après 50ms');
      } catch {
        /* ignore */
      }
    }, 50);
  }, []);

  const getPlayerState = useCallback((): number | null => {
    const p = playerRef.current;
    if (!p || typeof p.getPlayerState !== 'function') return null;
    try {
      const state = p.getPlayerState();
      return typeof state === 'number' ? state : null;
    } catch {
      return null;
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
    warmupSync,
    getPlayerState,
  };
}
