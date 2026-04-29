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
import { getSpotifyToken } from './music.js';

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
}

export interface UseSpotifyPlayerResult {
  status: SpotifyPlayerStatus;
  /** Disponible quand status === 'ready'. */
  deviceId: string | null;
  error: string | null;
  /** Code d'erreur "stable" pour différencier les cas (NOT_CONNECTED, PREMIUM_REQUIRED…). */
  errorCode: string | null;
  /**
   * Joue un morceau. Retourne true si l'API a accepté la requête.
   * Si le device n'est pas encore prêt, met l'URI en attente et retourne false.
   */
  play: (spotifyUri: string) => Promise<boolean>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
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
}: UseSpotifyPlayerOptions): UseSpotifyPlayerResult {
  const [status, setStatus] = useState<SpotifyPlayerStatus>('idle');
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const playerRef = useRef<SpotifyPlayer | null>(null);
  const tokenRef = useRef<string | null>(null);
  const tokenExpiresAtRef = useRef<number>(0);
  const pendingPlayRef = useRef<string | null>(null);

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
        const t = await getSpotifyToken();
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
        setStatus('loading_token');
        // Préchauffe le token pour vérifier qu'on est connecté avant de
        // charger le SDK (et pour donner un message d'erreur clair sinon).
        try {
          const initialToken = await getSpotifyToken();
          tokenRef.current = initialToken.access_token;
          tokenExpiresAtRef.current = new Date(initialToken.expires_at).getTime();
        } catch (err) {
          const msg = err instanceof Error ? err.message : '';
          if (msg.includes('NOT_CONNECTED') || msg.includes('non connecté')) {
            fail('NOT_CONNECTED', 'Spotify non connecté à ce workspace.');
          } else {
            fail('TOKEN_FETCH_FAILED', msg || 'Token Spotify indisponible');
          }
          return;
        }
        if (cancelled) return;

        setStatus('loading_sdk');
        await loadSpotifySdk();
        if (cancelled) return;

        if (!window.Spotify) {
          fail('SDK_UNAVAILABLE', 'Spotify SDK indisponible.');
          return;
        }

        setStatus('connecting');
        player = new window.Spotify.Player({
          name: 'Tutti Host',
          getOAuthToken: (cb) => {
            void fetchToken(cb);
          },
          volume: initialVolume,
        });
        playerRef.current = player;

        player.addListener('ready', ({ device_id }) => {
          if (cancelled) return;
          setDeviceId(device_id);
          setStatus('ready');
          // Si un play était en attente, on le déclenche
          const pending = pendingPlayRef.current;
          pendingPlayRef.current = null;
          if (pending) void play(pending);
        });
        player.addListener('not_ready', () => {
          if (cancelled) return;
          setDeviceId(null);
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
          console.warn('[spotify playback_error]', message);
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
      if (player) {
        try {
          player.disconnect();
        } catch {
          /* noop */
        }
      }
      playerRef.current = null;
      setStatus('idle');
      setDeviceId(null);
      // Pas de reset error pour laisser l'éventuel message visible au remount
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // ── Actions ────────────────────────────────────────────────────────────

  const play = async (spotifyUri: string): Promise<boolean> => {
    if (!deviceId || !tokenRef.current) {
      pendingPlayRef.current = spotifyUri;
      return false;
    }
    const res = await fetch(
      `${SPOTIFY_API}/me/player/play?device_id=${encodeURIComponent(deviceId)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${tokenRef.current}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uris: [spotifyUri] }),
      },
    );
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
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn('[spotify play] failed', res.status, text);
      return false;
    }
    return true;
  };

  const pause = async (): Promise<void> => {
    const p = playerRef.current;
    if (p) {
      try {
        await p.pause();
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
      } catch (err) {
        console.warn('[spotify resume] failed', err);
      }
    }
  };

  return { status, deviceId, error, errorCode, play, pause, resume };
}
