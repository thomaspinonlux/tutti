/**
 * useSpotifyPlayer — charge le Spotify Web Playback SDK et l'initialise pour
 * le host. Récupère un access token via /api/auth/spotify/token et le
 * rafraîchit transparemment quand le SDK le redemande (refresh côté backend).
 *
 * Important :
 *   - Le SDK exige un compte Spotify Premium pour la lecture full-track.
 *     Sur compte gratuit, `connect()` réussit mais `play()` échoue ensuite.
 *   - Le device_id n'est dispo qu'après l'event 'ready' — `play()` est mis
 *     en file d'attente s'il est appelé avant.
 *   - À chaque mount, on crée un device "Tutti Host" différent ; un compte
 *     ne peut être actif que sur un seul device à la fois côté Spotify.
 *
 * Usage :
 *   const { isReady, error, play, pause } = useSpotifyPlayer({ enabled: true });
 *   await play('spotify:track:6rqhFgbbKwnb9MLmUQDhG6');
 */

import { useEffect, useRef, useState } from 'react';
import { getSpotifyToken, type SpotifyTokenResponse } from './music.js';

const SDK_SCRIPT_URL = 'https://sdk.scdn.co/spotify-player.js';
const SDK_SCRIPT_ID = 'spotify-web-playback-sdk';
const SPOTIFY_API = 'https://api.spotify.com/v1';

export type SpotifyPlayerStatus =
  | 'idle'
  | 'loading_sdk'
  | 'loading_token'
  | 'connecting'
  | 'ready'
  | 'error';

export interface UseSpotifyPlayerOptions {
  /** Active le hook (par défaut on n'instancie pas le SDK pour rien). */
  enabled: boolean;
  /** Volume initial 0..1 (défaut 0.5). */
  initialVolume?: number;
  /**
   * feat/tv-audio-output — fetcher de token override. Défaut = getSpotifyToken
   * (host authentifié). La TV (ouverte via ?workspace=UUID) passe une closure
   * vers getSpotifyTokenPublic(workspaceId).
   */
  tokenFetcher?: () => Promise<SpotifyTokenResponse>;
  /**
   * feat/tv-audio-output — nom du device Spotify Connect. Défaut "Tutti Tracks
   * - Soirée" (host). Côté TV on passe "Tutti TV" pour les distinguer dans
   * l'app Spotify et permettre le Transfer Connect ciblé.
   */
  deviceName?: string;
}

export interface UseSpotifyPlayerResult {
  status: SpotifyPlayerStatus;
  /** Disponible quand status === 'ready'. */
  deviceId: string | null;
  error: string | null;
  /** Code d'erreur "stable" pour différencier les cas (NOT_CONNECTED, PREMIUM_REQUIRED…). */
  errorCode: string | null;
  /** Dernier event SDK reçu — pour debug UI badge. */
  lastEvent: string | null;
  /** Track URI actuellement lu (depuis state_changed). */
  currentTrackUri: string | null;
  /** Si le SDK considère le player comme actuellement en lecture (paused=false). */
  isPlaying: boolean;
  /** Position courante (ms) interpolée. Source unique de vérité audio. */
  positionMs: number;
  /** Durée totale du track courant (ms). */
  durationMs: number;
  /**
   * Joue un morceau. Retourne true si l'API a accepté la requête.
   * Si le device n'est pas encore prêt, met l'URI en attente et retourne false.
   */
  play: (spotifyUri: string) => Promise<boolean>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  /** Force le transfert de la lecture sur le device Tutti (utile si l'audio
   * sort sur un autre device — téléphone, autre app desktop). */
  transferToTutti: () => Promise<boolean>;
  /** Active le pipeline audio HTMLMediaElement du SDK. À appeler après une
   * vraie interaction utilisateur (clic) pour débloquer Chrome/Safari
   * autoplay policy. Idempotent. */
  activate: () => Promise<boolean>;
  /** Recommence le morceau courant depuis le début (position_ms = 0). */
  restartCurrentTrack: () => Promise<boolean>;
  /** feat/seek-bar — seek absolu (ms) via le SDK (player.seek). Host-only. */
  seek: (ms: number) => Promise<void>;
  /** feat/master-volume — règle le volume de lecture (0..1) via le SDK. */
  setVolume: (v: number) => Promise<void>;
  /** Bug 2 — true si Chrome/Safari ont bloqué la lecture audio. UI doit
   * afficher un bouton "🔊 Forcer audio" qui appelle unblockAudio(). */
  audioBlocked: boolean;
  /** Bug 2 — déclenche activate() + resume() depuis un clic user direct.
   * Clears audioBlocked si la lecture redémarre. */
  unblockAudio: () => Promise<boolean>;
}

