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
   * fix/robust-autoplay-no-refresh — true si après ready + unlock + 2 retries
   * la vidéo n'a pas atteint l'état PLAYING. Frontend doit alors afficher un
   * overlay "Tap to start" qui appelle `tapToStart()` au clic (user gesture
   * fresh, garanti efficace pour bypass autoplay policy Safari/iOS).
   */
  audioBlocked: boolean;
  /**
   * fix/robust-autoplay-no-refresh — relance la dernière vidéo demandée
   * depuis un user gesture frais. Reset audioBlocked. À câbler sur le clic
   * de l'overlay "Démarrer la lecture" affiché en fallback.
   */
  tapToStart: () => void;
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
  // fix/robust-autoplay-no-refresh — true si autoplay a échoué après les
  // retries auto. UI affiche un overlay "Démarrer la lecture" qui appelle
  // tapToStart() pour relancer depuis un user gesture frais.
  const [audioBlocked, setAudioBlocked] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerRef = useRef<any>(null);
  const tickRef = useRef<number | null>(null);
  const lastVideoRef = useRef<{ id: string; startSec: number; endSec: number } | null>(null);
  // Problème B (fix/playback-and-zombies-v4) — flag pour déclencher
  // playVideo() depuis l'event onStateChange CUED. cueVideoById met le
  // player en CUED sans démarrer la lecture ; on appelle playVideo() au
  // moment où l'état CUED est atteint pour garantir le lancement.
  const pendingPlayAfterCueRef = useRef(false);
  // fix/robust-autoplay-no-refresh — file d'attente de play() appelés avant
  // que le player ne soit ready. Exécutée dans onReady.
  const pendingPlayRef = useRef<{
    videoId: string;
    startSec: number;
    endSec: number;
  } | null>(null);
  // Tracking retries pour éviter boucle infinie. Reset à chaque nouvelle
  // demande de play (cueVideoById).
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  // statusRef pour qu'un useCallback puisse lire la valeur courante sans
  // dépendre de status (qui aurait recréé play() à chaque transition →
  // perte de stabilité référentielle).
  const statusRef = useRef<YouTubePlayerStatus>('idle');
  statusRef.current = status;

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
        console.info(`[Player] YouTube IFrame loaded on #${containerId}`);
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
              console.info('[Player] onReady fired — player available');
              setStatus('ready');
              // fix/robust-autoplay-no-refresh — queue drain via useEffect
              // séparé qui watch `status` (cf. ci-dessous). On ne touche pas
              // au player ici directement pour éviter les race avec setState.
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
              console.info(`[Player] State change: ${stateName}`);

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
                // fix/robust-autoplay-no-refresh — autoplay a réussi, on
                // peut cacher l'overlay "Démarrer la lecture" si visible.
                setAudioBlocked(false);
                // Cancel retry timer en cours (si la vidéo démarre avant
                // qu'on ait fini d'attendre les 1.5s).
                if (retryTimerRef.current !== null) {
                  window.clearTimeout(retryTimerRef.current);
                  retryTimerRef.current = null;
                }
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
  //
  // fix/robust-autoplay-no-refresh — play() ne return plus immédiatement
  // si player pas ready : on QUEUE la demande dans pendingPlayRef et un
  // useEffect (cf. ci-dessous) la drain dès que status='ready'. Si player
  // déjà ready, on exécute immédiatement.
  //
  // Après cueVideoById + playVideo, on lance un timer 1.5s :
  //   - si state == PLAYING → reset retry, audio joue, on est OK
  //   - sinon retry 1/2 (playVideo direct)
  //   - après 2 retries échoués → setAudioBlocked(true) → UI affiche
  //     overlay "Démarrer la lecture" qui appelle tapToStart()
  const play = useCallback(
    async (videoId: string, o?: { startSec?: number; endSec?: number }): Promise<boolean> => {
      const startSec = o?.startSec ?? defaultStartSec;
      const endSec = o?.endSec ?? defaultEndSec;
      lastVideoRef.current = { id: videoId, startSec, endSec };
      const p = playerRef.current;
      // L1 — queue si player pas prêt
      if (!p?.cueVideoById || !p?.playVideo || statusRef.current !== 'ready') {
        console.info(
          `[Player] play(${videoId}) queued — status=${statusRef.current}, will exec on ready`,
        );
        pendingPlayRef.current = { videoId, startSec, endSec };
        return false;
      }
      // Reset retry counter pour cette nouvelle demande de lecture.
      retryCountRef.current = 0;
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      console.info(
        `[Player] cueVideoById(${videoId}) called (startSec=${startSec}, endSec=${endSec})`,
      );
      // feat/debug-audio-overlay — état player 500ms après cueVideoById pour
      // diagnostic (PWA Safari : autoplay policy peut bloquer silencieusement).
      window.setTimeout(() => {
        try {
          const s = p.getPlayerState?.();
          const stateName: Record<number, string> = {
            [-1]: 'UNSTARTED',
            [0]: 'ENDED',
            [1]: 'PLAYING',
            [2]: 'PAUSED',
            [3]: 'BUFFERING',
            [5]: 'CUED',
          };
          console.info(
            `[Player] State after 500ms: ${typeof s === 'number' ? (stateName[s] ?? s) : 'unknown'}`,
          );
        } catch {
          /* noop */
        }
      }, 500);
      try {
        // Problème B (fix/playback-and-zombies-v4) — flow explicite en 2
        // étapes : cueVideoById met le player en CUED (vidéo prête mais
        // pas en lecture), puis le handler onStateChange CUED appelle
        // playVideo() → garantit que la lecture démarre depuis un état
        // connu, même au 1er morceau de la session.
        pendingPlayAfterCueRef.current = true;
        p.cueVideoById({
          videoId,
          startSeconds: startSec,
          endSeconds: endSec,
        });
        // Belt-and-suspenders : si le player est déjà CUED ou PAUSED, le
        // onStateChange ne re-fire pas → on appelle playVideo direct.
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
        // L3 — schedule check 1.5s plus tard. Si pas PLAYING → retry.
        scheduleAutoplayRetry();
        return true;
      } catch (err) {
        setError((err as Error).message);
        return false;
      }
    },
    [defaultStartSec, defaultEndSec],
  );

  /**
   * fix/robust-autoplay-no-refresh — vérifie 1.5s après cueVideo+playVideo
   * que le player est passé en PLAYING. Si non, retry playVideo() up to 2
   * fois. Si toujours pas PLAYING après 2 retries → setAudioBlocked(true).
   *
   * Pas un useCallback car appelé uniquement par play() qui le redéclenche
   * à chaque nouvelle vidéo. La closure capture playerRef + setters via
   * refs/setState (stables).
   */
  const scheduleAutoplayRetry = useCallback((): void => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      const p = playerRef.current;
      if (!p) return;
      const state = p.getPlayerState?.();
      if (state === YT_STATE.PLAYING) {
        // OK, déjà joué — onStateChange a déjà reset audioBlocked.
        return;
      }
      if (retryCountRef.current >= 2) {
        console.warn(
          `[Player] play did not start after 2 retries (state=${state}) → audioBlocked=true, UI fallback`,
        );
        setAudioBlocked(true);
        return;
      }
      retryCountRef.current += 1;
      console.warn(
        `[Player] play did not start (state=${state}), retry ${retryCountRef.current}/2`,
      );
      try {
        p.playVideo?.();
      } catch (err) {
        console.warn('[Player] retry playVideo failed:', err);
      }
      // Re-schedule pour vérifier après ce retry.
      scheduleAutoplayRetry();
    }, 1500);
  }, []);

  // L1 — drain de la queue quand le player devient ready. Watching status
  // (et non pas playerRef.current directement, qui ne déclenche pas de re-
  // render). Garantit qu'un play() arrivé avant onReady soit exécuté dès
  // que onReady fire.
  useEffect(() => {
    if (status !== 'ready') return;
    const pending = pendingPlayRef.current;
    if (!pending) return;
    pendingPlayRef.current = null;
    console.info(`[Player] Draining queued play (videoId=${pending.videoId}) — player now ready`);
    void play(pending.videoId, { startSec: pending.startSec, endSec: pending.endSec });
  }, [status, play]);

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
   *
   * fix/pwa-player-trigger-after-unlock — En PWA Safari standalone, le
   * AudioContext unlock seul ne déclenche pas la lecture YouTube. Il FAUT
   * appeler player.playVideo() explicitement dans le user gesture. Cette
   * fonction est ce hook, appelée depuis HostPage.onForceAudio en complément
   * de unlockAudioSync().
   *
   * Stratégie :
   *   1. Si player pas ready → log + early return (le caller doit ré-essayer)
   *   2. Si on a un lastVideoRef → loadVideoById (réamorce + autoplay)
   *   3. Sinon → playVideo() direct
   *   4. Schedule state check 500ms pour log diagnostic
   */
  const unblockAudio = useCallback((): void => {
    const p = playerRef.current;
    if (!p) {
      console.error('[Player] Cannot playVideo: ytPlayer not available (playerRef null)');
      return;
    }
    if (statusRef.current !== 'ready') {
      console.warn(
        `[Player] unblockAudio called but status=${statusRef.current} — playVideo may fail`,
      );
    }
    const last = lastVideoRef.current;
    console.info(
      `[Player] playVideo() called from unblockAudio (lastVideo=${last?.id ?? 'none'} status=${statusRef.current})`,
    );
    try {
      if (last && p.loadVideoById) {
        p.loadVideoById({
          videoId: last.id,
          startSeconds: last.startSec,
          endSeconds: last.endSec,
        });
      } else if (p.playVideo) {
        p.playVideo();
      } else {
        console.error('[Player] Neither loadVideoById nor playVideo available on player');
        return;
      }
      setIsPlaying(true);
    } catch (err) {
      console.warn(
        `[Player] Play failed: ${err instanceof Error ? err.name + ' ' + err.message : String(err)}`,
      );
      return;
    }
    // Diagnostic 500ms après — log clair pour le debug overlay.
    window.setTimeout(() => {
      try {
        const s = p.getPlayerState?.();
        const stateMap: Record<number, string> = {
          [-1]: 'UNSTARTED',
          [0]: 'ENDED',
          [1]: 'PLAYING',
          [2]: 'PAUSED',
          [3]: 'BUFFERING',
          [5]: 'CUED',
        };
        const name = typeof s === 'number' ? (stateMap[s] ?? `UNKNOWN(${s})`) : 'unknown';
        if (s === YT_STATE.PLAYING || s === YT_STATE.BUFFERING) {
          console.info(`[Player] Play succeeded — state=${name}`);
        } else {
          console.warn(
            `[Player] State after force-audio: ${s} (${name}) — not PLAYING, autoplay likely blocked`,
          );
        }
      } catch (err) {
        console.warn('[Player] State check after force-audio failed:', err);
      }
    }, 500);
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

  /**
   * fix/robust-autoplay-no-refresh — appelé depuis le bouton overlay
   * "Démarrer la lecture" (user gesture frais, garanti efficace contre
   * autoplay policy stricte Safari/iOS). Relance la dernière vidéo connue
   * via loadVideoById (vs cueVideoById) qui combine load + autoplay dans
   * le contexte du tap.
   */
  const tapToStart = useCallback((): void => {
    const p = playerRef.current;
    if (!p) {
      console.warn('[Player] tapToStart called but player not instantiated');
      return;
    }
    const last = lastVideoRef.current;
    if (!last) {
      // Pas de vidéo précédente connue — juste un playVideo()
      console.info('[Player] tapToStart : no last video, calling playVideo()');
      try {
        p.playVideo?.();
        setAudioBlocked(false);
      } catch (err) {
        console.warn('[Player] tapToStart playVideo failed:', err);
      }
      return;
    }
    console.info(`[Player] tapToStart : reloading ${last.id} from user gesture`);
    retryCountRef.current = 0;
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setAudioBlocked(false);
    try {
      p.loadVideoById?.({
        videoId: last.id,
        startSeconds: last.startSec,
        endSeconds: last.endSec,
      });
      setIsPlaying(true);
      // Re-schedule retry au cas où le clic ne suffit toujours pas (rare).
      scheduleAutoplayRetry();
    } catch (err) {
      console.warn('[Player] tapToStart loadVideoById failed:', err);
    }
  }, [scheduleAutoplayRetry]);

  // Cleanup retryTimer au unmount pour éviter les setState après unmount.
  useEffect(() => {
    return () => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
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
    audioBlocked,
    tapToStart,
  };
}
