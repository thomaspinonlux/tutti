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

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Socket } from 'socket.io-client';
import type {
  CurrentTrackState,
  JoinResponse,
  Participant,
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
  masterNextTrack,
  masterPause,
  masterPickRound,
  masterRestartTrack,
  masterResume,
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
import { VoiceButton } from '../components/play/VoiceButton.js';

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
  const [pseudo, setPseudo] = useState('');
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [identity, setIdentity] = useState<ParticipantContext | null>(null);
  const [participantsCount, setParticipantsCount] = useState(0);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [currentRound, setCurrentRound] = useState<SessionRoundWithPlaylist | null>(null);
  const [currentTrack, setCurrentTrack] = useState<CurrentTrackState | null>(null);
  const [correctAnswers, setCorrectAnswers] = useState<CorrectAnswerEntry[]>([]);
  const [lastReveal, setLastReveal] = useState<{ artist: string; title: string } | null>(null);
  const [phase2StartedAt, setPhase2StartedAt] = useState<string | null>(null);
  const [myScore, setMyScore] = useState(0);
  const [micRequesting, setMicRequesting] = useState(false);
  const [busy, setBusy] = useState(false);
  // Master mode (mode B uniquement) : flag is_master + état de pause
  const [isMaster, setIsMaster] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [masterPickerOpen, setMasterPickerOpen] = useState(false);
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
            clearParticipantContext(shortCode);
            setError(resp.error ?? t('play.kicked'));
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
            p.id === participant.id ? { ...p, is_master } : { ...p, is_master: false },
          ),
        );
        // Maj de mon propre flag
        if (participant.id === identity.participantId) {
          setIsMaster(is_master);
        } else if (is_master) {
          // Quelqu'un d'autre vient d'être nommé master → je perds le statut
          setIsMaster(false);
        }
      },
    );
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
    });
    sock.on('track:start', ({ state }: { state: CurrentTrackState }) => {
      setCurrentTrack(state);
      setCorrectAnswers([]);
      setLastReveal(null);
      setPhase2StartedAt(null);
    });
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
        phase: CurrentTrackState['phase'];
        phase2_started_at?: string;
        artist?: string;
        title?: string;
      }) => {
        setCurrentTrack((prev) => (prev ? { ...prev, phase: payload.phase } : prev));
        if (payload.phase === 'phase2' && payload.phase2_started_at) {
          setPhase2StartedAt(payload.phase2_started_at);
        }
        if (payload.phase === 'phase3-revealed' && payload.artist && payload.title) {
          // Master a déclenché "Donner la réponse" sans qu'aucun buzz n'ait abouti
          setLastReveal({ artist: payload.artist, title: payload.title });
        }
      },
    );
    sock.on('track:revealed', (payload: { round_id: string; artist: string; title: string }) => {
      // Cohérent avec phase_changed → phase3-revealed mais conservé pour
      // compat ascendante.
      setLastReveal({ artist: payload.artist, title: payload.title });
    });
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
  const handleMasterSkip = (): Promise<void> =>
    masterCall(async () => {
      if (!identity || !currentRound) return;
      await masterSkipTrack(identity.sessionId, currentRound.id, identity.token);
    });
  const handleMasterNext = (): Promise<void> =>
    masterCall(async () => {
      if (!identity || !currentRound) return;
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
      await masterRestartTrack(identity.sessionId, currentRound.id, identity.token);
    });
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
  const handleMasterAdjust = async (args: {
    target_participant_id: string;
    delta: number;
    reason?: string;
  }): Promise<void> => {
    if (!identity) return;
    await masterAdjustPoints(identity.sessionId, identity.token, args);
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col">
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
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-1">
                {t('common.brand')}
              </p>
              <TitleHandwritten as="h1" className="text-3xl">
                {/* Pivot B2C — backend renvoie session.name (custom) ou "Tutti"
                    par défaut, jamais le nom d'établissement. */}
                <Underline>{view?.establishment_name ?? t('common.brand')}</Underline>
              </TitleHandwritten>
              <p className="font-mono text-xs tracking-[0.2em] text-ink-soft mt-2">{shortCode}</p>
              {currentRound && (
                <Badge tone="spritz" tilt={-1} className="mt-2">
                  {t('play.roundBadge', {
                    n: currentRound.position,
                    name: currentRound.playlist.name,
                  })}
                </Badge>
              )}
            </div>
          </header>

          {error && (
            <Card tone="raspberry" size="sm" className="mb-4">
              <p role="alert" className="text-sm font-medium text-raspberry-deep">
                {error}
              </p>
            </Card>
          )}

          {step === 'pseudo' && view?.status !== 'ENDED' && (
            <Card size="md">
              <form onSubmit={handlePseudoSubmit} className="space-y-4">
                <p className="font-editorial italic text-ink-2 text-center mb-2">
                  {t('play.pseudoTagline')}
                </p>
                <Input
                  label={t('play.pseudoLabel')}
                  value={pseudo}
                  onChange={(e) => setPseudo(e.target.value)}
                  placeholder={t('play.pseudoPlaceholder')}
                  required
                  minLength={1}
                  maxLength={40}
                  autoFocus
                />
                <Button
                  type="submit"
                  disabled={submitting || !pseudo.trim()}
                  size="lg"
                  className="w-full"
                >
                  {view?.mode === 'TEAMS'
                    ? t('play.continueToTeam')
                    : t('play.continueToOnboarding')}
                </Button>
              </form>
            </Card>
          )}

          {step === 'team' && (
            <Card size="md">
              <p className="font-editorial italic text-ink-2 text-center mb-4">
                {t('play.chooseTeam')}
              </p>
              <ul className="space-y-2 mb-4">
                {teams.map((team) => (
                  <li key={team.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedTeam(team.id)}
                      aria-pressed={selectedTeam === team.id}
                      className={`w-full px-4 py-3 border-2 rounded font-bold text-base transition-colors min-h-[44px] ${
                        selectedTeam === team.id
                          ? 'border-ink shadow-pop-sm text-cream'
                          : 'border-ink bg-cream text-ink hover:bg-cream-2'
                      }`}
                      style={selectedTeam === team.id ? { backgroundColor: team.color } : undefined}
                    >
                      {team.name}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  onClick={() => setStep('pseudo')}
                  className="flex-1"
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  type="button"
                  size="md"
                  onClick={handleTeamSubmit}
                  disabled={!selectedTeam || submitting}
                  className="flex-1"
                >
                  {t('play.continueToOnboarding')}
                </Button>
              </div>
            </Card>
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
              <Card size="md" tone="basil" className="text-center">
                <p className="text-xs font-mono uppercase tracking-wider text-basil-deep mb-3">
                  {t('play.youAreIn')}
                </p>
                <TitleHandwritten as="h2" className="mb-2">
                  {identity.pseudo}
                </TitleHandwritten>
                {identity.teamId && (
                  <Badge tone="ink" tilt={-1} className="mb-4">
                    {teams.find((t2) => t2.id === identity.teamId)?.name}
                  </Badge>
                )}
                <p className="font-editorial italic text-ink-2 mt-4">{t('play.waitingMessage')}</p>
                <p className="font-mono text-xs text-ink-soft mt-3">
                  {participantsCount} {t('play.participantsConnected')}
                </p>
                <div className="mt-6 h-1 bg-cream-3 rounded overflow-hidden relative" aria-hidden>
                  <div className="absolute inset-y-0 w-1/3 bg-spritz animate-pulse" />
                </div>
                {/* feat/tv-playlist-carousel — proposer une playlist depuis le
                  lobby. Modal qui charge le catalogue OfficialPlaylist + POST
                  /api/sessions/by-code/:short_code/proposals. */}
                <ProposePlaylistButton shortCode={shortCode} token={identity.token} />
              </Card>
              {/* feat/rules — règles concises visibles dans le lobby avant la manche 1 */}
              <GameRules className="mt-4" />
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
                <Card tone="plum" size="md" className="text-center mb-3">
                  <p className="font-display text-2xl">⏸ {t('play.pausedTitle')}</p>
                  <p className="font-editorial italic text-ink-2 text-sm mt-1">
                    {t('play.pausedHint')}
                  </p>
                </Card>
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
                totalParticipants={participantsCount}
                roundPosition={currentRound?.position ?? null}
                isMaster={isMaster}
                isPaused={isPaused}
                onOpenMasterMenu={isMaster ? () => setMasterPickerOpen(false) : undefined}
                onMasterPause={isMaster ? handleMasterPause : undefined}
              />

              {isMaster && (
                <div className="mt-4">
                  <MasterMenu
                    isPaused={isPaused}
                    currentTrack={currentTrack}
                    hasActiveRound={!!currentRound}
                    busy={busy}
                    onReveal={handleMasterReveal}
                    onSkipTrack={handleMasterSkip}
                    onNextTrack={handleMasterNext}
                    onPause={handleMasterPause}
                    onResume={handleMasterResume}
                    onRestartTrack={handleMasterRestart}
                    onEndRound={handleMasterEndRound}
                    onEndSession={handleMasterEndSession}
                    onPickRound={() => setMasterPickerOpen(true)}
                    onAdjustPoints={() => setAdjustSheetOpen(true)}
                  />
                </div>
              )}
            </>
          )}

          {step === 'ended' && (
            <Card size="md" tone="cream" className="text-center">
              <TitleHandwritten as="h2" className="mb-2">
                {t('play.endedTitle')}
              </TitleHandwritten>
              <p className="font-editorial italic text-ink-2">{t('play.endedHint')}</p>
            </Card>
          )}
        </div>
      </main>

      {identity && (
        <MasterPlaylistPicker
          open={masterPickerOpen}
          sessionId={identity.sessionId}
          token={identity.token}
          onClose={() => setMasterPickerOpen(false)}
          onPick={(pid) => void handleMasterPickPlaylist(pid)}
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
            className={`px-3 py-2 border-2 border-ink rounded shadow-pop bg-white font-medium text-sm ${
              toast.fading ? 'animate-fade-out' : 'animate-pop-in'
            } ${
              toast.tone === 'basil'
                ? 'border-l-8 border-l-basil'
                : toast.tone === 'spritz'
                  ? 'border-l-8 border-l-spritz'
                  : 'border-l-8 border-l-raspberry'
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
  | { kind: 'recording'; capture: VoiceCapture; startedAt: number; level: number }
  | { kind: 'uploading' }
  | { kind: 'result'; result: VoiceAnswerResult };

interface PlayingViewProps {
  currentTrack: CurrentTrackState | null;
  identity: ParticipantContext;
  myScore: number;
  /** Réponses correctes accumulées sur le track courant (broadcast track:correct_answer). */
  correctAnswers: CorrectAnswerEntry[];
  /** Reveal master (phase3-revealed) ou null si phase3 normale. */
  lastReveal: { artist: string; title: string } | null;
  /** Phase 2 a démarré à cette date — pour calculer le chrono côté UI. */
  phase2StartedAt: string | null;
  busy: boolean;
  setBusy: (v: boolean) => void;
}

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
}

function PlayingView(props: PlayingViewProps & PlayingViewExtraProps): JSX.Element {
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

  // Reset le state d'enregistrement à chaque nouveau track.
  useEffect(() => {
    setRecState({ kind: 'idle' });
    setError(null);
    setBuzzCooldownUntil(0);
    setFailToast(null);
  }, [currentTrack?.track_id]);

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
    setBuzzCooldownUntil(Date.now() + 1000);

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
      });

      window.setTimeout(() => {
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
      setError(translateBuzzRefusalReason(code, t));
      setRecState({ kind: 'idle' });
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
      const [blobResult, wsResult] = await Promise.all([capture.stop(), wsStopPromise]);
      blob = blobResult;
      webSpeechTranscript = wsResult.transcript;
      webSpeechSupported = wsResult.supported;
      const sizeKb = Math.round(blob.size / 1024);
      console.info(
        `[Voice] Audio size=${sizeKb}KB | webSpeech.supported=${wsResult.supported} transcript="${wsResult.transcript.slice(0, 80)}" elapsedMs=${wsResult.elapsedMs} err=${wsResult.error ?? '-'}`,
      );
    } catch (err: unknown) {
      console.error('[Voice] Capture stop failed:', err);
      setError(err instanceof Error ? err.message : 'Capture échouée');
      setRecState({ kind: 'idle' });
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
      setFailToast(t('play.notMatchedShort'));
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
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 border-2 border-ink rounded shadow-pop bg-raspberry text-cream font-medium text-sm animate-pop-in">
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
        />
      )}

      {/* Phase 3 — dance message différencié finder vs non-finder */}
      {isPhase3 && <DanceMessage isFinder={!!myCorrect} score={myCorrect?.score ?? 0} />}

      {/* Zone interactive centrale : buzzer / recording / uploading / validated */}
      {!currentTrack ? (
        <Card size="md" tone="cream" className="text-center">
          <TitleHandwritten as="h2" className="mb-2">
            {t('play.waitingTrack')}
          </TitleHandwritten>
          <p className="font-editorial italic text-ink-2">{t('play.waitingTrackHint')}</p>
        </Card>
      ) : recState.kind === 'recording' ? (
        <RecordingView
          capture={recState.capture}
          startedAt={recState.startedAt}
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
    <div className="relative bg-ink text-cream rounded-2xl px-4 py-3.5 flex items-center justify-between shadow-pop">
      <div className="flex items-center gap-2">
        <div className="font-display text-xl text-spritz">
          Tutti
          <span
            aria-hidden
            className="inline-block w-2 h-2 bg-lemon rounded-full ml-0.5 align-top"
          />
        </div>
        {roundPosition !== null && (
          <span className="font-bold text-[11px] bg-basil text-ink px-2.5 py-0.5 rounded-xl uppercase tracking-wider">
            M{roundPosition}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="w-2 h-2 rounded-full bg-basil animate-pulse-buzz"
          title="Connecté"
        />
        {isMaster && onModerate && (
          <button
            type="button"
            onClick={onModerate}
            aria-label="Modérer"
            className="w-7 h-7 bg-spritz border-2 border-cream rounded-full flex items-center justify-center text-sm hover:bg-spritz-deep"
          >
            ⚙
          </button>
        )}
        {isMaster && onPause && (
          <button
            type="button"
            onClick={onPause}
            aria-label="Pause"
            className="w-7 h-7 border-2 border-cream rounded-full flex items-center justify-center text-sm hover:bg-cream/10"
          >
            ⏸
          </button>
        )}
      </div>
      {/* Multi-color signature */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 flex rounded-b-2xl overflow-hidden">
        <div className="flex-1 bg-spritz" />
        <div className="flex-1 bg-basil" />
        <div className="flex-1 bg-raspberry" />
        <div className="flex-1 bg-lemon" />
        <div className="flex-1 bg-plum" />
      </div>
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
      <p className="font-display text-2xl text-ink leading-tight">{pseudo}</p>
      {teamName && (
        <p className="font-editorial italic text-sm" style={{ color: teamColor ?? '#c8336e' }}>
          {teamName}
        </p>
      )}
      <span className="font-mono text-sm bg-lemon border-2 border-ink px-3 py-0.5 rounded-2xl inline-block mt-1.5 font-bold">
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
  const remaining = Math.max(0, 15_000 - (now - new Date(phase2StartedAt).getTime()));
  const seconds = Math.ceil(remaining / 1000);
  return (
    <div className="bg-lemon border-3 border-ink rounded-xl p-3 flex items-center justify-between shadow-pop">
      <div className="font-bold text-sm leading-tight pr-3">
        <strong className="block font-display font-normal text-base text-ink">
          {isFinder
            ? t('play.lateBannerFinderTitle')
            : t('play.lateBannerNonFinderTitle', { pseudo: firstFinderPseudo ?? '…' })}
        </strong>
        <span className="text-ink">
          {isFinder ? t('play.lateBannerFinderSub') : t('play.lateBannerNonFinderSub')}
        </span>
      </div>
      <div className="font-mono text-4xl font-bold text-ink leading-none animate-tick-pulse tabular-nums shrink-0">
        {seconds}
      </div>
    </div>
  );
}

function ResultPanel({ artist, title }: { artist: string; title: string }): JSX.Element {
  const { t } = useTranslation();
  return (
    <div
      className="bg-cream-2 border-3 border-ink rounded-xl p-4 text-center"
      style={{ boxShadow: '4px 4px 0 #ee6c2a' }}
    >
      <p className="text-[10px] uppercase tracking-widest font-bold opacity-70 mb-1">
        {t('play.resultPanelLabel')}
      </p>
      <p className="font-display text-2xl text-ink leading-none mb-1">{artist}</p>
      <p className="font-editorial italic text-sm text-raspberry font-semibold">{title}</p>
    </div>
  );
}

function DanceMessage({ isFinder, score }: { isFinder: boolean; score: number }): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="bg-ink text-cream rounded-xl py-3.5 text-center font-display text-lg animate-dance-pulse">
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
      <div className="bg-basil border-4 border-ink rounded-2xl px-5 py-7 text-center shadow-pop-lg animate-valid-pop relative z-10">
        <span className="font-display text-6xl block mb-1.5 text-cream">✓</span>
        <p className="font-display text-2xl text-cream mb-1.5">
          {scoreTitleBonus ? t('play.doubleValidated') : t('play.answerValidated')}
        </p>
        {hasBreakdown && (
          <ul className="space-y-0.5 mb-2 text-cream-2 font-mono text-sm">
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
        <p className="font-mono text-3xl bg-lemon text-ink inline-block px-4 py-1 rounded-xl font-bold">
          {t('play.scoreTotal')} : +{score} pts
        </p>
        <p className="font-mono text-xs text-cream-2 mt-3 uppercase tracking-widest">
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
      color: ['#ee6c2a', '#4a8b3f', '#c8336e', '#e8c547', '#6e3a6e', '#e89a64'][i % 6],
      isCircle: i % 3 === 0,
    })),
  );
  return (
    <div aria-hidden className="absolute inset-0 pointer-events-none overflow-hidden">
      {pieces.map((c) => (
        <span
          key={c.id}
          className="absolute top-0 animate-confetti-fall border border-ink"
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
}: {
  onBuzz: () => void;
  disabled: boolean;
  isPhase3: boolean;
  isPhase3Skipped: boolean;
  error: string | null;
  /** Bug 3 — true pendant l'analyse Whisper. Affiche spinner discret sur
   * le bouton sans masquer le reste, pour préserver l'UX rapidité. */
  analyzing?: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  // feat/voice-button-redesign — mapping recState vers VoiceButton state.
  // RecordingView (legacy) garde la responsabilité de l'état 'listening' avec
  // waveform + boutons cancel/submit (out of scope cette PR). VoiceButton ici
  // couvre 'idle' + 'processing' visibles dans BuzzerArea. 'success'/'fail'
  // sont gérés par ValidatedBanner (success externe) et failToast (fail
  // transient hors VoiceButton dans cette PR).
  const voiceState: 'idle' | 'processing' = analyzing ? 'processing' : 'idle';
  const labelOverride = isPhase3Skipped
    ? t('play.buzzerHintSkipped')
    : isPhase3
      ? t('play.buzzerHintPhase3')
      : analyzing
        ? t('play.buzzerHintAnalyzing')
        : t('play.buzzerHintActive');
  return (
    <div className="flex flex-col items-center gap-2">
      <VoiceButton
        state={voiceState}
        onStart={onBuzz}
        onStop={() => {
          /* géré par RecordingView une fois en listening */
        }}
        labelOverride={labelOverride}
        disabled={disabled}
        labels={{
          idle: t('play.voiceButton.idle'),
          listening: t('play.voiceButton.listening'),
          processing: t('play.voiceButton.processing'),
          success: t('play.voiceButton.success'),
          fail: t('play.voiceButton.fail'),
          ariaIdle: t('play.voiceButton.ariaIdle'),
          ariaListening: t('play.voiceButton.ariaListening'),
        }}
      />
      {error && (
        <p role="alert" className="text-sm text-raspberry text-center">
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
        className="flex-1 px-3 py-2 border-2 border-ink rounded bg-white focus:outline-none focus:ring-2 focus:ring-spritz disabled:bg-ink/10 disabled:text-ink-soft"
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
        className="px-3 py-2 border-2 border-ink rounded font-mono text-xs uppercase tracking-wider bg-basil text-ink hover:bg-basil-deep hover:text-cream transition-colors disabled:bg-ink/10 disabled:text-ink-soft disabled:cursor-not-allowed"
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
    <div className="bg-ink text-cream rounded-xl py-2.5 px-4 text-center text-xs font-bold mt-2">
      {myRank !== null && <span className="font-display text-lg text-lemon mr-1.5">{myRank}</span>}
      <span>{t('play.phoneFooter', { count: totalParticipants })}</span>
    </div>
  );
}

// ── Sous-vues legacy ────────────────────────────────────────────────────────

function RecordingView({
  capture,
  startedAt,
  level,
  onSubmit,
  onCancel,
}: {
  capture: VoiceCapture;
  startedAt: number;
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
  const remaining = Math.max(0, 10_000 - elapsed);
  const seconds = Math.ceil(remaining / 1000);

  // Niveau audio normalisé (0-100% pour la barre)
  const levelPct = Math.min(100, Math.round(level * 800));

  return (
    <Card size="md" tone="spritz" className="text-center">
      <p className="text-5xl mb-2 animate-pulse">🎤</p>
      <TitleHandwritten as="h2" className="mb-2">
        {t('play.recording')}
      </TitleHandwritten>
      <p className="font-editorial italic text-ink-2 text-sm mb-4">{t('play.recordingHint')}</p>

      <p className="font-display text-5xl text-spritz-deep mb-2">{seconds}s</p>

      <div className="h-3 border-2 border-ink rounded bg-cream-2 overflow-hidden mb-4">
        <div
          className="h-full bg-spritz-deep transition-[width] duration-100 ease-out"
          style={{ width: `${levelPct}%` }}
        />
      </div>

      <Button variant="primary" size="lg" onClick={onSubmit} className="w-full mb-2">
        ✓ {t('play.recordingSubmit')}
      </Button>
      <Button variant="ghost" size="sm" onClick={onCancel} className="w-full">
        {t('common.cancel')}
      </Button>
    </Card>
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

  useEffect(() => {
    if (!open || catalog.length > 0 || loading) return;
    setLoading(true);
    setError(null);
    void import('../lib/playlistProposals.js')
      .then(({ getLibraryCatalogForSession }) => getLibraryCatalogForSession(props.shortCode))
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
  }, [open, catalog.length, loading, props.shortCode, i18n.language]);

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
        className="mt-6 inline-flex items-center gap-2 px-4 py-2 border-2 border-ink rounded-lg bg-cream text-ink font-mono text-xs hover:bg-spritz/30 transition shadow-pop-sm"
      >
        <span aria-hidden>💡</span>
        <span>{t('play.proposePlaylistCta')}</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-ink/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-3 animate-fade-in"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-cream border-2 border-ink rounded-lg shadow-pop-lg w-full max-w-md max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b-2 border-ink flex items-center justify-between gap-2">
              <p className="font-display text-lg">💡 {t('play.proposePlaylistTitle')}</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t('common.close')}
                className="text-ink-soft hover:text-ink text-xl"
              >
                ✕
              </button>
            </div>
            <div className="p-3 border-b border-ink/15">
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t('play.proposePlaylistSearch')}
                className="w-full px-3 py-2 border-2 border-ink rounded font-mono text-sm focus:outline-none focus:ring-2 focus:ring-spritz"
              />
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loading && (
                <p className="font-mono text-sm text-ink-soft">⏳ {t('common.loading')}</p>
              )}
              {error && (
                <p role="alert" className="font-mono text-sm text-raspberry">
                  {error}
                </p>
              )}
              {!loading && !error && filtered.length === 0 && (
                <p className="font-editorial italic text-ink-soft text-center py-6">
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
                    className={`w-full text-left p-3 border-2 rounded-lg transition ${
                      isProposed
                        ? 'border-basil bg-basil/10 cursor-default'
                        : 'border-ink hover:bg-spritz/20 active:translate-y-px'
                    } ${isBusy ? 'opacity-60' : ''}`}
                  >
                    <p className="font-display font-semibold text-sm flex items-center gap-2">
                      {p.name}
                      {isProposed && <span className="text-basil text-xs">✓ proposée</span>}
                    </p>
                    {p.description && (
                      <p className="font-mono text-[11px] text-ink-soft mt-1 line-clamp-2">
                        {p.description}
                      </p>
                    )}
                    <p className="font-mono text-[10px] text-ink-soft mt-1">
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