/**
 * Charge le SDK une seule fois côté client (script tag).
 */
async function loadSpotifySdk(): Promise<void> {
  if (typeof window === 'undefined') throw new Error('SSR not supported');
  if (window.Spotify) return;
  if (document.getElementById(SDK_SCRIPT_ID)) {
    // Script déjà inséré, attendre l'init globale
    await new Promise<void>((resolve, reject) => {
      const iv = window.setInterval(() => {
        if (window.Spotify) {
          window.clearInterval(iv);
          resolve();
        }
      }, 50);
      window.setTimeout(() => {
        window.clearInterval(iv);
        reject(new Error('Spotify SDK timeout'));
      }, 10_000);
    });
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const prevHandler = window.onSpotifyWebPlaybackSDKReady;
    window.onSpotifyWebPlaybackSDKReady = () => {
      prevHandler?.();
      resolve();
    };
    const script = document.createElement('script');
    script.id = SDK_SCRIPT_ID;
    script.src = SDK_SCRIPT_URL;
    script.async = true;
    script.onerror = () => reject(new Error('Failed to load Spotify SDK script'));
    document.head.appendChild(script);
  });
}

export function useSpotifyPlayer({
  enabled,
  initialVolume = 0.5,
  tokenFetcher,
  deviceName,
}: UseSpotifyPlayerOptions): UseSpotifyPlayerResult {
  const fetchTokenImpl = tokenFetcher ?? getSpotifyToken;
  const playerDeviceName = deviceName ?? 'Tutti Tracks - Soirée';
  const [status, setStatus] = useState<SpotifyPlayerStatus>('idle');
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const [currentTrackUri, setCurrentTrackUri] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  /** Position courante (ms) lue depuis le SDK. Source unique de vérité audio. */
  const [positionMs, setPositionMs] = useState(0);
  /** Durée totale du track courant (ms). */
  const [durationMs, setDurationMs] = useState(0);
  /** Bug 2 — flag déclenché quand Chrome/Safari bloquent la lecture
   * (autoplay_failed OU still_paused 3s après play()). UI affiche fallback. */
  const [audioBlocked, setAudioBlocked] = useState(false);

  const playerRef = useRef<SpotifyPlayer | null>(null);
  const tokenRef = useRef<string | null>(null);
  const tokenExpiresAtRef = useRef<number>(0);
  const pendingPlayRef = useRef<string | null>(null);
  // fix/disable-spotify-sdk-non-allowlist — garde l'état enabled à jour pour
  // les méthodes (activate, play, etc.) qui sont des closures sans deps. Si
  // !enabled, toutes les méthodes deviennent des no-op SILENCIEUX (pas de
  // log [Spotify SDK]) → console propre pour les users non allowlistés.
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  /** Anchor pour interpolation position : ms à l'instant timestamp + paused flag.
   *  state_changed met à jour l'anchor, le tick interpole entre les events. */
  const positionAnchorRef = useRef<{ ms: number; timestamp: number; paused: boolean }>({
    ms: 0,
    timestamp: Date.now(),
    paused: true,
  });

  // Tick 250ms pour interpoler positionMs entre les state_changed events
  useEffect(() => {
    const id = window.setInterval(() => {
      const a = positionAnchorRef.current;
      if (a.paused) return;
      setPositionMs(a.ms + (Date.now() - a.timestamp));
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  // ── Suppression NotFoundError cascade Spotify SDK ──────────────────────
  // fix/disable-spotify-sdk-non-allowlist — le SDK Spotify retire ses
  // iframes/<audio> après que React ait déjà démonté la subtree. Le SDK
  // throw alors "NotFoundError: The object can not be found here" en
  // cascade (parfois 30+ erreurs) qui peuvent corrompre le rendu React.
  // Solution : window error handler global qui swallow ces erreurs SI
  // l'origine est le SDK Spotify (stack contient sdk.scdn.co OU message
  // "The object can not be found here").
  useEffect(() => {
    if (!enabled) return;

    const isSpotifyCleanupError = (msg: string | Event): boolean => {
      const text = typeof msg === 'string' ? msg : '';
      if (text.includes('The object can not be found here')) return true;
      return false;
    };

    const onError = (event: ErrorEvent): void => {
      if (
        isSpotifyCleanupError(event.message) ||
        (event.filename && event.filename.includes('sdk.scdn.co'))
      ) {
        event.preventDefault();
        // Log warn 1 seule fois aurait été plus propre, mais counter inutile
        // en V1 : l'important est de SWALLOW pour ne pas crash le render.
      }
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
      const reason = event.reason;
      const msg =
        reason && typeof reason === 'object' && 'message' in reason
          ? String((reason as { message: unknown }).message)
          : String(reason);
      if (isSpotifyCleanupError(msg)) {
        event.preventDefault();
      }
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, [enabled]);

  // ── Chargement SDK + token initial + connexion ─────────────────────────
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let player: SpotifyPlayer | null = null;

    const fail = (code: string, message: string): void => {
      if (cancelled) return;
      setErrorCode(code);
      setError(message);
      setStatus('error');
    };

    const fetchToken = async (cb: (token: string) => void): Promise<void> => {
      try {
        // Petit cache : si le token est encore valide pour ≥30s, on le réutilise
        const now = Date.now();
        if (tokenRef.current && tokenExpiresAtRef.current - now > 30_000) {
          cb(tokenRef.current);
          return;
        }
        const t = await fetchTokenImpl();
        tokenRef.current = t.access_token;
        tokenExpiresAtRef.current = new Date(t.expires_at).getTime();
        cb(t.access_token);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erreur token Spotify';
        fail('TOKEN_FETCH_FAILED', msg);
      }
    };

    const init = async (): Promise<void> => {
      try {
        console.info('[Spotify SDK] Initialisation du player…');
        setStatus('loading_token');
        // Préchauffe le token pour vérifier qu'on est connecté avant de
        // charger le SDK (et pour donner un message d'erreur clair sinon).
        try {
          const initialToken = await fetchTokenImpl();
          tokenRef.current = initialToken.access_token;
          tokenExpiresAtRef.current = new Date(initialToken.expires_at).getTime();
          console.info(
            '[Spotify SDK] Token récupéré (expire dans',
            Math.round((tokenExpiresAtRef.current - Date.now()) / 1000),
            's)',
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : '';
          console.error('[Spotify SDK] Token fetch failed:', msg);
          if (msg.includes('NOT_CONNECTED') || msg.includes('non connecté')) {
            fail('NOT_CONNECTED', 'Spotify non connecté à ce workspace.');
          } else {
            fail('TOKEN_FETCH_FAILED', msg || 'Token Spotify indisponible');
          }
          return;
        }
        if (cancelled) return;

        setStatus('loading_sdk');
        console.info('[Spotify SDK] Chargement du SDK script…');
        await loadSpotifySdk();
        if (cancelled) return;

        if (!window.Spotify) {
          fail('SDK_UNAVAILABLE', 'Spotify SDK indisponible.');
          return;
        }
        console.info('[Spotify SDK] SDK chargé');

        setStatus('connecting');
        player = new window.Spotify.Player({
          name: playerDeviceName,
          getOAuthToken: (cb) => {
            void fetchToken(cb);
          },
          volume: initialVolume,
        });
        playerRef.current = player;
        console.info('[Spotify SDK] Player créé :', playerDeviceName);

        player.addListener('ready', ({ device_id }) => {
          if (cancelled) return;
          console.info('[Spotify SDK] Ready event - Device ID:', device_id);
          setDeviceId(device_id);
          setStatus('ready');
          setLastEvent(`ready: ${device_id.substring(0, 12)}…`);
          // Bug 2 fix — NE PAS appeler activateElement() ici. Chrome/Safari
          // bloquent silencieusement les appels qui ne viennent pas d'un
          // event handler de clic utilisateur direct. activateElement() est
          // désormais appelé UNIQUEMENT depuis activate() (lui-même appelé
          // par handleStartSession au clic "Démarrer le blind test").
          //
          // Transfert explicite de la lecture sur ce device + délai 500ms
          // avant play() (Spotify Connect peut throttle si trop rapide).
          void (async () => {
            await transferPlaybackInternal(device_id, false);
            await new Promise((r) => window.setTimeout(r, 500));
            const pending = pendingPlayRef.current;
            pendingPlayRef.current = null;
            if (pending) void play(pending);
          })();
        });
        player.addListener('not_ready', ({ device_id }) => {
          if (cancelled) return;
          console.warn('[Spotify SDK] not_ready - Device ID:', device_id);
          setDeviceId(null);
        });
        player.addListener('player_state_changed', (state) => {
          if (!state) {
            console.warn(
              '[Spotify SDK] state_changed: state=null (device perdu ou control transféré ailleurs)',
            );
            setLastEvent('state_changed:null → auto re-transfer');
            setIsPlaying(false);
            setCurrentTrackUri(null);
            // Auto re-transfer pour récupérer le control sur le device Tutti.
            // Si un autre device a pris la main (téléphone, autre app), on
            // reprend ici. Délai 1s pour ne pas thrash en cas de transition.
            if (deviceId && tokenRef.current) {
              window.setTimeout(() => {
                console.info('[Spotify SDK] Auto-recovery : re-transfer vers Tutti device');
                void transferPlaybackInternal(deviceId, false);
              }, 1000);
            }
            return;
          }
          const trackName = state.track_window?.current_track?.name;
          const artistName = state.track_window?.current_track?.artists?.[0]?.name;
          const trackUri = state.track_window?.current_track?.uri ?? null;
          console.info(
            '[Spotify SDK] state_changed - paused:',
            state.paused,
            '| position:',
            state.position,
            '| track:',
            trackName,
            '-',
            artistName,
          );
          setLastEvent(
            `state_changed: ${state.paused ? 'paused' : 'playing'} @ ${state.position}ms`,
          );
          setIsPlaying(!state.paused);
          setCurrentTrackUri(trackUri);
          setPositionMs(state.position);
          setDurationMs(state.duration);
          // Update anchor pour interpolation
          positionAnchorRef.current = {
            ms: state.position,
            timestamp: Date.now(),
            paused: state.paused,
          };
          // Bug 2 — si la lecture redémarre vraiment (paused=false avec
          // position qui avance), le blocage autoplay est levé. Clear flag.
          if (!state.paused) {
            setAudioBlocked(false);
            // Si l'erreur affichée était l'autoplay block, on la clear aussi
            setErrorCode((prev) => (prev === 'AUTOPLAY_BLOCKED' ? null : prev));
            setError((prev) => (prev?.startsWith('Le navigateur a bloqué') ? null : prev));
          }
        });
        player.addListener('initialization_error', ({ message }) =>
          fail('INIT_ERROR', `Init: ${message}`),
        );
        player.addListener('authentication_error', ({ message }) =>
          fail('AUTH_ERROR', `Auth: ${message}`),
        );
        player.addListener('account_error', ({ message }) =>
          fail('PREMIUM_REQUIRED', `Compte non Premium ? ${message}`),
        );
        player.addListener('playback_error', ({ message }) => {
          // Non bloquant — on log mais on ne sort pas de status='ready'
          console.warn('[Spotify SDK] playback_error:', message);
          setLastEvent(`playback_error: ${message}`);
        });
        // ⚠️ autoplay_failed : event SDK officiel quand Chrome bloque la
        // lecture audio même après activateElement. Indique que l'user n'a
        // PAS encore fait d'interaction directe permettant au navigateur de
        // débloquer la pipeline (Chrome/Safari autoplay policy).
        player.addListener('autoplay_failed', () => {
          console.error(
            '[Spotify SDK] ❌ AUTOPLAY FAILED — Chrome/Safari ont bloqué la lecture. ' +
              "L'utilisateur doit cliquer un bouton DIRECT (pas via timer/socket).",
          );
          setErrorCode('AUTOPLAY_BLOCKED');
          setError(
            'Le navigateur a bloqué la lecture. Clique le bouton "Démarrer audio" pour autoriser.',
          );
          setLastEvent('autoplay_failed');
          // Bug 2 — déclenche affichage du fallback UI
          setAudioBlocked(true);
        });

        const ok = await player.connect();
        if (!ok && !cancelled) fail('CONNECT_FAILED', 'Spotify Player.connect() refusé.');
      } catch (err) {
        fail('UNKNOWN', err instanceof Error ? err.message : 'Erreur inconnue');
      }
    };

    void init();

    return () => {
      cancelled = true;
      // fix/disable-spotify-sdk-non-allowlist — try/catch défensif autour
      // de TOUTES les ops cleanup. Le SDK Spotify retire ses iframes/audio
      // élements après que React ait déjà unmount le tree → DOM cleanup
      // throw NotFoundError "The object can not be found here" en cascade.
      // Un seul catch global évite les erreurs visibles en console + fallout
      // sur le rendu (page host vide après end-round/end-session).
      if (player) {
        try {
          player.disconnect();
        } catch (err) {
          console.warn('[Spotify SDK] Cleanup disconnect error (non-fatal):', err);
        }
      }
      try {
        playerRef.current = null;
        setStatus('idle');
        setDeviceId(null);
      } catch (err) {
        console.warn('[Spotify SDK] Cleanup state reset error (non-fatal):', err);
      }
      // Pas de reset error pour laisser l'éventuel message visible au remount
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // ── Actions ────────────────────────────────────────────────────────────

  /**
   * Transfère la lecture sur le device Tutti via PUT /me/player.
   * Appelé automatiquement au ready event + manuellement via le bouton
   * "Forcer audio sur cet appareil" (fallback si le transfert auto échoue
   * silencieusement, p. ex. browser permissions audio).
   */
  const transferPlaybackInternal = async (
    targetDeviceId: string,
    autoplay: boolean,
  ): Promise<boolean> => {
    if (!tokenRef.current) return false;
    console.info(
      '[Spotify Transfer] Tentative transfer vers device',
      targetDeviceId,
      '(autoplay:',
      autoplay,
      ')',
    );
    try {
      const res = await fetch(`${SPOTIFY_API}/me/player`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${tokenRef.current}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ device_ids: [targetDeviceId], play: autoplay }),
      });
      console.info('[Spotify Transfer] Response status:', res.status);
      if (res.status === 204 || res.ok) return true;
      const body = await res.text().catch(() => '');
      console.warn('[Spotify Transfer] Failed body:', body);
      if (res.status === 401) {
        tokenRef.current = null;
        tokenExpiresAtRef.current = 0;
      } else if (res.status === 403) {
        setErrorCode('PREMIUM_REQUIRED');
        setError('Compte Spotify Premium requis pour la lecture.');
      } else if (res.status === 404) {
        // Pas de session active sur ce compte → pas grave, le play() suivant
        // déclenchera la lecture directement.
      } else {
        console.warn('[Spotify Transfer] unexpected status', res.status);
      }
      return false;
    } catch (err) {
      console.warn('[Spotify Transfer] network error', err);
      return false;
    }
  };

  const transferToTutti = async (): Promise<boolean> => {
    if (!deviceId) return false;
    return transferPlaybackInternal(deviceId, true);
  };

  /**
   * Active explicitement le pipeline audio HTMLMediaElement du SDK.
   * Doit être appelé après une vraie interaction utilisateur (clic) pour
   * débloquer Chrome/Safari autoplay policy. Idempotent (peut être appelé
   * plusieurs fois sans effet de bord).
   */
  const activate = async (): Promise<boolean> => {
    if (!enabledRef.current) {
      // Pas allowlisté → no-op silencieux. Pas de log pour ne pas polluer
      // la console des users normaux.
      return false;
    }
    const p = playerRef.current;
    if (!p) {
      console.warn('[Spotify SDK] activateElement non disponible (player pas prêt)');
      return false;
    }
    try {
      await p.activateElement();
      console.info('[Spotify SDK] activateElement OK (post user click)');
      // Re-transfert pour garantir que le device Tutti est bien actif
      if (deviceId) {
        await transferPlaybackInternal(deviceId, false);
      }
      return true;
    } catch (err) {
      console.error('[Spotify SDK] activateElement failed:', err);
      return false;
    }
  };

  /**
   * Bug 2 — fallback débloquant audio depuis un clic user direct.
   * Appelle activate() (activateElement + retransfer) puis resume().
   * Le state_changed listener clearera audioBlocked dès que la lecture
   * démarre vraiment (paused=false).
   */
  const unblockAudio = async (): Promise<boolean> => {
    console.info('[Spotify SDK] unblockAudio() — fallback user click');
    const p = playerRef.current;
    if (!p) return false;
    try {
      await p.activateElement();
      if (deviceId) await transferPlaybackInternal(deviceId, false);
      // Resume sur le device — si un track est déjà chargé, ça relance la lecture
      try {
        await p.resume();
      } catch (err) {
        console.warn('[Spotify SDK] resume after unblock failed:', err);
      }
      // Optimistic clear : le state_changed listener clearera vraiment quand
      // la lecture démarre. On laisse le flag sauf erreur.
      return true;
    } catch (err) {
      console.error('[Spotify SDK] unblockAudio failed:', err);
      return false;
    }
  };

  /** Recommence le morceau courant depuis le début (position_ms = 0). */
  const restartCurrentTrack = async (): Promise<boolean> => {
    if (!deviceId || !tokenRef.current) return false;
    console.info('[Spotify Play] Restart current track at position_ms=0');
    try {
      const res = await fetch(
        `${SPOTIFY_API}/me/player/seek?position_ms=0&device_id=${encodeURIComponent(deviceId)}`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${tokenRef.current}` },
        },
      );
      console.info('[Spotify Play] Seek response status:', res.status);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.warn('[Spotify Play] Seek failed:', body);
        return false;
      }
      // Force play après le seek (au cas où on était en pause).
      await fetch(`${SPOTIFY_API}/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${tokenRef.current}` },
      });
      return true;
    } catch (err) {
      console.warn('[Spotify Play] restart error:', err);
      return false;
    }
  };

  /**
   * feat/seek-bar — seek absolu host-only via le SDK Web Playback (player.seek).
   * Ne se bat pas avec useSpotifyAudioSync : la synchro ne re-play que sur
   * changement started_at/track_id, jamais sur la position courante.
   */
  const seek = async (ms: number): Promise<void> => {
    const p = playerRef.current;
    if (!p) return;
    const target = Math.max(0, Math.round(ms));
    try {
      await p.seek(target);
      // Anchor optimiste : positionMs reflète le seek immédiatement ;
      // player_state_changed confirmera la vraie position juste après.
      positionAnchorRef.current = {
        ms: target,
        timestamp: Date.now(),
        paused: positionAnchorRef.current.paused,
      };
      setPositionMs(target);
    } catch (err) {
      console.warn('[Spotify Play] seek failed:', err);
    }
  };

  /**
   * feat/master-volume — règle le volume du player Web Playback (0..1).
   * No-op si le player n'est pas encore instancié.
   */
  const setVolume = async (v: number): Promise<void> => {
    const p = playerRef.current;
    if (!p) return;
    const clamped = Math.min(1, Math.max(0, v));
    try {
      await p.setVolume(clamped);
    } catch (err) {
      console.warn('[Spotify Play] setVolume failed:', err);
    }
  };

  /** Vérifie le state du player après play() — détecte si Chrome a bloqué. */
  const verifyPlayback = (uri: string): void => {
    const p = playerRef.current;
    if (!p) return;
    [500, 1500, 3000].forEach((delayMs) => {
      window.setTimeout(() => {
        void p.getCurrentState().then((state) => {
          if (!state) {
            console.warn(
              `[Spotify Verify] +${delayMs}ms state=null — device pas actif (control ailleurs ?)`,
            );
            return;
          }
          const trackUri = state.track_window?.current_track?.uri;
          const matches = trackUri === uri;
          console.info(
            `[Spotify Verify] +${delayMs}ms — paused: ${state.paused} | pos: ${state.position}ms | uri match: ${matches} (${trackUri})`,
          );
          if (delayMs === 3000 && state.paused && matches) {
            console.error(
              '[Spotify Verify] ❌ Toujours paused 3s après play() — autoplay bloqué OU device inactif',
            );
            setLastEvent('verify:still_paused_3s');
            // Bug 2 — déclenche affichage du fallback UI (autoplay bloqué silencieusement)
            setAudioBlocked(true);
            setErrorCode('AUTOPLAY_BLOCKED');
            setError('Le navigateur a bloqué la lecture. Clique pour activer.');
          }
        });
      }, delayMs);
    });
  };

  // Bug 1 fix — sérialisation des play() pour éviter race entre Recommencer
  // (play sameURI pos=0) et Morceau suivant (play newURI pos=0). Sans cela,
  // les 2 PUT /me/player/play partent en parallèle et Spotify peut appliquer
  // l'ancien après le nouveau (ordre arbitraire), résultat = audio "ancien
  // morceau" alors que l'UI affiche "nouveau morceau".
  const playSeqRef = useRef(0);
  const playAbortRef = useRef<AbortController | null>(null);

  const play = async (spotifyUri: string): Promise<boolean> => {
    if (!deviceId || !tokenRef.current) {
      console.info('[Spotify Play] Device pas prêt, mise en file:', spotifyUri);
      pendingPlayRef.current = spotifyUri;
      return false;
    }
    // Cancel toute tentative play() précédente encore en vol.
    if (playAbortRef.current) {
      console.info('[Track Change] Cancelled pending play (previous request superseded)');
      playAbortRef.current.abort();
    }
    const seq = ++playSeqRef.current;
    const ctrl = new AbortController();
    playAbortRef.current = ctrl;
    console.info(`[Track Change] Playing new URI: ${spotifyUri} | seq=${seq} | device=${deviceId}`);
    // Re-active la pipeline audio par sécurité (idempotent). Important si
    // Chrome a reset le contexte audio entre 2 plays.
    const p = playerRef.current;
    if (p) {
      try {
        await p.activateElement();
      } catch (err) {
        console.warn('[Spotify Play] activateElement before play failed:', err);
      }
    }
    let res: Response;
    try {
      res = await fetch(`${SPOTIFY_API}/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${tokenRef.current}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uris: [spotifyUri], position_ms: 0 }),
        signal: ctrl.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        console.info(`[Spotify Play] seq=${seq} aborted (newer play() in flight)`);
        return false;
      }
      throw err;
    }
    // Si une requête plus récente a été déclenchée pendant qu'on attendait,
    // on ignore la réponse pour éviter de re-déclencher verifyPlayback sur
    // un URI obsolète.
    if (seq !== playSeqRef.current) {
      console.info(`[Spotify Play] seq=${seq} stale response — ignoring`);
      return false;
    }
    if (playAbortRef.current === ctrl) playAbortRef.current = null;
    console.info(`[Spotify Play] Response status: ${res.status} | seq=${seq} | uri=${spotifyUri}`);
    if (res.status === 204 || res.ok) {
      verifyPlayback(spotifyUri);
      return true;
    }
    if (res.status === 401) {
      // Token expiré → invalide le cache, le SDK redemandera un token frais
      tokenRef.current = null;
      tokenExpiresAtRef.current = 0;
      return false;
    }
    if (res.status === 403) {
      setErrorCode('PREMIUM_REQUIRED');
      setError('Lecture refusée — Compte Spotify Premium requis pour le full playback.');
      return false;
    }
    if (res.status === 404) {
      // Device perdu (pas dispo côté Spotify Connect) — peut arriver si
      // l'utilisateur a fermé un onglet ailleurs. On force un re-transfer.
      console.warn('[Spotify Play] Device 404 — re-transfer puis retry');
      const ok = await transferPlaybackInternal(deviceId, false);
      if (ok) return play(spotifyUri);
      return false;
    }
    const text = await res.text().catch(() => '');
    console.warn('[Spotify Play] Failed body:', text);
    return false;
  };

  const pause = async (): Promise<void> => {
    const p = playerRef.current;
    if (p) {
      try {
        await p.pause();
        console.info('[Spotify Play] Paused');
      } catch (err) {
        console.warn('[spotify pause] failed', err);
      }
    }
  };

  const resume = async (): Promise<void> => {
    const p = playerRef.current;
    if (p) {
      try {
        await p.resume();
        console.info('[Spotify Play] Resumed');
      } catch (err) {
        console.warn('[spotify resume] failed', err);
      }
    }
  };

  return {
    status,
    deviceId,
    error,
    errorCode,
    lastEvent,
    currentTrackUri,
    isPlaying,
    positionMs,
    durationMs,
    play,
    pause,
    resume,
    transferToTutti,
    activate,
    restartCurrentTrack,
    seek,
    setVolume,
    audioBlocked,
    unblockAudio,
  };
}
