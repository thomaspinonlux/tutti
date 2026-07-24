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
  /**
   * fix/robust-autoplay-no-refresh (Apple) — true si le play() a été refusé
   * par la politique d'autoplay du navigateur (geste user non conservé) OU si
   * MusicKit n'est pas autorisé. L'UI affiche alors l'overlay « Démarrer la
   * lecture » (identique YouTube/Spotify) qui appelle `unblockAudio()` depuis
   * un geste user frais. JAMAIS d'alert() ni de reload.
   */
  audioBlocked: boolean;
  /**
   * fix/robust-autoplay-no-refresh (Apple) — relance le dernier morceau
   * demandé depuis un geste user frais (clic sur l'overlay de secours).
   * (Ré)autorise MusicKit si besoin puis rejoue. Reset `audioBlocked` au
   * succès. Miroir de youtube.tapToStart / spotify.unblockAudio.
   */
  unblockAudio: () => Promise<boolean>;
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
  // fix/robust-autoplay-no-refresh (Apple) — autoplay bloqué → overlay de
  // secours (identique YouTube/Spotify), jamais d'alert().
  const [audioBlocked, setAudioBlocked] = useState(false);

  const musicRef = useRef<MusicKitInstance | null>(null);
  // Dernier morceau demandé — rejoué par unblockAudio() depuis un geste frais.
  const lastCatalogIdRef = useRef<string | null>(null);
  // Vérifie 1,5 s après play() que la lecture a bien démarré (sinon → bloqué).
  const unlockCheckRef = useRef<number | null>(null);
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
          // La lecture a réellement démarré → autoplay OK, on lève le blocage
          // et on annule la vérification différée (miroir YT onStateChange
          // PLAYING → setAudioBlocked(false)).
          if (m.isPlaying) {
            setAudioBlocked(false);
            if (unlockCheckRef.current !== null) {
              window.clearTimeout(unlockCheckRef.current);
              unlockCheckRef.current = null;
            }
          }
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

  /**
   * fix/robust-autoplay-no-refresh (Apple) — planifie une vérification 1,5 s
   * après play() : si MusicKit n'est pas en lecture, l'autoplay a été bloqué
   * (le geste user du clic « Démarrer » n'a pas été conservé jusqu'ici, car le
   * play réel est déclenché par la synchro serveur, pas par le clic). On lève
   * `audioBlocked` → l'UI affiche l'overlay de secours. Miroir de
   * useYouTubePlayer.scheduleAutoplayRetry (sans alert, sans reload).
   */
  const scheduleUnlockCheck = useCallback((): void => {
    if (unlockCheckRef.current !== null) {
      window.clearTimeout(unlockCheckRef.current);
      unlockCheckRef.current = null;
    }
    unlockCheckRef.current = window.setTimeout(() => {
      unlockCheckRef.current = null;
      const m = musicRef.current;
      if (!m) return;
      if (!m.isPlaying) {
        console.warn('[Apple] play did not start after 1.5s → audioBlocked=true (UI fallback)');
        setAudioBlocked(true);
      }
    }, 1500);
  }, []);

  const play = useCallback(
    async (catalogId: string): Promise<boolean> => {
      const music = musicRef.current;
      if (!music || !enabledRef.current) return false;
      lastCatalogIdRef.current = catalogId;
      // BONUS — un MusicKit NON autorisé ne joue que des extraits de 30 s
      // (preview). Plutôt que de dégrader silencieusement, on lève l'overlay de
      // secours : le tap user (geste frais) déclenchera authorize()+play via
      // unblockAudio() (le Music User Token en base est ré-injecté côté client,
      // cf. prop `musicUserToken`).
      if (!music.isAuthorized) {
        setIsAuthorized(false);
        setErrorCode('APPLE_NOT_AUTHORIZED');
        setAudioBlocked(true);
        return false;
      }
      try {
        await music.setQueue({ song: catalogId });
        await music.play();
        // La lecture peut échouer silencieusement (autoplay policy) sans throw :
        // on vérifie l'état réel 1,5 s plus tard.
        scheduleUnlockCheck();
        return true;
      } catch (err: unknown) {
        // Chrome/Edge REJETTENT play() quand l'autoplay est bloqué
        // ("play() failed because the user didn't interact…"). On NE remonte
        // PAS une erreur bloquante : on lève l'overlay de secours (geste frais).
        console.warn('[Apple] play() rejected → audioBlocked=true:', (err as Error).message);
        setAudioBlocked(true);
        return false;
      }
    },
    [scheduleUnlockCheck],
  );

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
    // fix/robust-autoplay-no-refresh (Apple) — appelé DEPUIS le clic « Démarrer
    // le blind test » (geste user frais). But : déverrouiller MusicKit une fois
    // pour toute la session. On (ré)autorise si nécessaire — authorize() DOIT
    // être appelé dans un geste user, ce que ce handler garantit. On NE recrée
    // pas l'instance MusicKit (elle est persistante, clé [enabled,
    // musicUserToken]) : le claim audio est ainsi conservé entre les morceaux.
    const music = musicRef.current;
    if (!music) return false;
    if (!music.isAuthorized) {
      try {
        await music.authorize();
        setIsAuthorized(music.isAuthorized);
      } catch (err) {
        console.warn('[Apple] activate(): authorize() échoué (best-effort):', err);
      }
    }
    return !!musicRef.current;
  }, []);

  const unblockAudio = useCallback(async (): Promise<boolean> => {
    // Appelé depuis l'overlay de secours (geste user frais garanti). (Ré)auto-
    // rise MusicKit si besoin puis rejoue le dernier morceau demandé. Le geste
    // frais bypasse la politique d'autoplay. Miroir youtube.tapToStart.
    const music = musicRef.current;
    if (!music) return false;
    if (!music.isAuthorized) {
      try {
        await music.authorize();
        setIsAuthorized(music.isAuthorized);
      } catch (err) {
        console.warn('[Apple] unblockAudio(): authorize() échoué:', err);
      }
    }
    const catalogId = lastCatalogIdRef.current;
    if (!catalogId) {
      // Pas de morceau connu — au moins on lève le blocage (rien à rejouer).
      setAudioBlocked(false);
      return !!musicRef.current;
    }
    try {
      await music.setQueue({ song: catalogId });
      await music.play();
      setAudioBlocked(false);
      scheduleUnlockCheck();
      return true;
    } catch (err: unknown) {
      console.warn('[Apple] unblockAudio() play rejeté (reste bloqué):', (err as Error).message);
      return false;
    }
  }, [scheduleUnlockCheck]);

  // Cleanup du timer de vérification au unmount.
  useEffect(() => {
    return () => {
      if (unlockCheckRef.current !== null) {
        window.clearTimeout(unlockCheckRef.current);
        unlockCheckRef.current = null;
      }
    };
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
    audioBlocked,
    unblockAudio,
  };
}
