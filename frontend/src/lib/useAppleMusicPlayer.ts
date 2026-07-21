/**
 * useAppleMusicPlayer — charge MusicKit JS (v3) et l'initialise pour lire de
 * l'audio Apple Music dans le navigateur du host (le son sort de la console,
 * comme Spotify/YouTube). feat/apple-music (étape 4).
 *
 * Modèle symétrique à useSpotifyPlayer :
 *   - developer token : minté côté backend (/api/auth/apple/developer-token),
 *     nécessaire pour configurer MusicKit + appeler l'Apple Music API.
 *   - Music User Token : le host connecte SON compte Apple Music abonné via
 *     MusicKit.authorize() (popup). MusicKit persiste l'autorisation ; on peut
 *     aussi injecter un token explicite (TV publique) via `musicUserToken`.
 *   - lecture full-track requiert un abonnement Apple Music actif (≈ Premium).
 *
 * L'étape 5 (UI) branchera ce hook dans HostPage ; ici on fournit juste la
 * mécanique (play/pause/resume/seek/volume + statut).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAppleDeveloperToken } from './appleMusic.js';
import { loadMusicKitSdk, type MusicKitInstance } from './musickitLoader.js';

export type AppleMusicPlayerStatus =
  | 'idle'
  | 'loading_sdk'
  | 'loading_token'
  | 'configuring'
  | 'ready'
  | 'error';

export interface UseAppleMusicPlayerOptions {
  /** Active le hook (par défaut on n'instancie pas MusicKit pour rien). */
  enabled: boolean;
  /** Volume initial 0..1 (défaut 0.5). */
  initialVolume?: number;
  /** Override du fetcher de developer token (défaut = getAppleDeveloperToken). */
  developerTokenFetcher?: () => Promise<string>;
  /**
   * Music User Token explicite (TV publique via token-public). Si absent, on
   * s'appuie sur l'autorisation MusicKit déjà stockée (host qui a connecté son
   * compte). N'affiche PAS de popup ici : la connexion se fait en étape 5.
   */
  musicUserToken?: string | null;
}

export interface UseAppleMusicPlayerResult {
  status: AppleMusicPlayerStatus;
  error: string | null;
  errorCode: string | null;
  /** true si l'utilisateur a autorisé un compte Apple Music abonné. */
  isAuthorized: boolean;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  /** Joue un morceau par son catalog id Apple Music. */
  play: (catalogId: string) => Promise<boolean>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  seek: (ms: number) => Promise<void>;
  setVolume: (v: number) => Promise<void>;
  /** Débloque l'audio après une interaction user (autoplay policy). */
  activate: () => Promise<boolean>;
}

export function useAppleMusicPlayer({
  enabled,
  initialVolume = 0.5,
  developerTokenFetcher,
  musicUserToken,
}: UseAppleMusicPlayerOptions): UseAppleMusicPlayerResult {
  const fetchDevToken =
    developerTokenFetcher ?? (async (): Promise<string> => (await getAppleDeveloperToken()).token);

  const [status, setStatus] = useState<AppleMusicPlayerStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);

  const musicRef = useRef<MusicKitInstance | null>(null);
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  // ── Initialisation MusicKit ────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    void (async () => {
      try {
        setStatus('loading_sdk');
        const MusicKit = await loadMusicKitSdk();
        if (cancelled) return;

        setStatus('loading_token');
        const developerToken = await fetchDevToken();
        if (cancelled) return;

        setStatus('configuring');
        const music = await MusicKit.configure({
          developerToken,
          app: { name: 'Tutti', build: '1.0.0' },
        });
        if (cancelled) return;
        musicRef.current = music;

        // TV publique : injecte le Music User Token connu (best-effort — selon
        // la version MusicKit, l'autorisation peut nécessiter authorize()).
        if (musicUserToken) {
          try {
            (music as unknown as { musicUserToken?: string }).musicUserToken = musicUserToken;
          } catch {
            /* ignore : fallback sur l'autorisation stockée */
          }
        }
        setIsAuthorized(music.isAuthorized);
        try {
          music.volume = initialVolume;
        } catch {
          /* volume best-effort */
        }

        const onPlayback = (): void => {
          const m = musicRef.current;
          if (!m) return;
          setIsPlaying(m.isPlaying);
        };
        const onTime = (): void => {
          const m = musicRef.current;
          if (!m) return;
          setPositionMs(Math.round((m.currentPlaybackTime ?? 0) * 1000));
          setDurationMs(Math.round((m.currentPlaybackDuration ?? 0) * 1000));
        };
        music.addEventListener('playbackStateDidChange', onPlayback);
        music.addEventListener('playbackTimeDidChange', onTime);

        setStatus('ready');
      } catch (err: unknown) {
        if (cancelled) return;
        setError((err as Error).message);
        setErrorCode('APPLE_INIT_FAILED');
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, musicUserToken]);

  // ── Contrôles ──────────────────────────────────────────────────────────────
  const play = useCallback(async (catalogId: string): Promise<boolean> => {
    const music = musicRef.current;
    if (!music || !enabledRef.current) return false;
    try {
      await music.setQueue({ song: catalogId });
      await music.play();
      return true;
    } catch (err: unknown) {
      setError((err as Error).message);
      return false;
    }
  }, []);

  const pause = useCallback(async (): Promise<void> => {
    const music = musicRef.current;
    if (!music) return;
    try {
      await music.pause();
    } catch {
      /* noop */
    }
  }, []);

  const resume = useCallback(async (): Promise<void> => {
    const music = musicRef.current;
    if (!music || !enabledRef.current) return;
    try {
      await music.play();
    } catch {
      /* noop */
    }
  }, []);

  const seek = useCallback(async (ms: number): Promise<void> => {
    const music = musicRef.current;
    if (!music) return;
    try {
      await music.seekToTime(Math.max(0, ms) / 1000);
    } catch {
      /* noop */
    }
  }, []);

  const setVolume = useCallback(async (v: number): Promise<void> => {
    const music = musicRef.current;
    if (!music) return;
    try {
      music.volume = Math.max(0, Math.min(1, v));
    } catch {
      /* noop */
    }
  }, []);

  const activate = useCallback(async (): Promise<boolean> => {
    // MusicKit démarre le pipeline audio au premier play() déclenché par un
    // clic user — pas d'API activate() séparée. On expose la méthode pour
    // rester symétrique avec Spotify ; elle est un no-op sûr.
    return !!musicRef.current;
  }, []);

  return {
    status,
    error,
    errorCode,
    isAuthorized,
    isPlaying,
    positionMs,
    durationMs,
    play,
    pause,
    resume,
    seek,
    setVolume,
    activate,
  };
}
