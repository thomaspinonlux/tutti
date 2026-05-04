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
import { abandonSession } from '../lib/screenState.js';
import { connectAsHost } from '../lib/socket.js';
import { useSpotifyPlayer } from '../lib/useSpotifyPlayer.js';
import { useSpotifyAudioSync } from '../lib/useSpotifyAudioSync.js';
import { useYouTubePlayer } from '../lib/useYouTubePlayer.js';
import { useYouTubeAudioSync } from '../lib/useYouTubeAudioSync.js';
// MinScreen retiré — console animateur utilisable depuis tout écran (iPhone inclus).
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
import { RoundProgramPanel } from '../components/host/RoundProgramPanel.js';
import { PlayersPanel } from '../components/host/PlayersPanel.js';
import { MainScreenView } from './screen/MainScreenView.js';
import { HostQuizzView } from './HostQuizzView.js';
import { ExternalScreenButton } from '../components/host/ExternalScreenButton.js';

interface Toast {
  id: string;
  text: string;
  tone: 'spritz' | 'basil' | 'raspberry';
}

export function HostPage(): JSX.Element {
  // Console animateur accessible TOUTES tailles (iPhone 375px inclus).
  // Plus de wrap MinScreen — le layout interne s'adapte responsive.
  return <HostPageInner />;
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

        // ⚠️ Listeners attachés AVANT l'emit join_by_code — si on les
        // attache dans le callback, on rate les broadcasts émis pendant
        // la latence callback (race condition).
        const sessionIdRef: { current: string | null } = { current: null };
        socket.on('participant:joined', ({ participant }: { participant: Participant }) => {
          setSession((s) => (s ? { ...s, participants: [...s.participants, participant] } : s));
          pushToast(setToasts, t('host.toastJoined', { pseudo: participant.pseudo }), 'spritz');
        });
        socket.on('participant:moved_team', ({ participant }: { participant: Participant }) => {
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
        });
        socket.on('participant:kicked', ({ participant }: { participant: Participant }) => {
          setSession((s) =>
            s ? { ...s, participants: s.participants.filter((p) => p.id !== participant.id) } : s,
          );
          pushToast(setToasts, t('host.toastKicked', { pseudo: participant.pseudo }), 'raspberry');
        });
        socket.on(
          'participant:master_changed',
          ({ participant, is_master }: { participant: Participant; is_master: boolean }) => {
            setSession((s) =>
              s
                ? {
                    ...s,
                    participants: s.participants.map((p) =>
                      p.id === participant.id ? { ...p, is_master } : { ...p, is_master: false },
                    ),
                  }
                : s,
            );
          },
        );
        socket.on('session:started', ({ session: s }: { session: Session }) => {
          setSession((prev) => (prev ? { ...prev, ...s } : prev));
          pushToast(setToasts, t('host.toastStarted'), 'basil');
        });
        socket.on(
          'session:ended',
          ({ session: s, cumulative: c }: { session: Session; cumulative: CumulativeScore[] }) => {
            setSession((prev) => (prev ? { ...prev, ...s } : prev));
            setCumulative(c);
          },
        );
        socket.on('round:created', ({ round }: { round: SessionRoundWithPlaylist }) => {
          setSession((prev) => (prev ? { ...prev, rounds: [...prev.rounds, round] } : prev));
        });
        socket.on('round:started', ({ round }: { round: SessionRoundWithPlaylist }) => {
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
        socket.on('round:ended', ({ round }: { round: SessionRoundWithPlaylist }) => {
          setSession((prev) =>
            prev
              ? { ...prev, rounds: prev.rounds.map((r) => (r.id === round.id ? round : r)) }
              : prev,
          );
          setCurrentTrack(null);
        });
        socket.on('track:start', ({ state }: { state: CurrentTrackState }) => {
          setCurrentTrack(state);
          setCorrectAnswers([]);
          setPhase2StartedAt(null);
          setLastReveal(null);
          setActiveBuzzers(new Set());
        });
        socket.on(
          'buzz:received',
          (payload: {
            round_id: string;
            participant_id: string;
            participant_pseudo: string;
            buzzed_at_ms: number;
            expires_at_ms: number;
          }) => {
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
        socket.on('track:correct_answer', (entry: CorrectAnswerEntry) => {
          setCorrectAnswers((prev) => [...prev, entry]);
          const sid = sessionIdRef.current;
          if (sid) {
            void getSession(sid)
              .then((res) => setCumulative(res.cumulative))
              .catch(() => {});
          }
        });
        socket.on(
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
        socket.on(
          'track:revealed',
          (payload: { round_id: string; artist: string; title: string }) => {
            setLastReveal({ artist: payload.artist, title: payload.title });
          },
        );
        socket.on('session:paused', () => {
          console.info('[Socket] session:paused received');
          setSession((prev) => (prev ? { ...prev, is_paused: true } : prev));
        });
        socket.on('session:resumed', () => {
          console.info('[Socket] session:resumed received');
          setSession((prev) => (prev ? { ...prev, is_paused: false } : prev));
        });
        socket.on('scores:invalidated', () => {
          const sid = sessionIdRef.current;
          if (sid) {
            void getSession(sid)
              .then((res) => setCumulative(res.cumulative))
              .catch(() => {});
          }
        });

        // Maintenant on emit le join — listeners déjà en place.
        socket.emit(
          'session:join_by_code',
          { shortCode: publicView.short_code },
          (resp: {
            ok: boolean;
            session?: SessionWithParticipants;
            active_track?: CurrentTrackState | null;
            error?: string;
          }) => {
            if (cancelled) return;
            if (!resp.ok || !resp.session) {
              setError(resp.error ?? t('host.notFound'));
              return;
            }
            sessionIdRef.current = resp.session.id;
            setSession(resp.session);
            // Phase 2.3 : restore activeTrack au reload — si un round est
            // PLAYING et qu'on a un snapshot mémoire, on rehydrate currentTrack
            // sans attendre un nouveau track:start.
            if (resp.active_track) {
              setCurrentTrack(resp.active_track);
              setCorrectAnswers(resp.active_track.correct_answers);
              setPhase2StartedAt(resp.active_track.phase2_started_at);
            }
            void getSession(resp.session.id)
              .then((res) => {
                if (!cancelled) setCumulative(res.cumulative);
              })
              .catch(() => {});
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
  // On charge les deux SDK (Spotify + YouTube) dès qu'on est en phase de
  // lecture. Chaque hook ne fait rien tant que currentTrack.provider ne le
  // sélectionne pas — pas de coût visible.
  const spotify = useSpotifyPlayer({ enabled: phase === 'roundPlaying' });
  const youtube = useYouTubePlayer({ enabled: phase === 'roundPlaying' });

  // ── Audio sync unifié — single source of truth = état serveur ────────
  // Chaque sync hook ne pilote SON provider que si currentTrack.provider
  // matche. Pas de conflit : un seul provider actif à la fois.
  useSpotifyAudioSync({
    spotify,
    currentTrack,
    isPaused: session?.is_paused ?? false,
    enabled: phase === 'roundPlaying',
  });
  useYouTubeAudioSync({
    youtube,
    currentTrack,
    isPaused: session?.is_paused ?? false,
    enabled: phase === 'roundPlaying',
  });

  // ── Phase 3d — provider courant pour position/durée/affichage ──────────
  const isYouTubeTrack = currentTrack?.provider === 'youtube';
  const audioPositionMs = isYouTubeTrack ? youtube.positionMs : spotify.positionMs;
  const audioDurationMs = isYouTubeTrack ? youtube.durationMs : spotify.durationMs;

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

  // Pas d'optimistic update : on attend le broadcast socket session:paused/
  // session:resumed qui set session.is_paused. useSpotifyAudioSync pilote
  // Spotify automatiquement quand le state change. Single source of truth.
  const handlePauseAudio = async (): Promise<void> => {
    if (!session || !playingRound) return;
    console.info('[Session Pause] POST /pause');
    try {
      await hostPauseSession(session.id, playingRound.id);
    } catch (err: unknown) {
      console.error('[Session Pause] ERROR:', err);
    }
  };

  const handleResumeAudio = async (): Promise<void> => {
    if (!session || !playingRound) return;
    console.info('[Session Resume] POST /resume');
    try {
      await hostResumeSession(session.id, playingRound.id);
    } catch (err: unknown) {
      console.error('[Session Resume] ERROR:', err);
    }
  };

  const handleRestartTrack = async (): Promise<void> => {
    if (!session || !playingRound) return;
    console.info('[Restart Track] POST /restart-track');
    try {
      await hostRestartTrack(session.id, playingRound.id);
      // Backend re-broadcast track:start avec nouveau started_at.
      // useSpotifyAudioSync détecte le changement → seek 0 + play.
    } catch (err: unknown) {
      console.error('[Restart Track] ERROR:', err);
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
    console.info(
      '[Next Track] Click bouton — session:',
      session?.id,
      '| round:',
      playingRound?.id,
      '| current track index:',
      currentTrack?.track_index,
      '| busy:',
      busy,
    );
    if (!session || !playingRound) {
      console.warn('[Next Track] ABORT — pas de session ou playingRound');
      return;
    }
    setBusy(true);
    try {
      console.info('[Next Track] POST /next-track');
      const result = await nextTrack(session.id, playingRound.id);
      console.info('[Next Track] Response:', result);
      // Le nouveau track arrive via socket track:start. Le useEffect audio
      // appellera spotify.play() avec le nouveau provider_track_id.
    } catch (err: unknown) {
      console.error('[Next Track] ERROR:', err);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSkipTrack = async (): Promise<void> => {
    console.info('[Skip Track] Click — session:', session?.id, '| round:', playingRound?.id);
    if (!session || !playingRound) {
      console.warn('[Skip Track] ABORT — pas de session ou playingRound');
      return;
    }
    setBusy(true);
    try {
      const result = await skipTrack(session.id, playingRound.id);
      console.info('[Skip Track] Response:', result);
    } catch (err: unknown) {
      console.error('[Skip Track] ERROR:', err);
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
      // Bug 2 — sortir de pause locale immédiatement (sinon overlay pause
      // peut bloquer le rendu du podium intermédiaire) + clear currentTrack
      setSession((prev) => (prev ? { ...prev, is_paused: false } : prev));
      setCurrentTrack(null);
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
      // Bug 1 — applique l'état ENDED + is_paused=false + clear currentTrack
      // immédiatement pour passer au podium sans page blanche.
      setSession((prev) => (prev ? { ...prev, ...res.session, is_paused: false } : prev));
      setCumulative(res.cumulative);
      setCurrentTrack(null);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Retour dashboard SANS terminer la session = abandon silencieux.
  // Marque la session ENDED en DB pour que l'écran TV ne reste pas bloqué
  // sur PAUSED/PLAYING zombie. Erreur swallowed (pas bloquant pour navigation).
  const handleBackToDashboard = async (): Promise<void> => {
    if (session && session.status !== 'ENDED') {
      try {
        await abandonSession(session.id);
      } catch (err) {
        console.warn('[HostPage] abandon failed (non-blocking):', err);
      }
    }
    navigate('/admin/dashboard');
  };

  // ── Render ─────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen flex flex-col">
        <MultiColorBar height="md" />
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md text-center">
            <p className="text-raspberry font-medium mb-4">{error}</p>
            <Button variant="secondary" onClick={() => void handleBackToDashboard()}>
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
  // Vue désormais accessible mobile aussi (plus de blocage MinScreen).
  // L'animateur peut piloter sa partie depuis n'importe quel écran.
  if (isModeB && inGameplay) {
    return (
      <>
        {/* Bug 2 — Banner fallback audio bloqué (mode B festif aussi) */}
        {spotify.audioBlocked && (
          <button
            type="button"
            onClick={() => void spotify.unblockAudio()}
            className="fixed top-0 left-0 right-0 z-50 bg-raspberry text-cream px-4 py-3 font-bold border-b-4 border-ink flex items-center justify-center gap-3 hover:bg-raspberry-deep transition-colors animate-pop-in"
          >
            <span className="text-2xl" aria-hidden>
              🔊
            </span>
            <span>{t('host.audioBlockedBanner')}</span>
          </button>
        )}
        {/* Badge master + change-master accessible discrètement en haut-droite */}
        <div className="fixed top-4 right-4 z-30 flex gap-2 items-center">
          <ExternalScreenButton shortCode={session.short_code} />
          <MasterBadge
            master={currentMaster}
            participants={session.participants}
            onToggleMaster={handleToggleMaster}
          />
        </div>
        {/* Phase 3d — container DOM YouTube IFrame Player (mode B aussi). */}
        <div
          id="youtube-player-host"
          aria-hidden
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: 1,
            height: 1,
            opacity: 0,
            pointerEvents: 'none',
          }}
        />
        <MainScreenView
          session={session}
          currentTrack={currentTrack}
          cumulative={cumulative}
          correctAnswers={correctAnswers}
          phase2StartedAt={phase2StartedAt}
          lastReveal={lastReveal}
          activeBuzzCount={activeBuzzers.size}
          busy={busy}
          positionMs={audioPositionMs}
          durationMs={audioDurationMs}
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

      {/* Bug 2 — Banner fallback "🔊 son bloqué par le navigateur".
          Visible quand le SDK Spotify a détecté un blocage Chrome/Safari
          (autoplay_failed OU still_paused 3s après play). Click =
          activateElement() + resume() depuis un user-gesture handler. */}
      {spotify.audioBlocked && (
        <button
          type="button"
          onClick={() => void spotify.unblockAudio()}
          className="w-full bg-raspberry text-cream px-4 py-3 font-bold border-b-4 border-ink flex items-center justify-center gap-3 hover:bg-raspberry-deep transition-colors animate-pop-in"
        >
          <span className="text-2xl" aria-hidden>
            🔊
          </span>
          <span>{t('host.audioBlockedBanner')}</span>
        </button>
      )}

      <main className="flex-1 px-4 sm:px-6 lg:px-10 py-4 sm:py-8">
        <header className="max-w-7xl mx-auto mb-4 sm:mb-8 flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-1">
              {effectivePhase === 'waiting'
                ? t('host.eyebrow')
                : effectivePhase === 'ended'
                  ? t('host.eyebrowEnded')
                  : t('host.eyebrowPlaying', { round: playingRoundsCount })}
            </p>
            <TitleHandwritten as="h1">
              {/* Bug 2 — titre dynamique selon l'état de la partie. Si la
                  session a un nom custom on le garde toujours, sinon
                  fallback contextuel. */}
              {session.name ? (
                <Underline>{session.name}</Underline>
              ) : effectivePhase === 'waiting' ? (
                t('host.titleWaiting')
              ) : effectivePhase === 'roundPlaying' ? (
                t('host.titleRoundPlaying')
              ) : effectivePhase === 'intermission' ? (
                t('host.titleIntermission')
              ) : effectivePhase === 'ended' ? (
                t('host.titleEnded')
              ) : (
                t('host.title')
              )}
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
              sessionId={session.id}
              round={playingRound}
              cumulative={cumulative}
              participants={session.participants}
              currentTrack={currentTrack}
              recentBuzzes={recentBuzzes}
              onNextTrack={handleNextTrack}
              onEndRound={handleEndCurrentRound}
              busy={busy}
              isPaused={session.is_paused}
              positionMs={audioPositionMs}
              durationMs={audioDurationMs}
              spotifyStatus={spotify.status}
              spotifyError={spotify.error}
              spotifyErrorCode={spotify.errorCode}
              onForceAudio={() => {
                // Bug 4 — route le clic vers le provider du morceau courant
                if (currentTrack?.provider === 'youtube') {
                  youtube.unblockAudio();
                } else {
                  void spotify.transferToTutti();
                }
              }}
              onPauseAudio={() => void handlePauseAudio()}
              onResumeAudio={() => void handleResumeAudio()}
              onRestartTrack={() => void handleRestartTrack()}
              onRevealAnswer={() => void handleGiveAnswer()}
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

      {/* Phase 3d — container DOM pour YouTube IFrame Player. Toujours présent
          quand on est en gameplay pour que useYouTubePlayer puisse y monter
          l'iframe. Taille 0×0 — la lecture est audio-only blind test. */}
      {phase === 'roundPlaying' && (
        <div
          id="youtube-player-host"
          aria-hidden
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: 1,
            height: 1,
            opacity: 0,
            pointerEvents: 'none',
          }}
        />
      )}

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
        {/* Feature 3 — rappel ouverture écran TV pour afficher le QR aux joueurs */}
        <Card tone="lemon" size="sm">
          <p className="font-mono text-xs uppercase tracking-wider text-ink mb-1">
            💡 {t('host.tvHintTitle')}
          </p>
          <p className="font-editorial italic text-sm text-ink-2">{t('host.tvHintBody')}</p>
        </Card>
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
  sessionId,
  round,
  cumulative,
  participants,
  currentTrack,
  recentBuzzes,
  onNextTrack,
  onEndRound,
  busy,
  isPaused,
  positionMs,
  durationMs,
  spotifyStatus,
  spotifyError,
  spotifyErrorCode,
  onForceAudio,
  onPauseAudio,
  onResumeAudio,
  onRestartTrack,
  onRevealAnswer,
}: {
  sessionId: string;
  round: SessionRoundWithPlaylist;
  cumulative: CumulativeScore[];
  participants: Participant[];
  currentTrack: CurrentTrackState | null;
  recentBuzzes: BuzzResult[];
  onNextTrack: () => Promise<void>;
  onEndRound: () => Promise<void>;
  busy: boolean;
  isPaused: boolean;
  positionMs: number;
  durationMs: number;
  spotifyStatus: import('../lib/useSpotifyPlayer.js').SpotifyPlayerStatus;
  spotifyError: string | null;
  spotifyErrorCode: string | null;
  onForceAudio: () => void;
  onPauseAudio: () => void;
  onResumeAudio: () => void;
  onRestartTrack: () => void;
  onRevealAnswer: () => void;
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
        {/* Bug 4 — bouton "Forcer audio" identique pour les morceaux YouTube,
            au cas où Chrome/Safari bloquent l'autoplay de l'iframe YT. */}
        {currentTrack?.provider === 'youtube' && (
          <Button variant="ghost" size="sm" onClick={onForceAudio} className="mt-2">
            🔊 {t('host.forceAudioOnDevice')}
          </Button>
        )}
        {isDemoProvider && (
          <p className="font-mono text-xs text-ink-soft my-3">{t('host.demoProviderHint')}</p>
        )}

        {/* Bug 5 — suppression du gros carré central "EN COURS ♪?????".
            Le morceau en cours est déjà mis en évidence dans le panneau
            "Programme de la manche" à droite (highlight spritz + badge
            "En cours"). Plus besoin de duplicate ici.
            On garde juste le placeholder quand !currentTrack pour donner
            un signal visible que le morceau n'a pas encore démarré. */}
        {!currentTrack ? (
          <p className="font-editorial italic text-ink-2 my-8">{t('host.noTrackYet')}</p>
        ) : (
          // Position progress mini-bar (info utile à l'animateur sans
          // dupliquer cover/titre/artiste — déjà dans Programme manche).
          <AnimatorTrackInfo track={currentTrack} positionMs={positionMs} durationMs={durationMs} />
        )}

        <div className="flex items-center justify-center gap-3 mt-6 flex-wrap">
          <Button
            variant="primary"
            size="md"
            onClick={() => void onNextTrack()}
            disabled={busy || !currentTrack}
          >
            {t('host.nextTrack')} →
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void onEndRound()} disabled={busy}>
            {t('host.endRound')}
          </Button>
        </div>

        {/* ── Contrôles audio (pause / reprendre / recommencer / révéler) ── */}
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
            {/* Refonte #1 — Révéler la réponse : phase 1 + phase 2 */}
            {(currentTrack.phase === 'phase1' || currentTrack.phase === 'phase2') && (
              <Button variant="ghost" size="sm" onClick={onRevealAnswer} disabled={busy}>
                💡 {t('host.revealAnswer')}
              </Button>
            )}
          </div>
        )}
      </Card>

      {/* ── Colonne droite : classement + programme + joueurs + buzz feed ── */}
      <div className="space-y-4">
        <RoundProgramPanel
          sessionId={sessionId}
          roundId={round.id}
          refetchKey={`${currentTrack?.track_index ?? -1}-${currentTrack?.started_at ?? ''}`}
        />
        {/* Feature 3 — liste joueurs + édition manuelle des points */}
        <PlayersPanel sessionId={sessionId} participants={participants} cumulative={cumulative} />

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

/**
 * Correction 2 — Panel d'info animateur avec pochette + titre + artiste +
 * barre de progression. Visible UNIQUEMENT côté animateur (jamais côté
 * joueurs ou écran TV). Permet à l'animateur de savoir ce qui joue.
 */
function AnimatorTrackInfo({
  track,
  positionMs,
  durationMs,
}: {
  track: CurrentTrackState;
  positionMs: number;
  durationMs: number;
}): JSX.Element {
  const total = durationMs || track.duration_ms || 0;
  const elapsed = Math.min(positionMs, total);
  const remaining = Math.max(0, total - elapsed);
  const progress = total > 0 ? elapsed / total : 0;
  const remainingMin = Math.floor(remaining / 60_000);
  const remainingSec = Math.floor((remaining % 60_000) / 1000)
    .toString()
    .padStart(2, '0');
  return (
    <div className="py-4">
      {/* Pochette + titre + artiste — affichage privé animateur */}
      <div className="flex items-center justify-center gap-4 mb-4">
        {track.cover_url ? (
          <img
            src={track.cover_url}
            alt=""
            className="w-24 h-24 rounded border-2 border-ink object-cover shadow-pop-sm"
          />
        ) : (
          <div className="w-24 h-24 rounded border-2 border-ink bg-cream-2 flex items-center justify-center font-display text-3xl text-ink-soft">
            ♪
          </div>
        )}
        <div className="text-left min-w-0 max-w-[260px]">
          <p className="font-display text-2xl text-ink truncate">{track.title}</p>
          <p className="font-editorial italic text-ink-2 truncate">{track.artist}</p>
          {track.year && <p className="font-mono text-xs text-ink-soft">{track.year}</p>}
        </div>
      </div>
      {/* Barre de progression + temps restant */}
      <div className="max-w-md mx-auto">
        <div className="h-3 border-2 border-ink rounded bg-cream-2 overflow-hidden">
          <div
            className="h-full bg-spritz-deep transition-[width] duration-150 ease-linear"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
        <div className="flex justify-between mt-1 font-mono text-xs text-ink-soft tabular-nums">
          <span>
            {Math.floor(elapsed / 60_000)}:
            {Math.floor((elapsed % 60_000) / 1000)
              .toString()
              .padStart(2, '0')}
          </span>
          <span>
            -{remainingMin}:{remainingSec}
          </span>
        </div>
      </div>
    </div>
  );
}

// Bug 5 — ListeningView, BuzzedView et CooldownView supprimés.
// Le morceau en cours + sa pochette + son titre sont déjà dans le panneau
// "Programme de la manche" (RoundProgramPanel) à droite. Le carré central
// "EN COURS ♪?????" était un duplicate inutile. Remplacé par
// CompactProgressBar (juste la barre de progression + temps restant).

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

// CooldownView supprimé (Bug 5) — voir commentaire au-dessus de SpotifyStatusBanner.

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
