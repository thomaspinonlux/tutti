/**
 * /play?session=CODE — flow joueur (étapes 9 + 9.5 + résilience + onboarding).
 *
 * Mobile-first absolu. Cf. docs/RESPONSIVE.md + docs/PLAYER_RESILIENCE.md.
 *
 * Steps :
 *   1. pseudo (+ team si TEAMS) — sauf si on a déjà une identité en localStorage
 *   2. onboarding (skip si hasPlayedBefore + permission micro déjà OK)
 *   3. micPermissionError (si refus)
 *   4. waiting (Socket.IO connecté)
 *   5. playing — badge "Manche X — <Nom>" si round PLAYING
 *   6. ended
 */

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNouvelleVersion } from '../lib/useNouvelleVersion.js';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Socket } from 'socket.io-client';
import type {
  CurrentTrackState,
  JoinResponse,
  Participant,
  ParticipantRole,
  PublicSessionView,
  SessionRoundWithPlaylist,
  SessionWithParticipants,
  Team,
} from '@tutti/shared';
import {
  getPublicSession,
  joinSession,
  masterAdjustPoints,
  masterEndRound,
  masterEndSession,
  masterGiveAnswer,
  masterListScores,
  masterLyricsOverlay,
  masterNextTrack,
  masterPause,
  masterPickRound,
  masterLaunchOfficial,
  masterRejectLyrics,
  masterRestartTrack,
  masterAudioKick,
  masterHidePodium,
  cancelVoiceBuzz,
  masterResume,
  masterSeek,
  masterSetVolume,
  masterSkipTrack,
  postBuzz,
} from '../lib/sessions.js';
import type { CorrectAnswerEntry, CumulativeScore } from '@tutti/shared';
import {
  startVoiceCapture,
  uploadVoiceAnswer,
  submitTextAnswer,
  type VoiceAnswerResult,
  type VoiceCapture,
} from '../lib/voiceCapture.js';
import { useWebSpeech } from '../lib/useWebSpeech.js';
import { useMicStream } from '../lib/useMicStream.js';
import { ApiError } from '../lib/api.js';
import {
  postVoiceMatchText,
  postVoiceTranscribeDeepgram,
  postVoiceTranscribeAssemblyAI,
  AssemblyAIDisabledError,
  type CascadeMatchResponse,
} from '../lib/voiceCascade.js';
import {
  clearParticipantContext,
  connectAsParticipant,
  readParticipantContext,
  saveParticipantContext,
  type ParticipantContext,
} from '../lib/socket.js';
import {
  checkMicPermission,
  hasPlayedBefore,
  markOnboardingDone,
  requestMicPermission,
} from '../lib/onboarding.js';
import { useWakeLock } from '../lib/useWakeLock.js';
import { ConnectionIndicator } from '../components/ConnectionIndicator.js';
import { OnboardingScreen } from '../components/play/OnboardingScreen.js';
import { GameRules } from '../components/play/GameRules.js';
import { MicPermissionErrorScreen } from '../components/play/MicPermissionErrorScreen.js';
import { MasterMenu } from '../components/play/MasterMenu.js';
import { MasterPlaylistPicker } from '../components/play/MasterPlaylistPicker.js';
import {
  MasterAdjustPointsSheet,
  type ParticipantOption,
} from '../components/play/MasterAdjustPointsSheet.js';
import {
  Badge,
  Button,
  Card,
  Input,
  MultiColorBar,
  TitleHandwritten,
  Underline,
} from '../components/ui/index.js';
import { PlayQuizzView } from '../components/play/quizz/PlayQuizzView.js';
import { VinylBuzzer } from '../components/play/VinylBuzzer.js';
import { ClassementDuTitre } from '../components/game/ClassementDuTitre.js';
import { remoteLog } from '../lib/remoteLog.js';

type Step =
  | 'pseudo'
  | 'team'
  | 'onboarding'
  | 'onboardingCondensed'
  | 'micError'
  | 'waiting'
  | 'playing'
  | 'ended';

interface Toast {
  id: string;
  text: string;
  tone: 'basil' | 'spritz' | 'raspberry';
  /** Bonus — fading=true déclenche l'animation fade-out avant retrait DOM. */
  fading?: boolean;
}

