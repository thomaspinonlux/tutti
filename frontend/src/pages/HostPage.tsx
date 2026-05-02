/**
 * /host?session=CODE — host iPad / laptop, refonte multi-round (étape 9.5+).
 *
 * Machine à états :
 *   - waiting        : salle d'attente (joueurs rejoignent, host attend)
 *   - roundSelection : pas de round PLAYING, host choisit la prochaine playlist
 *   - roundPlaying   : un round est PLAYING (étape 10 : la mécanique de jeu)
 *   - intermission   : un round vient de se terminer, mini-podium
 *   - ended          : session terminée, podium final cumulé
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Socket } from 'socket.io-client';
import type {
  BuzzResult,
  CorrectAnswerEntry,
  CumulativeScore,
  CurrentTrackState,
  Participant,
  Session,
  SessionRoundWithPlaylist,
  SessionWithParticipants,
  Team,
} from '@tutti/shared';
import {
  createRound,
  endRound,
  endSession,
  getPublicSession,
  getSession,
  giveAnswer,
  hostPauseSession,
  hostResumeSession,
  hostRestartTrack,
  kickParticipant,
  moveParticipantTeam,
  nextTrack,
  playTrack,
  skipTrack,
  startRound,
  startSession,
  toggleParticipantMaster,
} from '../lib/sessions.js';
import { connectAsHost } from '../lib/socket.js';
import { useSpotifyPlayer } from '../lib/useSpotifyPlayer.js';
import { MinScreen } from '../components/MinScreen.js';
import {
  Badge,
  Button,
  Card,
  MultiColorBar,
  TitleHandwritten,
  Underline,
} from '../components/ui/index.js';
import { QRCode } from '../components/host/QRCode.js';
import { RoundSelectionScreen } from '../components/host/RoundSelectionScreen.js';
import { RoundIntermissionScreen } from '../components/host/RoundIntermissionScreen.js';
import { ExpressPlaylistModal } from '../components/host/ExpressPlaylistModal.js';
import { MainScreenView } from './screen/MainScreenView.js';
import { HostQuizzView } from './HostQuizzView.js';
import { ExternalScreenButton } from '../components/host/ExternalScreenButton.js';

interface Toast {
  id: string;
  text: string;
  tone: 'spritz' | 'basil' | 'raspberry';
}

export function HostPage(): JSX.Element {
  return (
    <MinScreen min="lg">
      <HostPageInner />
    </MinScreen>
  );
}

function HostPageInner(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const shortCode = params.get('session');

  const [session, setSession] = useState<SessionWithParticipants | null>(null);
  const [cumulative, setCumulative] = useState<CumulativeScore[]>([]);
  const [hostSocket, setHostSocket] = useState<Socket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState(false);
  const [expressModalOpen, setExpressModalOpen] = useState(false);
  const [forcedSelection, setForcedSelection] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<CurrentTrackState | null>(null);
  // recentBuzzes : conservé pour l'ancien BuzzFeed du mode A. Il sera
  // alimenté par track:correct_answer (mappé en BuzzResult-like) en commit
  // ultérieur — pour l'instant vide, le BuzzFeed restera "Pas encore de buzz".
  const [recentBuzzes] = useState<BuzzResult[]>([]);
  const [correctAnswers, setCorrectAnswers] = useState<CorrectAnswerEntry[]>([]);
  const [phase2StartedAt, setPhase2StartedAt] = useState<string | null>(null);
  const [lastReveal, setLastReveal] = useState<{ artist: string; title: string } | null>(null);
  // Set des participants avec un buzz ouvert (mic en cours d'enregistrement).
  // Sert au compteur "X joueurs ont buzzé" en phase 1 (maquette 06).
  const [activeBuzzers, setActiveBuzzers] = useState<Set<string>>(new Set());

  // ── Bootstrap : socket + state initial ─────────────────────────────────
  useEffect(() => {
    if (!shortCode) {
      setError(t('host.missingCode'));
      return;
    }
    let cancelled = false;
    let socket: Socket | null = null;

    const init = async (): Promise<void> => {
      try {
        const publicView = await getPublicSession(shortCode);
        if (cancelled) return;
        socket = await connectAsHost();
        setHostSocket(socket);
        socket.on('connect_error', (err) => {
          if (cancelled) return;
          setError(`Socket: ${err.message}`);
        });
        socket.emit(
          'session:join_by_code',
          { shortCode: publicView.short_code },
          (resp: { ok: boolean; session?: SessionWithParticipants; error?: string }) => {
            if (cancelled) return;
            if (!resp.ok || !resp.session) {
              setError(resp.error ?? t('host.notFound'));
              return;
            }
            setSession(resp.session);
            void getSession(resp.session.id)
              .then((res) => {
                if (!cancelled) setCumulative(res.cumulative);
              })
              .catch(() => {});

            socket?.on('participant:joined', ({ participant }: { participant: Participant }) => {
              setSession((s) => (s ? { ...s, participants: [...s.participants, participant] } : s));
              pushToast(setToasts, t('host.toastJoined', { pseudo: participant.pseudo }), 'spritz');
            });
            socket?.on(
              'participant:moved_team',
              ({ participant }: { participant: Participant }) => {
                setSession((s) =>
                  s
                    ? {
                        ...s,
                        participants: s.participants.map((p) =>
                          p.id === participant.id ? participant : p,
                        ),
                      }
                    : s,
                );
              },
            );
            socket?.on('participant:kicked', ({ participant }: { participant: Participant }) => {
              setSession((s) =>
                s
                  ? { ...s, participants: s.participants.filter((p) => p.id !== participant.id) }
                  : s,
              );
              pushToast(
                setToasts,
                t('host.toastKicked', { pseudo: participant.pseudo }),
                'raspberry',
              );
            });
            socket?.on(
              'participant:master_changed',
              ({ participant, is_master }: { participant: Participant; is_master: boolean }) => {
                // Côté backend, on a démasterisé tous les autres avant de
                // (dé)masteriser la cible. On reflète ça côté UI.
                setSession((s) =>
                  s
                    ? {
                        ...s,
                        participants: s.participants.map((p) =>
                          p.id === participant.id
                            ? { ...p, is_master }
                            : { ...p, is_master: false },
                        ),
                      }
                    : s,
                );
              },
            );
            socket?.on('session:started', ({ session: s }: { session: Session }) => {
              setSession((prev) => (prev ? { ...prev, ...s } : prev));
              pushToast(setToasts, t('host.toastStarted'), 'basil');
            });
            socket?.on(
              'session:ended',
              ({
                session: s,
                cumulative: c,
              }: {
                session: Session;
                cumulative: CumulativeScore[];
              }) => {
                setSession((prev) => (prev ? { ...prev, ...s } : prev));
                setCumulative(c);
              },
            );
            socket?.on('round:created', ({ round }: { round: SessionRoundWithPlaylist }) => {
              setSession((prev) => (prev ? { ...prev, rounds: [...prev.rounds, round] } : prev));
            });
            socket?.on('round:started', ({ round }: { round: SessionRoundWithPlaylist }) => {
              setSession((prev) =>
                prev
                  ? {
                      ...prev,
                      rounds: prev.rounds.map((r) =>
                        r.id === round.id
                          ? round
                          : r.status === 'PLAYING'
                            ? { ...r, status: 'ENDED' }
                            : r,
                      ),
                    }
                  : prev,
              );
            });
            socket?.on('round:ended', ({ round }: { round: SessionRoundWithPlaylist }) => {
              setSession((prev) =>
                prev
                  ? { ...prev, rounds: prev.rounds.map((r) => (r.id === round.id ? round : r)) }
                  : prev,
              );
              setCurrentTrack(null);
            });
            // Gameplay events (Phase C voice-first)
            socket?.on('track:start', ({ state }: { state: CurrentTrackState }) => {
              setCurrentTrack(state);
              // Reset les états par-track
              setCorrectAnswers([]);
              setPhase2StartedAt(null);
              setLastReveal(null);
              setActiveBuzzers(new Set());
            });
            socket?.on(
              'buzz:received',
              (payload: {
                round_id: string;
                participant_id: string;
                participant_pseudo: string;
                buzzed_at_ms: number;
                expires_at_ms: number;
              }) => {
                // Compteur de buzzes pour la phase 1 (maquette 06 — top-left
                // du center stage). On ajoute le participant au set, et on le
                // retire automatiquement à expires_at_ms (fin de la fenêtre
                // micro 10s).
                setActiveBuzzers((prev) => {
                  const next = new Set(prev);
                  next.add(payload.participant_id);
                  return next;
                });
                const remainingMs = Math.max(0, payload.expires_at_ms - Date.now());
                window.setTimeout(() => {
                  setActiveBuzzers((prev) => {
                    if (!prev.has(payload.participant_id)) return prev;
                    const next = new Set(prev);
                    next.delete(payload.participant_id);
                    return next;
                  });
                }, remainingMs);
              },
            );
            socket?.on('track:correct_answer', (entry: CorrectAnswerEntry) => {
              setCorrectAnswers((prev) => [...prev, entry]);
              // Le toast festif XL est déclenché côté MainScreenView via l'effect
              // qui watch correctAnswers.length.
              if (resp.session) {
                void getSession(resp.session.id)
                  .then((res) => setCumulative(res.cumulative))
                  .catch(() => {});
              }
            });
            socket?.on(
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
                  setLastReveal({ artist: payload.artist, title: payload.title });
                }
              },
            );
            socket?.on(
              'track:revealed',
              (payload: { round_id: string; artist: string; title: string }) => {
                setLastReveal({ artist: payload.artist, title: payload.title });
              },
            );
            socket?.on('session:paused', () => {
              setSession((prev) => (prev ? { ...prev, is_paused: true } : prev));
            });
            socket?.on('session:resumed', () => {
              setSession((prev) => (prev ? { ...prev, is_paused: false } : prev));
            });
            // track:restart attaché dans un useEffect séparé pour éviter
            // closure stale sur spotify.restartCurrentTrack (cf. ci-dessous).
            socket?.on('scores:invalidated', () => {
              if (resp.session) {
                void getSession(resp.session.id)
                  .then((res) => setCumulative(res.cumulative))
                  .catch(() => {});
              }
            });
          },
        );
      } catch (err: unknown) {
        if (!cancelled) setError((err as Error).message);
      }
    };

    void init();
    return () => {
      cancelled = true;
      socket?.disconnect();
      setHostSocket(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortCode]);

  // ── État dérivé ────────────────────────────────────────────────────────
  type Phase = 'waiting' | 'roundSelection' | 'roundPlaying' | 'intermission' | 'ended';
  const phase: Phase = useMemo(() => {
    if (!session) return 'waiting';
    if (session.status === 'ENDED') return 'ended';
    if (session.status === 'WAITING') return 'waiting';
    const playing = session.rounds.find((r) => r.status === 'PLAYING');
    if (playing) return 'roundPlaying';
    const lastEnded = [...session.rounds].reverse().find((r) => r.status === 'ENDED');
    if (lastEnded) return 'intermission';
    return 'roundSelection';
  }, [session]);

  useEffect(() => {
    if (phase === 'roundPlaying' || phase === 'ended') setForcedSelection(false);
  }, [phase]);

  const effectivePhase: Phase =
    forcedSelection && phase === 'intermission' ? 'roundSelection' : phase;

  const playingRound = session?.rounds.find((r) => r.status === 'PLAYING') ?? null;
  const lastEndedRound = session
    ? [...session.rounds].reverse().find((r) => r.status === 'ENDED')
    : null;
  const pendingRound = session?.rounds.find((r) => r.status === 'PENDING') ?? null;
  const playingRoundsCount = session?.rounds.filter((r) => r.status !== 'PENDING').length ?? 0;
  const currentMaster = session?.participants.find((p) => p.is_master) ?? null;

  // ── Audio playback (Phase B) ───────────────────────────────────────────
  // On charge le SDK Spotify dès qu'on est en phase de lecture. Le hook se
  // débrouille pour ignorer si aucun track:start ne demande Spotify.
  const spotify = useSpotifyPlayer({ enabled: phase === 'roundPlaying' });

  // Listener track:restart séparé — re-attaché à chaque changement de socket
  // ou de spotify pour garantir une closure fraîche sur restartCurrentTrack.
  useEffect(() => {
    if (!hostSocket) return;
    const handler = (): void => {
      void spotify.restartCurrentTrack();
    };
    hostSocket.on('track:restart', handler);
    return () => {
      hostSocket.off('track:restart', handler);
    };
  }, [hostSocket, spotify]);

  // Auto-play selon les events gameplay (Phase C : musique continue en
  // phase 2 + phase 3, ne s'arrête QUE sur phase3-skipped ou round/session end).
  useEffect(() => {
    if (!currentTrack) {
      // Round terminé mid-track ou track effacé : on coupe le son
      void spotify.pause();
      return;
    }
    if (currentTrack.provider !== 'spotify') return;
    if (session?.is_paused) {
      // Pause master active : effet géré ci-dessous, on ne touche pas ici.
      return;
    }

    // Sur le NOUVEAU track (track_id change), on lance la lecture.
    // Pendant phase 2 et phase 3 et phase 3-revealed, on laisse jouer (musique
    // continue jusqu'à la fin naturelle). Sur phase 3-skipped, on coupe.
    if (currentTrack.phase === 'phase3-skipped') {
      void spotify.pause();
      return;
    }
    // Pour les autres phases : on déclenche play() seulement si on vient de
    // changer de track (le useEffect retrigger sur track_id).
    void spotify.play(`spotify:track:${currentTrack.provider_track_id}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentTrack?.track_id,
    currentTrack?.phase === 'phase3-skipped',
    currentTrack?.provider,
    currentTrack === null,
    session?.is_paused,
  ]);

  // Master pause/resume : pause/reprise l'audio Spotify si on était en train
  // de jouer, et indépendamment de la phase track.
  useEffect(() => {
    if (!currentTrack) return;
    if (currentTrack.provider !== 'spotify') return;
    if (session?.is_paused) {
      void spotify.pause();
    } else if (currentTrack.phase === 'phase1') {
      // Reprise pendant l'écoute → on relance la lecture du morceau courant
      void spotify.resume();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.is_paused]);

  // ── Actions ────────────────────────────────────────────────────────────
  const refreshCumulative = async (sid: string): Promise<void> => {
    try {
      const res = await getSession(sid);
      setCumulative(res.cumulative);
      setSession(res.session);
    } catch {
      /* ignore */
    }
  };

  const handleStartSession = async (): Promise<void> => {
    if (!session) return;
    setBusy(true);
    try {
      // Active le pipeline audio Spotify (anti-blocage Chrome autoplay).
      // Ce clic est la 1ʳᵉ interaction utilisateur — moment idéal pour
      // débloquer le HTMLMediaElement interne du SDK.
      await spotify.activate();
      await startSession(session.id);
      if (pendingRound) {
        await startRound(session.id, pendingRound.id);
        // Démarre auto le 1ᵉʳ track
        await playTrack(session.id, pendingRound.id);
      }
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handlePauseAudio = async (): Promise<void> => {
    if (!session || !playingRound) return;
    try {
      await hostPauseSession(session.id, playingRound.id);
      await spotify.pause();
    } catch (err: unknown) {
      console.warn('[host pause]', err);
    }
  };

  const handleResumeAudio = async (): Promise<void> => {
    if (!session || !playingRound) return;
    try {
      await hostResumeSession(session.id, playingRound.id);
      await spotify.resume();
    } catch (err: unknown) {
      console.warn('[host resume]', err);
    }
  };

  const handleRestartTrack = async (): Promise<void> => {
    if (!session || !playingRound) return;
    try {
      await hostRestartTrack(session.id, playingRound.id);
      // Le broadcast track:restart déclenche le restart côté ce client aussi
      // (via le useEffect listener), donc pas besoin d'appel direct ici.
    } catch (err: unknown) {
      console.warn('[host restart]', err);
    }
  };

  const handlePickPlaylist = async (playlistId: string): Promise<void> => {
    if (!session) return;
    setBusy(true);
    try {
      // Idempotent — réactive l'audio si l'utilisateur arrive direct depuis
      // roundSelection (cas où handleStartSession ne s'est pas exécuté).
      await spotify.activate();
      const round = await createRound(session.id, playlistId);
      await startRound(session.id, round.id);
      await playTrack(session.id, round.id);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleNextTrack = async (): Promise<void> => {
    if (!session || !playingRound) return;
    setBusy(true);
    try {
      await nextTrack(session.id, playingRound.id);
      // round:ended est broadcast auto si fin de playlist
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSkipTrack = async (): Promise<void> => {
    if (!session || !playingRound) return;
    setBusy(true);
    try {
      await skipTrack(session.id, playingRound.id);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleGiveAnswer = async (): Promise<void> => {
    if (!session || !playingRound) return;
    setBusy(true);
    try {
      await giveAnswer(session.id, playingRound.id);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleEndCurrentRound = async (): Promise<void> => {
    if (!session || !playingRound) return;
    setBusy(true);
    try {
      await endRound(session.id, playingRound.id);
      await refreshCumulative(session.id);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleToggleMaster = async (participantId: string): Promise<void> => {
    if (!session) return;
    try {
      await toggleParticipantMaster(session.id, participantId);
      // L'event socket participant:master_changed mettra à jour l'UI.
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  };

  const handleEndSession = async (): Promise<void> => {
    if (!session) return;
    if (!window.confirm(t('host.endBlindTestConfirm'))) return;
    setBusy(true);
    try {
      const res = await endSession(session.id);
      setSession((prev) => (prev ? { ...prev, ...res.session } : prev));
      setCumulative(res.cumulative);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen flex flex-col">
        <MultiColorBar height="md" />
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md text-center">
            <p className="text-raspberry font-medium mb-4">{error}</p>
            <Button variant="secondary" onClick={() => navigate('/admin/dashboard')}>
              {t('host.backDashboard')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="font-mono text-ink-soft">{t('common.loading')}</p>
      </div>
    );
  }

  // ── Branche Tutti Quizz : vue dédiée pour les sessions QUIZZ ─────────────
  // Mode A (has_animator) : iPad = console host avec contrôles.
  // Mode B (!has_animator) : iPad = vue publique festive XL, master pilote depuis tel.
  if (session.game_type === 'QUIZZ') {
    return (
      <HostQuizzView
        session={session}
        cumulative={cumulative}
        socket={hostSocket}
        onSessionUpdate={(s) => setSession(s)}
        onCumulativeUpdate={(c) => setCumulative(c)}
        publicView={!session.has_animator}
      />
    );
  }

  const teams = (session.teams_config as Team[] | null) ?? [];
  const playUrl = `${window.location.origin}/play?session=${session.short_code}`;
  const isModeB = !session.has_animator;
  const inGameplay =
    effectivePhase === 'roundPlaying' ||
    effectivePhase === 'roundSelection' ||
    effectivePhase === 'intermission';

  // ── Mode B en cours de jeu : vue festive publique sans contrôles ─────
  if (isModeB && inGameplay) {
    return (
      <>
        {/* Badge master + change-master accessible discrètement en haut-droite */}
        <div className="fixed top-4 right-4 z-30 flex gap-2 items-center">
          <ExternalScreenButton shortCode={session.short_code} />
          <MasterBadge
            master={currentMaster}
            participants={session.participants}
            onToggleMaster={handleToggleMaster}
          />
        </div>
        <MainScreenView
          session={session}
          currentTrack={currentTrack}
          cumulative={cumulative}
          correctAnswers={correctAnswers}
          phase2StartedAt={phase2StartedAt}
          lastReveal={lastReveal}
          activeBuzzCount={activeBuzzers.size}
          busy={busy}
          onSkipTrack={handleSkipTrack}
          onGiveAnswer={handleGiveAnswer}
          onNextTrack={handleNextTrack}
        />
        <div className="fixed bottom-4 right-4 z-40 space-y-2 max-w-xs">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`px-4 py-2 border-2 border-ink rounded shadow-pop bg-white animate-pop-in font-medium text-sm ${
                toast.tone === 'spritz'
                  ? 'border-l-8 border-l-spritz'
                  : toast.tone === 'basil'
                    ? 'border-l-8 border-l-basil'
                    : 'border-l-8 border-l-raspberry'
              }`}
            >
              {toast.text}
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <MultiColorBar height="md" />

      <main className="flex-1 px-6 lg:px-10 py-8">
        <header className="max-w-7xl mx-auto mb-8 flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-1">
              {effectivePhase === 'waiting'
                ? t('host.eyebrow')
                : effectivePhase === 'ended'
                  ? t('host.eyebrowEnded')
                  : t('host.eyebrowPlaying', { round: playingRoundsCount })}
            </p>
            <TitleHandwritten as="h1">
              {session.name ? <Underline>{session.name}</Underline> : t('host.title')}
            </TitleHandwritten>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <ExternalScreenButton shortCode={session.short_code} />
            {!session.has_animator &&
              (effectivePhase === 'roundPlaying' ||
                effectivePhase === 'roundSelection' ||
                effectivePhase === 'intermission') && (
                <MasterBadge
                  master={currentMaster}
                  participants={session.participants}
                  onToggleMaster={handleToggleMaster}
                />
              )}
            {/* En mode A : bouton terminer accessible sur l'iPad. En mode B :
                c'est le master qui termine depuis son tel (cf. brief). */}
            {session.has_animator &&
              (effectivePhase === 'roundPlaying' ||
                effectivePhase === 'roundSelection' ||
                effectivePhase === 'intermission') && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleEndSession()}
                  disabled={busy}
                >
                  {t('host.endBlindTest')}
                </Button>
              )}
          </div>
        </header>

        <div className="max-w-7xl mx-auto">
          {effectivePhase === 'waiting' && (
            <WaitingPhase
              shortCode={session.short_code}
              playUrl={playUrl}
              participants={session.participants}
              teams={teams}
              mode={session.mode}
              busy={busy}
              hasPendingRound={!!pendingRound}
              hasAnimator={session.has_animator}
              currentMasterId={currentMaster?.id ?? null}
              onStart={handleStartSession}
              onMove={async (pid, tid) => {
                await moveParticipantTeam(session.id, pid, tid);
              }}
              onKick={async (pid) => {
                if (window.confirm(t('host.kickConfirm'))) {
                  await kickParticipant(session.id, pid);
                }
              }}
              onToggleMaster={handleToggleMaster}
            />
          )}

          {effectivePhase === 'roundSelection' && (
            <RoundSelectionScreen
              isFirstRound={session.rounds.length === 0}
              onPickPlaylist={handlePickPlaylist}
              onCreateExpress={() => setExpressModalOpen(true)}
              onEndSession={handleEndSession}
              loading={busy}
            />
          )}

          {effectivePhase === 'roundPlaying' && playingRound && (
            <RoundPlayingScreen
              round={playingRound}
              cumulative={cumulative}
              currentTrack={currentTrack}
              recentBuzzes={recentBuzzes}
              onNextTrack={handleNextTrack}
              onEndRound={handleEndCurrentRound}
              busy={busy}
              isPaused={session.is_paused}
              spotifyStatus={spotify.status}
              spotifyError={spotify.error}
              spotifyErrorCode={spotify.errorCode}
              onForceAudio={() => void spotify.transferToTutti()}
              onPauseAudio={() => void handlePauseAudio()}
              onResumeAudio={() => void handleResumeAudio()}
              onRestartTrack={() => void handleRestartTrack()}
            />
          )}

          {effectivePhase === 'intermission' && lastEndedRound && (
            <RoundIntermissionScreen
              round={lastEndedRound}
              cumulative={cumulative}
              onNextRound={() => setForcedSelection(true)}
              onEndSession={handleEndSession}
              loading={busy}
            />
          )}

          {effectivePhase === 'ended' && <EndedScreen cumulative={cumulative} />}
        </div>
      </main>

      <ExpressPlaylistModal
        open={expressModalOpen}
        onClose={() => setExpressModalOpen(false)}
        nextRoundPosition={session.rounds.length + 1}
        language={(session.language as 'fr' | 'en') ?? 'fr'}
        onLaunch={(playlistId) => {
          setExpressModalOpen(false);
          return handlePickPlaylist(playlistId);
        }}
      />

      <div className="fixed bottom-4 right-4 z-40 space-y-2 max-w-xs">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`px-4 py-2 border-2 border-ink rounded shadow-pop bg-white animate-pop-in font-medium text-sm ${
              toast.tone === 'spritz'
                ? 'border-l-8 border-l-spritz'
                : toast.tone === 'basil'
                  ? 'border-l-8 border-l-basil'
                  : 'border-l-8 border-l-raspberry'
            }`}
          >
            {toast.text}
          </div>
        ))}
      </div>

      <MultiColorBar height="md" />

      {/* Debug Spotify (visible uniquement quand SDK actif) */}
      {spotify.status !== 'idle' && (
        <div className="fixed bottom-2 left-2 z-50 max-w-[280px] px-2 py-1 bg-ink/90 text-cream font-mono text-[10px] rounded border border-cream/30 leading-tight">
          <div>
            🎵 Spotify: <strong>{spotify.status}</strong>
            {spotify.isPlaying ? ' ▶' : ' ⏸'}
          </div>
          <div className="opacity-70 truncate">
            device: {spotify.deviceId ? spotify.deviceId.substring(0, 16) + '…' : 'none'}
          </div>
          {spotify.lastEvent && (
            <div className="opacity-70 truncate">last: {spotify.lastEvent}</div>
          )}
          {spotify.error && <div className="text-raspberry truncate">⚠ {spotify.error}</div>}
        </div>
      )}
    </div>
  );
}

// ── Sous-écrans ─────────────────────────────────────────────────────────────

function MasterBadge({
  master,
  participants,
  onToggleMaster,
}: {
  master: Participant | null;
  participants: Participant[];
  onToggleMaster: (id: string) => Promise<void>;
}): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-xs font-mono px-3 py-1.5 border-2 border-ink rounded bg-cream-2 hover:bg-cream"
      >
        <span aria-hidden>👑</span>
        <span>
          {master ? (
            <>
              {t('host.masterIs')} <strong>{master.pseudo}</strong>
            </>
          ) : (
            t('host.masterNone')
          )}
        </span>
        <span aria-hidden className="text-ink-soft">
          ▾
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-30 w-64 max-h-72 overflow-auto bg-white border-2 border-ink rounded shadow-pop p-2">
          <p className="text-[10px] font-mono uppercase tracking-wider text-ink-soft px-2 py-1">
            {t('host.masterChange')}
          </p>
          <ul className="space-y-1">
            {participants.length === 0 && (
              <li className="px-2 py-2 font-editorial italic text-xs text-ink-soft">
                {t('host.waitingForPlayers')}
              </li>
            )}
            {participants.map((p) => {
              const isCurrent = p.id === master?.id;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      void onToggleMaster(p.id);
                      setOpen(false);
                    }}
                    className={[
                      'w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2',
                      isCurrent ? 'bg-basil/15 text-ink' : 'hover:bg-cream-2',
                    ].join(' ')}
                  >
                    {isCurrent && <span aria-hidden>👑</span>}
                    <span className="truncate flex-1">{p.pseudo}</span>
                    {isCurrent && (
                      <span className="text-[10px] font-mono text-basil-deep">
                        {t('host.masterRevoke')}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function WaitingPhase({
  shortCode,
  playUrl,
  participants,
  teams,
  mode,
  busy,
  hasPendingRound,
  hasAnimator,
  currentMasterId,
  onStart,
  onMove,
  onKick,
  onToggleMaster,
}: {
  shortCode: string;
  playUrl: string;
  participants: Participant[];
  teams: Team[];
  mode: 'SOLO' | 'TEAMS';
  busy: boolean;
  hasPendingRound: boolean;
  hasAnimator: boolean;
  currentMasterId: string | null;
  onStart: () => Promise<void>;
  onMove: (participantId: string, teamId: string | null) => Promise<void>;
  onKick: (participantId: string) => Promise<void>;
  onToggleMaster: (participantId: string) => Promise<void>;
}): JSX.Element {
  const { t } = useTranslation();
  // Mode B exige qu'un master soit désigné avant de démarrer.
  const needsMaster = !hasAnimator && !currentMasterId;
  const canStart = !busy && participants.length >= 1 && !needsMaster;
  return (
    <div className="grid gap-8 lg:grid-cols-1 xl:grid-cols-[auto_1fr]">
      <Card size="lg" tone="cream" className="text-center">
        <p className="text-xs font-mono uppercase tracking-wider text-ink-soft mb-3">
          {t('host.scanToJoin')}
        </p>
        <QRCode value={playUrl} size={280} className="mx-auto mb-4" />
        <p className="font-mono text-3xl tracking-[0.2em] text-ink mb-1">{shortCode}</p>
        <p className="font-editorial italic text-sm text-ink-soft">{playUrl}</p>
      </Card>

      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="font-display text-2xl">
            {t('host.participants')} <span className="text-ink-soft">({participants.length})</span>
          </p>
          <Button onClick={() => void onStart()} disabled={!canStart} size="lg">
            {busy
              ? t('host.starting')
              : hasPendingRound
                ? t('host.startBlindTestWithFirstRound')
                : t('host.startBlindTest')}
          </Button>
        </div>

        {!hasAnimator && (
          <Card tone={currentMasterId ? 'basil' : 'cream'} size="md">
            <p className="text-xs font-mono uppercase tracking-wider text-ink-soft mb-1">
              {t('host.masterSectionLabel')}
            </p>
            <p className="font-editorial italic text-sm text-ink-2">
              {currentMasterId
                ? t('host.masterPickedHint', {
                    pseudo: participants.find((p) => p.id === currentMasterId)?.pseudo ?? '',
                  })
                : t('host.masterPickHint')}
            </p>
          </Card>
        )}

        {mode === 'TEAMS' ? (
          <TeamsView
            teams={teams}
            participants={participants}
            currentMasterId={currentMasterId}
            showMasterToggle={!hasAnimator}
            onMove={onMove}
            onKick={onKick}
            onToggleMaster={onToggleMaster}
          />
        ) : (
          <ParticipantsList
            participants={participants}
            currentMasterId={currentMasterId}
            showMasterToggle={!hasAnimator}
            onKick={onKick}
            onToggleMaster={onToggleMaster}
          />
        )}
      </div>
    </div>
  );
}

function RoundPlayingScreen({
  round,
  cumulative,
  currentTrack,
  recentBuzzes,
  onNextTrack,
  onEndRound,
  busy,
  isPaused,
  spotifyStatus,
  spotifyError,
  spotifyErrorCode,
  onForceAudio,
  onPauseAudio,
  onResumeAudio,
  onRestartTrack,
}: {
  round: SessionRoundWithPlaylist;
  cumulative: CumulativeScore[];
  currentTrack: CurrentTrackState | null;
  recentBuzzes: BuzzResult[];
  onNextTrack: () => Promise<void>;
  onEndRound: () => Promise<void>;
  busy: boolean;
  isPaused: boolean;
  spotifyStatus: import('../lib/useSpotifyPlayer.js').SpotifyPlayerStatus;
  spotifyError: string | null;
  spotifyErrorCode: string | null;
  onForceAudio: () => void;
  onPauseAudio: () => void;
  onResumeAudio: () => void;
  onRestartTrack: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const top5 = cumulative.slice(0, 5);
  const totalTracks = round.playlist.tracks_count ?? 0;
  const trackPosition = currentTrack ? currentTrack.track_index + 1 : round.current_track_index + 1;

  const showSpotifyStatus =
    currentTrack?.provider === 'spotify' || (currentTrack === null && spotifyStatus !== 'idle');
  const isDemoProvider = currentTrack?.provider === 'demo';

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      {/* ── Colonne gauche : track en cours ──────────────────────────── */}
      <Card tone="spritz" size="lg" className="text-center">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <Badge tone="cream" tilt={-1}>
            {t('host.currentRound', { n: round.position })}
          </Badge>
          {totalTracks > 0 && (
            <Badge tone="ink" tilt={1}>
              {t('host.trackPosition', { current: trackPosition, total: totalTracks })}
            </Badge>
          )}
        </div>
        <TitleHandwritten as="h2" className="mb-4">
          <Underline>{round.playlist.name}</Underline>
        </TitleHandwritten>

        {showSpotifyStatus && (
          <SpotifyStatusBanner
            status={spotifyStatus}
            error={spotifyError}
            errorCode={spotifyErrorCode}
          />
        )}
        {showSpotifyStatus && spotifyStatus === 'ready' && currentTrack && (
          <Button variant="ghost" size="sm" onClick={onForceAudio} className="mt-2">
            🔊 {t('host.forceAudioOnDevice')}
          </Button>
        )}
        {isDemoProvider && (
          <p className="font-mono text-xs text-ink-soft my-3">{t('host.demoProviderHint')}</p>
        )}

        {!currentTrack ? (
          <p className="font-editorial italic text-ink-2 my-8">{t('host.noTrackYet')}</p>
        ) : currentTrack.phase === 'phase1' ? (
          <ListeningView track={currentTrack} />
        ) : currentTrack.phase === 'phase2' ? (
          <BuzzedView track={currentTrack} />
        ) : (
          <CooldownView track={currentTrack} lastBuzz={recentBuzzes[0] ?? null} />
        )}

        <div className="flex items-center justify-center gap-3 mt-6 flex-wrap">
          <Button
            variant="primary"
            size="md"
            onClick={() => void onNextTrack()}
            disabled={busy || !currentTrack || currentTrack.phase === 'phase1'}
          >
            {t('host.nextTrack')} →
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void onEndRound()} disabled={busy}>
            {t('host.endRound')}
          </Button>
        </div>

        {/* ── Contrôles audio (pause / reprendre / recommencer) ────────── */}
        {currentTrack && (
          <div className="mt-3 pt-3 border-t-2 border-ink/10 flex items-center justify-center gap-2 flex-wrap">
            {!isPaused ? (
              <Button variant="ghost" size="sm" onClick={onPauseAudio} disabled={busy}>
                ⏸️ {t('host.pauseAudio')}
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={onResumeAudio} disabled={busy}>
                ▶️ {t('host.resumeAudio')}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onRestartTrack} disabled={busy}>
              🔄 {t('host.restartTrack')}
            </Button>
          </div>
        )}
      </Card>

      {/* ── Colonne droite : classement + buzz feed ──────────────────── */}
      <div className="space-y-4">
        <Card size="md">
          <p className="text-xs font-mono uppercase tracking-wider text-ink-soft mb-3">
            {t('host.cumulativeScores')}
          </p>
          {top5.length === 0 ? (
            <p className="font-editorial italic text-sm text-ink-soft">{t('host.noScoresYet')}</p>
          ) : (
            <ol className="space-y-2">
              {top5.map((entry, idx) => (
                <li
                  key={entry.id}
                  className="flex items-center gap-3 px-3 py-2 border-2 border-ink rounded bg-white"
                >
                  <span className="font-display text-xl w-6 text-center text-spritz-deep">
                    {idx + 1}
                  </span>
                  {entry.color && (
                    <span
                      aria-hidden
                      className="w-3 h-3 rounded-full border-2 border-ink shrink-0"
                      style={{ backgroundColor: entry.color }}
                    />
                  )}
                  <span className="font-medium flex-1 truncate text-sm">{entry.label}</span>
                  <Badge tone="ink">{entry.total_points}</Badge>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card size="md">
          <p className="text-xs font-mono uppercase tracking-wider text-ink-soft mb-3">
            {t('host.buzzFeed')}
          </p>
          {recentBuzzes.length === 0 ? (
            <p className="font-editorial italic text-sm text-ink-soft">{t('host.buzzFeedEmpty')}</p>
          ) : (
            <ul className="space-y-2">
              {recentBuzzes.map((buzz, idx) => (
                <li
                  key={`${buzz.round_id}-${buzz.track_index}-${idx}`}
                  className="flex items-center gap-2 text-xs"
                >
                  <span className="font-medium truncate">{buzz.participant_pseudo}</span>
                  <span className="text-ink-soft truncate flex-1">
                    {buzz.matched_artist
                      ? buzz.matched_title
                        ? `${buzz.reveal.artist} — ${buzz.reveal.title}`
                        : buzz.reveal.artist
                      : t('host.notFound')}
                  </span>
                  <Badge tone={buzz.total_points > 0 ? 'basil' : 'plum'}>
                    {buzz.total_points > 0 ? `+${buzz.total_points}` : '0'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

// ── Sous-vues du track en cours ──────────────────────────────────────────

function useTimeRemaining(startedAtIso: string, durationMs: number): number {
  const [remaining, setRemaining] = useState(() => {
    const elapsed = Date.now() - new Date(startedAtIso).getTime();
    return Math.max(0, durationMs - elapsed);
  });
  useEffect(() => {
    const tick = (): void => {
      const elapsed = Date.now() - new Date(startedAtIso).getTime();
      setRemaining(Math.max(0, durationMs - elapsed));
    };
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [startedAtIso, durationMs]);
  return remaining;
}

function ListeningView({ track }: { track: CurrentTrackState }): JSX.Element {
  const { t } = useTranslation();
  // Phase C : la durée du morceau vient de track.duration_ms (Spotify), null
  // pour les morceaux Demo. Fallback 30s en attendant la rewrite commit 6.
  const durationMs = track.duration_ms ?? 30_000;
  const remaining = useTimeRemaining(track.started_at, durationMs);
  const seconds = Math.ceil(remaining / 1000);
  const progress = 1 - remaining / durationMs;
  return (
    <div className="py-6">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-2">
        {t('host.listening')}
      </p>
      <p className="font-display text-7xl text-ink mb-1">{seconds}s</p>
      <p className="font-editorial italic text-ink-2 mb-4">{t('host.waitingForBuzz')}</p>
      <div className="h-2 border-2 border-ink rounded bg-cream-2 overflow-hidden max-w-sm mx-auto">
        <div
          className="h-full bg-spritz-deep transition-[width] duration-100 ease-linear"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
    </div>
  );
}

function BuzzedView({ track }: { track: CurrentTrackState }): JSX.Element {
  const { t } = useTranslation();
  // Stub commit 2 — la BuzzedView complète arrive en commit 6 avec les
  // multi-correct-answers + chrono phase 2.
  void track;
  return (
    <div className="py-6">
      <p className="font-display text-6xl text-spritz-deep mb-2 animate-pop-in">
        {t('host.buzzed')} !
      </p>
      <p className="font-editorial italic text-ink-2">
        {t('host.awaitingAnswer', { pseudo: '…' })}
      </p>
    </div>
  );
}

function SpotifyStatusBanner({
  status,
  error,
  errorCode,
}: {
  status: import('../lib/useSpotifyPlayer.js').SpotifyPlayerStatus;
  error: string | null;
  errorCode: string | null;
}): JSX.Element | null {
  const { t } = useTranslation();
  if (status === 'idle' || status === 'ready') return null;
  if (status === 'loading_sdk' || status === 'loading_token' || status === 'connecting') {
    return (
      <p className="font-mono text-xs text-ink-soft my-3 animate-pulse">
        {t('host.spotifyLoading')}
      </p>
    );
  }
  // Erreur
  const msg =
    errorCode === 'NOT_CONNECTED'
      ? t('host.spotifyNotConnected')
      : errorCode === 'PREMIUM_REQUIRED'
        ? t('host.spotifyPremiumRequired')
        : (error ?? t('host.spotifyError'));
  return (
    <div className="my-3 px-3 py-2 border-2 border-raspberry rounded bg-cream-2 text-xs text-raspberry">
      <span className="font-medium">{t('host.spotifyErrorEyebrow')} :</span> {msg}
    </div>
  );
}

function CooldownView({
  track,
  lastBuzz,
}: {
  track: CurrentTrackState;
  lastBuzz: BuzzResult | null;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="py-4">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-soft mb-2">
        {t('host.reveal')}
      </p>
      <p className="font-display text-3xl text-ink leading-tight">{track.title}</p>
      <p className="font-editorial italic text-xl text-ink-2 mb-4">{track.artist}</p>
      {lastBuzz && (
        <Badge tone={lastBuzz.total_points > 0 ? 'basil' : 'plum'} tilt={-2}>
          {lastBuzz.participant_pseudo} :{' '}
          {lastBuzz.total_points > 0 ? `+${lastBuzz.total_points}` : '0'} pts
        </Badge>
      )}
    </div>
  );
}

function EndedScreen({ cumulative }: { cumulative: CumulativeScore[] }): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [first, second, third, ...rest] = cumulative;

  return (
    <div className="max-w-3xl mx-auto text-center">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-2">
        {t('host.podiumEyebrow')}
      </p>
      <TitleHandwritten as="h2" className="mb-8">
        <Underline>{t('host.podiumTitle')}</Underline>
      </TitleHandwritten>

      {cumulative.length === 0 ? (
        <p className="font-editorial italic text-ink-soft mb-6">{t('host.noScoresYet')}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            {[second, first, third].filter(Boolean).map((entry) => {
              const rank = entry === first ? 1 : entry === second ? 2 : 3;
              const tone = (rank === 1 ? 'spritz' : rank === 2 ? 'basil' : 'plum') as
                | 'spritz'
                | 'basil'
                | 'plum';
              return (
                <Card
                  key={entry!.id}
                  tone={tone}
                  size="md"
                  className={
                    rank === 1
                      ? 'sm:order-2 sm:scale-110'
                      : rank === 2
                        ? 'sm:order-1'
                        : 'sm:order-3'
                  }
                >
                  <p className="font-display text-5xl mb-1">{rank}</p>
                  <p className="font-medium truncate">{entry!.label}</p>
                  <Badge tone="ink" className="mt-2">
                    {entry!.total_points}
                  </Badge>
                </Card>
              );
            })}
          </div>
          {rest.length > 0 && (
            <ul className="space-y-1 mb-6 text-sm font-mono text-ink-soft">
              {rest.map((entry, idx) => (
                <li key={entry.id}>
                  {idx + 4}. {entry.label} — {entry.total_points} pts
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <Button variant="secondary" onClick={() => navigate('/admin/dashboard')}>
        {t('host.backDashboard')}
      </Button>
    </div>
  );
}

function ParticipantsList({
  participants,
  currentMasterId,
  showMasterToggle,
  onKick,
  onToggleMaster,
}: {
  participants: Participant[];
  currentMasterId: string | null;
  showMasterToggle: boolean;
  onKick: (id: string) => Promise<void>;
  onToggleMaster: (id: string) => Promise<void>;
}): JSX.Element {
  const { t } = useTranslation();
  if (participants.length === 0) {
    return (
      <Card>
        <p className="font-editorial italic text-ink-soft text-center py-6">
          {t('host.waitingForPlayers')}
        </p>
      </Card>
    );
  }
  return (
    <Card>
      <ul className="space-y-2">
        {participants.map((p) => {
          const isMaster = p.id === currentMasterId;
          return (
            <li
              key={p.id}
              className={[
                'flex items-center justify-between gap-3 px-3 py-2 border-2 rounded group',
                isMaster ? 'border-basil bg-basil/10' : 'border-ink bg-cream-2',
              ].join(' ')}
            >
              <span className="font-medium flex items-center gap-2">
                {isMaster && <span aria-hidden>👑</span>}
                {p.pseudo}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                {showMasterToggle && (
                  <button
                    type="button"
                    onClick={() => void onToggleMaster(p.id)}
                    className={[
                      'text-xs font-mono px-2 py-1 border-2 rounded transition-colors',
                      isMaster
                        ? 'border-basil text-basil-deep bg-white hover:bg-basil/20'
                        : 'border-ink text-ink-soft hover:bg-cream',
                    ].join(' ')}
                    aria-pressed={isMaster}
                  >
                    {isMaster ? t('host.masterRevoke') : t('host.masterAssign')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void onKick(p.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-raspberry hover:underline"
                >
                  {t('host.kick')}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function TeamsView({
  teams,
  participants,
  currentMasterId,
  showMasterToggle,
  onMove,
  onKick,
  onToggleMaster,
}: {
  teams: Team[];
  participants: Participant[];
  currentMasterId: string | null;
  showMasterToggle: boolean;
  onMove: (participantId: string, teamId: string | null) => Promise<void>;
  onKick: (id: string) => Promise<void>;
  onToggleMaster: (id: string) => Promise<void>;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {teams.map((team) => {
        const members = participants.filter((p) => p.team_id === team.id);
        return (
          <Card key={team.id} className="!border-3" style={{ borderColor: team.color }}>
            <div className="flex items-center justify-between gap-2 mb-3">
              <Badge tone="ink" tilt={-1}>
                {team.name}
              </Badge>
              <span className="font-mono text-xs text-ink-soft">{members.length}</span>
            </div>
            {members.length === 0 ? (
              <p className="font-editorial italic text-xs text-ink-soft py-2">
                {t('host.teamEmpty')}
              </p>
            ) : (
              <ul className="space-y-1">
                {members.map((p) => {
                  const isMaster = p.id === currentMasterId;
                  return (
                    <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate flex items-center gap-1">
                        {isMaster && <span aria-hidden>👑</span>}
                        {p.pseudo}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        {showMasterToggle && (
                          <button
                            type="button"
                            onClick={() => void onToggleMaster(p.id)}
                            className={[
                              'text-[10px] font-mono px-1.5 py-0.5 border rounded',
                              isMaster
                                ? 'border-basil text-basil-deep bg-basil/10'
                                : 'border-ink-soft text-ink-soft hover:bg-cream',
                            ].join(' ')}
                            aria-pressed={isMaster}
                            aria-label={isMaster ? t('host.masterRevoke') : t('host.masterAssign')}
                          >
                            👤
                          </button>
                        )}
                        <select
                          aria-label={t('host.moveToTeam')}
                          value={p.team_id ?? ''}
                          onChange={(e) => void onMove(p.id, e.target.value || null)}
                          className="text-xs border border-ink rounded px-1 py-0.5 bg-cream"
                        >
                          {teams.map((t2) => (
                            <option key={t2.id} value={t2.id}>
                              {t2.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => void onKick(p.id)}
                          className="text-xs text-raspberry hover:underline"
                        >
                          ✕
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        );
      })}
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
