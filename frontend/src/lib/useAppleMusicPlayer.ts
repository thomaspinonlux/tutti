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
import { borner } from './borner.js';
import { supportsNativeAppleMusic } from './platform.js';
import { nativeMusicKit } from './nativeMusicKit.js';

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
  /**
   * feat/synced-lyrics — position RÉELLE du lecteur, lue à la demande.
   * `positionMs` (état React) n'est rafraîchi qu'à ~1 Hz : trop grossier pour
   * synchroniser des paroles. Cette fonction interroge directement MusicKit,
   * ce qui permet à l'overlay de la relire à chaque frame.
   */
  readPositionMs: () => number;
  durationMs: number;
  /** Joue un morceau par son catalog id Apple Music. */
  play: (catalogId: string) => Promise<boolean>;
  /** feat/next-track-preload — met le morceau SUIVANT en tampon pendant la lecture. */
  prepareNext: (catalogId: string) => Promise<boolean>;
  /** feat/next-track-preload — bascule instantanée sur le morceau préchargé. */
  playPrepared: (catalogId: string) => Promise<boolean>;
  /** fix/live-sync-check — id du morceau réellement en lecture ('' = inconnu). */
  readNowPlayingId: () => string;
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
  // fix/apple-ecouteurs-empiles — retire les écouteurs posés sur l'instance.
  const detacherEcouteurs = useRef<(() => void) | null>(null);
  // Dernier morceau demandé — rejoué par unblockAudio() depuis un geste frais.
  const lastCatalogIdRef = useRef<string | null>(null);
  // feat/next-track-preload — id du morceau actuellement PRÉCHARGÉ dans la
  // file du lecteur (web : setQueue/playLater ; natif : queueNext Swift).
  const preparedNextRef = useRef<string | null>(null);
  // fix/live-sync-check — identité du morceau RÉELLEMENT en lecture (sonde
  // native 250 ms / nowPlayingItem web). '' = inconnue (vieux binaire).
  const nowPlayingIdRef = useRef<string>('');
  // fix/no-auto-advance — fenêtre pendant laquelle un changement de file est
  // LÉGITIME (play/playPrepared viennent de l'ordonner). Hors fenêtre, un
  // changement = le lecteur a enchaîné TOUT SEUL sur le titre préchargé → on
  // coupe : ce son est celui de la PROCHAINE réponse.
  const queueChangeAllowedUntilRef = useRef<number>(0);
  // Vérifie 1,5 s après play() que la lecture a bien démarré (sinon → bloqué).
  const unlockCheckRef = useRef<number | null>(null);
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  // feat/native (phase 1) — sur iPad natif avec le plugin MusicKit présent, on
  // pilote la lecture via le PONT NATIF (ApplicationMusicPlayer Swift) au lieu de
  // MusicKit JS : lecture full-track sans blocage autoplay. Partout ailleurs
  // (web, desktop, iPad sans plugin) `useNative` est faux → chemin web inchangé.
  const useNative = supportsNativeAppleMusic() && nativeMusicKit.isAvailable();
  const useNativeRef = useRef(useNative);
  useNativeRef.current = useNative;

  // ── Initialisation MusicKit ────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    if (useNative) return; // chemin natif : voir l'effet dédié plus bas.
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
        // fix/apple-ecouteurs-empiles — LES ÉCOUTEURS SONT RETIRÉS À LA SORTIE.
        // MusicKit.configure() rend toujours la MÊME instance : à chaque
        // relance de cet effet (changement de jeton, remontage de la page) une
        // nouvelle série d'écouteurs s'ajoutait aux précédentes sans jamais
        // partir. Au bout de quelques manches, le garde-fou d'avance de file
        // se déclenchait en cascade et mettait la musique en pause tout seul.
        const onQueue = (): void => {
          if (Date.now() > queueChangeAllowedUntilRef.current) {
            console.warn('[Apple] avance de file NON demandée → pause immédiate');
            void musicRef.current?.pause();
          }
        };
        music.addEventListener('playbackStateDidChange', onPlayback);
        music.addEventListener('playbackTimeDidChange', onTime);
        // fix/no-auto-advance — cf. queueChangeAllowedUntilRef.
        music.addEventListener('queuePositionDidChange', onQueue);
        detacherEcouteurs.current = () => {
          try {
            music.removeEventListener('playbackStateDidChange', onPlayback);
            music.removeEventListener('playbackTimeDidChange', onTime);
            music.removeEventListener('queuePositionDidChange', onQueue);
          } catch {
            /* retrait best-effort : jamais bloquant */
          }
        };

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
      detacherEcouteurs.current?.();
      detacherEcouteurs.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, musicUserToken]);

  // ── Initialisation NATIVE (iPad, plugin TuttiMusicKit) ──────────────────────
  // feat/native (phase 1) — pas de SDK JS à charger : on autorise MusicKit natif
  // puis on sonde l'état (250 ms) pour interpoler position/lecture, symétrique au
  // `playbackTimeDidChange` du chemin web.
  useEffect(() => {
    if (!enabled || !useNative) return;
    let cancelled = false;
    let poll: number | null = null;
    void (async () => {
      setStatus('configuring');
      // fix/apple-bloque-en-configuration — L'AUTORISATION EST BORNÉE ET
      // RATTRAPÉE. Sans limite ni capture d'erreur, si la boîte de dialogue
      // iOS s'affichait derrière l'écran externe, ou si le pont refusait
      // (abonnement expiré), le statut restait sur « configuration » pour
      // toujours : plus aucun morceau ne pouvait être joué, sans le moindre
      // message, et le refus partait en promesse non rattrapée.
      let authorized = false;
      try {
        ({ authorized } = await borner(
          nativeMusicKit.authorize(),
          20_000,
          'Autorisation Apple Music',
        ));
      } catch (err: unknown) {
        if (cancelled) return;
        console.error('[Apple natif] autorisation impossible :', err);
        setError((err as Error).message);
        setErrorCode('APPLE_INIT_FAILED');
        setStatus('error');
        return;
      }
      if (cancelled) return;
      setIsAuthorized(authorized);
      setStatus('ready');
      poll = window.setInterval(() => {
        void nativeMusicKit.getStatus().then((s) => {
          if (cancelled) return;
          setIsPlaying(s.isPlaying);
          setPositionMs(Math.round(s.positionMs));
          setDurationMs(Math.round(s.durationMs));
          nowPlayingIdRef.current = s.nowPlayingId ?? '';
          if (s.isPlaying) setAudioBlocked(false);
        });
      }, 250);
    })();
    return () => {
      cancelled = true;
      if (poll !== null) window.clearInterval(poll);
    };
  }, [enabled, useNative]);

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
      lastCatalogIdRef.current = catalogId;
      // feat/native (phase 1) — chemin natif iPad : ApplicationMusicPlayer joue
      // full-track sans politique d'autoplay. En cas de non-autorisation, on
      // lève l'overlay de secours (identique web).
      if (useNativeRef.current) {
        // fix/silence-sans-message — le pont natif REJETTE quand le morceau est
        // introuvable ou que la lecture échoue (abonnement expiré, identifiant
        // mort, réseau). Sans ce filet l'exception se perdait : aucun son,
        // aucun message, et pas d'overlay de secours pour l'animateur.
        try {
          if (!enabledRef.current) return false;
          const auth = await nativeMusicKit.authorize();
          setIsAuthorized(auth.authorized);
          if (!auth.authorized) {
            setErrorCode('APPLE_NOT_AUTHORIZED');
            setAudioBlocked(true);
            return false;
          }
          queueChangeAllowedUntilRef.current = Date.now() + 4000;
          const r = await nativeMusicKit.play(catalogId);
          preparedNextRef.current = null; // nouvelle file → l'ancien préchargé est perdu
          if (!r.ok) {
            setAudioBlocked(true);
            return false;
          }
          setAudioBlocked(false);
          return true;
        } catch (err: unknown) {
          console.warn('[Apple] lecture native refusée :', err);
          setErrorCode('APPLE_PLAY_FAILED');
          setAudioBlocked(true);
          return false;
        }
      }
      const music = musicRef.current;
      if (!music || !enabledRef.current) return false;
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
        preparedNextRef.current = null; // nouvelle file → l'ancien préchargé est perdu
        queueChangeAllowedUntilRef.current = Date.now() + 4000;
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

  /**
   * feat/next-track-preload — met le morceau SUIVANT en file d'attente du
   * lecteur PENDANT le morceau courant. Le lecteur le met en tampon : le
   * moment venu, playPrepared() démarre quasi instantanément.
   * Best-effort : false = pas préchargé (binaire natif trop ancien, API web
   * absente…) — le flux normal play() reste le repli, rien ne casse.
   */
  const prepareNext = useCallback(async (catalogId: string): Promise<boolean> => {
    if (preparedNextRef.current === catalogId) return true;
    if (useNativeRef.current) {
      const ok = await nativeMusicKit.queueNext(catalogId);
      if (ok) preparedNextRef.current = catalogId;
      return ok;
    }
    const music = musicRef.current;
    if (!music) return false;
    try {
      // MusicKit JS : ajoute en fin de file sans toucher à la lecture en cours.
      await music.playLater({ songs: [catalogId] });
      preparedNextRef.current = catalogId;
      return true;
    } catch {
      return false;
    }
  }, []);

  /**
   * feat/next-track-preload — démarre le morceau attendu s'il est déjà
   * préchargé (saut de file instantané). false → l'appelant fait play().
   */
  const playPrepared = useCallback(async (catalogId: string): Promise<boolean> => {
    if (preparedNextRef.current !== catalogId) return false;
    preparedNextRef.current = null;
    lastCatalogIdRef.current = catalogId;
    queueChangeAllowedUntilRef.current = Date.now() + 4000;
    if (useNativeRef.current) {
      // fix/skip-sans-fuite-audio — le saut natif est VÉRIFIÉ : après
      // skipToNext (qui coupe d'abord l'ancien titre côté natif), on sonde le
      // lecteur jusqu'à 1.5 s pour confirmer que le morceau EN LECTURE est bien
      // la cible. Pas confirmé → return false → l'appelant fait un play()
      // complet (setQueue). Résultat : soit bascule instantanée confirmée,
      // soit rechargement franc — jamais l'ancien titre qui continue.
      const jumped = await nativeMusicKit.skipToNext();
      if (!jumped) return false;
      for (let i = 0; i < 10; i += 1) {
        await new Promise((r) => setTimeout(r, 150));
        try {
          const st = await nativeMusicKit.getStatus();
          if (st?.nowPlayingId === catalogId) {
            nowPlayingIdRef.current = st.nowPlayingId ?? '';
            return true;
          }
        } catch {
          /* sonde indisponible → on laisse la boucle finir */
        }
      }
      console.warn('[ApplePlayer] playPrepared non confirmé en 1.5s → fallback play()');
      return false;
    }
    const music = musicRef.current;
    if (!music) return false;
    try {
      // Même principe côté web : on coupe l'ancien titre avant le saut.
      try {
        await music.pause();
      } catch {
        /* noop */
      }
      await music.skipToNextItem();
      if (!music.isPlaying) await music.play();
      scheduleUnlockCheck();
      return true;
    } catch {
      return false;
    }
  }, []);

  const pause = useCallback(async (): Promise<void> => {
    if (useNativeRef.current) {
      await nativeMusicKit.pause();
      return;
    }
    const music = musicRef.current;
    if (!music) return;
    try {
      await music.pause();
    } catch {
      /* noop */
    }
  }, []);

  const resume = useCallback(async (): Promise<void> => {
    if (useNativeRef.current) {
      if (!enabledRef.current) return;
      await nativeMusicKit.resume();
      return;
    }
    const music = musicRef.current;
    if (!music || !enabledRef.current) return;
    try {
      await music.play();
    } catch {
      /* noop */
    }
  }, []);

  const seek = useCallback(async (ms: number): Promise<void> => {
    if (useNativeRef.current) {
      await nativeMusicKit.seek(Math.max(0, ms));
      return;
    }
    const music = musicRef.current;
    if (!music) return;
    try {
      await music.seekToTime(Math.max(0, ms) / 1000);
    } catch {
      /* noop */
    }
  }, []);

  const setVolume = useCallback(async (v: number): Promise<void> => {
    if (useNativeRef.current) {
      await nativeMusicKit.setVolume(Math.max(0, Math.min(1, v)));
      return;
    }
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
    if (useNativeRef.current) {
      const { authorized } = await nativeMusicKit.authorize();
      setIsAuthorized(authorized);
      return authorized;
    }
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
    if (useNativeRef.current) {
      const auth = await nativeMusicKit.authorize();
      setIsAuthorized(auth.authorized);
      const id = lastCatalogIdRef.current;
      if (!id) {
        setAudioBlocked(false);
        return auth.authorized;
      }
      const r = await nativeMusicKit.play(id);
      if (r.ok) setAudioBlocked(false);
      return r.ok;
    }
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

  // feat/synced-lyrics — lecture directe de la position MusicKit (pas l'état
  // React) : l'overlay paroles l'appelle à chaque frame d'animation.
  /**
   * fix/live-sync-check — identité du morceau réellement en lecture.
   * '' = indisponible (binaire natif ancien, lecteur pas prêt) → contrôle sauté.
   */
  const readNowPlayingId = useCallback((): string => {
    if (useNativeRef.current) return nowPlayingIdRef.current;
    const m = musicRef.current as unknown as { nowPlayingItem?: { id?: string } } | null;
    return m?.nowPlayingItem?.id ?? '';
  }, []);

  const readPositionMs = useCallback((): number => {
    const m = musicRef.current;
    if (!m) return 0;
    return Math.round((m.currentPlaybackTime ?? 0) * 1000);
  }, []);

  return {
    status,
    error,
    errorCode,
    isAuthorized,
    isPlaying,
    positionMs,
    readPositionMs,
    durationMs,
    play,
    pause,
    resume,
    seek,
    setVolume,
    prepareNext,
    playPrepared,
    readNowPlayingId,
    activate,
    audioBlocked,
    unblockAudio,
  };
}