export function PlayPage(): JSX.Element {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const shortCode = (params.get('session') ?? '').toUpperCase();

  const [view, setView] = useState<PublicSessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('pseudo');
  // feat/telephone-au-style-tv — tout l ecran joueur est sombre : accueil,
  // salle d attente, jeu, fin de partie.
  useFondJoueurSombre();
  const [pseudo, setPseudo] = useState('');
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [identity, setIdentity] = useState<ParticipantContext | null>(null);
  const [participantsCount, setParticipantsCount] = useState(0);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [currentRound, setCurrentRound] = useState<SessionRoundWithPlaylist | null>(null);
  const [currentTrack, setCurrentTrack] = useState<CurrentTrackState | null>(null);
  // fix/app-qui-tourne-avec-un-vieux-code — le téléphone se recharge seul hors
  // morceau quand une nouvelle version est en ligne.
  useNouvelleVersion(!currentTrack, 'telephone');
  const [correctAnswers, setCorrectAnswers] = useState<CorrectAnswerEntry[]>([]);
  const [lastReveal, setLastReveal] = useState<{
    artist: string;
    title: string;
    // feat/oeuvre-affichee — vrai titre de la chanson (playlists film & co).
    song_title?: string | null;
    // feat/pochette-ecran-joueur — pochette du morceau, envoyée par le serveur
    // AU MOMENT de la révélation uniquement.
    cover_url?: string | null;
  } | null>(null);
  const [phase2StartedAt, setPhase2StartedAt] = useState<string | null>(null);
  const [myScore, setMyScore] = useState(0);
  const [micRequesting, setMicRequesting] = useState(false);
  const [busy, setBusy] = useState(false);
  // Master mode (mode B uniquement) : flag is_master + état de pause
  const [isMaster, setIsMaster] = useState(false);
  // feat/multi-animator-roles — rôle du participant. is_master = isAnimatorRole(role)
  // (les deux profils animateur pilotent). role distingue qui VOIT la réponse :
  // ANIMATOR_FULL reçoit track:answer, ANIMATOR_PLAYING non (il joue).
  const [myRole, setMyRole] = useState<ParticipantRole>('PLAYER');
  // feat/manette-console-master — position/durée diffusées par la console
  // (broadcast track:progress) pour la timeline + le scrub de la télécommande.
  const [masterProgress, setMasterProgress] = useState<{
    position_ms: number;
    duration_ms: number | null;
    is_paused: boolean;
    at: number;
  } | null>(null);
  // feat/synced-lyrics — overlay paroles actif (source de vérité : broadcast serveur).
  const [lyricsOn, setLyricsOn] = useState(false);
  // feat/instructions-debut-partie — pop-in de consignes affiché UNE fois
  // quand la partie démarre (comment répondre, micro, bouton Envoyer).
  const [showRules, setShowRules] = useState(false);
  const rulesShownRef = useRef(false);

  useEffect(() => {
    if (step === 'playing' && !rulesShownRef.current) {
      rulesShownRef.current = true;
      setShowRules(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
  const [isPaused, setIsPaused] = useState(false);
  const [masterPickerOpen, setMasterPickerOpen] = useState(false);
  // feat/classement-final-persistant — bouton de fermeture du podium.
  const [podiumFermeture, setPodiumFermeture] = useState(false);
  const [adjustSheetOpen, setAdjustSheetOpen] = useState(false);
  const [participantsList, setParticipantsList] = useState<Participant[]>([]);
  const [cumulative, setCumulative] = useState<CumulativeScore[]>([]);
  const hadConnectionRef = useRef(false);

  const teams = useMemo<Team[]>(
    () => (view?.teams_config as Team[] | null) ?? [],
    [view?.teams_config],
  );

  // Wake Lock pendant la lecture
  useWakeLock(step === 'playing');

  // Master : récupère la cumulative quand on ouvre l'ajustement (et on est
  // master). Évite d'afficher "0 pts" partout.
  useEffect(() => {
    if (!adjustSheetOpen || !identity || !isMaster) return;
    void masterListScores(identity.sessionId, identity.token)
      .then(setCumulative)
      .catch(() => {});
  }, [adjustSheetOpen, identity, isMaster]);

  // fix/ios-voice-cascade-mic-and-buzz-refused — log de mount unique pour
  // corréler les bugs PO. UA + isStandalone + iOS détection visibles dans
  // DebugOverlay (?debug=audio).
  useEffect(() => {
    const isStandalone =
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(display-mode: standalone)')?.matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true);
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '(no-ua)';
    console.info(`[Voice] page /play mounted | userAgent="${ua}" | isStandalone=${isStandalone}`);
  }, []);

  // ── Bootstrap : récupère la session publique + auto-resume éventuel ──
  useEffect(() => {
    if (!shortCode) {
      setError(t('play.missingCode'));
      return;
    }
    void getPublicSession(shortCode)
      .then((v) => {
        setView(v);
        setParticipantsCount(v.participants_count);

        const stored = readParticipantContext(shortCode);
        if (stored) {
          if (v.status === 'ENDED') {
            clearParticipantContext(shortCode);
            setStep('ended');
            return;
          }
          // Reprise : on saute l'onboarding si déjà fait, sinon on l'affiche en condensé
          setIdentity(stored);
          setPseudo(stored.pseudo);
          setSelectedTeam(stored.teamId);
          setStep(v.status === 'PLAYING' ? 'playing' : 'waiting');
          return;
        }

        if (v.status === 'ENDED') {
          setStep('ended');
        }
      })
      .catch(() => setError(t('play.notFound')));
  }, [shortCode, t]);

  // ── Socket.IO une fois qu'on a une identité ───────────────────────────
  useEffect(() => {
    if (!identity) return;
    const sock = connectAsParticipant(identity.token);
    setSocket(sock);

    sock.on('connect', () => {
      const wasReconnect = hadConnectionRef.current;
      hadConnectionRef.current = true;
      sock.emit(
        'session:join',
        { sessionId: identity.sessionId },
        (resp: {
          ok: boolean;
          session?: SessionWithParticipants;
          active_track?: CurrentTrackState | null;
          cumulative?: CumulativeScore[];
          error?: string;
        }) => {
          if (!resp.ok) {
            // fix/joueur-qui-perd-sa-place — ON N EFFACE QUE SI C EST VOULU.
            //
            // Soiree du 11/09 : une joueuse a du se reinscrire sous un nouveau
            // pseudo en cours de partie, et l animateur lui a retransfere ses
            // 456 points a la main. Ici, TOUTE reponse negative du serveur
            // effacait l identite du telephone et renvoyait a l ecran pseudo —
            // y compris une panne passagere (base indisponible, delai depasse),
            // qui renvoie simplement le message de l exception. Le joueur
            // perdait alors sa place pour un incident de deux secondes.
            //
            // Seule l exclusion par l animateur justifie d oublier le joueur.
            // Tout le reste laisse l identite en place : la bibliotheque
            // Socket.IO retentera, et le journal garde la trace du motif.
            const exclu = resp.error === 'PARTICIPANT_EXCLU';
            remoteLog(
              'session',
              exclu ? 'joueur exclu par l animateur' : 'session:join refuse — identite conservee',
              { pseudo: identity.pseudo, motif: resp.error ?? '(aucun)' },
              exclu ? 'warn' : 'error',
            );
            if (!exclu) {
              setError(t('play.reconnecting'));
              return;
            }
            clearParticipantContext(shortCode);
            setError(t('play.kicked'));
            setIdentity(null);
            setStep('pseudo');
            return;
          }
          if (resp.session) {
            setParticipantsCount(resp.session.participants.length);
            setParticipantsList(resp.session.participants);
            const playing = resp.session.rounds.find((r) => r.status === 'PLAYING');
            setCurrentRound(playing ?? null);
            // Récupère mon flag is_master courant (mode B) + état pause
            const me = resp.session.participants.find((p) => p.id === identity.participantId);
            setIsMaster(me?.is_master ?? false);
            const role = me?.role ?? 'PLAYER';
            setMyRole(role);
            // feat/multi-animator-roles — seul ANIMATOR_FULL s'abonne au canal
            // réponses (le backend revérifie le rôle en base avant d'ouvrir).
            if (role === 'ANIMATOR_FULL') sock.emit('answers:subscribe');
            setIsPaused(resp.session.is_paused ?? false);
            if (resp.session.status === 'PLAYING') setStep('playing');
            else if (resp.session.status === 'ENDED') {
              clearParticipantContext(shortCode);
              setStep('ended');
            } else setStep('waiting');
          }
          // Reconnexion joueur — restore current track + cumulative score
          // pour que le joueur retrouve immédiatement son état (pseudo, score,
          // rang, morceau en cours, phase). Sans ça, il faut attendre le
          // prochain broadcast (track:start ou track:correct_answer).
          if (resp.active_track) {
            setCurrentTrack(resp.active_track);
            setCorrectAnswers(resp.active_track.correct_answers);
            setPhase2StartedAt(resp.active_track.phase2_started_at);
          }
          if (resp.cumulative) {
            setCumulative(resp.cumulative);
            // Recalcule myScore (somme de mes points individuels — en SOLO)
            // ou la part qui me revient en TEAMS via team_id.
            const myEntry = resp.cumulative.find((e) => e.id === identity.participantId);
            if (myEntry) setMyScore(myEntry.total_points);
          }
          // Mid-game join — toast d'accueil quand on rejoint pendant que la
          // session est PLAYING avec un morceau actif. !wasReconnect = 1ʳᵉ
          // connexion socket de cette identité (pas un reload).
          if (!wasReconnect && resp.session?.status === 'PLAYING' && resp.active_track) {
            pushToast(setToasts, t('play.joinMidGame'), 'spritz');
          }
          if (wasReconnect) {
            pushToast(setToasts, t('connection.toastReconnected'), 'basil');
            // Vérif silencieuse de la permission micro après une coupure prolongée
            void checkMicPermission().then((res) => {
              if (res.kind === 'denied') {
                pushToast(setToasts, t('onboarding.micErrorEyebrow'), 'raspberry');
              }
            });
          }
        },
      );
    });

    sock.on('participant:joined', ({ participant }: { participant: Participant }) => {
      setParticipantsCount((c) => c + 1);
      setParticipantsList((prev) => [...prev, participant]);
    });
    sock.on('participant:kicked', ({ participant }: { participant: Participant }) => {
      if (participant.id === identity.participantId) {
        clearParticipantContext(shortCode);
        setError(t('play.kicked'));
        setIdentity(null);
        setStep('pseudo');
      } else {
        setParticipantsCount((c) => Math.max(0, c - 1));
        setParticipantsList((prev) => prev.filter((p) => p.id !== participant.id));
      }
    });
    sock.on(
      'participant:master_changed',
      ({ participant, is_master }: { participant: Participant; is_master: boolean }) => {
        // Backend démasterise tous les autres en transaction.
        setParticipantsList((prev) =>
          prev.map((p) =>
            p.id === participant.id
              ? { ...p, is_master, role: participant.role }
              : { ...p, is_master: false, role: 'PLAYER' },
          ),
        );
        // Maj de mon propre flag
        if (participant.id === identity.participantId) {
          setIsMaster(is_master);
          setMyRole(participant.role);
          if (participant.role === 'ANIMATOR_FULL') sock.emit('answers:subscribe');
        } else if (is_master) {
          // Quelqu'un d'autre vient d'être nommé master → je perds le statut
          setIsMaster(false);
          setMyRole('PLAYER');
        }
      },
    );
    // feat/multi-animator-roles — attribution multi-animateurs (n'affecte que
    // la cible). Le concerné (re)synchronise son canal réponses sans reco.
    sock.on('participant:role_changed', ({ participant }: { participant: Participant }) => {
      setParticipantsList((prev) =>
        prev.map((p) =>
          p.id === participant.id
            ? { ...p, role: participant.role, is_master: participant.is_master }
            : p,
        ),
      );
      if (participant.id === identity.participantId) {
        setIsMaster(participant.is_master);
        setMyRole(participant.role);
        // Rejoint OU quitte answers:{id} selon le nouveau rôle (backend arbitre).
        sock.emit('answers:subscribe');
      }
    });
    sock.on('session:started', () => setStep('playing'));
    sock.on('session:ended', () => {
      clearParticipantContext(shortCode);
      setStep('ended');
    });
    sock.on('round:started', ({ round }: { round: SessionRoundWithPlaylist }) => {
      setCurrentRound(round);
    });
    sock.on('round:ended', () => {
      setCurrentRound(null);
      setCurrentTrack(null);
      setCorrectAnswers([]);
      setLastReveal(null);
      setPhase2StartedAt(null);
      setMasterProgress(null);
    });
    sock.on('track:start', ({ state }: { state: CurrentTrackState }) => {
      setCurrentTrack(state);
      setCorrectAnswers([]);
      setLastReveal(null);
      setPhase2StartedAt(null);
      setMasterProgress(null);
      // Nouveau morceau → l'overlay paroles est éteint côté serveur.
      setLyricsOn(false);
    });
    // feat/synced-lyrics — état du bouton Paroles piloté par le serveur.
    sock.on('lyrics:overlay', (p: { on: boolean }) => setLyricsOn(!!p.on));
    // feat/multi-animator-roles — canal PRIVILÉGIÉ (reçu uniquement si
    // ANIMATOR_FULL). Fusionne la réponse dans currentTrack. Un ANIMATOR_PLAYING
    // n'est jamais dans la room answers → n'entre jamais ici (anti-triche).
    sock.on(
      'track:answer',
      (a: {
        round_id: string;
        track_index: number;
        phase: CurrentTrackState['phase'];
        artist: string;
        title: string;
        album: string | null;
        year: number | null;
        cover_url: string | null;
      }) => {
        setCurrentTrack((prev) =>
          prev && prev.round_id === a.round_id && prev.track_index === a.track_index
            ? {
                ...prev,
                artist: a.artist,
                title: a.title,
                album: a.album,
                year: a.year,
                cover_url: a.cover_url,
              }
            : prev,
        );
      },
    );
    // feat/manette-console-master — la console diffuse sa position → timeline
    // exacte + scrub côté télécommande (corrige aussi le désync post-seek).
    sock.on(
      'track:progress',
      (p: { position_ms: number; duration_ms: number | null; is_paused: boolean }) => {
        setMasterProgress({ ...p, at: Date.now() });
      },
    );
    sock.on(
      'buzz:received',
      (_payload: { round_id: string; participant_id: string; participant_pseudo: string }) => {
        // V1 : on ne fait rien sur le tel des autres joueurs (le multi-buzz
        // ne bloque pas leur UI). Pourrait afficher un compteur "X joueurs
        // en train d'enregistrer" à terme.
      },
    );
    sock.on(
      'track:correct_answer',
      (payload: CorrectAnswerEntry & { cumulative?: CumulativeScore[] }) => {
        setCorrectAnswers((prev) => [...prev, payload]);
        if (payload.participant_id === identity.participantId) {
          setMyScore((prev) => prev + payload.score);
        }
        // Backend inclut maintenant la cumulative dans le broadcast — permet
        // au PhoneFooter d'afficher myRank live sans appel REST master-only.
        if (payload.cumulative) {
          setCumulative(payload.cumulative);
        }
      },
    );
    sock.on(
      'track:phase_changed',
      (payload: {
        round_id: string;
        track_index?: number;
        phase: CurrentTrackState['phase'];
        phase2_started_at?: string;
        artist?: string;
        title?: string;
        song_title?: string | null;
        cover_url?: string | null;
      }) => {
        // fix/buzzers-coupes-a-tort — ON ÉCARTE UN MESSAGE PÉRIMÉ.
        // Un changement de phase destiné à un AUTRE morceau (minuteur
        // d'une manche précédente, message arrivé en retard) coupait les
        // buzzers du morceau en cours. On ne l'applique que s'il désigne
        // bien la manche ET le morceau affichés.
        let perime = false;
        setCurrentTrack((prev) => {
          if (!prev) return prev;
          if (
            payload.round_id !== prev.round_id ||
            (payload.track_index !== undefined && payload.track_index !== prev.track_index)
          ) {
            perime = true;
            return prev;
          }
          return { ...prev, phase: payload.phase };
        });
        if (perime) return;
        if (payload.phase === 'phase2' && payload.phase2_started_at) {
          setPhase2StartedAt(payload.phase2_started_at);
        }
        if (payload.phase === 'phase3-revealed' && payload.artist && payload.title) {
          // Master a déclenché "Donner la réponse" sans qu'aucun buzz n'ait abouti
          setLastReveal({
            artist: payload.artist,
            title: payload.title,
            song_title: payload.song_title ?? null,
            cover_url: payload.cover_url ?? null,
          });
        }
      },
    );
    sock.on(
      'track:revealed',
      (payload: {
        round_id: string;
        artist: string;
        title: string;
        song_title?: string | null;
        cover_url?: string | null;
      }) => {
        // Cohérent avec phase_changed → phase3-revealed mais conservé pour
        // compat ascendante.
        setLastReveal({
          artist: payload.artist,
          title: payload.title,
          song_title: payload.song_title ?? null,
          cover_url: payload.cover_url ?? null,
        });
      },
    );
    sock.on('session:paused', () => setIsPaused(true));
    sock.on('session:resumed', () => setIsPaused(false));
    sock.on('scores:invalidated', () => {
      // Le master a ajusté des points : on rafraîchit la cumulative pour le
      // master (sheet d'ajustement) et on recalcule notre score perso si
      // un event nous concerne. Pour les non-master, on accepte que leur
      // score perso (myScore) ne reflète pas un ajustement silencieux —
      // ça reste cohérent avec le brief "pas de notif publique".
      void masterListScores(identity.sessionId, identity.token)
        .then((c) => {
          setCumulative(c);
          const me = c.find((entry) => entry.id === identity.participantId);
          if (me) setMyScore(me.total_points);
        })
        .catch(() => {});
    });

    return () => {
      sock.disconnect();
      setSocket(null);
    };
  }, [identity, shortCode, t]);

  // ── Submit handlers ───────────────────────────────────────────────────
  const handlePseudoSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!pseudo.trim()) return;
    if (view?.mode === 'TEAMS') {
      setStep('team');
      return;
    }
    // Tutti Quizz : pas d'onboarding micro requis (pas de voice).
    if (view?.game_type === 'QUIZZ') {
      void doJoin(null);
      return;
    }
    setStep(hasPlayedBefore() ? 'onboardingCondensed' : 'onboarding');
  };

  const handleTeamSubmit = (): void => {
    if (!selectedTeam) return;
    if (view?.game_type === 'QUIZZ') {
      void doJoin(selectedTeam);
      return;
    }
    setStep(hasPlayedBefore() ? 'onboardingCondensed' : 'onboarding');
  };

  const handleOnboardingContinue = async (): Promise<void> => {
    setMicRequesting(true);
    const res = await requestMicPermission();
    setMicRequesting(false);
    if (res.kind === 'granted') {
      markOnboardingDone();
      await doJoin(selectedTeam);
    } else if (res.kind === 'unsupported') {
      // Pas de micro disponible : on permet de jouer quand même (V1 bienveillant)
      markOnboardingDone();
      await doJoin(selectedTeam);
    } else {
      setStep('micError');
    }
  };

  const doJoin = async (teamId: string | null): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const resp: JoinResponse = await joinSession(shortCode, {
        pseudo: pseudo.trim(),
        team_id: teamId,
      });
      const ctx: ParticipantContext = {
        token: resp.token,
        participantId: resp.participant.id,
        sessionId: resp.participant.session_id,
        pseudo: resp.participant.pseudo,
        teamId: resp.participant.team_id ?? null,
      };
      saveParticipantContext(shortCode, ctx);
      setIdentity(ctx);
      setStep('waiting');
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Master actions (mode B) ───────────────────────────────────────────
  const masterCall = async (fn: () => Promise<unknown>): Promise<void> => {
    if (!identity || busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (err: unknown) {
      pushToast(setToasts, (err as Error).message, 'raspberry');
    } finally {
      setBusy(false);
    }
  };

  const handleMasterReveal = (): Promise<void> =>
    masterCall(async () => {
      if (!identity || !currentRound) return;
      await masterGiveAnswer(identity.sessionId, currentRound.id, identity.token);
    });
  // fix/master-timeline-optimistic — au tap Suivant/Passer/Rejouer, la barre
  // repart à 0:00 IMMÉDIATEMENT (gelée) au lieu de continuer sur l'ancien
  // morceau pendant le chargement (1-3 s). Le vrai track:progress reprend la
  // main dès que la console joue le nouveau titre.
  const resetTimelineOptimistic = (): void =>
    setMasterProgress({ position_ms: 0, duration_ms: null, is_paused: true, at: Date.now() });
  const handleMasterSkip = (): Promise<void> =>
    masterCall(async () => {
      if (!identity || !currentRound) return;
      resetTimelineOptimistic();
      await masterSkipTrack(identity.sessionId, currentRound.id, identity.token);
    });
  const handleMasterNext = (): Promise<void> =>
    masterCall(async () => {
      if (!identity || !currentRound) return;
      resetTimelineOptimistic();
      await masterNextTrack(identity.sessionId, currentRound.id, identity.token);
    });
  const handleMasterPause = (): Promise<void> =>
    masterCall(async () => {
      if (!identity) return;
      await masterPause(identity.sessionId, identity.token);
    });
  const handleMasterResume = (): Promise<void> =>
    masterCall(async () => {
      if (!identity) return;
      await masterResume(identity.sessionId, identity.token);
    });
  const handleMasterRestart = (): Promise<void> =>
    masterCall(async () => {
      if (!identity || !currentRound) return;
      resetTimelineOptimistic();
      await masterRestartTrack(identity.sessionId, currentRound.id, identity.token);
    });
  // feat/relancer-le-son-telecommande — demande à la console de relancer le
  // son du morceau en cours (autoplay iOS bloqué, lecteur muet). N'altère
  // aucun état de jeu : ni position, ni phase, ni score.
  const handleMasterAudioKick = (): Promise<void> =>
    masterCall(async () => {
      if (!identity) return;
      await masterAudioKick(identity.sessionId, identity.token);
    });
  // feat/synced-lyrics — bouton Paroles (affichage MANUEL, morceau révélé).
  const handleToggleLyrics = (on: boolean): Promise<void> =>
    masterCall(async () => {
      if (!identity) return;
      await masterLyricsOverlay(identity.sessionId, identity.token, on);
    });
  const handleRejectLyrics = (): Promise<void> =>
    masterCall(async () => {
      if (!identity) return;
      await masterRejectLyrics(identity.sessionId, identity.token);
      setCurrentTrack((prev) => (prev ? { ...prev, lyrics_available: false } : prev));
    });
  // feat/manette-console-master — position de lecture RÉELLE : la console diffuse
  // sa position (track:progress). On l'interpole avec l'horloge locale. Fallback
  // sur started_at si pas encore de progress. C'est cette position réelle (et
  // non started_at, faux après un seek) qui sert de base au ±10s et au scrub.
  const currentPlaybackMs = (): number => {
    if (masterProgress) {
      const drift = masterProgress.is_paused ? 0 : Date.now() - masterProgress.at;
      return Math.max(0, masterProgress.position_ms + drift);
    }
    if (currentTrack?.started_at) {
      return Math.max(0, Date.now() - new Date(currentTrack.started_at).getTime());
    }
    return 0;
  };
  // ±10s relatifs à la position réelle. La console applique + rediffuse.
  const handleMasterSeek = (deltaMs: number): void => {
    void masterCall(async () => {
      if (!identity) return;
      await masterSeek(
        identity.sessionId,
        identity.token,
        Math.max(0, currentPlaybackMs() + deltaMs),
      );
    });
  };
  // Scrub tactile : position absolue (ms) depuis la barre de la télécommande.
  const handleMasterSeekTo = (ms: number): void => {
    void masterCall(async () => {
      if (!identity) return;
      await masterSeek(identity.sessionId, identity.token, Math.max(0, Math.round(ms)));
    });
  };
  // feat/master-volume — volume 0..1 depuis le slider de la manette → commande
  // serveur → la console applique sur son lecteur. Pas de masterCall (pas de
  // busy/erreur bloquante pour un réglage continu) : fire-and-forget silencieux.
  const handleMasterSetVolume = (v: number): void => {
    if (!identity) return;
    void masterSetVolume(identity.sessionId, identity.token, v).catch(() => {});
  };
  const handleMasterEndSession = (): Promise<void> =>
    masterCall(async () => {
      if (!identity) return;
      await masterEndSession(identity.sessionId, identity.token);
      // L'event session:ended fera basculer step → 'ended'
    });
  // F3 — terminer la manche courante depuis l'interface master mode B.
  const handleMasterEndRound = (): Promise<void> =>
    masterCall(async () => {
      if (!identity || !currentRound) return;
      await masterEndRound(identity.sessionId, currentRound.id, identity.token);
      // L'event round:ended déclenchera la transition vers intermission.
    });
  const handleMasterPickPlaylist = async (playlistId: string): Promise<void> => {
    setMasterPickerOpen(false);
    return masterCall(async () => {
      if (!identity) return;
      await masterPickRound(identity.sessionId, playlistId, identity.token);
    });
  };
  // feat/animator-full-control — l'animateur lance une playlist OFFICIELLE
  // (source + niveau) depuis son tel. Même effet que le launch host, son console.
  const handleMasterPickOfficial = async (
    playlistId: string,
    provider: 'youtube' | 'spotify' | 'apple_music',
    // fix/mix-em-types — LaunchLevel a gagné 'MIX_EM' (mix Facile/Moyen) en
    // 9a41413 ; cette signature n'avait pas suivi → build frontend cassé.
    difficulty?: 'EASY' | 'MEDIUM' | 'EXPERT' | 'MIX_EM',
  ): Promise<void> => {
    setMasterPickerOpen(false);
    return masterCall(async () => {
      if (!identity) return;
      await masterLaunchOfficial(
        identity.sessionId,
        playlistId,
        identity.token,
        provider,
        difficulty,
      );
    });
  };
  const handleMasterAdjust = async (args: {
    target_participant_id: string;
    delta: number;
    reason?: string;
  }): Promise<void> => {
    if (!identity) return;
    // fix/points-attribues-en-double — GARDE ET MESSAGE.
    // Contrairement à toutes les autres actions de la télécommande, celle-ci ne
    // passait pas par le verrou commun : rien ne bougeait à l'écran (le score
    // n'arrive qu'au message suivant), l'animateur retapait, et le joueur
    // recevait deux ou trois fois les points. Un échec, lui, ne se voyait nulle
    // part — on croyait avoir donné des points qui n'existaient pas.
    if (busy) return;
    setBusy(true);
    try {
      await masterAdjustPoints(identity.sessionId, identity.token, args);
    } catch (err: unknown) {
      console.error('[Télécommande] ajustement de points en échec :', err);
      setError('Points non attribués — réessaie');
    } finally {
      setBusy(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    // feat/telephone-au-style-tv — fond sombre de la TV sur tout le parcours.
    <div className="min-h-screen flex flex-col bg-[#0B0B0F] text-white">
      <MultiColorBar height="md" />
      {/* fix/prevent-safari-reader-mode — role="application" évite que Safari
          détecte la page joueur (peu de texte structuré) comme article éditorial
          et propose son mode Lecteur (casserait micro + buzz + animations). */}
      <main role="application" className="flex-1 px-4 py-3 flex items-start justify-center">
        <div className="w-full max-w-[500px]">
          <header className="mb-6 relative">
            <div className="absolute top-0 right-0">
              {identity && <ConnectionIndicator socket={socket} />}
            </div>
            <div className="text-center">
              <p
                className="mb-1 font-mono text-xs uppercase tracking-[0.28em]"
                style={{ color: TEL_CORAIL }}
              >
                {t('common.brand')}
              </p>
              {/* Pivot B2C — backend renvoie session.name (custom) ou "Tutti"
                  par défaut, jamais le nom d'établissement. */}
              <h1 className="font-display text-3xl leading-tight text-white">
                {view?.establishment_name ?? t('common.brand')}
              </h1>
              <p className="mt-2 font-mono text-xs tracking-[0.3em] text-white/45">{shortCode}</p>
              {currentRound && (
                <span className="mt-2 inline-block rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] text-white/70">
                  {t('play.roundBadge', {
                    n: currentRound.position,
                    name: currentRound.playlist.name,
                  })}
                </span>
              )}
            </div>
          </header>

          {error && (
            <div
              className="mb-4 rounded-2xl border px-4 py-3"
              style={{ backgroundColor: `${TEL_CORAIL}1a`, borderColor: `${TEL_CORAIL}55` }}
            >
              <p role="alert" className="text-sm font-medium" style={{ color: TEL_CORAIL }}>
                {error}
              </p>
            </div>
          )}

          {step === 'pseudo' && view?.status !== 'ENDED' && (
            <PanneauJoueur>
              <form onSubmit={handlePseudoSubmit} className="space-y-4">
                <p className="mb-2 text-center font-editorial italic text-white/60">
                  {t('play.pseudoTagline')}
                </p>
                <label className="block">
                  <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.22em] text-white/55">
                    {t('play.pseudoLabel')}
                  </span>
                  <input
                    type="text"
                    value={pseudo}
                    onChange={(e) => setPseudo(e.target.value)}
                    placeholder={t('play.pseudoPlaceholder')}
                    required
                    minLength={1}
                    maxLength={40}
                    autoFocus
                    className="w-full rounded-2xl border border-white/15 bg-white/[0.07] px-3.5 py-2.5 text-white placeholder:text-white/35 focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-[#FF5C4D]/50"
                  />
                </label>
                <BoutonJoueur type="submit" disabled={submitting || !pseudo.trim()}>
                  {view?.mode === 'TEAMS'
                    ? t('play.continueToTeam')
                    : t('play.continueToOnboarding')}
                </BoutonJoueur>
              </form>
            </PanneauJoueur>
          )}

          {step === 'team' && (
            <PanneauJoueur>
              <p className="mb-4 text-center font-editorial italic text-white/60">
                {t('play.chooseTeam')}
              </p>
              <ul className="space-y-2 mb-4">
                {teams.map((team) => (
                  <li key={team.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedTeam(team.id)}
                      aria-pressed={selectedTeam === team.id}
                      className={`min-h-[44px] w-full rounded-2xl border px-4 py-3 text-base font-bold transition-colors ${
                        selectedTeam === team.id
                          ? 'border-white/30 text-white'
                          : 'border-white/12 bg-white/[0.05] text-white/80 hover:bg-white/[0.1]'
                      }`}
                      style={selectedTeam === team.id ? { backgroundColor: team.color } : undefined}
                    >
                      {team.name}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <BoutonJoueur type="button" variante="fantome" onClick={() => setStep('pseudo')}>
                  {t('common.cancel')}
                </BoutonJoueur>
                <BoutonJoueur
                  type="button"
                  onClick={handleTeamSubmit}
                  disabled={!selectedTeam || submitting}
                >
                  {t('play.continueToOnboarding')}
                </BoutonJoueur>
              </div>
            </PanneauJoueur>
          )}

          {step === 'onboarding' && (
            <OnboardingScreen
              onContinue={handleOnboardingContinue}
              busy={micRequesting || submitting}
            />
          )}

          {step === 'onboardingCondensed' && (
            <OnboardingScreen
              condensed
              onContinue={handleOnboardingContinue}
              onShowFull={() => setStep('onboarding')}
              busy={micRequesting || submitting}
            />
          )}

          {step === 'micError' && (
            <MicPermissionErrorScreen
              onRetry={handleOnboardingContinue}
              busy={micRequesting || submitting}
            />
          )}

          {step === 'waiting' && identity && (
            <>
              <PanneauJoueur className="text-center">
                <p
                  className="mb-3 font-mono text-[11px] uppercase tracking-[0.28em]"
                  style={{ color: TEL_CORAIL }}
                >
                  {t('play.youAreIn')}
                </p>
                <h2 className="mb-2 font-display text-2xl leading-tight text-white">
                  {identity.pseudo}
                </h2>
                {identity.teamId && (
                  <span className="mb-4 inline-block rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] text-white/70">
                    {teams.find((t2) => t2.id === identity.teamId)?.name}
                  </span>
                )}
                <p className="mt-4 font-editorial italic text-white/60">
                  {t('play.waitingMessage')}
                </p>
                <p className="mt-3 font-mono text-xs text-white/45">
                  {participantsCount} {t('play.participantsConnected')}
                </p>
                <div className="relative mt-6 h-1 overflow-hidden rounded-full bg-white/[0.08]" aria-hidden>
                  <div
                    className="absolute inset-y-0 w-1/3 animate-pulse"
                    style={{ backgroundColor: TEL_CORAIL }}
                  />
                </div>
                {/* feat/tv-playlist-carousel — proposer une playlist depuis le
                  lobby. Modal qui charge le catalogue OfficialPlaylist + POST
                  /api/sessions/by-code/:short_code/proposals. */}
                <ProposePlaylistButton shortCode={shortCode} token={identity.token} />
              </PanneauJoueur>
              {/* feat/animator-full-control — l'animateur désigné lance la 1ʳᵉ manche
                  DEPUIS LE LOBBY (bibliothèque + niveau + source ou playlist perso).
                  Le backend passe la session WAITING → PLAYING. */}
              {isMaster && (
                <div
                  className="mt-4 rounded-[20px] border p-5 text-center"
                  style={{ backgroundColor: `${TEL_CORAIL}14`, borderColor: `${TEL_CORAIL}55` }}
                >
                  <div className="mb-2 flex items-center justify-center gap-2">
                    <span aria-hidden className="text-lg">
                      👑
                    </span>
                    <p className="font-display text-base text-white">{t('play.masterMenuTitle')}</p>
                  </div>
                  {/* feat/multi-animator-roles — profil animateur : FULL voit les
                      réponses en avance, PLAYING non (il peut jouer). */}
                  <p className="mb-1 font-mono text-[11px] uppercase tracking-wide text-white/55">
                    {myRole === 'ANIMATOR_FULL'
                      ? t('host.roleAnimatorFull')
                      : t('host.roleAnimatorPlaying')}
                  </p>
                  <p className="mb-3 font-editorial text-sm italic text-white/60">
                    Tu pilotes la partie — choisis une playlist et lance le blind test.
                  </p>
                  <BoutonJoueur type="button" onClick={() => setMasterPickerOpen(true)}>
                    🎬 Choisir une playlist &amp; démarrer
                  </BoutonJoueur>
                </div>
              )}
              {/* feat/rules — règles concises visibles dans le lobby avant la manche 1 */}
              <GameRules className="mt-4" sombre />
            </>
          )}

          {step === 'playing' && identity && view?.game_type === 'QUIZZ' && (
            <PlayQuizzView
              socket={socket}
              sessionId={identity.sessionId}
              participantId={identity.participantId}
              token={identity.token}
              pseudo={identity.pseudo}
              isMaster={isMaster}
              sessionStatus="PLAYING"
            />
          )}

          {step === 'playing' && identity && view?.game_type !== 'QUIZZ' && (
            <>
              {isPaused && (
                <PanneauJoueur className="mb-3 text-center">
                  <p className="font-display text-2xl text-white">⏸ {t('play.pausedTitle')}</p>
                  <p className="mt-1 font-editorial text-sm italic text-white/60">
                    {t('play.pausedHint')}
                  </p>
                </PanneauJoueur>
              )}
              <PlayingView
                currentTrack={currentTrack}
                identity={identity}
                myScore={myScore}
                correctAnswers={correctAnswers}
                lastReveal={lastReveal}
                phase2StartedAt={phase2StartedAt}
                busy={busy}
                setBusy={setBusy}
                teamName={teams.find((t2) => t2.id === identity.teamId)?.name ?? null}
                teamColor={teams.find((t2) => t2.id === identity.teamId)?.color ?? null}
                myRank={cumulative.findIndex((c) => c.id === identity.participantId) + 1 || null}
                cumulative={cumulative}
                totalParticipants={participantsCount}
                roundPosition={currentRound?.position ?? null}
                isMaster={isMaster}
                isPaused={isPaused}
                // fix/engrenage-mort — IL OUVRAIT UN PANNEAU DÉJÀ FERMÉ.
                // Le bouton ⚙ de l'animateur appelait la fermeture au lieu de
                // l'ouverture : aucun changement d'état, aucun rendu, bouton
                // parfaitement mort en soirée.
                onOpenMasterMenu={isMaster ? () => setMasterPickerOpen(true) : undefined}
                onMasterPause={isMaster ? handleMasterPause : undefined}
              />

              {/* feat/manette-console-master — plus de self-claim depuis le tel.
                  L'animateur est désigné DEPUIS LA CONSOLE (bouton « Nommer
                  animateur » à côté de chaque joueur). Un joueur désigné voit
                  le MasterMenu (télécommande) apparaître ci-dessous. */}

              {isMaster && (
                <div className="mt-4">
                  <MasterMenu
                    isPaused={isPaused}
                    currentTrack={currentTrack}
                    hasActiveRound={!!currentRound}
                    tracksTotal={currentRound?.playlist?.tracks_count ?? null}
                    busy={busy}
                    onReveal={handleMasterReveal}
                    onSkipTrack={handleMasterSkip}
                    onNextTrack={handleMasterNext}
                    onPause={handleMasterPause}
                    onResume={handleMasterResume}
                    onRestartTrack={handleMasterRestart}
                    onAudioKick={() => void handleMasterAudioKick()}
                    onSeekBack={() => handleMasterSeek(-10_000)}
                    onSeekForward={() => handleMasterSeek(10_000)}
                    onSeekTo={handleMasterSeekTo}
                    onSetVolume={handleMasterSetVolume}
                    progress={masterProgress}
                    lyricsAvailable={
                      !!currentTrack?.lyrics_available &&
                      (currentTrack.phase === 'phase3' || currentTrack.phase === 'phase3-revealed')
                    }
                    lyricsOn={lyricsOn}
                    onToggleLyrics={(on) => void handleToggleLyrics(on)}
                    onRejectLyrics={() => void handleRejectLyrics()}
                    onEndRound={handleMasterEndRound}
                    onEndSession={handleMasterEndSession}
                    onPickRound={() => setMasterPickerOpen(true)}
                    onAdjustPoints={() => setAdjustSheetOpen(true)}
                    players={participantsList
                      .filter((p) => !p.is_kicked)
                      .map((p) => ({
                        id: p.id,
                        pseudo: p.pseudo,
                        score: cumulative.find((c) => c.id === p.id)?.total_points ?? 0,
                      }))}
                    onQuickAdjust={(pid, delta) =>
                      void handleMasterAdjust({ target_participant_id: pid, delta })
                    }
                  />
                </div>
              )}
            </>
          )}

          {step === 'ended' && (
            <PanneauJoueur className="text-center">
              <h2 className="mb-2 font-display text-2xl text-white">{t('play.endedTitle')}</h2>
              <p className="font-editorial italic text-white/60">{t('play.endedHint')}</p>
              {/* feat/classement-final-persistant — l'animateur ferme le podium
                  final (TV + console) depuis son téléphone, quand il le décide. */}
              {isMaster && identity && (
                <button
                  type="button"
                  disabled={podiumFermeture}
                  onClick={() => {
                    setPodiumFermeture(true);
                    void masterHidePodium(identity.sessionId, identity.token)
                      .catch(() => setError('Fermeture impossible — réessaie'))
                      .finally(() => setPodiumFermeture(false));
                  }}
                  className="mt-5 w-full rounded-2xl border border-white/15 py-3 font-display text-lg text-white/80 transition-colors hover:bg-white/[0.06] active:translate-y-0.5 disabled:opacity-40"
                >
                  ✕ FERMER LE CLASSEMENT
                </button>
              )}
            </PanneauJoueur>
          )}
        </div>
      </main>

      {showRules && step === 'playing' && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-5 animate-fade-in backdrop-blur-sm">
          <div className={`${TEL_PANNEAU} w-full max-w-sm p-6`}>
            <p className="mb-4 text-center font-display text-2xl text-white">Comment répondre 🎤</p>
            <ul className="space-y-3 font-editorial text-base leading-snug text-white/80">
              <li>
                🎵 Dis le <strong>TITRE</strong>, l'<strong>ARTISTE</strong> — ou les deux (les deux
                = plus de points).
              </li>
              <li>
                📱 Parle <strong>près du micro</strong> de ton téléphone, bien fort.
              </li>
              <li>
                🤫 Arrête de parler quand tu as fini : l'envoi part <strong>tout seul</strong>. Tu
                peux aussi appuyer sur <strong>ENVOYER</strong>.
              </li>
              <li>
                ⚡ Raté ? Tu peux <strong>re-buzzer aussitôt</strong>.
              </li>
            </ul>
            <button
              type="button"
              onClick={() => setShowRules(false)}
              className="mt-5 w-full rounded-2xl py-3 font-display text-xl text-[#0B0B0F] transition-transform active:scale-[0.98]"
              style={{ backgroundColor: TEL_CORAIL }}
            >
              C'EST PARTI !
            </button>
          </div>
        </div>
      )}

      {identity && (
        <MasterPlaylistPicker
          open={masterPickerOpen}
          sessionId={identity.sessionId}
          token={identity.token}
          onClose={() => setMasterPickerOpen(false)}
          onPick={(pid) => void handleMasterPickPlaylist(pid)}
          onPickOfficial={(pid, provider, difficulty) =>
            void handleMasterPickOfficial(pid, provider, difficulty)
          }
        />
      )}

      {identity && (
        <MasterAdjustPointsSheet
          open={adjustSheetOpen}
          participants={participantsList
            .filter((p) => !p.is_kicked)
            .map<ParticipantOption>((p) => ({
              id: p.id,
              pseudo: p.pseudo,
              team_id: p.team_id,
              total_points: cumulative.find((c) => c.id === p.id)?.total_points ?? 0,
            }))}
          onClose={() => setAdjustSheetOpen(false)}
          onConfirm={async (args) => {
            await handleMasterAdjust(args);
            // Rafraîchit la cumulative localement pour refléter le delta
            try {
              const c = await masterListScores(identity.sessionId, identity.token);
              setCumulative(c);
            } catch {
              /* ignore */
            }
          }}
        />
      )}

      <div className="fixed bottom-4 right-4 z-40 space-y-2 max-w-[280px]">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`rounded-2xl border border-white/12 bg-[#191922]/95 px-3 py-2 text-sm font-medium text-white shadow-[0_18px_50px_rgba(0,0,0,0.6)] backdrop-blur ${
              toast.fading ? 'animate-fade-out' : 'animate-pop-in'
            } ${
              toast.tone === 'basil'
                ? 'border-l-4 border-l-[#4ade80]'
                : toast.tone === 'spritz'
                  ? 'border-l-4 border-l-[#FF5C4D]'
                  : 'border-l-4 border-l-[#FF5C4D]'
            }`}
          >
            {toast.text}
          </div>
        ))}
      </div>

      <MultiColorBar height="md" />
    </div>
  );
}

function pushToast(
  set: React.Dispatch<React.SetStateAction<Toast[]>>,
  text: string,
  tone: Toast['tone'],
): void {
  const id = crypto.randomUUID();
  set((prev) => [...prev, { id, text, tone }]);
  // Bonus — fade-out après 2.5s, retrait du DOM à 3s.
  window.setTimeout(() => {
    set((prev) => prev.map((tt) => (tt.id === id ? { ...tt, fading: true } : tt)));
  }, 2500);
  window.setTimeout(() => {
    set((prev) => prev.filter((tt) => tt.id !== id));
  }, 3000);
}

// ── Vue de jeu voice-first (Phase C) ───────────────────────────────────────

type RecState =
  | { kind: 'idle' }
  | {
      kind: 'recording';
      capture: VoiceCapture;
      startedAt: number;
      level: number;
      // fix/compte-a-rebours-faux — la durée réelle vient du serveur.
      windowMs: number;
    }
  | { kind: 'uploading' }
  | { kind: 'result'; result: VoiceAnswerResult };

interface PlayingViewProps {
  currentTrack: CurrentTrackState | null;
  identity: ParticipantContext;
  myScore: number;
  /** Réponses correctes accumulées sur le track courant (broadcast track:correct_answer). */
  correctAnswers: CorrectAnswerEntry[];
  /** Reveal master (phase3-revealed) ou null si phase3 normale. */
  lastReveal: {
    artist: string;
    title: string;
    song_title?: string | null;
    cover_url?: string | null;
  } | null;
  /** Phase 2 a démarré à cette date — pour calculer le chrono côté UI. */
  phase2StartedAt: string | null;
  busy: boolean;
  setBusy: (v: boolean) => void;
}

/**
 * feat/telephone-au-style-tv — briques communes a TOUS les ecrans du
 * telephone (accueil, salle d attente, fin de partie), au meme langage
 * visuel que la TV. Les composants generiques Card / Button / Input sont
 * partages avec le back-office : on ne les touche pas, on pose ici des
 * equivalents sombres propres a l ecran joueur.
 */
function PanneauJoueur({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return <div className={`${TEL_PANNEAU} p-5 ${className}`}>{children}</div>;
}

function BoutonJoueur({
  children,
  variante = 'corail',
  ...rest
}: {
  children: ReactNode;
  variante?: 'corail' | 'fantome';
} & React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  const base =
    'w-full rounded-2xl px-4 py-3 font-bold transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40';
  if (variante === 'fantome') {
    return (
      <button {...rest} className={`${base} border border-white/15 text-white/75 hover:bg-white/[0.06]`}>
        {children}
      </button>
    );
  }
  return (
    <button {...rest} className={`${base} text-[#0B0B0F]`} style={{ backgroundColor: TEL_CORAIL }}>
      {children}
    </button>
  );
}

/**
 * feat/telephone-au-style-tv — pose le fond sombre sur le document entier
 * pendant qu on est sur l ecran joueur, et le retire en sortant. Sans ca,
 * la page passait en sombre mais le document restait creme : bandes claires
 * au rebond iOS et texture papier par-dessus un ecran sombre.
 */
export function useFondJoueurSombre(actif = true): void {
  useEffect(() => {
    if (!actif) return;
    document.documentElement.classList.add('theme-joueur');
    return () => document.documentElement.classList.remove('theme-joueur');
  }, [actif]);
}

// feat/telephone-au-style-tv — MEMES CODES VISUELS QUE L ECRAN DE LA SALLE.
// Demande de Thomas apres la soiree du 11/09 : le telephone des joueurs doit
// reprendre le style de la TV. On reutilise donc les memes valeurs que
// TvScreenView plutot que la charte claire « Pop Cocktail » : fond tres
// sombre, panneaux gris-bleu a filet blanc, corail pour l accent, et le
// meme trio de polices (display / editorial / mono).
const TEL_CORAIL = '#FF5C4D';
const TEL_PANNEAU =
  'rounded-[20px] bg-[#191922] border border-white/[0.07] shadow-[0_18px_50px_rgba(0,0,0,0.5)]';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';

interface PlayingViewExtraProps {
  /** Couleur de l'équipe du joueur (mode TEAMS). */
  teamColor?: string | null;
  /** Nom de l'équipe du joueur (mode TEAMS). */
  teamName?: string | null;
  /** Position cumulée du joueur dans le classement (1-based, null si inconnu). */
  myRank: number | null;
  /** Total de joueurs en jeu (footer). */
  totalParticipants: number;
  /** Position de la manche en cours (badge header). */
  roundPosition: number | null;
  /** True si le joueur est master (affiche l'icône Modérer). */
  isMaster: boolean;
  /** Callback pour ouvrir le menu master. */
  onOpenMasterMenu?: () => void;
  /** Callback pour le bouton pause (master uniquement V1). */
  onMasterPause?: () => void;
  /** Pause active (overlay). */
  isPaused: boolean;
  /** Classement cumule de la partie — sert au classement du titre (animateur). */
  cumulative: CumulativeScore[];
}

export function PlayingView(props: PlayingViewProps & PlayingViewExtraProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const {
    currentTrack,
    identity,
    myScore,
    correctAnswers,
    lastReveal,
    phase2StartedAt,
    teamName,
    teamColor,
    myRank,
    totalParticipants,
    roundPosition,
    isMaster,
    onOpenMasterMenu,
    onMasterPause,
    isPaused,
    cumulative,
  } = props;
  const [recState, setRecState] = useState<RecState>({ kind: 'idle' });
  const [buzzCooldownUntil, setBuzzCooldownUntil] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Refonte #2 — toast top "Pas reconnu" quand voice fail, retour buzzer direct
  const [failToast, setFailToast] = useState<string | null>(null);

  // feat/voice-cascade-l1-l2 — niveau 1 cascade : Web Speech API. Démarré en
  // parallèle du MediaRecorder dans handleBuzz, stoppé dans uploadAndShowResult
  // pour exploiter son transcript (instantané) avant éventuelle escalade L2.
  // Le code langue suit i18n.language : 'fr' → 'fr-FR', sinon 'en-US'.
  const webSpeechLang = i18n.language?.toLowerCase().startsWith('fr') ? 'fr-FR' : 'en-US';
  const webSpeech = useWebSpeech({ lang: webSpeechLang });
  // fix/ios-voice-cascade-mic-and-buzz-refused — stream micro persistant. UN
  // SEUL getUserMedia() pour toute la session, évite le popup système iOS à
  // chaque morceau (Bug #1) et le stream mort au morceau 2 (Bug #3).
  const mic = useMicStream();

  // Auto-clear fail toast 1.5s
  useEffect(() => {
    if (!failToast) return;
    const id = window.setTimeout(() => setFailToast(null), 1500);
    return () => window.clearTimeout(id);
  }, [failToast]);

  /** Minuteur de fin d'enregistrement, annulable. */
  const autoStopRef = useRef<number | null>(null);

  // Reset le state d'enregistrement à chaque nouveau track — ET à chaque
  // « Recommencer » du même track.
  //
  // fix/rejouer-apres-recommencer — Test du 11/09 09:40 : le joueur avait
  // trouvé (écran « résultat »), l'animateur a appuyé sur Recommencer, et le
  // téléphone est resté bloqué : aucun buzz n'est parti (rien côté serveur).
  // Cet effet ne se déclenchait que sur un changement de `track_id` ; un
  // Recommencer garde le même morceau, seul `started_at` change. L'état
  // « résultat » restait donc en place et le buzzer restait désactivé
  // (`recState.kind !== 'idle'`). On écoute aussi `started_at`.
  useEffect(() => {
    // fix/micro-qui-fuit — ON ANNULE VRAIMENT LA CAPTURE EN COURS.
    // Passer l'état à « repos » ne fermait ni le micro, ni l'analyseur audio,
    // ni la mesure de niveau à 10 Hz : chaque morceau abandonné laissait
    // derrière lui une boucle vivante qui perturbait l'enregistrement suivant
    // et faisait chauffer le téléphone. Au bout de quelques morceaux, le
    // navigateur refusait même d'ouvrir un nouvel analyseur.
    if (autoStopRef.current !== null) {
      window.clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    setRecState((prev) => {
      if (prev.kind === 'recording') prev.capture.cancel();
      return { kind: 'idle' };
    });
    setError(null);
    setBuzzCooldownUntil(0);
    setFailToast(null);
  }, [currentTrack?.track_id, currentTrack?.started_at]);

  // Démontage (fin de partie, fermeture) : on relâche tout.
  useEffect(() => {
    return () => {
      if (autoStopRef.current !== null) window.clearTimeout(autoStopRef.current);
      setRecState((prev) => {
        if (prev.kind === 'recording') prev.capture.cancel();
        return { kind: 'idle' };
      });
    };
  }, []);

  // À l'entrée en phase 3 (reveal global), on sort de l'écran "résultat" pour
  // laisser apparaître le reveal commun (artiste + titre + scores). Le branch
  // phase 3 ci-dessous prend le relais.
  useEffect(() => {
    const phase = currentTrack?.phase;
    if (
      (phase === 'phase3' || phase === 'phase3-revealed' || phase === 'phase3-skipped') &&
      recState.kind === 'result'
    ) {
      setRecState({ kind: 'idle' });
    }
  }, [currentTrack?.phase, recState.kind]);

  const myCorrect = correctAnswers.find((a) => a.participant_id === identity.participantId);
  const totalScore = myScore + (myCorrect ? 0 : 0); // myScore est déjà additionné via socket
  const phase = currentTrack?.phase ?? null;
  const isPhase1 = phase === 'phase1';
  const isPhase2 = phase === 'phase2';
  const isPhase3Reveal = phase === 'phase3' || phase === 'phase3-revealed';
  const isPhase3 = isPhase3Reveal || phase === 'phase3-skipped';

  // ── Action : tap BUZZ → ouvre le micro et démarre la capture ──────────
  const handleBuzz = async (): Promise<void> => {
    if (!currentTrack) return;
    if (recState.kind !== 'idle') return;
    if (Date.now() < buzzCooldownUntil) return;

    setError(null);
    // fix/rebuzz-rapide — aligné sur le serveur (400 ms).
    setBuzzCooldownUntil(Date.now() + 400);

    try {
      const buzzRes = await postBuzz(identity.sessionId, currentTrack.round_id, identity.token);
      const maxDurationMs = (buzzRes as { buzz_window_ms?: number }).buzz_window_ms ?? 10_000;

      console.info(
        `[Voice] Recording started | webSpeech.supported=${webSpeech.supported} lang=${webSpeechLang}`,
      );

      // feat/voice-cascade-l1-l2 — démarre Web Speech EN PARALLÈLE du
      // MediaRecorder. Coût quasi-nul si supporté, ignoré sinon (Firefox).
      // Le transcript sera lu dans uploadAndShowResult après stop().
      //
      // fix/ios-voice-cascade-mic-and-buzz-refused — sur iOS, on SKIP L1
      // (SpeechRecognition trop instable + concurrence le MediaRecorder pour
      // l'accès micro → souvent throw "InvalidStateError" ou retour vide).
      // On va direct L2 Deepgram. ~300ms de latence ajoutés (acceptable) en
      // échange d'un taux de match nettement meilleur.
      const shouldSkipL1 = mic.isiOS;
      if (webSpeech.supported && !shouldSkipL1) {
        webSpeech.start();
      } else if (shouldSkipL1) {
        console.info('[Voice] iOS detected — skipping L1 Web Speech, direct L2 Deepgram');
      }

      // fix/ios-voice-cascade-mic-and-buzz-refused — healthcheck du stream
      // persistant avant chaque buzz. Si mort (iOS background prolongé), on
      // re-init en transparence avant de démarrer la capture.
      if (!mic.isLive()) {
        console.warn('[Voice] Mic stream not live — reinit before capture');
        // diag/telephones-en-difficulte — jusqu ici ces evenements ne
        // quittaient jamais le telephone : le soir du 10/09, impossible de
        // dire pourquoi certains appareils « n arrivaient pas a buzzer ».
        // Chaque reprise du micro part au journal serveur, avec l appareil.
        remoteLog('micro', 'micro inutilisable avant le buzz — reprise', { pseudo: identity.pseudo }, 'warn');
        await mic.reinit();
      }
      const persistentStream = mic.getStream();
      const capture = await startVoiceCapture({
        maxDurationMs,
        // Passe le stream persistant pour éviter le popup système iOS à chaque
        // buzz (sinon getUserMedia ré-évalué par WebKit). Si null (permission
        // pas encore accordée), voiceCapture créera son propre stream legacy.
        stream: persistentStream ?? undefined,
        // Optim Whisper — VAD agressif (500ms silence après speech) cut early
        // dès que le joueur a fini de parler, sans attendre les 10s max.
        onSilence: () => {
          console.info('[Voice] VAD detected silence → cut');
          void finalizeRecording();
        },
        onLevel: (rms) => {
          setRecState((prev) => (prev.kind === 'recording' ? { ...prev, level: rms } : prev));
        },
      });

      setRecState({
        kind: 'recording',
        capture,
        startedAt: Date.now(),
        level: 0,
        windowMs: maxDurationMs,
      });

      // fix/enregistrement-coupe — LE MINUTEUR EST MÉMORISÉ ET ANNULÉ.
      // Il n'était stocké nulle part : celui du buzz précédent survivait au
      // changement de morceau et coupait l'enregistrement du buzz suivant en
      // pleine phrase, envoyant un extrait tronqué rejeté sans explication.
      if (autoStopRef.current !== null) window.clearTimeout(autoStopRef.current);
      autoStopRef.current = window.setTimeout(() => {
        autoStopRef.current = null;
        void finalizeRecording();
      }, maxDurationMs + 200);
    } catch (err: unknown) {
      // fix/ios-voice-cascade-mic-and-buzz-refused — utilise ApiError.code
      // typé (vs ancienne logique `msg.includes()` fragile) pour mapper le
      // refus serveur sur un message i18n précis. Couvre tous les enum :
      // NO_TRACK, PHASE_LOCKED, COOLDOWN, ALREADY_BUZZING, ALREADY_ANSWERED,
      // PARTICIPANT_INVALID, VALIDATION_ERROR.
      const code =
        err instanceof ApiError ? err.code : err instanceof Error ? err.message : 'UNKNOWN';
      console.warn(
        `[Voice] Buzz refused | code=${code} | message=${err instanceof Error ? err.message : String(err)}`,
      );
      remoteLog('buzz', 'buzz refuse', { pseudo: identity?.pseudo, code, message: err instanceof Error ? err.message : String(err) }, 'warn');
      setError(translateBuzzRefusalReason(code, t));
      // fix/deuxieme-appui-qui-casse-le-premier — ON N'ÉCRASE QUE SON PROPRE
      // ÉTAT. Ce retour à l'état de repos était inconditionnel : quand le
      // joueur appuyait une seconde fois (le premier appui ne montrant rien
      // pendant que le réseau répond), le refus du second effaçait
      // l'enregistrement que le premier venait de démarrer. Le micro, lui,
      // continuait de tourner sans que rien ne puisse l'arrêter.
      setRecState((prev) => (prev.kind === 'recording' ? prev : { kind: 'idle' }));
      // Si le serveur avait accepté le buzz mais que la capture a échoué, il
      // faut refermer la fenêtre côté serveur, sinon le joueur est bloqué
      // pendant toute sa durée sans pouvoir retenter.
      if (!(err instanceof ApiError) && identity && currentTrack) {
        void cancelVoiceBuzz(identity.sessionId, currentTrack.round_id, identity.token).catch(
          () => undefined,
        );
      }
    }
  };

  /**
   * fix/ios-voice-cascade-mic-and-buzz-refused — résout un code d'erreur
   * backend ("NO_TRACK", "PHASE_LOCKED"…) en message i18n explicite. Default
   * = `buzzReason.refused` (générique) si code inconnu, pour ne pas afficher
   * un message tech au joueur.
   */
  function translateBuzzRefusalReason(code: string, tFn: typeof t): string {
    switch (code) {
      case 'NO_TRACK':
        return tFn('play.buzzReason.noTrack');
      case 'PHASE_LOCKED':
        return tFn('play.tooLate');
      case 'COOLDOWN':
        return tFn('play.buzzReason.cooldown');
      case 'ALREADY_BUZZING':
        return tFn('play.buzzReason.alreadyBuzzing');
      case 'ALREADY_ANSWERED':
        return tFn('play.alreadyAnswered');
      case 'PARTICIPANT_INVALID':
        return tFn('play.buzzReason.participantInvalid');
      default:
        return tFn('play.buzzReason.refused');
    }
  }

  const finalizeRecording = async (): Promise<void> => {
    if (autoStopRef.current !== null) {
      window.clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    setRecState((prev) => {
      if (prev.kind !== 'recording') return prev;
      void uploadAndShowResult(prev.capture);
      return { kind: 'uploading' };
    });
  };

  /**
   * feat/voice-cascade-l1-l2 — pipeline cascade :
   *   L1 — Web Speech transcript (0ms réseau) → POST /voice-match-text
   *        score ≥ 80 → ✅ matched (broadcast déjà fait backend)
   *        score < 30 → ❌ abandon (pas d'upload audio)
   *        sinon       → escalade L2
   *   L2 — Upload audio → POST /voice-transcribe-deepgram
   *        backend appelle Deepgram (Nova-3 + keyterms) puis Whisper en
   *        fallback si Deepgram timeout/erreur (transparent côté client).
   *   L3 — Si L2 throw (erreur réseau totale), legacy /voice-answer (Whisper)
   *        comme dernier filet de sécurité.
   *
   * Logs structurés [Voice] L1/L2/FINAL pour debug latence.
   */
  const uploadAndShowResult = async (capture: VoiceCapture): Promise<void> => {
    if (!currentTrack) return;
    const t0 = Date.now();
    console.info('[Voice] Recording stopped — cascade start');

    let blob: Blob;
    let webSpeechTranscript = '';
    let webSpeechSupported = false;
    try {
      // Finalise audio + récup transcript Web Speech en parallèle.
      // fix/ios-voice-cascade-mic-and-buzz-refused — sur iOS, L1 a été skipped
      // dans handleBuzz, donc on retourne un transcript vide sans appeler
      // webSpeech.stop() (qui throw si jamais start() pas appelé).
      const wsStopPromise =
        webSpeech.supported && !mic.isiOS
          ? webSpeech.stop()
          : Promise.resolve({
              transcript: '',
              supported: false,
              elapsedMs: 0,
              error: undefined,
            });
      // fix/analyse-qui-ne-finit-pas — LA RECONNAISSANCE DU NAVIGATEUR NE PEUT
      // PLUS BLOQUER LA SUITE. Sa promesse d'arrêt n'est résolue que par un
      // événement du moteur (hébergé chez Google) : si cet événement n'arrive
      // pas — perte de réseau au mauvais moment — toute la chaîne restait en
      // attente et le joueur voyait « analyse » jusqu'au morceau suivant. Ce
      // niveau n'est qu'un gain de rapidité : au-delà de 1,5 s on s'en passe.
      const wsStopBorne = Promise.race([
        wsStopPromise,
        new Promise<Awaited<typeof wsStopPromise>>((resolve) =>
          window.setTimeout(
            () => resolve({ transcript: '', supported: false, elapsedMs: 1500, error: undefined }),
            1500,
          ),
        ),
      ]);
      const [blobResult, wsResult] = await Promise.all([capture.stop(), wsStopBorne]);
      blob = blobResult;
      webSpeechTranscript = wsResult.transcript;
      webSpeechSupported = wsResult.supported;
      const sizeKb = Math.round(blob.size / 1024);
      console.info(
        `[Voice] Audio size=${sizeKb}KB | webSpeech.supported=${wsResult.supported} transcript="${wsResult.transcript.slice(0, 80)}" elapsedMs=${wsResult.elapsedMs} err=${wsResult.error ?? '-'}`,
      );
    } catch (err: unknown) {
      console.error('[Voice] Capture stop failed:', err);
      remoteLog('micro', 'capture echouee', { pseudo: identity.pseudo, erreur: err instanceof Error ? err.message : String(err) }, 'error');
      setError(err instanceof Error ? err.message : 'Capture échouée');
      setRecState({ kind: 'idle' });
      webSpeech.cancel();
      return;
    }

    // fix/telephone-bloque-sur-enregistrement-vide — ON N ENVOIE PAS DU VIDE.
    //
    // Soiree du 10/09 : plusieurs buzz d un meme iPhone partent a 0 Ko. Le
    // serveur les transmettait a Deepgram, puis Whisper, puis AssemblyAI —
    // trois refus en cascade, chacun avec son delai reseau — et le telephone
    // restait bloque sur l ecran d attente. Un buzz reel pese 6 a 33 Ko ; sous
    // 1 Ko il n y a pas de parole. On rend la main tout de suite, le joueur
    // rebuzze sans attendre. Le serveur applique la meme garde de son cote,
    // pour les clients qui n auraient pas cette version.
    if (blob.size < 1024) {
      console.warn(`[Voice] enregistrement vide (${blob.size} o) — rien envoye`);
      remoteLog('micro', 'enregistrement vide', { pseudo: identity.pseudo, octets: blob.size, mime: capture.mimeType }, 'warn');
      setRecState({ kind: 'idle' });
      setFailToast(t('play.nothingHeard'));
      webSpeech.cancel();
      return;
    }

    const filename = capture.mimeType.includes('mp4') ? 'buzz.mp4' : 'buzz.webm';
    let finalResult: CascadeMatchResponse | null = null;
    let finalLevel: 'L1' | 'L2' | 'L3' | 'L3-fallback' | 'L3-legacy-whisper' | null = null;
    // feat/voice-cascade-l3-assemblyai — seuil d'escalade L2 → L3. Si Deepgram
    // a retourné un score sous ce seuil, on tente AssemblyAI Universal-2 qui
    // est meilleur sur accents prononcés / audio bruité. Au-dessus, on
    // considère que c'est probablement une mauvaise réponse, pas un problème
    // de transcription — AssemblyAI ne sauvera pas le coup.
    const L3_ESCALATE_THRESHOLD = 50;

    // ── L1 — Web Speech ──────────────────────────────────────────────────
    if (webSpeechSupported && webSpeechTranscript.trim().length > 0) {
      const tL1Start = Date.now();
      try {
        const l1 = await postVoiceMatchText({
          apiUrl: API_BASE,
          sessionId: identity.sessionId,
          roundId: currentTrack.round_id,
          token: identity.token,
          // fix/reponse-comptee-sur-le-mauvais-titre — le morceau visé part avec
          // la réponse : si l'animateur enchaîne pendant la transcription, le
          // serveur écarte la réponse au lieu de la compter sur le titre suivant.
          trackId: currentTrack.track_id,
          transcript: webSpeechTranscript,
          source: 'web-speech',
        });
        const tL1 = Date.now() - tL1Start;
        const decision = l1.matched
          ? 'matched'
          : l1.score < l1.give_up_threshold
            ? 'reject'
            : 'escalate';
        console.info(
          `[Voice] L1 Web Speech: "${webSpeechTranscript.slice(0, 60)}" score=${l1.score}% → ${decision} (latency=${tL1}ms)`,
        );

        if (l1.matched) {
          finalResult = l1;
          finalLevel = 'L1';
        } else if (l1.score < l1.give_up_threshold) {
          // Abandon — économise un upload audio inutile.
          console.info(
            `[Voice] FINAL: matched=false level=L1 latency=${Date.now() - t0}ms (give up)`,
          );
          setRecState({ kind: 'idle' });
          setFailToast(t('play.notMatchedShort'));
          return;
        }
        // 30 ≤ score < 80 → escalade L2 (continue ci-dessous).
      } catch (err: unknown) {
        console.warn('[Voice] L1 request failed → escalade L2', err);
      }
    } else {
      console.info(
        `[Voice] L1 skip — supported=${webSpeechSupported} transcript=${JSON.stringify(webSpeechTranscript)}`,
      );
    }

    // ── L2 — Deepgram (backend, Whisper fallback intégré) ────────────────
    if (!finalResult) {
      const tL2Start = Date.now();
      try {
        const l2 = await postVoiceTranscribeDeepgram({
          apiUrl: API_BASE,
          sessionId: identity.sessionId,
          roundId: currentTrack.round_id,
          token: identity.token,
          // fix/reponse-comptee-sur-le-mauvais-titre — le morceau visé part avec
          // la réponse : si l'animateur enchaîne pendant la transcription, le
          // serveur écarte la réponse au lieu de la compter sur le titre suivant.
          trackId: currentTrack.track_id,
          audio: blob,
          filename,
        });
        const tL2 = Date.now() - tL2Start;
        const l2Decision = l2.matched
          ? 'matched'
          : l2.score < L3_ESCALATE_THRESHOLD
            ? 'escalate-l3'
            : 'reject';
        console.info(
          `[Voice] L2 ${l2.level}: "${l2.transcript.slice(0, 60)}" score=${l2.score}% → ${l2Decision} (latency=${tL2}ms)`,
        );
        finalResult = l2;
        finalLevel = l2.level; // 'L2' ou 'L3-fallback' (Whisper interne)

        // ── L3 — AssemblyAI Universal-2 + word_boost ───────────────────
        // Escalade UNIQUEMENT si L2 a renvoyé un score franchement bas (sous
        // L3_ESCALATE_THRESHOLD). Au-dessus on suppose mauvaise réponse, pas
        // mauvaise transcription — AssemblyAI ne corrigera rien.
        if (!l2.matched && l2.score < L3_ESCALATE_THRESHOLD) {
          const tL3Start = Date.now();
          try {
            const l3 = await postVoiceTranscribeAssemblyAI({
              apiUrl: API_BASE,
              sessionId: identity.sessionId,
              roundId: currentTrack.round_id,
              token: identity.token,
              // fix/reponse-comptee-sur-le-mauvais-titre — le morceau visé part avec
              // la réponse : si l'animateur enchaîne pendant la transcription, le
              // serveur écarte la réponse au lieu de la compter sur le titre suivant.
              trackId: currentTrack.track_id,
              audio: blob,
              filename,
            });
            const tL3 = Date.now() - tL3Start;
            console.info(
              `[Voice] L3 ${l3.level}: "${l3.transcript.slice(0, 60)}" score=${l3.score}% → ${l3.matched ? 'matched' : 'reject'} (latency=${tL3}ms backend=${l3.latency_ms ?? '-'}ms)`,
            );
            finalResult = l3;
            finalLevel = l3.level;
          } catch (err: unknown) {
            if (err instanceof AssemblyAIDisabledError) {
              // Feature flag off côté Railway — pas d'escalade L3, on garde
              // le résultat L2 (reject) et on conclut "rejeté".
              console.info('[Voice] L3 skip — AssemblyAI disabled by env flag');
            } else {
              console.warn('[Voice] L3 AssemblyAI failed → keep L2 reject result', err);
            }
            // Pas de fallback supplémentaire — L2 reject reste la conclusion.
          }
        }
      } catch (err: unknown) {
        // L3 — Filet de sécurité : legacy /voice-answer (Whisper, route en
        // place depuis Phase C). Ne devrait jamais être atteint en pratique
        // car L2 fallback déjà Whisper côté backend, mais ceinture+bretelles.
        console.warn(
          '[Voice] L2 endpoint unreachable → legacy Whisper fallback /voice-answer',
          err,
        );
        try {
          const w = await uploadVoiceAnswer({
            apiUrl: API_BASE,
            sessionId: identity.sessionId,
            roundId: currentTrack.round_id,
            token: identity.token,
            audio: blob,
            filename,
          });
          console.info(
            `[Voice] L3 legacy Whisper: matched=${w.matched} score=${w.score ?? '-'} latency=${Date.now() - t0}ms`,
          );
          if (!w.matched) {
            setRecState({ kind: 'idle' });
            setFailToast(t('play.notMatchedShort'));
            return;
          }
          setRecState({ kind: 'result', result: w });
          console.info(
            `[Voice] FINAL: matched=true level=L3-legacy-whisper latency=${Date.now() - t0}ms`,
          );
          return;
        } catch (err2: unknown) {
          console.error('[Voice] Legacy fallback failed:', err2);
          setError(err2 instanceof Error ? err2.message : 'Upload échoué');
          setRecState({ kind: 'idle' });
          return;
        }
      }
    }

    // ── Final dispatch ───────────────────────────────────────────────────
    if (!finalResult) {
      // Sécurité (ne devrait pas arriver).
      setRecState({ kind: 'idle' });
      setFailToast(t('play.notMatchedShort'));
      return;
    }
    console.info(
      `[Voice] FINAL: matched=${finalResult.matched} level=${finalLevel} score=${finalResult.score}% latency=${Date.now() - t0}ms`,
    );

    if (!finalResult.matched) {
      setRecState({ kind: 'idle' });
      // fix/panne-invisible — on distingue « je ne t'ai pas compris » d'une
      // panne du service de reconnaissance : le joueur ne doit pas croire
      // qu'il s'est trompé, ni chercher un problème sur son téléphone.
      setFailToast(
        finalResult.reason === 'RECONNAISSANCE_INDISPONIBLE'
          ? 'Reconnaissance indisponible — préviens l’animateur'
          : t('play.notMatchedShort'),
      );
      return;
    }

    // Convert CascadeMatchResponse → VoiceAnswerResult (shape attendu par
    // le RecState 'result' et l'UI 'ValidatedBanner' qui consomme score +
    // breakdown).
    const legacyShape: VoiceAnswerResult = {
      matched: finalResult.matched,
      scored: finalResult.scored,
      transcript: finalResult.transcript,
      position: finalResult.position,
      score: finalResult.total_score,
      breakdown: finalResult.breakdown,
      reason: finalResult.reason,
    };
    setRecState({ kind: 'result', result: legacyShape });
  };

  const handleCancelRec = (): void => {
    // fix/rebuzz-refuse — on prévient le serveur, sinon la fenêtre de buzz
    // reste ouverte 10 s et le joueur ne peut pas retenter tout de suite.
    if (currentTrack) {
      void cancelVoiceBuzz(identity.sessionId, currentTrack.round_id, identity.token);
    }
    if (autoStopRef.current !== null) {
      window.clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    setRecState((prev) => {
      if (prev.kind === 'recording') {
        prev.capture.cancel();
      }
      return { kind: 'idle' };
    });
    // feat/voice-cascade-l1-l2 — annule aussi Web Speech (pas de transcript
    // ni de stop() à attendre, on jette).
    webSpeech.cancel();
  };

  // Refonte #3 — saisie texte alternative au buzz vocal.
  const [textBusy, setTextBusy] = useState(false);
  const handleTextAnswer = async (text: string): Promise<void> => {
    if (!currentTrack || textBusy) return;
    setTextBusy(true);
    try {
      const result = await submitTextAnswer({
        apiUrl: API_BASE,
        sessionId: identity.sessionId,
        roundId: currentTrack.round_id,
        token: identity.token,
        text,
      });
      if (!result.matched) {
        setFailToast(t('play.notMatchedShort'));
        return;
      }
      // matched → broadcast track:correct_answer arrivera, myCorrect basculera,
      // ValidatedBanner remplacera le buzzer + input. Pas d'autre action ici.
    } catch (err) {
      setFailToast((err as Error).message);
    } finally {
      setTextBusy(false);
    }
  };

  // Pseudo du 1ᵉʳ trouveur — pour le late banner non-finder phase 2.
  const firstFinder = correctAnswers[0] ?? null;

  // ── Render unifié style "tel" maquette 07 ─────────────────────────────
  const cooldownActive = Date.now() < buzzCooldownUntil;
  const buzzerDisabled =
    !currentTrack ||
    !!myCorrect ||
    cooldownActive ||
    isPhase3 ||
    recState.kind !== 'idle' ||
    isPaused;

  return (
    // Layout iPhone (6 mai #2 spec brief) :
    //   - PAS de min-h-[100dvh] qui crée de l'espace crème vide en bas.
    //   - PAS de justify-center sur ce parent.
    //   - gap-2 entre header / infoBar / BUZZ / TextInput / footer.
    //   - overflow-x-hidden conservé pour bande noire iPhone.
    <div className="flex flex-col gap-2 overflow-x-hidden">
      {/* Refonte #2 — toast top "Pas reconnu" 1.5s, retour buzzer immédiat. */}
      {failToast && (
        <div className="fixed top-4 left-1/2 z-50 -translate-x-1/2 rounded-2xl border border-white/15 bg-[#191922]/95 px-4 py-2 text-sm font-medium text-white shadow-[0_18px_50px_rgba(0,0,0,0.6)] backdrop-blur animate-pop-in">
          {failToast}
        </div>
      )}

      {/* Header tel : logo + manche + connection + boutons (master) */}
      <PhoneHeader
        roundPosition={roundPosition}
        isMaster={isMaster}
        onModerate={onOpenMasterMenu}
        onPause={onMasterPause}
      />

      {/* Player info bar : pseudo + équipe + score */}
      <PlayerInfoBar
        pseudo={identity.pseudo}
        teamName={teamName ?? null}
        teamColor={teamColor ?? null}
        score={totalScore}
      />

      {/* Classement DU TITRE — telephone ANIMATEUR uniquement (choix Thomas :
          TV + console iPad + telephone animateur). Le telephone des joueurs
          garde son affichage actuel. */}
      {isMaster && correctAnswers.length > 0 && (
        <ClassementDuTitre
          correctAnswers={correctAnswers}
          cumulative={cumulative}
          variante="compact"
          moiParticipantId={identity.participantId}
          maxLignes={8}
        />
      )}

      {/* Phase 2 banner — différent pour finder vs non-finder.
          Pas de reveal ici (correction spec — pas de leak). */}
      {isPhase2 && phase2StartedAt && (
        <LateBanner
          isFinder={!!myCorrect}
          firstFinderPseudo={firstFinder?.pseudo ?? null}
          phase2StartedAt={phase2StartedAt}
        />
      )}

      {/* Correction 2 — bandeau "EN COURS ♪?????" supprimé côté joueur.
          Le joueur sait qu'il joue et n'a pas besoin du mystère "?????"
          sur l'écran de buzz. Composant TrackStatusMystery retiré du flow. */}

      {/* Phase 3 — result panel : reveal partagé avec tous */}
      {isPhase3Reveal && (
        <ResultPanel
          artist={lastReveal?.artist ?? currentTrack?.artist ?? '???'}
          title={lastReveal?.title ?? currentTrack?.title ?? '???'}
          songTitle={lastReveal?.song_title ?? currentTrack?.song_title ?? null}
          coverUrl={lastReveal?.cover_url ?? currentTrack?.cover_url ?? null}
        />
      )}

      {/* Phase 3 — dance message différencié finder vs non-finder */}
      {isPhase3 && <DanceMessage isFinder={!!myCorrect} score={myCorrect?.score ?? 0} />}

      {/* Zone interactive centrale : buzzer / recording / uploading / validated */}
      {!currentTrack ? (
        <div className={`${TEL_PANNEAU} p-5 text-center`}>
          <h2 className="mb-2 font-display text-2xl text-white">{t('play.waitingTrack')}</h2>
          <p className="font-editorial italic text-white/60">{t('play.waitingTrackHint')}</p>
        </div>
      ) : recState.kind === 'recording' ? (
        <RecordingView
          capture={recState.capture}
          startedAt={recState.startedAt}
          windowMs={recState.windowMs}
          level={recState.level}
          onSubmit={() => void finalizeRecording()}
          onCancel={handleCancelRec}
        />
      ) : myCorrect ? (
        // J'ai trouvé : ValidatedBanner remplace le buzzer.
        // Confettis seulement en phase 3 (correction spec — pas avant).
        <ValidatedBanner
          score={myCorrect.score}
          position={myCorrect.position}
          matchedTitle={myCorrect.matched_title}
          scorePosition={myCorrect.score_position}
          scoreTitleBonus={myCorrect.score_title_bonus}
          scoreSpeedBonus={myCorrect.score_speed_bonus}
          showConfetti={isPhase3Reveal}
        />
      ) : (
        // Buzzer (idle ou uploading) — actif en phase 1+2, désactivé en phase 3.
        //
        // Layout 6 mai #2 — pas de flex-1, pas de justify-center : on COLLE
        // BUZZ + TextInput sous le header avec un gap fixe minimal. Le BUZZ
        // est en taille FIXE 240×240 (cf BuzzerArea) pour iPhone SE/14.
        <div className="flex flex-col gap-2">
          <div className="flex justify-center">
            <BuzzerArea
              onBuzz={() => void handleBuzz()}
              disabled={buzzerDisabled}
              isPhase3={isPhase3}
              isPhase3Skipped={phase === 'phase3-skipped'}
              error={error}
              analyzing={recState.kind === 'uploading'}
              isPlaying={!!currentTrack && !isPaused && (isPhase1 || isPhase2)}
            />
          </div>
          {/* Saisie texte alternative au buzz vocal — collée sous le BUZZ
              (pas sticky bottom, pas mt-auto). 16px de gap max via gap-2 du
              parent. */}
          {(isPhase1 || isPhase2) && !myCorrect && !isPaused && (
            <div className="px-1">
              <TextAnswerInput
                onSubmit={(text) => void handleTextAnswer(text)}
                busy={textBusy}
                disabled={recState.kind !== 'idle' || !!myCorrect}
              />
            </div>
          )}
        </div>
      )}

      {/* Phone footer : position cumulée + total joueurs */}
      <PhoneFooter myRank={myRank} totalParticipants={totalParticipants} />
    </div>
  );
}

// ── Sous-composants tel (maquette 07) ──────────────────────────────────────

function PhoneHeader({
  roundPosition,
  isMaster,
  onModerate,
  onPause,
}: {
  roundPosition: number | null;
  isMaster: boolean;
  onModerate?: () => void;
  onPause?: () => void;
}): JSX.Element {
  return (
    <div className={`relative ${TEL_PANNEAU} px-4 py-3.5 flex items-center justify-between`}>
      <div className="flex items-center gap-2">
        <div className="font-display text-xl text-white">
          Tutti
          <span
            aria-hidden
            className="inline-block w-2 h-2 rounded-full ml-0.5 align-top"
            style={{ backgroundColor: TEL_CORAIL }}
          />
        </div>
        {roundPosition !== null && (
          <span className="rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-white/70">
            {`M${roundPosition}`}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="w-2 h-2 rounded-full bg-[#4ade80] animate-pulse-buzz"
          title="Connecté"
        />
        {isMaster && onModerate && (
          <button
            type="button"
            onClick={onModerate}
            aria-label="Modérer"
            className="w-7 h-7 rounded-full border border-white/20 bg-white/[0.08] flex items-center justify-center text-sm text-white hover:bg-white/[0.16]"
          >
            ⚙
          </button>
        )}
        {isMaster && onPause && (
          <button
            type="button"
            onClick={onPause}
            aria-label="Pause"
            className="w-7 h-7 rounded-full border border-white/20 flex items-center justify-center text-sm text-white hover:bg-white/[0.12]"
          >
            ⏸
          </button>
        )}
      </div>
      {/* feat/telephone-au-style-tv — le filet multicolore devient le liseré
          corail de la TV : un seul accent, comme sur l'écran de la salle. */}
      <div
        aria-hidden
        className="absolute bottom-0 left-4 right-4 h-px rounded-full"
        style={{ background: `linear-gradient(90deg, transparent, ${TEL_CORAIL}, transparent)` }}
      />
    </div>
  );
}

function PlayerInfoBar({
  pseudo,
  teamName,
  teamColor,
  score,
}: {
  pseudo: string;
  teamName: string | null;
  teamColor: string | null;
  score: number;
}): JSX.Element {
  return (
    <div className="text-center">
      <p className="font-display text-2xl leading-tight text-white">{pseudo}</p>
      {teamName && (
        <p className="font-editorial italic text-sm" style={{ color: teamColor ?? TEL_CORAIL }}>
          {teamName}
        </p>
      )}
      <span
        className="mt-1.5 inline-block rounded-full px-3 py-0.5 font-mono text-sm font-bold tabular-nums"
        style={{ backgroundColor: `${TEL_CORAIL}22`, border: `1px solid ${TEL_CORAIL}66`, color: TEL_CORAIL }}
      >
        {score} pts
      </span>
    </div>
  );
}

// Correction 2 — TrackStatusMystery supprimé (bandeau "EN COURS ♪?????"
// inutile sur l'écran de buzz côté joueur).

function LateBanner({
  isFinder,
  firstFinderPseudo,
  phase2StartedAt,
}: {
  isFinder: boolean;
  firstFinderPseudo: string | null;
  phase2StartedAt: string;
}): JSX.Element {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  const remaining = Math.max(0, 10_000 - (now - new Date(phase2StartedAt).getTime()));
  const seconds = Math.ceil(remaining / 1000);
  return (
    <div className={`${TEL_PANNEAU} flex items-center justify-between p-3`}>
      <div className="pr-3 text-sm font-bold leading-tight">
        <strong className="block font-display text-base font-normal text-white">
          {isFinder
            ? t('play.lateBannerFinderTitle')
            : t('play.lateBannerNonFinderTitle', { pseudo: firstFinderPseudo ?? '…' })}
        </strong>
        <span className="text-white/60">
          {isFinder ? t('play.lateBannerFinderSub') : t('play.lateBannerNonFinderSub')}
        </span>
      </div>
      <div
        className="shrink-0 animate-tick-pulse font-mono text-4xl font-bold leading-none tabular-nums"
        style={{ color: TEL_CORAIL }}
      >
        {seconds}
      </div>
    </div>
  );
}

function ResultPanel({
  artist,
  title,
  songTitle,
  coverUrl,
}: {
  artist: string;
  title: string;
  /** feat/oeuvre-affichee — vrai titre de la chanson quand `title` est une œuvre. */
  songTitle?: string | null;
  /** feat/pochette-ecran-joueur — pochette affichée à la révélation. */
  coverUrl?: string | null;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className={`${TEL_PANNEAU} p-4 text-center`}>
      <p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-white/55">
        {t('play.resultPanelLabel')}
      </p>
      {coverUrl && (
        <img
          src={coverUrl}
          alt=""
          className="mx-auto mb-3 h-28 w-28 rounded-2xl object-cover ring-1 ring-white/15 shadow-[0_16px_40px_rgba(0,0,0,0.6)]"
        />
      )}
      {/* feat/oeuvre-affichee — ordre demandé : œuvre (ou titre) / chanson / interprète */}
      <p className="mb-1 font-display text-2xl leading-tight text-white">{title}</p>
      {songTitle && <p className="mb-1 font-display text-base text-white/75">{songTitle}</p>}
      <p className="font-editorial text-sm font-semibold italic" style={{ color: TEL_CORAIL }}>
        {artist}
      </p>
    </div>
  );
}

function DanceMessage({ isFinder, score }: { isFinder: boolean; score: number }): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className={`${TEL_PANNEAU} py-3.5 text-center font-display text-lg text-white animate-dance-pulse`}>
      {isFinder ? (
        <>
          <span aria-hidden className="inline-block animate-emoji-wave mr-2">
            🎉
          </span>
          {t('play.danceFinder', { points: score })}
          <span aria-hidden className="inline-block animate-emoji-wave ml-2">
            🎉
          </span>
        </>
      ) : (
        <>
          <span aria-hidden className="inline-block animate-emoji-wave mr-2">
            🕺
          </span>
          {t('play.danceNonFinder')}
          <span aria-hidden className="inline-block animate-emoji-wave ml-2">
            💃
          </span>
        </>
      )}
    </div>
  );
}

function ValidatedBanner({
  score,
  position,
  matchedTitle,
  scorePosition,
  scoreTitleBonus,
  scoreSpeedBonus,
  showConfetti,
}: {
  score: number;
  position: number;
  matchedTitle: boolean;
  scorePosition?: number;
  scoreTitleBonus?: number;
  scoreSpeedBonus?: number;
  showConfetti: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  // Refonte #4 — affichage clarifié du détail des points si breakdown fourni.
  const hasBreakdown =
    scorePosition !== undefined || scoreTitleBonus !== undefined || scoreSpeedBonus !== undefined;
  return (
    <div className="relative my-4 overflow-hidden rounded-2xl">
      {/* Confettis confinés au banner — déclenchés en phase 3 pour les finders.
          Pas en phase 2 (pas d'animation festive avant le reveal global). */}
      {showConfetti && <PhoneConfettiBurst />}
      {/* feat/telephone-au-style-tv — le bandeau de reussite reprend le corail
          de la TV : c etait le dernier ilot vert-et-jaune de l ecran. */}
      <div
        className="relative z-10 rounded-[20px] border px-5 py-7 text-center animate-valid-pop"
        style={{
          backgroundColor: `${TEL_CORAIL}1f`,
          borderColor: `${TEL_CORAIL}66`,
          boxShadow: `0 0 40px ${TEL_CORAIL}33`,
        }}
      >
        <span className="mb-1.5 block font-display text-6xl" style={{ color: TEL_CORAIL }}>
          ✓
        </span>
        <p className="mb-1.5 font-display text-2xl text-white">
          {scoreTitleBonus ? t('play.doubleValidated') : t('play.answerValidated')}
        </p>
        {hasBreakdown && (
          <ul className="mb-2 space-y-0.5 font-mono text-sm text-white/65">
            {!!scorePosition && (
              <li>
                +{scorePosition} {t('play.scoreArtist', { n: position })}
              </li>
            )}
            {!!scoreSpeedBonus && (
              <li>
                +{scoreSpeedBonus} {t('play.scoreSpeed')}
              </li>
            )}
            {matchedTitle && !!scoreTitleBonus && (
              <li>
                +{scoreTitleBonus} {t('play.scoreTitleBonus')}
              </li>
            )}
          </ul>
        )}
        <p
          className="inline-block rounded-2xl px-4 py-1 font-mono text-3xl font-bold tabular-nums text-[#0B0B0F]"
          style={{ backgroundColor: TEL_CORAIL }}
        >
          {t('play.scoreTotal')} : +{score} pts
        </p>
        <p className="mt-3 font-mono text-xs uppercase tracking-widest text-white/50">
          {t('play.position', { n: position })}
        </p>
      </div>
    </div>
  );
}

/**
 * Confettis confinés au panneau (overlay absolute), spawn ~10 morceaux en
 * burst 3-5s. Animation linéaire de haut en bas, couleurs Pop Cocktail.
 * Utilisé sur le tel des trouveurs en phase 3.
 */
function PhoneConfettiBurst(): JSX.Element {
  const [pieces] = useState(() =>
    Array.from({ length: 10 }, (_, i) => ({
      id: i,
      left: `${Math.round(Math.random() * 100)}%`,
      delay: `${Math.round(Math.random() * 1500)}ms`,
      duration: `${3 + Math.round(Math.random() * 2)}s`,
      // feat/telephone-au-style-tv — palette resserree autour du corail.
      color: ['#FF5C4D', '#FFFFFF', '#FF8A7A', '#FFD166', '#FF5C4D', '#FFFFFF'][i % 6],
      isCircle: i % 3 === 0,
    })),
  );
  return (
    <div aria-hidden className="absolute inset-0 pointer-events-none overflow-hidden">
      {pieces.map((c) => (
        <span
          key={c.id}
          className="absolute top-0 animate-confetti-fall"
          style={{
            left: c.left,
            width: '8px',
            height: '12px',
            backgroundColor: c.color,
            animationDelay: c.delay,
            animationDuration: c.duration,
            borderRadius: c.isCircle ? '50%' : '0',
          }}
        />
      ))}
    </div>
  );
}

function BuzzerArea({
  onBuzz,
  disabled,
  isPhase3,
  isPhase3Skipped,
  error,
  analyzing = false,
  isPlaying,
}: {
  onBuzz: () => void;
  disabled: boolean;
  isPhase3: boolean;
  isPhase3Skipped: boolean;
  error: string | null;
  /** Bug 3 — true pendant l'analyse Whisper. Affiche spinner discret sur
   * le bouton sans masquer le reste, pour préserver l'UX rapidité. */
  analyzing?: boolean;
  /** feat/arcade-buttons-vinyl-buzzer — vraie lecture audio en cours côté
   *  serveur (currentTrack && !isPaused && phase active). Pilote la rotation
   *  infinie du vinyle. */
  isPlaying: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  // feat/arcade-buttons-vinyl-buzzer — VinylBuzzer remplace VoiceButton pour
  // l'IDLE (= le buzz trigger). Quand le joueur tape, on déclenche onBuzz
  // (= pipeline existante : start recording → RecordingView prend le relais
  // pour listening avec waveform + cancel/submit). `buzzed=analyzing` rend le
  // scratch + glow tant que l'analyse Whisper est en cours.
  const hint = isPhase3Skipped
    ? t('play.buzzerHintSkipped')
    : isPhase3
      ? t('play.buzzerHintPhase3')
      : analyzing
        ? t('play.buzzerHintAnalyzing')
        : t('play.buzzerHintActive');
  return (
    <div className="flex flex-col items-center gap-2">
      <VinylBuzzer
        isPlaying={isPlaying && !analyzing && !disabled}
        buzzed={analyzing}
        disabled={disabled}
        hint={hint}
        feedbackLabel={analyzing ? t('play.voiceButton.processing') : null}
        onBuzz={onBuzz}
        ariaLabel={t('play.voiceButton.ariaIdle')}
      />
      {error && (
        <p role="alert" className="text-center text-sm" style={{ color: TEL_CORAIL }}>
          {error}
        </p>
      )}
    </div>
  );
}

// Refonte #3 — Saisie texte alternative au buzz vocal. Toujours visible
// sous le buzzer en phase 1+2 (sauf si le joueur a déjà trouvé). Le
// matching backend est strictement le même (artiste + titre + aliases).
function TextAnswerInput({
  onSubmit,
  busy,
  disabled,
}: {
  onSubmit: (text: string) => void;
  busy: boolean;
  disabled: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  const [text, setText] = useState('');

  // Bug 4 — refonte iOS : combinaison min-h-[100dvh] (parent) + sticky bottom
  // suffit pour que le clavier mobile pousse le form sans scroller la page.
  // Plus besoin de visualViewport / position fixed manuel.

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || busy || disabled) return;
    onSubmit(trimmed);
    setText('');
  };

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('play.textAnswerPlaceholder')}
        disabled={busy || disabled}
        maxLength={200}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        // enterkeyhint = "send" → le bouton clavier mobile devient "Envoyer"
        enterKeyHint="send"
        // Bug 5 — PAS de text-sm/text-xs sur les inputs : iOS Safari zoom auto
        // sur tout input < 16px. La règle globale index.css force 16px sur
        // input/textarea/select.
        className="flex-1 rounded-2xl border border-white/15 bg-white/[0.07] px-3.5 py-2.5 text-white placeholder:text-white/40 backdrop-blur focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-[#FF5C4D]/50 disabled:bg-white/[0.03] disabled:text-white/30"
      />
      <button
        type="submit"
        disabled={busy || disabled || !text.trim()}
        // onMouseDown au lieu de onClick : se déclenche AVANT le blur de
        // l'input. Sans ça, sur iOS, le tap "Envoyer" peut rater le bouton
        // si le clavier se ferme + reflow entre mousedown et click.
        onMouseDown={(e) => {
          if (!text.trim() || busy || disabled) return;
          e.preventDefault();
          submit(e);
        }}
        className="rounded-2xl px-4 py-2.5 font-mono text-xs font-bold uppercase tracking-[0.18em] text-[#0B0B0F] transition-transform active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-white/[0.08] disabled:text-white/30"
        style={{ backgroundColor: busy || disabled || !text.trim() ? undefined : TEL_CORAIL }}
      >
        {busy ? '…' : t('play.textAnswerSubmit')}
      </button>
    </form>
  );
}

function PhoneFooter({
  myRank,
  totalParticipants,
}: {
  myRank: number | null;
  totalParticipants: number;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className={`${TEL_PANNEAU} mt-2 px-4 py-2.5 text-center text-xs font-bold text-white/75`}>
      {myRank !== null && (
        <span className="mr-1.5 font-display text-lg" style={{ color: TEL_CORAIL }}>
          {myRank}
        </span>
      )}
      <span>{t('play.phoneFooter', { count: totalParticipants })}</span>
    </div>
  );
}

// ── Sous-vues legacy ────────────────────────────────────────────────────────

function RecordingView({
  capture,
  startedAt,
  windowMs,
  level,
  onSubmit,
  onCancel,
}: {
  capture: VoiceCapture;
  startedAt: number;
  windowMs: number;
  level: number;
  onSubmit: () => void;
  onCancel: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  void capture; // disponible si on veut accéder aux états plus tard
  // Tick à 100ms pour rafraîchir le countdown
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, []);
  const elapsed = now - startedAt;
  // fix/compte-a-rebours-faux — LE DÉCOMPTE SUIT LA VRAIE FENÊTRE.
  // Il était figé à 10 s : dès que la fenêtre de buzz était réglée
  // autrement, le joueur voyait 0 alors qu'il lui restait du temps, ou
  // l'inverse.
  const remaining = Math.max(0, windowMs - elapsed);
  const seconds = Math.ceil(remaining / 1000);

  // Niveau audio normalisé (0-100% pour la barre)
  const levelPct = Math.min(100, Math.round(level * 800));

  return (
    /* feat/telephone-au-style-tv — l ecoute prend elle aussi le panneau sombre. */
    <div className={`${TEL_PANNEAU} p-5 text-center`}>
      <p className="mb-2 animate-pulse text-5xl">🎤</p>
      <p className="mb-2 font-display text-2xl text-white">{t('play.recording')}</p>
      <p className="mb-4 font-editorial text-sm italic text-white/55">{t('play.recordingHint')}</p>

      <p className="mb-2 font-display text-5xl tabular-nums" style={{ color: TEL_CORAIL }}>
        {seconds}s
      </p>

      <div className="mb-4 h-2.5 overflow-hidden rounded-full bg-white/[0.08]">
        <div
          className="h-full transition-[width] duration-100 ease-out"
          style={{ width: `${levelPct}%`, backgroundColor: TEL_CORAIL }}
        />
      </div>

      <button
        type="button"
        onClick={onSubmit}
        className="mb-2 w-full rounded-2xl px-4 py-3 font-bold text-[#0B0B0F] transition-transform active:scale-[0.98]"
        style={{ backgroundColor: TEL_CORAIL }}
      >
        ✓ {t('play.recordingSubmit')}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="w-full rounded-2xl border border-white/15 px-4 py-2.5 text-sm text-white/70 transition-colors hover:bg-white/[0.06]"
      >
        {t('common.cancel')}
      </button>
    </div>
  );
}

// Refonte #2 — ResultView (écran intermédiaire "Pas reconnu" + bouton Rebuzzer)
// supprimé. Le retour au buzzer est désormais immédiat avec un toast top
// 1.5s "❌ Pas reconnu, retente !". Plus de transcript Whisper affiché.
//
// La validation après match correct passe directement par <ValidatedBanner />
// (déclenché via myCorrect une fois le broadcast track:correct_answer reçu).

/**
 * feat/tv-playlist-carousel — bouton + modal pour proposer une playlist
 * officielle Tutti depuis le lobby. Charge le catalogue à la 1ère ouverture,
 * persiste les playlists déjà proposées par cet user pour éviter les
 * doublons UI (le backend est idempotent côté DB grâce au unique constraint).
 */
function ProposePlaylistButton(props: { shortCode: string; token: string }): JSX.Element | null {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<
    Array<{
      id: string;
      name: string;
      description: string | null;
      theme: string | null;
      track_count: number;
    }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [proposed, setProposed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');

  // fix/rafale-de-requetes-modale — UN ÉCHEC NE DOIT PAS RELANCER LA REQUÊTE.
  // Le garde ne tenait compte ni de l'échec ni d'un catalogue vide : « chargement »
  // repassait à faux, les dépendances changeaient, l'effet repartait — le
  // téléphone envoyait des requêtes en rafale tant que la fenêtre restait
  // ouverte. On mémorise qu'une tentative a eu lieu.
  const tentativeFaite = useRef(false);
  useEffect(() => {
    if (!open) {
      tentativeFaite.current = false;
      return;
    }
    if (tentativeFaite.current || catalog.length > 0 || loading) return;
    tentativeFaite.current = true;
    setLoading(true);
    setError(null);
    void import('../lib/playlistProposals.js')
      .then(({ getLibraryCatalogForSession }) => getLibraryCatalogForSession(props.shortCode, 400))
      .then((rows) => {
        const isFr = i18n.language?.toLowerCase().startsWith('fr');
        setCatalog(
          rows.map((p) => ({
            id: p.id,
            name: isFr ? p.name_fr : p.name_en,
            description: isFr ? p.description_fr : p.description_en,
            theme: p.theme,
            track_count: p.track_count,
          })),
        );
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError((err as Error).message);
        setLoading(false);
      });
    // `loading` et `catalog.length` restent lus, jamais déclencheurs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, props.shortCode, i18n.language]);

  const handlePropose = async (id: string): Promise<void> => {
    setBusy(id);
    try {
      const { proposeLibraryPlaylist } = await import('../lib/playlistProposals.js');
      await proposeLibraryPlaylist({
        shortCode: props.shortCode,
        token: props.token,
        officialPlaylistId: id,
      });
      setProposed((s) => new Set(s).add(id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const filtered = catalog.filter((p) =>
    filter ? p.name.toLowerCase().includes(filter.toLowerCase()) : true,
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-6 inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/[0.06] px-4 py-2 font-mono text-xs text-white/80 transition-colors hover:bg-white/[0.12]"
      >
        <span aria-hidden>💡</span>
        <span>{t('play.proposePlaylistCta')}</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-3 animate-fade-in"
          onClick={() => setOpen(false)}
        >
          <div
            className={`${TEL_PANNEAU} flex max-h-[85vh] w-full max-w-md flex-col p-0`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-white/10 p-4">
              <p className="font-display text-lg text-white">💡 {t('play.proposePlaylistTitle')}</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t('common.close')}
                className="text-xl text-white/50 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="border-b border-white/10 p-3">
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t('play.proposePlaylistSearch')}
                className="w-full rounded-2xl border border-white/15 bg-white/[0.07] px-3 py-2 font-mono text-sm text-white placeholder:text-white/35 focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-[#FF5C4D]/50"
              />
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loading && (
                <p className="font-mono text-sm text-white/50">⏳ {t('common.loading')}</p>
              )}
              {error && (
                <p role="alert" className="font-mono text-sm" style={{ color: TEL_CORAIL }}>
                  {error}
                </p>
              )}
              {!loading && !error && filtered.length === 0 && (
                <p className="py-6 text-center font-editorial italic text-white/45">
                  {t('play.proposePlaylistEmpty')}
                </p>
              )}
              {filtered.map((p) => {
                const isProposed = proposed.has(p.id);
                const isBusy = busy === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => void handlePropose(p.id)}
                    disabled={isProposed || isBusy}
                    className={`w-full rounded-2xl border p-3 text-left transition ${
                      isProposed
                        ? 'cursor-default border-[#4ade80]/50 bg-[#4ade80]/10'
                        : 'border-white/12 bg-white/[0.04] hover:bg-white/[0.09] active:translate-y-px'
                    } ${isBusy ? 'opacity-60' : ''}`}
                  >
                    <p className="flex items-center gap-2 font-display text-sm font-semibold text-white">
                      {p.name}
                      {isProposed && <span className="text-xs text-[#4ade80]">✓ proposée</span>}
                    </p>
                    {p.description && (
                      <p className="mt-1 line-clamp-2 font-mono text-[11px] text-white/50">
                        {p.description}
                      </p>
                    )}
                    <p className="mt-1 font-mono text-[10px] text-white/45">
                      {p.theme && <span>{p.theme} · </span>}
                      {p.track_count} morceaux
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Phase2Countdown : remplacé par LateBanner (maquette 07). Conservé pour
// référence si besoin de revenir à un affichage compact.
//
// Refonte #2 : ScoreBadge supprimé — il n'était utilisé que dans ResultView
// (lui-même supprimé puisque l'écran intermédiaire "Pas reconnu" disparaît).
// Si besoin futur d'afficher un score inline, recréer ce composant.
