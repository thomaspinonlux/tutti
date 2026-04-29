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
  masterEndSession,
  masterGiveAnswer,
  masterListScores,
  masterNextTrack,
  masterPause,
  masterPickRound,
  masterResume,
  masterSkipTrack,
  postBuzz,
} from '../lib/sessions.js';
import type { CorrectAnswerEntry, CumulativeScore } from '@tutti/shared';
import {
  startVoiceCapture,
  uploadVoiceAnswer,
  type VoiceAnswerResult,
  type VoiceCapture,
} from '../lib/voiceCapture.js';
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
        (resp: { ok: boolean; session?: SessionWithParticipants; error?: string }) => {
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
    sock.on('track:correct_answer', (entry: CorrectAnswerEntry) => {
      setCorrectAnswers((prev) => [...prev, entry]);
      if (entry.participant_id === identity.participantId) {
        setMyScore((prev) => prev + entry.score);
      }
    });
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
    setStep(hasPlayedBefore() ? 'onboardingCondensed' : 'onboarding');
  };

  const handleTeamSubmit = (): void => {
    if (!selectedTeam) return;
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
  const handleMasterEndSession = (): Promise<void> =>
    masterCall(async () => {
      if (!identity) return;
      await masterEndSession(identity.sessionId, identity.token);
      // L'event session:ended fera basculer step → 'ended'
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
      <main className="flex-1 px-4 py-6 flex items-start justify-center">
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
                <Underline>{view?.establishment_name ?? '…'}</Underline>
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
            </Card>
          )}

          {step === 'playing' && identity && (
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
            className={`px-3 py-2 border-2 border-ink rounded shadow-pop bg-white animate-pop-in font-medium text-sm ${
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
  window.setTimeout(() => {
    set((prev) => prev.filter((tt) => tt.id !== id));
  }, 4000);
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

function PlayingView(props: PlayingViewProps): JSX.Element {
  const { t } = useTranslation();
  const { currentTrack, identity, myScore, correctAnswers, lastReveal, phase2StartedAt } = props;
  const [recState, setRecState] = useState<RecState>({ kind: 'idle' });
  const [buzzCooldownUntil, setBuzzCooldownUntil] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Reset le state d'enregistrement à chaque nouveau track.
  useEffect(() => {
    setRecState({ kind: 'idle' });
    setError(null);
    setBuzzCooldownUntil(0);
  }, [currentTrack?.track_id]);

  const myCorrect = correctAnswers.find((a) => a.participant_id === identity.participantId);

  // ── Action : tap BUZZ → ouvre le micro et démarre la capture ──────────
  const handleBuzz = async (): Promise<void> => {
    if (!currentTrack) return;
    if (recState.kind !== 'idle') return;
    if (Date.now() < buzzCooldownUntil) return;

    setError(null);
    setBuzzCooldownUntil(Date.now() + 1000); // cooldown 1s anti-tap

    try {
      // 1) Notifie le backend (ouvre la fenêtre micro côté gameState).
      const buzzRes = await postBuzz(identity.sessionId, currentTrack.round_id, identity.token);
      const maxDurationMs = (buzzRes as { buzz_window_ms?: number }).buzz_window_ms ?? 10_000;

      // 2) Démarre la capture audio locale.
      const capture = await startVoiceCapture({
        maxDurationMs,
        onSilence: () => {
          // Auto-stop quand le joueur a fini (1.5s de silence après speech).
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

      // Auto-finalisation au bout du maxDurationMs si rien d'autre n'a coupé avant
      window.setTimeout(() => {
        void finalizeRecording();
      }, maxDurationMs + 200);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur micro';
      // Si le backend a refusé (cooldown, déjà répondu, phase locked) : message clair
      if (msg.includes('ALREADY_ANSWERED')) {
        setError(t('play.alreadyAnswered'));
      } else if (msg.includes('PHASE_LOCKED')) {
        setError(t('play.tooLate'));
      } else {
        setError(msg);
      }
      setRecState({ kind: 'idle' });
    }
  };

  // ── Action : "Envoyer maintenant" ou silence détecté ou timeout ───────
  const finalizeRecording = async (): Promise<void> => {
    setRecState((prev) => {
      if (prev.kind !== 'recording') return prev;
      // Capture le handle puis dispatch async
      void uploadAndShowResult(prev.capture);
      return { kind: 'uploading' };
    });
  };

  const uploadAndShowResult = async (capture: VoiceCapture): Promise<void> => {
    if (!currentTrack) return;
    try {
      const blob = await capture.stop();
      const result = await uploadVoiceAnswer({
        apiUrl: API_BASE,
        sessionId: identity.sessionId,
        roundId: currentTrack.round_id,
        token: identity.token,
        audio: blob,
        filename: capture.mimeType.includes('mp4') ? 'buzz.mp4' : 'buzz.webm',
      });
      setRecState({ kind: 'result', result });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload échoué');
      setRecState({ kind: 'idle' });
    }
  };

  // ── Cancel manuel pendant l'enregistrement ────────────────────────────
  const handleCancelRec = (): void => {
    setRecState((prev) => {
      if (prev.kind === 'recording') {
        prev.capture.cancel();
      }
      return { kind: 'idle' };
    });
  };

  // ── Pas de track : entre 2 manches ────────────────────────────────────
  if (!currentTrack) {
    return (
      <Card size="md" tone="cream" className="text-center">
        <TitleHandwritten as="h2" className="mb-2">
          {t('play.waitingTrack')}
        </TitleHandwritten>
        <p className="font-editorial italic text-ink-2">{t('play.waitingTrackHint')}</p>
        <ScoreBadge score={myScore} />
      </Card>
    );
  }

  // ── État recording : countdown + waveform + Envoyer ───────────────────
  if (recState.kind === 'recording') {
    return (
      <RecordingView
        capture={recState.capture}
        startedAt={recState.startedAt}
        level={recState.level}
        onSubmit={() => void finalizeRecording()}
        onCancel={handleCancelRec}
      />
    );
  }

  // ── État uploading : transcription Whisper en cours ───────────────────
  if (recState.kind === 'uploading') {
    return (
      <Card size="md" tone="spritz" className="text-center">
        <p className="text-5xl mb-3">🎧</p>
        <TitleHandwritten as="h2" className="mb-2">
          {t('play.transcribing')}
        </TitleHandwritten>
        <p className="font-editorial italic text-ink-2 text-sm">{t('play.transcribingHint')}</p>
      </Card>
    );
  }

  // ── État result : matched / not matched ───────────────────────────────
  if (recState.kind === 'result') {
    const r = recState.result;
    return (
      <ResultView
        result={r}
        canRebuzz={
          (currentTrack.phase === 'phase1' || currentTrack.phase === 'phase2') && !myCorrect
        }
        onRebuzz={() => setRecState({ kind: 'idle' })}
        myScore={myScore}
      />
    );
  }

  // ── Phase 3 (festive) : buzzers off, profite de la musique ────────────
  if (
    currentTrack.phase === 'phase3' ||
    currentTrack.phase === 'phase3-revealed' ||
    currentTrack.phase === 'phase3-skipped'
  ) {
    const revealTitle = lastReveal?.title ?? currentTrack.title;
    const revealArtist = lastReveal?.artist ?? currentTrack.artist;
    return (
      <Card size="md" tone="basil" className="text-center">
        {currentTrack.phase !== 'phase3-skipped' && (
          <>
            <p className="text-xs font-mono uppercase tracking-wider text-basil-deep mb-2">
              {t('play.reveal')}
            </p>
            <TitleHandwritten as="h2" className="mb-1">
              {revealTitle}
            </TitleHandwritten>
            <p className="font-editorial italic text-ink-2 mb-4">{revealArtist}</p>
          </>
        )}
        {myCorrect ? (
          <Badge tone="lemon" tilt={-1}>
            {t('play.youScored', { points: myCorrect.score })}
          </Badge>
        ) : currentTrack.phase === 'phase3-revealed' ? (
          <Badge tone="cream" tilt={1}>
            {t('play.masterRevealedNobodyFound')}
          </Badge>
        ) : null}
        <p className="font-editorial italic text-ink-soft text-sm mt-4">
          🎵 {t('play.festivePhase')}
        </p>
        <ScoreBadge score={myScore} />
      </Card>
    );
  }

  // ── Phase 1 / Phase 2 : grand bouton BUZZ ─────────────────────────────
  const inPhase2 = currentTrack.phase === 'phase2';
  const cooldownActive = Date.now() < buzzCooldownUntil;
  return (
    <div className="text-center">
      {inPhase2 && phase2StartedAt && <Phase2Countdown phase2StartedAt={phase2StartedAt} />}
      {!inPhase2 && (
        <p className="font-editorial italic text-ink-2 mb-4">{t('play.listenAndBuzz')}</p>
      )}
      <button
        type="button"
        onClick={() => void handleBuzz()}
        disabled={!!myCorrect || cooldownActive}
        className="w-48 h-48 sm:w-56 sm:h-56 rounded-full bg-spritz text-cream border-3 border-ink shadow-pop-xl font-display text-4xl active:translate-x-1 active:translate-y-1 active:shadow-pop-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        BUZZ
      </button>
      <p className="font-mono text-xs text-ink-soft mt-4">{t('play.buzzHint')}</p>
      {myCorrect && (
        <Badge tone="lemon" tilt={-1} className="mt-3">
          {t('play.youAlreadyFound', { points: myCorrect.score })}
        </Badge>
      )}
      {error && (
        <p role="alert" className="text-sm text-raspberry mt-3">
          {error}
        </p>
      )}
      <ScoreBadge score={myScore} />
    </div>
  );
}

// ── Sous-vues ───────────────────────────────────────────────────────────────

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

function ResultView({
  result,
  canRebuzz,
  onRebuzz,
  myScore,
}: {
  result: VoiceAnswerResult;
  canRebuzz: boolean;
  onRebuzz: () => void;
  myScore: number;
}): JSX.Element {
  const { t } = useTranslation();

  if (result.matched && result.scored) {
    return (
      <Card size="md" tone="basil" className="text-center">
        <p className="text-5xl mb-2">🎉</p>
        <TitleHandwritten as="h2" className="mb-2">
          {t('play.youScored', { points: result.score ?? 0 })}
        </TitleHandwritten>
        {result.position && (
          <Badge tone="lemon" tilt={-1} className="mb-2">
            {t('play.position', { n: result.position })}
          </Badge>
        )}
        {result.transcript && (
          <p className="font-mono text-xs text-ink-soft mt-3 italic">« {result.transcript} »</p>
        )}
        <ScoreBadge score={myScore + (result.score ?? 0)} />
      </Card>
    );
  }

  // Pas matché → on encourage à retenter (en phase 1/2 only).
  return (
    <Card size="md" tone="cream" className="text-center">
      <p className="text-5xl mb-2">🤔</p>
      <TitleHandwritten as="h2" className="mb-2">
        {t('play.notMatched')}
      </TitleHandwritten>
      {result.transcript && (
        <p className="font-mono text-xs text-ink-soft mt-1 italic mb-3">
          {t('play.weHeard')} : « {result.transcript} »
        </p>
      )}
      {canRebuzz ? (
        <Button variant="primary" size="md" onClick={onRebuzz} className="w-full mt-2">
          {t('play.rebuzz')}
        </Button>
      ) : (
        <p className="font-editorial italic text-ink-soft text-sm">{t('play.tooLate')}</p>
      )}
      <ScoreBadge score={myScore} />
    </Card>
  );
}

function Phase2Countdown({ phase2StartedAt }: { phase2StartedAt: string }): JSX.Element {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  const elapsed = now - new Date(phase2StartedAt).getTime();
  const remaining = Math.max(0, 15_000 - elapsed);
  const seconds = Math.ceil(remaining / 1000);
  return (
    <div className="mb-3">
      <Badge tone="raspberry" tilt={-1}>
        ⏱ {t('play.phase2Remaining', { seconds })}
      </Badge>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }): JSX.Element {
  const { t } = useTranslation();
  return (
    <p className="font-mono text-sm text-ink-soft mt-6">
      {t('play.yourScore')}: <span className="font-display text-lg text-ink">{score}</span>
    </p>
  );
}
