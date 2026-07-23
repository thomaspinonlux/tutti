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

import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Socket } from 'socket.io-client';
import type {
  BuzzResult,
  CorrectAnswerEntry,
  CumulativeScore,
  CurrentTrackState,
  Participant,
  ParticipantRole,
  Playlist,
  Session,
  SessionRoundWithPlaylist,
  SessionWithParticipants,
  Team,
} from '@tutti/shared';
import { DEFAULT_SESSION_SIZE, isAnimatorRole } from '@tutti/shared';
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
  setParticipantRole,
  skipTrack,
  startRound,
  startSession,
  toggleParticipantMaster,
} from '../lib/sessions.js';
import { abandonSession, postQrOverlay } from '../lib/screenState.js';
import { JoinQrCorner } from '../components/host/JoinQrCorner.js';
import { connectAsHost } from '../lib/socket.js';
import { getMe } from '../lib/me.js';
import { useSpotifyPlayer } from '../lib/useSpotifyPlayer.js';
import { useSpotifyAudioSync } from '../lib/useSpotifyAudioSync.js';
import { useYouTubePlayer } from '../lib/useYouTubePlayer.js';
import { useYouTubeAudioSync } from '../lib/useYouTubeAudioSync.js';
import { useAppleMusicPlayer } from '../lib/useAppleMusicPlayer.js';
import { useAppleMusicAudioSync } from '../lib/useAppleMusicAudioSync.js';
import { getAppleMusicStatus, getApplePublicTokens } from '../lib/appleMusic.js';
import { unlockAudioSync } from '../lib/audioUnlock.js';
import { usePwa } from '../lib/usePwa.js';
import { ContentBlockerWarning } from '../components/ContentBlockerWarning.js';
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
import { NoProviderModal } from '../components/host/library/NoProviderModal.js';
import { PreviewModal } from '../components/host/library/PreviewModal.js';
import {
  getLibraryPlaylist,
  launchLibraryPlaylist,
  launchLibraryQuizPack,
  type LibraryPlaylistDetail,
  type LibraryPlaylistSummary,
  type LibraryQuizPackSummary,
  type PreferProvider,
} from '../lib/library.js';
import { PreGameStartScreen } from './host/PreGameStartScreen.js';
import {
  computePlayability,
  type HostProviders,
  type PlayabilityReport,
} from '../lib/providerSelection.js';
import {
  getSpotifyStatus,
  getYouTubeStatus,
  startSpotifyConnect,
  startYouTubeConnect,
} from '../lib/music.js';
import { RoundIntermissionScreen } from '../components/host/RoundIntermissionScreen.js';
import { ExpressPlaylistModal } from '../components/host/ExpressPlaylistModal.js';
import { RoundProgramPanel } from '../components/host/RoundProgramPanel.js';
// fix/restrict-banners-to-host-pages — bandeau Safari déplacé d'AdminLayout
// vers HostPage. Justification : Safari bloque la lecture audio en HostPage
// (Spotify SDK / YouTube IFrame), mais pas en admin dashboard où aucun
// média ne joue. Ne pas effrayer les visiteurs en /admin/* avec un message
// technique qui ne les concerne pas.
import { SafariMediaBanner } from '../components/admin/SafariMediaBanner.js';
import { PlayersPanel } from '../components/host/PlayersPanel.js';
import { PlayerControls } from '../components/host/PlayerControls.js';
import { SeekBar } from '../components/host/SeekBar.js';
import { MainScreenView } from './screen/MainScreenView.js';
import { HostQuizzView } from './HostQuizzView.js';
import { TvCastButton } from '../components/host/TvCastButton.js';
import { PwaSafetyControls } from '../components/host/PwaSafetyControls.js';

interface Toast {
  id: string;
  text: string;
  tone: 'spritz' | 'basil' | 'raspberry';
}

// Bug v2 (fix/end-round-blank-page-v2) — ErrorBoundary autour du contenu
// dynamique pour éviter qu'un crash dans RoundIntermissionScreen /
// RoundPlayingScreen / RoundSelectionScreen ne fasse unmount tout le
// HostPage en silence (= page vide). Au lieu de ça : on log l'erreur +
// affiche un fallback avec bouton "Continuer" pour reset le boundary.
interface HostContentBoundaryState {
  error: Error | null;
}
class HostContentBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  HostContentBoundaryState
> {
  state: HostContentBoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): HostContentBoundaryState {
    return { error };
  }
  componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    // fix/tv-cast-desktop-guard-and-boundary-capture — log TAGGÉ (capturé par
    // DebugOverlay 🐛 sur iPad) avec message + stack complète + component stack
    // React, pour diagnostiquer le crash host à distance (pas d'accès console).
    const msg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? (error.stack ?? '(no stack)') : '';
    console.error(
      `[HostContentBoundary] Caught render error | message=${msg}\nstack=${stack}\ncomponentStack=${info.componentStack ?? '(none)'}`,
    );
  }
  render(): ReactNode {
    if (this.state.error) {
      console.warn(
        '[HostContentBoundary] Rendering fallback (error=' + String(this.state.error) + ')',
      );
      return this.props.fallback;
    }
    return this.props.children;
  }
}

export function HostPage(): JSX.Element {
  // Console animateur accessible TOUTES tailles (iPhone 375px inclus).
  // Plus de wrap MinScreen — le layout interne s'adapte responsive.
  //
  // fix/eliminate-blank-pages-state-recovery — ErrorBoundary niveau racine
  // pour garantir qu'aucun crash de composant (header, banner, sidebar, etc.)
  // ne produit une page blanche. Le boundary intérieur (autour du content
  // dynamique seul) gère les crashes de phase, celui-ci gère TOUT le reste.
  return (
    <HostContentBoundary fallback={<HostPageTopLevelFallback />}>
      <HostPageInner />
    </HostContentBoundary>
  );
}

/**
 * Fallback affiché si HostPageInner crash AVANT d'avoir pu monter quoi que ce
 * soit (cas extrême : crash dans useState/useEffect au boot, broken import,
 * etc.). Layout minimaliste hardcodé (pas de t()/components qui pourraient
 * eux-mêmes throw) pour garantir une UI lisible quoi qu'il arrive.
 */
function HostPageTopLevelFallback(): JSX.Element {
  // fix/tv-cast-desktop-guard-and-boundary-capture — marqueur taggé capturé par
  // le DebugOverlay 🐛 : confirme que c'est le boundary TOP-LEVEL qui a rendu
  // (vs le boundary de contenu interne). À lire avec le log
  // [HostContentBoundary] message+stack émis juste avant.
  console.error('[HostPageTopLevel] Fallback rendu — crash hors phase (corps HostPage / hook)');
  return (
    <main className="min-h-screen flex items-center justify-center bg-cream p-6">
      <div className="max-w-lg text-center border-2 border-ink rounded-lg bg-white p-6 shadow-pop">
        <p className="text-3xl mb-2" aria-hidden>
          ⚠️
        </p>
        <h1 className="font-display text-2xl mb-2">Erreur d'affichage</h1>
        <p className="text-sm text-ink-2 mb-4">
          La page host a rencontré un problème inattendu. Aucune donnée n'a été perdue côté serveur
          — recharge la page pour reprendre où tu en étais.
        </p>
        <div className="flex flex-wrap gap-2 justify-center">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-spritz-deep text-cream font-medium rounded border-2 border-ink"
          >
            Recharger
          </button>
          <a
            href="/admin"
            className="px-4 py-2 bg-cream-2 text-ink font-medium rounded border-2 border-ink"
          >
            Dashboard
          </a>
        </div>
      </div>
    </main>
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

  // feat/tv-carousel-polish — propositions playlists reçues en lobby.
  // Alimenté par socket event 'proposal:received'. Chip + modale d'agrégation.
  interface ProposalEvent {
    official_playlist_id: string;
    playlist_name: string;
    participant_pseudo: string;
  }
  const [proposals, setProposals] = useState<ProposalEvent[]>([]);

  // fix/eliminate-blank-pages-state-recovery — état socket pour bandeau
  // "Reconnexion..." discret en cas de coupure réseau. Connecté par défaut
  // (optimiste) pour éviter le flash au boot avant que socket.io ait acked.
  const [socketConnected, setSocketConnected] = useState(true);

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
        // fix/eliminate-blank-pages-state-recovery — tracking de l'état
        // socket pour bandeau "Reconnexion..." + re-sync auto au reconnect.
        socket.on('disconnect', (reason) => {
          if (cancelled) return;
          console.warn(`[HostPage] Socket disconnect reason=${reason}`);
          setSocketConnected(false);
        });
        socket.on('connect', () => {
          if (cancelled) return;
          console.info('[HostPage] Socket connect (initial or reconnect)');
          setSocketConnected(true);
        });
        // socket.io fire 'reconnect' après reconnexions auto réussies (config
        // reconnection: true, attempts: Infinity dans lib/socket.ts). Au
        // reconnect, on re-emit join_by_code pour resync session + active_track
        // depuis le serveur (source de vérité), évitant tout drift d'état
        // pendant la déconnexion (track terminé, round changé, etc.).
        socket.io.on('reconnect', () => {
          if (cancelled || !socket) return;
          console.info('[HostPage] Socket reconnected → re-syncing state');
          setSocketConnected(true);
          // Re-emit join_by_code → re-fetch full session + active_track via
          // callback (même payload qu'au bootstrap initial).
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
              if (resp.ok && resp.session) {
                console.info('[HostPage] Reconnect re-sync OK');
                setSession(resp.session);
                setCurrentTrack(resp.active_track ?? null);
                if (resp.active_track) {
                  setCorrectAnswers(resp.active_track.correct_answers);
                  setPhase2StartedAt(resp.active_track.phase2_started_at);
                }
                void getSession(resp.session.id)
                  .then((r) => {
                    if (!cancelled) setCumulative(r.cumulative);
                  })
                  .catch(() => {});
              } else {
                console.warn('[HostPage] Reconnect re-sync FAILED', resp.error);
              }
            },
          );
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
                      p.id === participant.id
                        ? { ...p, is_master, role: participant.role }
                        : { ...p, is_master: false, role: 'PLAYER' },
                    ),
                  }
                : s,
            );
          },
        );
        // feat/multi-animator-roles — attribution MULTI-animateurs (n'affecte
        // que la cible, contrairement au master toggle single-master ci-dessus).
        socket.on('participant:role_changed', ({ participant }: { participant: Participant }) => {
          setSession((s) =>
            s
              ? {
                  ...s,
                  participants: s.participants.map((p) =>
                    p.id === participant.id
                      ? { ...p, role: participant.role, is_master: participant.is_master }
                      : p,
                  ),
                }
              : s,
          );
        });
        socket.on('session:started', ({ session: s }: { session: Session }) => {
          setSession((prev) => (prev ? { ...prev, ...s } : prev));
          pushToast(setToasts, t('host.toastStarted'), 'basil');
        });
        socket.on(
          'session:ended',
          ({ session: s, cumulative: c }: { session: Session; cumulative: CumulativeScore[] }) => {
            console.info(
              `[HostPage] Socket event session:ended at ${Date.now()} status=${s.status} cumulative.count=${c.length}`,
            );
            setSession((prev) => (prev ? { ...prev, ...s } : prev));
            setCumulative(c);
            // Cleanup défensif : si le socket arrive AVANT la résolution du
            // POST /end (cas mode B où master termine via /play, host reçoit
            // l'event mais n'a pas appelé endSession lui-même), on s'assure
            // que le state local est cohérent.
            setCurrentTrack(null);
            setActiveBuzzers(new Set());
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
          console.info(
            `[HostPage] Socket event round:ended at ${Date.now()} roundId=${round.id} position=${round.position} status=${round.status}`,
          );
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
        // feat/multi-animator-roles — canal PRIVILÉGIÉ. Le host (toujours dans
        // la room answers:{id}) reçoit ici la réponse caviardée du track:start
        // et la fusionne dans currentTrack pour l'afficher sur la console.
        socket.on(
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
        // feat/tv-carousel-polish — proposition playlist reçue d'un joueur
        // pendant le lobby. Append + dedup (même playlist, même pseudo).
        socket.on(
          'proposal:received',
          (evt: {
            official_playlist_id: string;
            playlist_name: string;
            participant_pseudo: string;
          }) => {
            console.info('[Socket] proposal:received', evt);
            setProposals((prev) => {
              const dup = prev.some(
                (p) =>
                  p.official_playlist_id === evt.official_playlist_id &&
                  p.participant_pseudo === evt.participant_pseudo,
              );
              if (dup) return prev;
              return [
                ...prev,
                {
                  official_playlist_id: evt.official_playlist_id,
                  playlist_name: evt.playlist_name,
                  participant_pseudo: evt.participant_pseudo,
                },
              ];
            });
          },
        );
        socket.on('session:resumed', () => {
          console.info('[Socket] session:resumed received');
          setSession((prev) => (prev ? { ...prev, is_paused: false } : prev));
        });
        // feat/sans-animateur — la télécommande (master) a demandé un seek → la
        // CONSOLE applique sur SON lecteur (cf. effet pendingSeek plus bas).
        // On passe par un state (pas d'appel direct) pour éviter la closure
        // périmée : l'effet lit le lecteur/provider courants.
        socket.on('track:seek', ({ position_ms }: { position_ms: number }) => {
          console.info('[Socket] track:seek received →', position_ms, 'ms');
          setPendingSeek({ ms: position_ms, at: Date.now() });
        });
        // feat/master-volume — la manette a réglé le volume → la CONSOLE applique
        // sur SON lecteur (cf. effet pendingVolume plus bas). Même logique que le
        // seek : state + effet pour lire le lecteur courant (pas de closure périmée).
        socket.on('track:volume', ({ volume }: { volume: number }) => {
          console.info('[Socket] track:volume received →', Math.round(volume * 100), '%');
          setPendingVolume({ v: volume, at: Date.now() });
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

  // feat/tv-join-qr-codes (D) — toggle overlay QR géant sur la TV pendant la
  // partie. Flag piloté par l'animateur, lu par la TV via screen-state.
  const [qrBig, setQrBig] = useState(false);
  const toggleQrBig = (): void => {
    setQrBig((prev) => {
      const next = !prev;
      void postQrOverlay(next).catch(() => undefined);
      return next;
    });
  };
  // Sort de la partie (ou changement de phase) → on coupe l'overlay pour ne
  // pas le laisser collé sur l'écran de sélection / podium.
  useEffect(() => {
    if (effectivePhase !== 'roundPlaying' && qrBig) {
      setQrBig(false);
      void postQrOverlay(false).catch(() => undefined);
    }
  }, [effectivePhase, qrBig]);

  const playingRound = session?.rounds.find((r) => r.status === 'PLAYING') ?? null;
  const lastEndedRound = session
    ? [...session.rounds].reverse().find((r) => r.status === 'ENDED')
    : null;
  const pendingRound = session?.rounds.find((r) => r.status === 'PENDING') ?? null;
  const playingRoundsCount = session?.rounds.filter((r) => r.status !== 'PENDING').length ?? 0;
  const currentMaster = session?.participants.find((p) => p.is_master) ?? null;

  // ── Audio playback ─────────────────────────────────────────────────────
  // YouTube SDK : chargé pour tous les users (provider principal post-pivot).
  // Spotify SDK : chargé UNIQUEMENT pour les users allowlistés (Thomas + 4
  // testeurs, gating fix/disable-spotify-sdk-non-allowlist). Évite les
  // NotFoundError cascade DOM cleanup en transition end-round/end-session
  // pour les users normaux + élimine bruit console [Spotify SDK].
  const [spotifyAllowlisted, setSpotifyAllowlisted] = useState(false);
  // fix/provider-master-manette (BUG 1) — SOURCE audio ACTIVE de la session.
  // Défaut = YouTube (pivot). Le SDK Spotify, sa synchro ET l'indicateur
  // « Spotify: ready » sont gatés STRICTEMENT dessus : en mode YouTube, Spotify
  // n'est JAMAIS initialisé. Positionné au launch (source choisie) puis
  // re-synchronisé sur le provider RÉEL du morceau courant (autoritatif serveur,
  // clone étanche) — cf. effet plus bas.
  const [audioProvider, setAudioProvider] = useState<'youtube' | 'spotify' | 'apple_music'>(
    'youtube',
  );
  // feat/apple-music — compte Apple Music connecté (gate le SDK MusicKit + le
  // 3e onglet source). Chargé au mount + re-synchronisé par fetchHostProviders.
  const [appleConnected, setAppleConnected] = useState(false);
  // BONUS — Music User Token du host, injecté dans MusicKit pour AUTORISER la
  // lecture full-track (sinon MusicKit tombe en preview 30 s). Le token vit en
  // base (music_provider_credentials) ; on le récupère via l'endpoint public
  // (gated session active) et on le passe au hook Apple.
  const [appleUserToken, setAppleUserToken] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  // BUG 2/3 — true dès que le statut Apple est connu (succès OU échec), pour ne
  // pas présélectionner YouTube par défaut avant d'avoir la réponse.
  const [appleStatusLoaded, setAppleStatusLoaded] = useState(false);
  useEffect(() => {
    void getAppleMusicStatus()
      .then((s) => setAppleConnected(s.connected))
      .catch(() => {
        /* statut non critique */
      })
      .finally(() => setAppleStatusLoaded(true));
  }, []);
  // BONUS — récupère le Music User Token dès qu'Apple est connecté + workspace
  // connu (session active requise côté backend). Best-effort : un échec laisse
  // le token null → le hook remontera APPLE_NOT_AUTHORIZED au lieu de jouer des
  // extraits 30 s.
  useEffect(() => {
    if (!appleConnected || !workspaceId) return;
    let cancelled = false;
    void getApplePublicTokens(workspaceId)
      .then((tk) => {
        if (!cancelled) setAppleUserToken(tk.music_user_token ?? null);
      })
      .catch(() => {
        if (!cancelled) setAppleUserToken(null);
      });
    return () => {
      cancelled = true;
    };
  }, [appleConnected, workspaceId]);
  // feat/quiz-launch-host-ui — flag pour afficher le sub-onglet "Quizz"
  // dans la bibliothèque officielle. Reflète WorkspaceMember.can_use_quizz.
  //
  // fix/quiz-library-host-access — défaut TRUE (au lieu de false) pour éviter
  // la race condition pendant le fetch /api/me : avec false par défaut, le
  // sub-onglet Quizz était caché pendant ~200ms au mount du HostPage, ce qui
  // donnait l'impression que la feature était cassée. Le défaut DB de
  // can_use_quizz est true (migration 20260508160000) donc cohérent. Si
  // /api/me retourne false explicitement → on cache. Backend POST /launch
  // reste la vraie sécurité (403 QUIZZ_NOT_ALLOWED).
  const [canUseQuizz, setCanUseQuizz] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void getMe()
      .then((me) => {
        if (cancelled) return;
        setSpotifyAllowlisted(me.spotify_allowlist === true);
        setCanUseQuizz(me.can_use_quizz !== false);
        // feat/audio-auto-routing — SENTINELLE "je suis la console" : on écrit
        // le workspaceId (même source que ScreenPage : me.workspace.id) dans
        // localStorage. Une 2e fenêtre /screen ouverte sur CETTE machine lira
        // ce marqueur, verra qu'elle est sur la même console que le host, et
        // refusera d'armer l'audio (évite le double son console+2e-fenêtre).
        // Un vrai écran TV externe est une autre machine → localStorage vide
        // ou workspaceId différent → il arme normalement.
        if (me.workspace?.id) {
          setWorkspaceId(me.workspace.id);
          try {
            window.localStorage.setItem('tutti-console-ws', me.workspace.id);
          } catch {
            /* localStorage indispo (mode privé strict) — non bloquant */
          }
        }
        console.info(
          `[HostPage] /api/me OK · spotify_allowlist=${me.spotify_allowlist === true ? 'ON' : 'OFF'} · can_use_quizz=${me.can_use_quizz !== false ? 'ON' : 'OFF'}`,
        );
      })
      .catch((err: unknown) => {
        // Si /api/me fail → on garde le défaut optimiste (canUseQuizz=true) +
        // spotify reste OFF (sécurité). Backend filtre les 2 cas.
        console.warn('[HostPage] /api/me failed, falling back to defaults', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // fix/ipad-pwa-audio-persistent-player — le YT.Player reste VIVANT pendant
  // tout le gameplay (roundPlaying + intermission + roundSelection). Avant :
  // `enabled: phase === 'roundPlaying'` → destroy() à chaque intermission →
  // nouvelle iframe à la manche suivante créée dans un useEffect (hors
  // gesture user) → iOS PWA standalone refuse le claim audio → musique gelée
  // à ~11s (buffer chargé, décode audio bloquée) sur la manche 2+.
  // Le container DOM est déjà persistant sur inGameplay (PR #69) — garder
  // l'iframe vivante évite aussi le path destroy/recreate du NotFoundError.
  const playerAlive =
    phase === 'roundPlaying' || phase === 'intermission' || phase === 'roundSelection';
  const spotify = useSpotifyPlayer({
    // BUG 1 — Spotify n'est initialisé QUE si la source active est Spotify
    // (+ allowlist). Mode YouTube → SDK jamais chargé → pas d'« Spotify: ready ».
    enabled: spotifyAllowlisted && playerAlive && audioProvider === 'spotify',
  });
  const youtube = useYouTubePlayer({ enabled: playerAlive });
  // feat/apple-music — MusicKit initialisé UNIQUEMENT si la source active est
  // Apple + compte connecté (comme Spotify). Sinon SDK jamais chargé.
  const apple = useAppleMusicPlayer({
    enabled: appleConnected && playerAlive && audioProvider === 'apple_music',
    // BONUS — injecte le Music User Token du host → MusicKit autorisé →
    // lecture full-track (au lieu de preview 30 s).
    musicUserToken: appleUserToken,
  });
  // feat/detect-content-blocker-youtube — lit isStandalone pour adapter
  // les instructions du ContentBlockerWarning (PWA vs Safari classique).
  const { isStandalone } = usePwa();

  // ── Audio — la CONSOLE joue TOUJOURS le son ───────────────────────────
  // feat/sans-animateur — plus AUCUN routing audio vers un autre appareil
  // (l'ancien #131 causait les doubles sons / bugs). Le lecteur vit sur la
  // console ; le 2e onglet /screen est VISUEL uniquement. Un master/télécommande
  // distant pilote via des broadcasts serveur (session:paused, session:resumed,
  // track:start, track:seek) que le host applique sur SON lecteur (cf. sync hooks
  // + listener track:seek plus bas). Aucun son ne sort jamais d'un autre appareil.
  useSpotifyAudioSync({
    spotify,
    currentTrack,
    isPaused: session?.is_paused ?? false,
    enabled: spotifyAllowlisted && audioProvider === 'spotify' && phase === 'roundPlaying',
  });
  useYouTubeAudioSync({
    youtube,
    currentTrack,
    isPaused: session?.is_paused ?? false,
    enabled: phase === 'roundPlaying',
  });
  useAppleMusicAudioSync({
    apple,
    currentTrack,
    isPaused: session?.is_paused ?? false,
    enabled: appleConnected && audioProvider === 'apple_music' && phase === 'roundPlaying',
  });

  // BUG 1 — le provider RÉEL du morceau courant (décidé serveur au clone, étanche)
  // fait AUTORITÉ : re-synchronise `audioProvider` dessus. Corrige aussi la
  // reprise (reload en cours de session) où le choix initial est perdu.
  useEffect(() => {
    const p = currentTrack?.provider;
    if (p === 'spotify' || p === 'youtube' || p === 'apple_music') setAudioProvider(p);
  }, [currentTrack?.provider]);

  // fix/ipad-pwa-audio-persistent-player — le player survit à l'intermission
  // (plus de destroy entre manches) : pause explicite en quittant roundPlaying,
  // sinon la musique continue sur le mini-podium.
  const prevPhaseRef = useRef<Phase | null>(null);
  useEffect(() => {
    if (prevPhaseRef.current === 'roundPlaying' && phase !== 'roundPlaying') {
      youtube.pause();
      void spotify.pause();
      void apple.pause();
    }
    prevPhaseRef.current = phase;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Position/durée = lecteur LOCAL de la console (elle joue toujours le son).
  const isYouTubeTrack = currentTrack?.provider === 'youtube';
  const isAppleTrack = currentTrack?.provider === 'apple_music';
  const audioPositionMs = isYouTubeTrack
    ? youtube.positionMs
    : isAppleTrack
      ? apple.positionMs
      : spotify.positionMs;
  const audioDurationMs = isYouTubeTrack
    ? youtube.durationMs
    : isAppleTrack
      ? apple.durationMs
      : spotify.durationMs;

  // feat/sans-animateur — seek demandé par la télécommande (broadcast track:seek).
  // Appliqué sur le lecteur LOCAL de la console (seule à émettre du son). State +
  // effet (pas d'appel direct dans le handler socket) → lit le lecteur courant.
  const [pendingSeek, setPendingSeek] = useState<{ ms: number; at: number } | null>(null);
  useEffect(() => {
    if (!pendingSeek) return;
    if (isYouTubeTrack) youtube.seek(pendingSeek.ms);
    else if (isAppleTrack) void apple.seek(pendingSeek.ms);
    else void spotify.seek(pendingSeek.ms);
    // ONE-SHOT : sans ce reset, `youtube`/`spotify` changent d'identité à chaque
    // poll de position → l'effet rejoue → ré-applique le MÊME seek ~1×/s → la
    // musique boucle sur ~1s et n'avance jamais (bug −10/+10s). On consomme le
    // seek une seule fois. started_at (ancre buzz/scoring) n'est jamais touché.
    setPendingSeek(null);
  }, [pendingSeek, isYouTubeTrack, isAppleTrack, youtube, spotify, apple]);

  // feat/master-volume — volume réglé par la manette (broadcast track:volume).
  // Appliqué sur les DEUX lecteurs de la console : l'inactif l'ignore sans effet
  // de bord, et le volume persiste si on change de provider en cours de session.
  // One-shot (même raison que pendingSeek : évite les ré-applications au poll).
  const [pendingVolume, setPendingVolume] = useState<{ v: number; at: number } | null>(null);
  useEffect(() => {
    if (!pendingVolume) return;
    youtube.setVolume(pendingVolume.v);
    void spotify.setVolume(pendingVolume.v);
    void apple.setVolume(pendingVolume.v);
    setPendingVolume(null);
  }, [pendingVolume, youtube, spotify, apple]);

  // feat/manette-console-master — la CONSOLE diffuse sa position de lecture à la
  // room (~1/s) pour que la télécommande affiche une timeline EXACTE + un scrub
  // tactile. Pur métadonnée (aucun son routé). Ref pour lire les valeurs
  // courantes sans recréer l'interval à chaque poll de position des lecteurs.
  const progressRef = useRef<{
    isYouTubeTrack: boolean;
    isAppleTrack: boolean;
    youtube: typeof youtube;
    spotify: typeof spotify;
    apple: typeof apple;
    sessionId: string | null;
    isPaused: boolean;
    hasTrack: boolean;
  }>({
    isYouTubeTrack,
    isAppleTrack,
    youtube,
    spotify,
    apple,
    sessionId: session?.id ?? null,
    isPaused: session?.is_paused ?? false,
    hasTrack: !!currentTrack,
  });
  progressRef.current = {
    isYouTubeTrack,
    isAppleTrack,
    youtube,
    spotify,
    apple,
    sessionId: session?.id ?? null,
    isPaused: session?.is_paused ?? false,
    hasTrack: !!currentTrack,
  };
  useEffect(() => {
    if (!hostSocket) return;
    const emit = (): void => {
      const p = progressRef.current;
      if (!p.sessionId || !p.hasTrack) return;
      const position_ms = p.isYouTubeTrack
        ? p.youtube.positionMs
        : p.isAppleTrack
          ? p.apple.positionMs
          : p.spotify.positionMs;
      const duration_ms =
        (p.isYouTubeTrack
          ? p.youtube.durationMs
          : p.isAppleTrack
            ? p.apple.durationMs
            : p.spotify.durationMs) || null;
      hostSocket.emit('console:progress', {
        session_id: p.sessionId,
        position_ms,
        duration_ms,
        is_paused: p.isPaused,
      });
    };
    emit();
    const id = window.setInterval(emit, 1000);
    return () => window.clearInterval(id);
  }, [hostSocket]);

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
    // fix/pwa-safari-audio-unlock — débloque l'audio SYNC depuis le gesture
    // du clic "Lancer la partie". Crucial en PWA standalone Safari où le
    // moindre await avant l'unlock invalide le user gesture. À placer en
    // PREMIÈRE instruction, avant tout async.
    unlockAudioSync('start-session-button');
    // fix/pwa-player-trigger-after-unlock — IMPORTANT en PWA Safari : le
    // unlock AudioContext seul ne suffit pas pour YouTube IFrame Player.
    // Il faut aussi déclencher playVideo() dans le tick du gesture pour
    // que l'iframe hérite de la permission. warmupSync = playVideo() +
    // pauseVideo() 50ms après → marque le player "user-engaged" sans
    // démarrer une vraie lecture parasite (la vraie lecture viendra du
    // playTrack ci-dessous via track:start broadcast).
    youtube.warmupSync();
    setBusy(true);
    try {
      // fix/ipad-pwa-audio-persistent-player — n'active le pipeline Spotify
      // que pour les users allowlistés. Pour les autres (pivot YouTube-only),
      // activer le HTMLMediaElement Spotify crée une contention d'audio
      // session iOS avec l'iframe YT.
      if (spotifyAllowlisted) {
        await spotify.activate();
      }
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

  // Bug 3 (fix/critical-bugs-v3) — pré-game state. Le clic sur une playlist
  // ne lance plus la création/play directement : on stage les infos puis on
  // affiche <PreGameStartScreen>. Le clic "▶ Démarrer" sur cet écran fournit
  // un user gesture frais qui débloque l'autoplay policy navigateur.
  type PendingFirstPlay =
    | { source: 'perso'; playlistId: string; name: string; trackCount: number }
    | {
        source: 'official';
        previewPlaylist: LibraryPlaylistDetail;
        prefer: PreferProvider;
        trackCount: number;
        // feat/thematic-level-filter — niveau choisi sur une thématique éclatée
        // (clone-filtré au launch). undefined = tous niveaux (Mix / décennies).
        difficulty?: 'EASY' | 'MEDIUM' | 'EXPERT';
      };
  const [pendingFirstPlay, setPendingFirstPlay] = useState<PendingFirstPlay | null>(null);

  const handlePickPlaylist = (playlist: Playlist): void => {
    if (!session) return;
    // feat/spotify-decouple-default — le défaut reste TOUJOURS YouTube, même
    // pour un host allowlisté : débloquer Spotify ne doit pas basculer la source
    // par défaut. Le provider réel du morceau corrige ensuite (effet de synchro
    // `currentTrack.provider` plus haut, qui fait autorité) → une playlist perso
    // Spotify passe bien en Spotify une fois le 1ᵉʳ morceau démarré.
    setAudioProvider('youtube');
    setPendingFirstPlay({
      source: 'perso',
      playlistId: playlist.id,
      name: playlist.name,
      // BUG3 — annonce la taille EFFECTIVE de la manche (capée), pas le pool.
      trackCount: Math.min(
        playlist.tracks_count ?? 0,
        playlist.default_session_size ?? DEFAULT_SESSION_SIZE,
      ),
    });
  };

  const handlePickExpress = (info: { id: string; name: string; tracks_count: number }): void => {
    if (!session) return;
    setAudioProvider('youtube'); // feat/spotify-decouple-default — défaut YouTube (cf. handlePickPlaylist)
    setPendingFirstPlay({
      source: 'perso',
      playlistId: info.id,
      name: info.name,
      // BUG3 — l'express modal ne porte que le pool ; cape à la taille de manche.
      trackCount: Math.min(info.tracks_count, DEFAULT_SESSION_SIZE),
    });
  };

  // ── Bibliothèque officielle Tutti — flow lancement ───────────────────────
  const [hostProviders, setHostProviders] = useState<HostProviders | null>(null);
  const [noProviderOpen, setNoProviderOpen] = useState(false);
  const [previewPlaylist, setPreviewPlaylist] = useState<LibraryPlaylistDetail | null>(null);
  // feat/two-provider-libraries — provider de l'onglet bibliothèque au moment du
  // pick (youtube|spotify), relu au launch. Ref : survit pick→preview→confirm.
  const pickedProviderRef = useRef<'youtube' | 'spotify' | 'apple_music'>('youtube');
  // feat/thematic-level-filter — niveau choisi sur une thématique éclatée, relu
  // au launch (clone-filtré). Ref : survit pick→preview→confirm. undefined =
  // tous niveaux (Mix / décennies / thématique non éclatée).
  const pickedDifficultyRef = useRef<'EASY' | 'MEDIUM' | 'EXPERT' | undefined>(undefined);
  const [previewReport, setPreviewReport] = useState<PlayabilityReport | null>(null);

  const fetchHostProviders = async (): Promise<HostProviders> => {
    // fix/disable-spotify-sdk-non-allowlist — skip /api/providers/spotify/*
    // pour les users non allowlistés. Évite l'appel HTTP + le risque
    // d'erreur 404/410 si Spotify Connect a été désactivé pour ce user.
    const [sp, yt] = await Promise.allSettled([
      spotifyAllowlisted ? getSpotifyStatus() : Promise.resolve(null),
      getYouTubeStatus(),
    ]);
    const spotify = sp.status === 'fulfilled' ? sp.value : null;
    const youtube = yt.status === 'fulfilled' ? yt.value : null;
    // feat/apple-music — statut Apple Music (best-effort, non bloquant).
    const appleStatus = await getAppleMusicStatus().catch(() => null);
    setAppleConnected(appleStatus?.connected ?? false);
    const providers: HostProviders = {
      spotify: { connected: spotify?.connected ?? false, premium: true },
      youtube: { connected: youtube?.connected ?? false, premium: youtube?.premium ?? false },
      apple: { connected: appleStatus?.connected ?? false, premium: true },
    };
    setHostProviders(providers);
    return providers;
  };

  // fix/spotify-toggle-lock — le toggle « source Spotify » de l'écran de
  // sélection dépend de hostProviders.spotify.connected, MAIS hostProviders
  // n'était peuplé qu'au pick d'une playlist (fetchHostProviders appelé dans
  // les handlers). Sur l'écran de sélection, hostProviders=null → connected
  // effectivement false → cadenas 🔒 verrouillé même pour un host allowlisté +
  // Spotify connecté. On charge donc le statut des providers dès que la session
  // est prête, et on re-fetch quand spotifyAllowlisted bascule à true (à ce
  // moment getSpotifyStatus() est enfin appelé et connected devient correct).
  useEffect(() => {
    if (!session) return;
    void fetchHostProviders();
    // fetchHostProviders est recréé à chaque render (closure sur spotifyAllowlisted) ;
    // on ne le met pas en dép pour éviter une boucle — on veut re-fetch sur
    // changement de session ou du flag allowlist uniquement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, spotifyAllowlisted]);

  // Cœur partagé du lancement officiel : charge providers + détail + playability
  // et ouvre la PreviewModal. Réutilisé par le toggle bibliothèque (RoundSelection)
  // ET par l'entrée "Bibliothèque officielle" de Tutti Tracks (BUG 2) via le
  // param d'URL — AUCUNE logique dupliquée (même preview → pregame → launch).
  const openOfficialPreview = async (
    playlistId: string,
    provider: 'youtube' | 'spotify' | 'apple_music' = 'youtube',
    difficulty?: 'EASY' | 'MEDIUM' | 'EXPERT',
  ): Promise<void> => {
    if (!session) return;
    pickedProviderRef.current = provider; // source choisie → relue au launch
    setAudioProvider(provider);
    pickedDifficultyRef.current = difficulty; // niveau choisi → relu au launch

    const providers = await fetchHostProviders();
    const hasAny =
      providers.spotify.connected || providers.youtube.connected || !!providers.apple?.connected;
    if (!hasAny) {
      setNoProviderOpen(true);
      return;
    }
    try {
      const detail = await getLibraryPlaylist(playlistId);
      if (detail.locked) return; // premium non débloqué
      // feat/watertight-provider — aperçu STRICTEMENT sur la source choisie.
      const report = computePlayability(detail.tracks, providers, provider);
      setPreviewPlaylist(detail);
      setPreviewReport(report);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handlePickOfficial = async (
    summary: LibraryPlaylistSummary,
    provider: 'youtube' | 'spotify' | 'apple_music' = 'youtube',
    difficulty?: 'EASY' | 'MEDIUM' | 'EXPERT',
  ): Promise<void> => {
    if (summary.locked) return; // ne devrait pas arriver — card disabled
    await openOfficialPreview(summary.id, provider, difficulty);
  };

  // BUG 2 — lancement d'une playlist officielle depuis "Tutti Tracks" : la page
  // crée une session puis navigue vers /host?session=…&official=<id>. Ici on
  // ouvre la même Preview qu'au flux Nouvelle session (une seule fois), avec la
  // source par défaut BUG 3 (apple_music si connecté, sinon youtube). On attend
  // que le statut Apple soit chargé pour ne pas figer YouTube par erreur.
  const officialParam = params.get('official');
  const autoOfficialDoneRef = useRef(false);
  useEffect(() => {
    if (!session || !officialParam || !appleStatusLoaded || autoOfficialDoneRef.current) return;
    autoOfficialDoneRef.current = true;
    const prov: 'youtube' | 'apple_music' = appleConnected ? 'apple_music' : 'youtube';
    void openOfficialPreview(officialParam, prov);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, officialParam, appleStatusLoaded, appleConnected]);

  /**
   * feat/tv-carousel-polish — accepter directement la proposition d'un joueur.
   * Court-circuite l'étape "Picker bibliothèque" : fetch détail + open preview
   * directement, host valide ensuite (PreviewModal existant gère le launch).
   */
  const handleProposalLaunch = async (officialPlaylistId: string): Promise<void> => {
    if (!session) return;
    const providers = await fetchHostProviders();
    const hasAny = providers.spotify.connected || providers.youtube.connected;
    if (!hasAny) {
      setNoProviderOpen(true);
      return;
    }
    try {
      // Proposition joueur → source YouTube (défaut du pivot). Relu au launch.
      pickedProviderRef.current = 'youtube';
      setAudioProvider('youtube'); // BUG 1
      pickedDifficultyRef.current = undefined;
      const detail = await getLibraryPlaylist(officialPlaylistId);
      const report = computePlayability(detail.tracks, providers, 'youtube');
      setPreviewPlaylist(detail);
      setPreviewReport(report);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // feat/quiz-launch-host-ui — clone le pack officiel + crée nouvelle session
  // game_type=QUIZZ, puis redirige vers /host?session=<short_code>. La session
  // courante (TRACKS) reste intacte côté backend, mais le host bascule sur
  // la nouvelle session quizz. Pas de PreGameStartScreen pour quizz : pas
  // d'audio à débloquer, le SessionConfigPage s'occupera du démarrage.
  const handlePickQuizOfficial = async (pack: LibraryQuizPackSummary): Promise<void> => {
    if (pack.locked) return;
    setBusy(true);
    setError(null);
    try {
      const lang: 'fr' | 'en' = pack.locale_primary.startsWith('en') ? 'en' : 'fr';
      const result = await launchLibraryQuizPack(pack.id, lang);
      // Hard navigation pour reset complet du HostPage state (la nouvelle
      // session est game_type=QUIZZ, pas de round, pas d'audio).
      navigate(`/host?session=${result.session.short_code}`);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmLaunchOfficial = (): void => {
    if (!session || !previewPlaylist || !hostProviders) return;
    // feat/watertight-provider — la SOURCE choisie via le toggle UI est
    // transmise TELLE QUELLE au launch (plus d'override par preferredProvider,
    // qui écrasait le choix YouTube et laissait passer un clone Spotify). Le
    // backend clone alors 100% mono-provider (étanche). Garde : la source doit
    // être connectée, sinon on renvoie vers l'écran "connecter un provider".
    const prefer: PreferProvider = pickedProviderRef.current;
    const connected =
      prefer === 'spotify'
        ? hostProviders.spotify.connected
        : prefer === 'apple_music'
          ? !!hostProviders.apple?.connected
          : hostProviders.youtube.connected;
    if (!connected) {
      setNoProviderOpen(true);
      setPreviewPlaylist(null);
      setPreviewReport(null);
      return;
    }
    // Bug 3 — stage state pré-game au lieu de lancer directement.
    const playableCount = previewReport?.playable ?? previewPlaylist.tracks.length;
    setPendingFirstPlay({
      source: 'official',
      previewPlaylist,
      prefer,
      // BUG3 — cape à la taille de manche (official dss=15) : la manche ne joue
      // que min(15, playable), jamais tout le pool playable.
      trackCount: Math.min(playableCount, DEFAULT_SESSION_SIZE),
      // feat/thematic-level-filter — niveau choisi au pick (ref), relu ici.
      difficulty: pickedDifficultyRef.current,
    });
    setPreviewPlaylist(null);
    setPreviewReport(null);
  };

  // Bug 3 — exécute la chaîne async réelle (create/launch + startRound +
  // playTrack) depuis le clic "▶ Démarrer" du PreGameStartScreen. Le clic
  // est le user gesture qui débloque l'autoplay des deux SDK.
  const handleStartFirstPlay = async (): Promise<void> => {
    if (!session || !pendingFirstPlay) return;
    // fix/pwa-safari-audio-unlock — voir handleStartSession. Doit être SYNC
    // avant tout await pour préserver le user gesture en PWA standalone.
    unlockAudioSync('start-first-play-button');
    // fix/ipad-pwa-audio-persistent-player — claim YouTube SYNC dans le
    // gesture, AVANT tout await. Asymétrie corrigée : handleStartSession le
    // faisait, pas ce handler. Avec le player persistant, à la manche 2+ le
    // player garde la dernière vidéo cued → warmupSync fait un vrai
    // playVideo/pauseVideo qui re-claim l'audio iOS. (Manche 1 : player tout
    // neuf sans vidéo → no-op safe cf. #73, le claim passe par le flow
    // cueVideoById→CUED→playVideo de PreGameStartScreen.)
    youtube.warmupSync();
    setBusy(true);
    try {
      // fix/ipad-pwa-audio-persistent-player — n'active QUE le pipeline du
      // provider qui va jouer. iOS = audio session singleton : activer
      // Spotify SDK (HTMLMediaElement interne) juste avant que l'iframe YT
      // demande son claim crée une contention → YT perd → musique gelée.
      // Pivot YouTube-only : les playlists officielles forcent youtube
      // (library.ts), donc skip Spotify sauf si explicitement préféré.
      const wantsSpotify =
        spotifyAllowlisted &&
        (pendingFirstPlay.source === 'official' ? pendingFirstPlay.prefer === 'spotify' : true);
      if (wantsSpotify) {
        await spotify.activate();
      }
      let roundId: string;
      if (pendingFirstPlay.source === 'perso') {
        const round = await createRound(session.id, pendingFirstPlay.playlistId);
        roundId = round.id;
      } else {
        const result = await launchLibraryPlaylist(
          pendingFirstPlay.previewPlaylist.id,
          session.id,
          pendingFirstPlay.prefer,
          pendingFirstPlay.difficulty,
        );
        roundId = result.round.id;
      }
      await startRound(session.id, roundId);
      await playTrack(session.id, roundId);
      setPendingFirstPlay(null);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleCancelFirstPlay = (): void => {
    if (busy) return;
    setPendingFirstPlay(null);
  };

  const handleConnectSpotify = async (): Promise<void> => {
    try {
      const url = await startSpotifyConnect();
      window.location.href = url;
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleConnectYoutube = async (): Promise<void> => {
    try {
      const url = await startYouTubeConnect();
      window.location.href = url;
    } catch (err) {
      setError((err as Error).message);
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
      // feat/round-end-rankings — quand on est sur le dernier morceau,
      // /next-track auto-end le round (advanceToNextOrEndRound). Le backend
      // broadcast round:ended via socket mais on applique aussi un update
      // optimistic local pour éviter la fenêtre "page vide" entre l'ack HTTP
      // et le socket event (cf. handleEndCurrentRound qui fait pareil).
      if (result.ended === true && result.round) {
        setSession((prev) =>
          prev
            ? {
                ...prev,
                is_paused: false,
                rounds: prev.rounds.map((r) => (r.id === result.round!.id ? result.round! : r)),
              }
            : prev,
        );
        setCurrentTrack(null);
        await refreshCumulative(session.id);
      }
      // Sinon le nouveau track arrive via socket track:start. Le useEffect
      // audio appellera spotify.play() avec le nouveau provider_track_id.
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
      // feat/round-end-rankings — idem handleNextTrack : skip sur dernier
      // morceau → auto-end → optimistic update pour éviter page vide.
      if (result.ended === true && result.round) {
        setSession((prev) =>
          prev
            ? {
                ...prev,
                is_paused: false,
                rounds: prev.rounds.map((r) => (r.id === result.round!.id ? result.round! : r)),
              }
            : prev,
        );
        setCurrentTrack(null);
        await refreshCumulative(session.id);
      }
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
      console.info(
        `[HostPage] handleEndCurrentRound START playingRoundId=${playingRound.id} position=${playingRound.position}`,
      );
      const updatedRound = await endRound(session.id, playingRound.id);
      console.info(
        `[HostPage] endRound resolved roundId=${updatedRound.id} status=${updatedRound.status}`,
      );
      // Bug C v5 — update LOCAL state directement avec le round retourné par
      // l'API. Avant : on attendait le socket round:ended pour mettre à jour
      // session.rounds → race condition possible (socket lent ou perdu) →
      // phase reste 'roundPlaying' avec playingRound stale → page vide entre
      // RoundPlayingScreen (pas de currentTrack) et RoundIntermissionScreen
      // (pas encore de lastEndedRound). Avec setSession optimistic ici, le
      // rendu passe IMMÉDIATEMENT à 'intermission' (rounds map a la nouvelle
      // version ENDED), donc RoundIntermissionScreen rend tout de suite.
      setSession((prev) =>
        prev
          ? {
              ...prev,
              is_paused: false,
              rounds: prev.rounds.map((r) => (r.id === updatedRound.id ? updatedRound : r)),
            }
          : prev,
      );
      setCurrentTrack(null);
      await refreshCumulative(session.id);
    } catch (err: unknown) {
      console.error('[HostPage] handleEndCurrentRound FAIL', err);
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

  // feat/multi-animator-roles — attribue un rôle explicite (multi-animateurs).
  // L'event socket participant:role_changed rafraîchit l'UI.
  const handleSetRole = async (participantId: string, role: ParticipantRole): Promise<void> => {
    if (!session) return;
    try {
      await setParticipantRole(session.id, participantId, role);
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  };

  const handleEndSession = async (): Promise<void> => {
    if (!session) return;
    if (!window.confirm(t('host.endBlindTestConfirm'))) return;
    setBusy(true);
    try {
      console.info(
        `[HostPage] handleEndSession START sessionId=${session.id} status=${session.status}`,
      );
      const result = await endSession(session.id);
      console.info(
        `[HostPage] endSession resolved status=${result.session.status} cumulative.count=${result.cumulative.length}`,
      );
      // Bug C v5 — update LOCAL state aussi pour cas où navigate échoue (ex:
      // erreur React Router, popup confirm bloqué). Le user voit alors au
      // moins l'EndedScreen au lieu d'une page vide.
      setSession((prev) => (prev ? { ...prev, ...result.session } : prev));
      setCumulative(result.cumulative);
      setCurrentTrack(null);
      // Pattern terminal : navigate explicite au lieu de dépendre du render
      // derived (qui a montré son fragile — Bug 4 récurrent). Le podium final
      // s'affiche sur l'écran TV (FINAL_PODIUM via ScreenState polling), pas
      // besoin de doublon sur la console host. URL param ?notice=session-ended
      // déclenche un banner de confirmation sur le dashboard.
      console.info('[HostPage] handleEndSession navigate → /admin/dashboard?notice=session-ended');
      navigate('/admin/dashboard?notice=session-ended');
      // Pas de setBusy(false) — composant unmount avant.
    } catch (err: unknown) {
      setError((err as Error).message);
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

  // Issue 5 (6 mai) — bouton "Retour dashboard" en salle d'attente.
  // - 0 joueur connecté : navigate direct (pas de confirm).
  // - >=1 joueur : confirm() avant d'abandon + navigate (pour ne pas
  //   faire disparaître la partie sous les yeux des joueurs déjà sur /play).
  // Pose ?notice=session-cancelled pour banner de confirmation côté dashboard.
  const handleCancelWaiting = async (): Promise<void> => {
    if (!session) {
      navigate('/admin/dashboard');
      return;
    }
    const playersCount = session.participants.filter((p) => !p.is_kicked).length;
    if (playersCount > 0) {
      if (!window.confirm(t('host.cancelWaitingConfirm', { count: playersCount }))) return;
    }
    try {
      await abandonSession(session.id);
    } catch (err) {
      console.warn('[HostPage] abandon failed (non-blocking):', err);
    }
    navigate('/admin/dashboard?notice=session-cancelled');
  };

  // ── Render ─────────────────────────────────────────────────────────────

  // Bug C v5 (fix/playback-and-host-render-v5) — logs massifs pour
  // diagnostiquer la page host vide après end-session ou end-round.
  // Permet de voir dans la console :
  //   - status session (WAITING / PLAYING / ENDED)
  //   - phase dérivée (waiting / roundSelection / roundPlaying /
  //     intermission / ended)
  //   - rounds list + status par round
  //   - quel composant va être rendu (early return vs main vs ModeB)
  console.info(
    `[HostPage] Render status=${session?.status ?? 'no-session'} ` +
      `phase=${phase} effectivePhase=${effectivePhase} ` +
      `sessionId=${session?.id ?? 'n/a'} ` +
      `rounds=[${session?.rounds.map((r) => `${r.position}:${r.status}`).join(',') ?? 'none'}] ` +
      `hasError=${error !== null} hasPlayingRound=${playingRound !== null} ` +
      `lastEndedRound=${lastEndedRound?.id ?? 'null'} ` +
      `inGameplay=will-compute hasAnimator=${session?.has_animator ?? '?'}`,
  );

  if (error) {
    console.info(`[HostPage] About to render <ErrorScreen /> (error="${error}")`);
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
    console.info('[HostPage] About to render <LoadingScreen /> (session=null)');
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="font-mono text-ink-soft">{t('common.loading')}</p>
      </div>
    );
  }

  console.info(`[HostPage] Past early returns. Session game_type=${session.game_type}`);

  // ── Branche Tutti Quizz : vue dédiée pour les sessions QUIZZ ─────────────
  // Mode A (has_animator) : iPad = console host avec contrôles.
  // Mode B (!has_animator) : iPad = vue publique festive XL, master pilote depuis tel.
  if (session.game_type === 'QUIZZ') {
    console.info('[HostPage] About to render <HostQuizzView />');
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

  console.info(
    `[HostPage] Decision : isModeB=${isModeB} inGameplay=${inGameplay} → ` +
      `${isModeB && inGameplay ? '<MainScreenView /> (early ModeB return)' : 'main render block'}`,
  );

  // ── Mode B en cours de jeu : vue festive publique sans contrôles ─────
  // Vue désormais accessible mobile aussi (plus de blocage MinScreen).
  // L'animateur peut piloter sa partie depuis n'importe quel écran.
  if (isModeB && inGameplay) {
    console.info('[HostPage] About to render <MainScreenView /> (ModeB inGameplay path)');
    return (
      <>
        {/* Bug 2 — Banner fallback audio bloqué (mode B festif aussi) */}
        {spotify.audioBlocked && (
          <button
            type="button"
            onClick={() => {
              // fix/pwa-safari-audio-unlock — SYNC unlock avant l'async Spotify.
              unlockAudioSync('spotify-audio-blocked-banner-modeB');
              void spotify.unblockAudio();
            }}
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
          <PwaSafetyControls />
          <TvCastButton tvCode={session.tv_code} shortCode={session.short_code} />
          {/* feat/ecran-joueurs — bouton direct « Écran TV » retiré : tout passe
              par TvCastButton (renommé « Écran Joueurs »), qui propose déjà QR +
              « ouvrir ici » (desktop). Un seul bouton. */}
          {/* feat/audio-auto-routing — capsule "son sur la TV" retirée : le
              routing est désormais automatique (écran TV externe prêt → TV,
              sinon console). Plus aucun bouton de choix côté host. */}
          <MasterBadge
            master={currentMaster}
            participants={session.participants}
            onToggleMaster={handleToggleMaster}
          />
        </div>
        {/* fix/youtube-removechild-notfound — le container DOM YouTube est
            désormais créé et possédé par useYouTubePlayer sous <body>, hors de
            l'arbre React (évite le removeChild NotFoundError au changement de
            phase). Plus aucun <div id="youtube-player-host"> rendu ici. */}
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

  // Bug 3 — overlay full-screen "Prêt à jouer ?" affiché entre la sélection
  // de playlist et le lancement effectif du round. Le clic sur le bouton
  // fournit un user gesture frais qui débloque l'autoplay des SDK audio.
  if (pendingFirstPlay) {
    console.info('[HostPage] About to render <PreGameStartScreen />');
    const isOfficial = pendingFirstPlay.source === 'official';
    const playlistName =
      pendingFirstPlay.source === 'perso'
        ? pendingFirstPlay.name
        : (pendingFirstPlay.previewPlaylist.name_fr ?? pendingFirstPlay.previewPlaylist.name_en);
    const providerLabel = isOfficial
      ? pendingFirstPlay.prefer === 'youtube'
        ? 'YouTube'
        : pendingFirstPlay.prefer === 'apple_music'
          ? 'Apple Music'
          : 'Spotify'
      : null;
    return (
      <>
        {/* fix/youtube-removechild-notfound — container YT possédé par le hook
            sous <body>, hors arbre React. Le player reste vivant dès
            roundSelection sans qu'aucun <div> rendu ici ne soit démonté au
            passage sélection→pregame→playing (plus de NotFoundError). */}
        <PreGameStartScreen
          playlistName={playlistName}
          trackCount={pendingFirstPlay.trackCount}
          badge={isOfficial ? t('preGame.officialBadge') : null}
          providerLabel={providerLabel}
          busy={busy}
          onStart={() => void handleStartFirstPlay()}
          onCancel={handleCancelFirstPlay}
          onYoutubeWarmup={youtube.warmupSync}
          getYoutubeState={youtube.getPlayerState}
        />
      </>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-[#0B0B0F] to-[#14141C] text-white">
      <MultiColorBar height="md" />

      {/* fix/restrict-banners-to-host-pages — Safari content-blocker hint.
          Affiché UNIQUEMENT sur /host (où le SDK Spotify et YouTube IFrame
          peuvent être bloqués). Auto-dismissed via localStorage. */}
      <SafariMediaBanner />

      {/* fix/eliminate-blank-pages-state-recovery — bandeau discret quand
          le socket est déconnecté. socket.io retente automatiquement
          (reconnection: Infinity dans lib/socket.ts), au reconnect on
          re-emit join_by_code pour re-sync l'état. */}
      {!socketConnected && (
        <div
          role="status"
          aria-live="polite"
          className="w-full bg-lemon text-ink px-4 py-2 text-sm font-mono text-center border-b-2 border-ink animate-fade-in"
        >
          🔄 {t('host.reconnecting')}
        </div>
      )}

      {/* Bug 2 — Banner fallback "🔊 son bloqué par le navigateur".
          Visible quand le SDK Spotify a détecté un blocage Chrome/Safari
          (autoplay_failed OU still_paused 3s après play). Click =
          activateElement() + resume() depuis un user-gesture handler. */}
      {spotify.audioBlocked && (
        <button
          type="button"
          onClick={() => {
            // fix/pwa-safari-audio-unlock — SYNC unlock avant l'async Spotify.
            unlockAudioSync('spotify-audio-blocked-banner-modeA');
            void spotify.unblockAudio();
          }}
          className="w-full bg-raspberry text-cream px-4 py-3 font-bold border-b-4 border-ink flex items-center justify-center gap-3 hover:bg-raspberry-deep transition-colors animate-pop-in"
        >
          <span className="text-2xl" aria-hidden>
            🔊
          </span>
          <span>{t('host.audioBlockedBanner')}</span>
        </button>
      )}

      {/* fix/robust-autoplay-no-refresh — overlay YouTube fallback. Affiché
          quand useYouTubePlayer a tenté ready + retries auto sans succès.
          Click = user gesture frais → tapToStart() relance loadVideoById
          dans le contexte du tap (bypass autoplay policy Safari/iOS).
          JAMAIS de window.location.reload(). */}
      {youtube.audioBlocked && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('host.youtubeBlockedTitle')}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 backdrop-blur-sm animate-fade-in p-6"
        >
          <button
            type="button"
            onClick={() => {
              // fix/pwa-safari-audio-unlock — débloque l'audio SYNC dans le
              // gesture du tap, puis appelle tapToStart() (lui-même sync).
              unlockAudioSync('tap-to-start-overlay');
              youtube.tapToStart();
            }}
            className="bg-raspberry text-cream max-w-md w-full px-6 py-8 rounded-lg border-4 border-ink shadow-pop-lg flex flex-col items-center gap-4 hover:bg-raspberry-deep transition-transform hover:-translate-y-0.5 active:translate-y-0"
          >
            <span className="text-5xl" aria-hidden>
              ▶
            </span>
            <span className="font-display text-2xl text-center leading-tight">
              {t('host.youtubeBlockedTitle')}
            </span>
            <span className="font-mono text-xs uppercase tracking-wider opacity-90">
              {t('host.youtubeBlockedCta')}
            </span>
          </button>
        </div>
      )}

      {/* feat/detect-content-blocker-youtube — overlay informatif quand le
          IFrame YouTube ne fire pas onReady dans les 5s (typique : Content
          Blocker Safari qui filtre youtube.com / googlevideo.com). Variante
          PWA si standalone (instructions pour ouvrir Safari et désactiver). */}
      {youtube.blockedByContentFilter && <ContentBlockerWarning isStandalone={isStandalone} />}

      {/* fix/prevent-safari-reader-mode — role="application" évite que Safari
          détecte la page host comme article éditorial et propose son mode
          Lecteur (qui casserait YT IFrame + boutons + audio). */}
      <main role="application" className="flex-1 px-4 sm:px-6 lg:px-10 py-4 sm:py-8">
        <header className="max-w-7xl mx-auto mb-4 sm:mb-8 flex items-center justify-between flex-wrap gap-3">
          <div>
            <p
              className="font-mono text-xs uppercase tracking-[0.2em] mb-1"
              style={{ color: '#FF5C4D' }}
            >
              {effectivePhase === 'waiting'
                ? t('host.eyebrow')
                : effectivePhase === 'ended'
                  ? t('host.eyebrowEnded')
                  : t('host.eyebrowPlaying', { round: playingRoundsCount })}
            </p>
            <h1 className="font-display text-4xl leading-tight text-white">
              {session.name
                ? session.name
                : effectivePhase === 'waiting'
                  ? t('host.titleWaiting')
                  : effectivePhase === 'roundPlaying'
                    ? t('host.titleRoundPlaying')
                    : effectivePhase === 'intermission'
                      ? t('host.titleIntermission')
                      : effectivePhase === 'ended'
                        ? t('host.titleEnded')
                        : t('host.title')}
            </h1>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Issue 5 (6 mai) — bouton "Retour dashboard" visible uniquement
                en salle d'attente. Permet d'annuler la session avant qu'elle
                ne démarre. Confirme si des joueurs sont déjà connectés. */}
            {effectivePhase === 'waiting' && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleCancelWaiting()}
                disabled={busy}
              >
                ← {t('host.backDashboard')}
              </Button>
            )}
            <PwaSafetyControls />
            <TvCastButton tvCode={session.tv_code} shortCode={session.short_code} />
            {/* feat/ecran-joueurs — bouton direct « Écran TV » retiré (voir plus
                haut) : un seul bouton « Écran Joueurs » via TvCastButton. */}
            {/* feat/audio-auto-routing — capsule son→TV retirée : routing
                automatique (écran TV externe prêt → TV, sinon console). */}
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
                  variant="danger"
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
          <HostContentBoundary
            fallback={
              <Card tone="cream" size="lg" className="text-center max-w-2xl mx-auto">
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-raspberry mb-2">
                  ⚠️
                </p>
                <TitleHandwritten as="h2" className="mb-3">
                  <Underline>{t('host.contentCrashTitle')}</Underline>
                </TitleHandwritten>
                <p className="font-editorial italic text-ink-2 mb-4">
                  {t('host.contentCrashHint')}
                </p>
                <div className="flex gap-3 justify-center flex-wrap">
                  <Button variant="primary" size="lg" onClick={() => window.location.reload()}>
                    {t('host.contentCrashReload')}
                  </Button>
                  <Button variant="ghost" size="lg" onClick={() => void handleBackToDashboard()}>
                    {t('host.backDashboard')}
                  </Button>
                </div>
              </Card>
            }
          >
            {effectivePhase === 'waiting' && (
              <>
                {/* feat/tv-carousel-polish — chip propositions live + click-launch. */}
                <ProposalsChip
                  proposals={proposals}
                  onPick={(id) => void handleProposalLaunch(id)}
                />
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
                  onSetRole={handleSetRole}
                />
              </>
            )}

            {effectivePhase === 'roundSelection' && (
              <RoundSelectionScreen
                isFirstRound={session.rounds.length === 0}
                onPickPlaylist={handlePickPlaylist}
                onPickOfficial={handlePickOfficial}
                spotifyLibraryAvailable={spotifyAllowlisted && !!hostProviders?.spotify.connected}
                appleLibraryAvailable={!!hostProviders?.apple?.connected}
                onPickQuizOfficial={handlePickQuizOfficial}
                canUseQuizz={canUseQuizz}
                onCreateExpress={() => setExpressModalOpen(true)}
                onEndSession={handleEndSession}
                loading={busy}
                joinCode={session.short_code}
              />
            )}

            {/* fix/eliminate-blank-pages-state-recovery — fallback si phase
                est roundPlaying mais playingRound est null (race condition
                socket round:started attendu mais session.rounds pas encore
                à jour côté local). Au lieu de blank, on affiche un état de
                chargement avec bouton manuel "Recharger" si ça persiste. */}
            {effectivePhase === 'roundPlaying' && !playingRound && (
              <Card tone="cream" size="lg" className="text-center max-w-2xl mx-auto">
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-2">
                  {t('host.eyebrowPlaying', { round: playingRoundsCount })}
                </p>
                <TitleHandwritten as="h2" className="mb-3">
                  <Underline>{t('host.syncing')}</Underline>
                </TitleHandwritten>
                <p className="font-editorial italic text-ink-2 mb-4">{t('host.syncingHint')}</p>
                <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>
                  🔄 {t('host.contentCrashReload')}
                </Button>
              </Card>
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
                  // fix/pwa-safari-audio-unlock — débloque l'audio en mode
                  // FULLY SYNC dans le gesture (resume AudioContext + silent
                  // buffer). Doit être la 1ʳᵉ instruction avant tout async.
                  unlockAudioSync('force-audio-button');
                  // Bug 4 — route le clic vers le provider du morceau courant.
                  // youtube.unblockAudio est sync. spotify.transferToTutti est
                  // async mais le gesture est déjà capturé par unlockAudioSync.
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
                onSeek={(ms) => {
                  // feat/seek-bar — route vers le provider du morceau courant.
                  if (currentTrack?.provider === 'youtube') youtube.seek(ms);
                  else void spotify.seek(ms);
                }}
              />
            )}

            {/* feat/tv-join-qr-codes (D) — petit QR en coin pendant la partie ;
                clic → overlay QR géant sur la TV (re-clic → off). */}
            {effectivePhase === 'roundPlaying' && playingRound && (
              <JoinQrCorner joinCode={session.short_code} onClick={toggleQrBig} active={qrBig} />
            )}

            {effectivePhase === 'intermission' &&
              (() => {
                // Bug v2 (fix/end-round-blank-page-v2) — log + fallback :
                // si lastEndedRound est falsy alors que phase===intermission
                // (race condition theorique), afficher un placeholder au
                // lieu de blank. Garantit que le user voit TOUJOURS un
                // contenu en intermission, jamais une page vide.
                console.info(
                  `[HostPage] Render intermission branch lastEndedRound=${
                    lastEndedRound ? `${lastEndedRound.id}/${lastEndedRound.position}` : 'NULL'
                  } cumulative.count=${cumulative.length}`,
                );
                if (lastEndedRound) {
                  return (
                    <RoundIntermissionScreen
                      sessionId={session.id}
                      round={lastEndedRound}
                      cumulative={cumulative}
                      onNextRound={() => setForcedSelection(true)}
                      onEndSession={handleEndSession}
                      loading={busy}
                    />
                  );
                }
                return (
                  <Card tone="cream" size="lg" className="text-center max-w-2xl mx-auto">
                    <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-2">
                      {t('host.eyebrowPlaying', { round: playingRoundsCount })}
                    </p>
                    <TitleHandwritten as="h2" className="mb-4">
                      <Underline>{t('host.titleIntermission')}</Underline>
                    </TitleHandwritten>
                    <p className="font-editorial italic text-ink-2 mb-4">{t('host.noScoresYet')}</p>
                    <div className="flex gap-3 justify-center flex-wrap">
                      <Button
                        variant="primary"
                        size="lg"
                        onClick={() => setForcedSelection(true)}
                        disabled={busy}
                      >
                        {t('host.nextRound')} →
                      </Button>
                      <Button
                        variant="ghost"
                        size="lg"
                        onClick={() => void handleEndSession()}
                        disabled={busy}
                      >
                        {t('host.endBlindTest')}
                      </Button>
                    </div>
                  </Card>
                );
              })()}

            {effectivePhase === 'ended' && <EndedScreen cumulative={cumulative} />}

            {/* fix/eliminate-blank-pages-state-recovery — défense ultime :
                si effectivePhase ne matche aucun case ci-dessus (valeur
                inconnue / état transitoire), on rend un placeholder loading
                au lieu de laisser le `<HostContentBoundary>` vide.
                Garantit qu'il y a TOUJOURS un contenu visible. */}
            {effectivePhase !== 'waiting' &&
              effectivePhase !== 'roundSelection' &&
              effectivePhase !== 'roundPlaying' &&
              effectivePhase !== 'intermission' &&
              effectivePhase !== 'ended' && (
                <Card tone="cream" size="lg" className="text-center max-w-2xl mx-auto">
                  <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-soft mb-2">
                    {String(effectivePhase)}
                  </p>
                  <TitleHandwritten as="h2" className="mb-3">
                    <Underline>{t('host.syncing')}</Underline>
                  </TitleHandwritten>
                  <p className="font-editorial italic text-ink-2 mb-4">{t('host.syncingHint')}</p>
                  <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>
                    🔄 {t('host.contentCrashReload')}
                  </Button>
                </Card>
              )}
          </HostContentBoundary>
        </div>
      </main>

      <ExpressPlaylistModal
        open={expressModalOpen}
        onClose={() => setExpressModalOpen(false)}
        nextRoundPosition={session.rounds.length + 1}
        language={(session.language as 'fr' | 'en') ?? 'fr'}
        onLaunch={(info) => {
          setExpressModalOpen(false);
          handlePickExpress(info);
        }}
      />

      {/* Bibliothèque officielle Tutti — flow validation + lancement */}
      <NoProviderModal
        open={noProviderOpen}
        onClose={() => setNoProviderOpen(false)}
        onConnectSpotify={() => void handleConnectSpotify()}
        onConnectYoutube={() => void handleConnectYoutube()}
      />
      <PreviewModal
        open={!!previewPlaylist}
        playlist={previewPlaylist}
        report={previewReport}
        provider={pickedProviderRef.current}
        busy={busy}
        onCancel={() => {
          setPreviewPlaylist(null);
          setPreviewReport(null);
        }}
        onConfirm={() => void handleConfirmLaunchOfficial()}
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

      {/* fix/youtube-removechild-notfound — le container DOM YouTube est créé
          et possédé par useYouTubePlayer sous <body>, en dehors de l'arbre
          React. React ne le monte ni ne le démonte jamais : fini le
          NotFoundError (removeChild sur un nœud déjà remplacé par l'<iframe>
          YT) au passage roundSelection→pregame→roundPlaying→intermission.
          Le nœud persiste tant que le player est `enabled` → l'iframe survit
          aux manches (persistance audio iPad PWA #80). */}

      {/* Debug Spotify (visible uniquement en mode Spotify + SDK actif) */}
      {spotify.status !== 'idle' && audioProvider === 'spotify' && (
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
  onSetRole,
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
  onSetRole: (participantId: string, role: ParticipantRole) => Promise<void>;
}): JSX.Element {
  const { t } = useTranslation();
  // F2 (feat/playlist-search-and-host-improvements) — autoriser démarrage
  // avec 0 joueur (mode démo / test / animateur seul). Mode B exige
  // toujours un master désigné — sans master, l'animateur n'a personne
  // pour piloter le round.
  const needsMaster = !hasAnimator && !currentMasterId;
  const noPlayers = participants.length === 0;
  const canStart = !busy && !needsMaster;
  const CORAL = '#FF5C4D';
  return (
    // feat/console-dark — stage sombre premium (cohérent écran TV + console jeu).
    <div className="relative">
      <div className="grid gap-8 lg:grid-cols-1 xl:grid-cols-[auto_1fr]">
        <div className="rounded-[24px] border border-white/[0.07] bg-[#15151d]/80 p-8 text-center backdrop-blur-xl">
          <p className="mb-4 font-mono text-xs uppercase tracking-[0.25em] text-white/50">
            {t('host.scanToJoin')}
          </p>
          <div className="mx-auto mb-4 inline-block rounded-2xl bg-white p-3">
            <QRCode value={playUrl} size={260} />
          </div>
          <p className="mb-1 font-mono text-3xl font-bold tracking-[0.2em] text-white">
            {shortCode}
          </p>
          <p className="font-editorial text-sm italic text-white/40">{playUrl}</p>
        </div>

        <div className="space-y-4">
          <div
            className="rounded-2xl border p-4"
            style={{ backgroundColor: '#FF5C4D14', borderColor: '#FF5C4D55' }}
          >
            <p className="mb-1 font-mono text-xs uppercase tracking-wider" style={{ color: CORAL }}>
              💡 {t('host.tvHintTitle')}
            </p>
            <p className="font-editorial text-sm italic text-white/60">{t('host.tvHintBody')}</p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-display text-2xl text-white">
              {t('host.participants')}{' '}
              <span className="text-white/40">({participants.length})</span>
            </p>
            <Button
              onClick={() => {
                if (noPlayers && !window.confirm(t('host.startWithZeroPlayersConfirm'))) {
                  return;
                }
                void onStart();
              }}
              disabled={!canStart}
              size="lg"
            >
              {busy
                ? t('host.starting')
                : hasPendingRound
                  ? t('host.startBlindTestWithFirstRound')
                  : t('host.startBlindTest')}
            </Button>
          </div>

          {!hasAnimator && (
            <div
              className="rounded-2xl border p-4"
              style={{
                backgroundColor: currentMasterId ? '#4ade8014' : '#ffffff08',
                borderColor: currentMasterId ? '#4ade8055' : '#ffffff14',
              }}
            >
              <p className="mb-1 font-mono text-xs uppercase tracking-wider text-white/50">
                {t('host.masterSectionLabel')}
              </p>
              <p className="font-editorial text-sm italic text-white/60">
                {currentMasterId
                  ? t('host.masterPickedHint', {
                      pseudo: participants.find((p) => p.id === currentMasterId)?.pseudo ?? '',
                    })
                  : t('host.masterPickHint')}
              </p>
            </div>
          )}

          {mode === 'TEAMS' ? (
            <TeamsView
              teams={teams}
              participants={participants}
              showMasterToggle={true}
              onMove={onMove}
              onKick={onKick}
              onToggleMaster={onToggleMaster}
              onSetRole={onSetRole}
              dark
            />
          ) : (
            <ParticipantsList
              participants={participants}
              showMasterToggle={true}
              onKick={onKick}
              onToggleMaster={onToggleMaster}
              onSetRole={onSetRole}
              dark
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * F2 (host-tv-perfect-sync) — horloge serveur pause-aware côté host. Compte le
 * temps écoulé depuis `startedAtIso` (reset 0 au changement), +delta par tick si
 * !isPaused, FIGE si isPaused. Sert de fallback à la position du lecteur local
 * quand le son est sur la TV (lecteur host muet → position figée). MÊME logique
 * que la TV (MainScreenView.useTimeElapsed) → les 2 timers restent synchrones.
 * Lecture seule — NE touche PAS started_at_ms (ancre buzz/scoring).
 */
function useServerElapsedMs(startedAtIso: string | null, isPaused: boolean): number {
  // Amorce depuis l'horloge serveur (now - started_at), PAS depuis 0 — cf.
  // MainScreenView.useTimeElapsed : sinon la barre repart à 0 à chaque (re)montage.
  const seed = (): number => {
    if (!startedAtIso) return 0;
    const ms = Date.now() - new Date(startedAtIso).getTime();
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  };
  const [elapsed, setElapsed] = useState(seed);
  const lastTickRef = useRef<number>(Date.now());
  useEffect(() => {
    setElapsed(seed());
    lastTickRef.current = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAtIso]);
  useEffect(() => {
    if (!startedAtIso) return;
    const tick = (): void => {
      const now = Date.now();
      const delta = now - lastTickRef.current;
      lastTickRef.current = now;
      if (!isPaused) setElapsed((e) => e + delta);
    };
    lastTickRef.current = Date.now();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [isPaused, startedAtIso]);
  return elapsed;
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
  onSeek,
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
  /** F2 — undefined quand le son est sur la TV → fallback horloge serveur. */
  positionMs?: number;
  durationMs?: number;
  spotifyStatus: import('../lib/useSpotifyPlayer.js').SpotifyPlayerStatus;
  spotifyError: string | null;
  spotifyErrorCode: string | null;
  onForceAudio: () => void;
  onPauseAudio: () => void;
  onResumeAudio: () => void;
  onRestartTrack: () => void;
  onRevealAnswer: () => void;
  onSeek: (ms: number) => void;
}): JSX.Element {
  const { t } = useTranslation();
  // F2 — position/durée effectives : lecteur local si fourni (sink=host), sinon
  // horloge serveur (sink=tv → lecteur host muet). Le timer tourne pareil et la
  // pause (isPaused serveur) fige les deux côtés.
  const serverElapsedMs = useServerElapsedMs(currentTrack?.started_at ?? null, isPaused);
  const effPositionMs = positionMs ?? serverElapsedMs;
  const effDurationMs = durationMs ?? currentTrack?.duration_ms ?? 0;
  const top5 = cumulative.slice(0, 5);
  const totalTracks = round.playlist.tracks_count ?? 0;
  const trackPosition = currentTrack ? currentTrack.track_index + 1 : round.current_track_index + 1;

  const showSpotifyStatus =
    currentTrack?.provider === 'spotify' || (currentTrack === null && spotifyStatus !== 'idle');
  const isDemoProvider = currentTrack?.provider === 'demo';

  const CORAL = '#FF5C4D';
  const chip = 'rounded-full px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.2em]';
  const darkPanel =
    'rounded-[20px] border border-white/[0.07] bg-[#15151d]/80 p-5 backdrop-blur-xl';
  return (
    // feat/console-dark — stage sombre premium (cohérent écran TV). Bleed sur le
    // padding du <main> via marges négatives pour couvrir toute la zone de jeu.
    <div className="relative">
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        {/* ── Colonne gauche : track en cours ──────────────────────────── */}
        <div className="rounded-[24px] border border-white/[0.07] bg-[#15151d]/80 p-6 text-center backdrop-blur-xl lg:p-8">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <span className={`${chip} text-[#0B0B0F]`} style={{ backgroundColor: CORAL }}>
              {t('host.currentRound', { n: round.position })}
            </span>
            {totalTracks > 0 && (
              <span className={`${chip} border border-white/15 text-white/80`}>
                {t('host.trackPosition', { current: trackPosition, total: totalTracks })}
              </span>
            )}
          </div>
          <h2 className="mb-4 font-display text-4xl leading-tight text-white">
            {round.playlist.name}
          </h2>

          {showSpotifyStatus && (
            <SpotifyStatusBanner
              status={spotifyStatus}
              error={spotifyError}
              errorCode={spotifyErrorCode}
            />
          )}
          {showSpotifyStatus && spotifyStatus === 'ready' && currentTrack && (
            <Button variant="secondary" size="sm" onClick={onForceAudio} className="mt-2">
              🔊 {t('host.forceAudioOnDevice')}
            </Button>
          )}
          {currentTrack?.provider === 'youtube' && (
            <Button variant="secondary" size="sm" onClick={onForceAudio} className="mt-2">
              🔊 {t('host.forceAudioOnDevice')}
            </Button>
          )}
          {isDemoProvider && (
            <p className="my-3 font-mono text-xs text-white/45">{t('host.demoProviderHint')}</p>
          )}

          {!currentTrack ? (
            <p className="my-8 font-editorial italic text-white/55">{t('host.noTrackYet')}</p>
          ) : (
            <AnimatorTrackInfo
              track={currentTrack}
              positionMs={effPositionMs}
              durationMs={effDurationMs}
              onSeek={onSeek}
              dark
            />
          )}

          <PlayerControls
            currentTrack={currentTrack}
            isPaused={isPaused}
            busy={busy}
            totalTracks={totalTracks}
            onNextTrack={() => void onNextTrack()}
            onEndRound={() => void onEndRound()}
            onPauseAudio={onPauseAudio}
            onResumeAudio={onResumeAudio}
            onRestartTrack={onRestartTrack}
            onRevealAnswer={onRevealAnswer}
            dark
          />
        </div>

        {/* ── Colonne droite : programme + joueurs + classement + buzz ── */}
        <div className="space-y-4">
          <RoundProgramPanel
            sessionId={sessionId}
            roundId={round.id}
            refetchKey={`${currentTrack?.track_index ?? -1}-${currentTrack?.started_at ?? ''}`}
            dark
          />
          <PlayersPanel
            sessionId={sessionId}
            participants={participants}
            cumulative={cumulative}
            dark
          />

          <div className={darkPanel}>
            <p className="mb-3 font-mono text-xs uppercase tracking-wider text-white/50">
              {t('host.cumulativeScores')}
            </p>
            {top5.length === 0 ? (
              <p className="font-editorial text-sm italic text-white/45">{t('host.noScoresYet')}</p>
            ) : (
              <ol className="space-y-2">
                {top5.map((entry, idx) => (
                  <li
                    key={entry.id}
                    className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2"
                  >
                    <span
                      className="w-6 text-center font-display text-xl"
                      style={{ color: idx === 0 ? CORAL : '#ffffff' }}
                    >
                      {idx + 1}
                    </span>
                    {entry.color && (
                      <span
                        aria-hidden
                        className="h-3 w-3 shrink-0 rounded-full ring-1 ring-white/30"
                        style={{ backgroundColor: entry.color }}
                      />
                    )}
                    <span className="flex-1 truncate text-sm font-medium text-white">
                      {entry.label}
                    </span>
                    <span className="font-mono text-sm font-bold tabular-nums text-white">
                      {entry.total_points}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className={darkPanel}>
            <p className="mb-3 font-mono text-xs uppercase tracking-wider text-white/50">
              {t('host.buzzFeed')}
            </p>
            {recentBuzzes.length === 0 ? (
              <p className="font-editorial text-sm italic text-white/45">
                {t('host.buzzFeedEmpty')}
              </p>
            ) : (
              <ul className="space-y-2">
                {recentBuzzes.map((buzz, idx) => (
                  <li
                    key={`${buzz.round_id}-${buzz.track_index}-${idx}`}
                    className="flex items-center gap-2 text-xs"
                  >
                    <span className="truncate font-medium text-white">
                      {buzz.participant_pseudo}
                    </span>
                    <span className="flex-1 truncate text-white/50">
                      {buzz.matched_artist
                        ? buzz.matched_title
                          ? `${buzz.reveal.artist} — ${buzz.reveal.title}`
                          : buzz.reveal.artist
                        : t('host.notFound')}
                    </span>
                    <span
                      className="rounded-full px-2 py-0.5 font-mono text-[11px] font-bold"
                      style={{
                        backgroundColor: buzz.total_points > 0 ? '#4ade8033' : '#ffffff12',
                        color: buzz.total_points > 0 ? '#4ade80' : '#ffffff99',
                      }}
                    >
                      {buzz.total_points > 0 ? `+${buzz.total_points}` : '0'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
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
  onSeek,
  dark = false,
}: {
  track: CurrentTrackState;
  positionMs: number;
  durationMs: number;
  onSeek: (ms: number) => void;
  dark?: boolean;
}): JSX.Element {
  const total = durationMs || track.duration_ms || 0;
  return (
    <div className="py-4">
      {/* Pochette + titre + artiste — affichage privé animateur */}
      <div className="flex items-center justify-center gap-4 mb-4">
        {track.cover_url ? (
          <img
            src={track.cover_url}
            alt=""
            className={`w-24 h-24 rounded object-cover ${dark ? 'ring-1 ring-white/15 shadow-[0_10px_30px_rgba(0,0,0,0.5)]' : 'border-2 border-ink shadow-pop-sm'}`}
          />
        ) : (
          <div
            className={`w-24 h-24 rounded flex items-center justify-center font-display text-3xl ${dark ? 'bg-white/[0.06] ring-1 ring-white/10 text-white/60' : 'border-2 border-ink bg-cream-2 text-ink-soft'}`}
          >
            ♪
          </div>
        )}
        <div className="text-left min-w-0 flex-1">
          <p className={`font-display text-2xl break-words ${dark ? 'text-white' : 'text-ink'}`}>
            {track.title}
          </p>
          <p
            className={`font-editorial italic break-words ${dark ? 'text-white/55' : 'text-ink-2'}`}
          >
            {track.artist}
          </p>
          {track.year && (
            <p className={`font-mono text-xs ${dark ? 'text-white/40' : 'text-ink-soft'}`}>
              {track.year}
            </p>
          )}
        </div>
      </div>
      {/* Barre de temps SEEKABLE (host-only) — extraite dans <SeekBar>. */}
      <SeekBar positionMs={positionMs} durationMs={total} onSeek={onSeek} dark={dark} />
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

// feat/multi-animator-roles — sélecteur 3 rôles (segmented control). Multi-
// animateurs : chaque joueur peut être basculé indépendamment.
function RoleSelector({
  role,
  onSetRole,
  compact,
  dark = false,
}: {
  role: ParticipantRole;
  onSetRole: (role: ParticipantRole) => void;
  compact?: boolean;
  dark?: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  const opts: { value: ParticipantRole; label: string; title: string }[] = [
    { value: 'PLAYER', label: t('host.rolePlayer'), title: t('host.rolePlayerHint') },
    {
      value: 'ANIMATOR_PLAYING',
      label: t('host.roleAnimatorPlaying'),
      title: t('host.roleAnimatorPlayingHint'),
    },
    {
      value: 'ANIMATOR_FULL',
      label: t('host.roleAnimatorFull'),
      title: t('host.roleAnimatorFullHint'),
    },
  ];
  return (
    <div
      role="group"
      aria-label={t('host.roleLabel')}
      className={`inline-flex rounded-lg overflow-hidden shrink-0 border-2 ${dark ? 'border-white/15' : 'border-ink'}`}
    >
      {opts.map((o) => {
        const active = o.value === role;
        return (
          <button
            key={o.value}
            type="button"
            title={o.title}
            aria-pressed={active}
            onClick={() => {
              if (!active) onSetRole(o.value);
            }}
            className={[
              compact ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1',
              'font-mono transition-colors border-r-2 last:border-r-0',
              dark ? 'border-white/15' : 'border-ink',
              active
                ? 'bg-basil text-white'
                : dark
                  ? 'bg-white/[0.06] text-white/60 hover:bg-white/[0.14]'
                  : 'bg-cream text-ink-soft hover:bg-cream-2',
            ].join(' ')}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ParticipantsList({
  participants,
  showMasterToggle,
  onKick,
  onToggleMaster,
  onSetRole,
  dark = false,
}: {
  participants: Participant[];
  showMasterToggle: boolean;
  onKick: (id: string) => Promise<void>;
  onToggleMaster: (id: string) => Promise<void>;
  onSetRole?: (id: string, role: ParticipantRole) => Promise<void>;
  dark?: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  const wrap = (children: React.ReactNode): JSX.Element =>
    dark ? (
      <div className="rounded-[20px] border border-white/[0.07] bg-[#15151d]/80 p-4 backdrop-blur-xl">
        {children}
      </div>
    ) : (
      <Card>{children}</Card>
    );
  if (participants.length === 0) {
    return wrap(
      <p
        className={`font-editorial italic text-center py-6 ${dark ? 'text-white/45' : 'text-ink-soft'}`}
      >
        {t('host.waitingForPlayers')}
      </p>,
    );
  }
  return wrap(
    <ul className="space-y-2">
      {participants.map((p) => {
        const isMaster = isAnimatorRole(p.role);
        return (
          <li
            key={p.id}
            className={[
              'flex items-center justify-between gap-3 px-3 py-2 border-2 rounded-xl group',
              isMaster
                ? 'border-basil bg-basil/15'
                : dark
                  ? 'border-white/10 bg-white/[0.05]'
                  : 'border-ink bg-cream-2',
            ].join(' ')}
          >
            <span className={`font-medium flex items-center gap-2 ${dark ? 'text-white' : ''}`}>
              {isMaster && <span aria-hidden>👑</span>}
              {p.pseudo}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              {onSetRole ? (
                <RoleSelector
                  role={p.role}
                  onSetRole={(r) => void onSetRole(p.id, r)}
                  dark={dark}
                />
              ) : (
                showMasterToggle && (
                  <button
                    type="button"
                    onClick={() => void onToggleMaster(p.id)}
                    className={[
                      'text-xs font-mono px-2 py-1 border-2 rounded transition-colors',
                      isMaster
                        ? 'border-basil text-basil bg-basil/10 hover:bg-basil/20'
                        : dark
                          ? 'border-white/15 text-white/60 hover:bg-white/10'
                          : 'border-ink text-ink-soft hover:bg-cream',
                    ].join(' ')}
                    aria-pressed={isMaster}
                  >
                    🎙️ {isMaster ? t('host.masterRevoke') : t('host.masterAssign')}
                  </button>
                )
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
    </ul>,
  );
}

function TeamsView({
  teams,
  participants,
  showMasterToggle,
  onMove,
  onKick,
  onToggleMaster,
  onSetRole,
  dark = false,
}: {
  teams: Team[];
  participants: Participant[];
  showMasterToggle: boolean;
  onMove: (participantId: string, teamId: string | null) => Promise<void>;
  onKick: (id: string) => Promise<void>;
  onToggleMaster: (id: string) => Promise<void>;
  onSetRole?: (id: string, role: ParticipantRole) => Promise<void>;
  dark?: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {teams.map((team) => {
        const members = participants.filter((p) => p.team_id === team.id);
        const card = (
          <>
            <div className="flex items-center justify-between gap-2 mb-3">
              <span
                className={`inline-block rounded-full px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-wider ${dark ? 'text-white' : 'bg-ink text-cream'}`}
                style={dark ? { backgroundColor: '#ffffff14' } : undefined}
              >
                {team.name}
              </span>
              <span className={`font-mono text-xs ${dark ? 'text-white/45' : 'text-ink-soft'}`}>
                {members.length}
              </span>
            </div>
            {members.length === 0 ? (
              <p
                className={`font-editorial italic text-xs py-2 ${dark ? 'text-white/40' : 'text-ink-soft'}`}
              >
                {t('host.teamEmpty')}
              </p>
            ) : (
              <ul className="space-y-1">
                {members.map((p) => {
                  const isMaster = isAnimatorRole(p.role);
                  return (
                    <li
                      key={p.id}
                      className={`flex items-center justify-between gap-2 text-sm ${dark ? 'text-white' : ''}`}
                    >
                      <span className="truncate flex items-center gap-1">
                        {isMaster && <span aria-hidden>👑</span>}
                        {p.pseudo}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        {onSetRole ? (
                          <RoleSelector
                            role={p.role}
                            onSetRole={(r) => void onSetRole(p.id, r)}
                            compact
                            dark={dark}
                          />
                        ) : (
                          showMasterToggle && (
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
                              aria-label={
                                isMaster ? t('host.masterRevoke') : t('host.masterAssign')
                              }
                            >
                              👤
                            </button>
                          )
                        )}
                        <select
                          aria-label={t('host.moveToTeam')}
                          value={p.team_id ?? ''}
                          onChange={(e) => void onMove(p.id, e.target.value || null)}
                          className={`text-xs rounded px-1 py-0.5 border ${dark ? 'border-white/20 bg-white/10 text-white' : 'border-ink bg-cream'}`}
                        >
                          {teams.map((t2) => (
                            <option
                              key={t2.id}
                              value={t2.id}
                              className={dark ? 'text-ink' : undefined}
                            >
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
          </>
        );
        return dark ? (
          <div
            key={team.id}
            className="rounded-2xl border-[3px] bg-[#15151d]/80 p-4 backdrop-blur-xl"
            style={{ borderColor: team.color }}
          >
            {card}
          </div>
        ) : (
          <Card key={team.id} className="!border-3" style={{ borderColor: team.color }}>
            {card}
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

/**
 * feat/tv-carousel-polish — Chip live qui agrège les propositions de
 * playlists des joueurs (socket event `proposal:received`). Affichée en
 * lobby host. Click sur une proposition → ouvre la preview / launch.
 */
interface ProposalsChipProps {
  proposals: Array<{
    official_playlist_id: string;
    playlist_name: string;
    participant_pseudo: string;
  }>;
  onPick: (officialPlaylistId: string) => void;
}

function ProposalsChip({ proposals, onPick }: ProposalsChipProps): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  if (proposals.length === 0) return null;

  // Agrégation par playlist : count + liste participants
  const byPlaylist = new Map<
    string,
    { official_playlist_id: string; playlist_name: string; participants: string[] }
  >();
  for (const p of proposals) {
    const entry = byPlaylist.get(p.official_playlist_id) ?? {
      official_playlist_id: p.official_playlist_id,
      playlist_name: p.playlist_name,
      participants: [],
    };
    if (!entry.participants.includes(p.participant_pseudo)) {
      entry.participants.push(p.participant_pseudo);
    }
    byPlaylist.set(p.official_playlist_id, entry);
  }
  const aggregated = Array.from(byPlaylist.values()).sort(
    (a, b) => b.participants.length - a.participants.length,
  );
  const total = proposals.length;
  const top3 = aggregated
    .slice(0, 3)
    .map((a) => a.playlist_name)
    .join(', ');

  return (
    <div className="max-w-3xl mx-auto mb-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 border-2 border-ink rounded-lg bg-lemon text-ink shadow-pop-sm hover:translate-y-px transition text-left"
        aria-expanded={expanded}
      >
        <span aria-hidden className="text-xl">
          💡
        </span>
        <span className="flex-1 min-w-0">
          <p className="font-display text-sm">
            {total} proposition{total > 1 ? 's' : ''} de playlist
            {aggregated.length > 1 ? `s (${aggregated.length} différentes)` : ''}
          </p>
          <p className="font-mono text-[11px] text-ink-soft truncate">{top3}</p>
        </span>
        <span aria-hidden className="font-mono text-xs">
          {expanded ? '▲' : '▼'}
        </span>
      </button>
      {expanded && (
        <ul className="mt-2 border-2 border-ink rounded-lg bg-cream overflow-hidden divide-y divide-ink/15">
          {aggregated.map((row) => (
            <li key={row.official_playlist_id}>
              <button
                type="button"
                onClick={() => onPick(row.official_playlist_id)}
                className="w-full text-left px-4 py-3 hover:bg-spritz/20 active:translate-y-px transition flex items-center gap-3"
              >
                <span className="font-display font-semibold flex-1 truncate">
                  {row.playlist_name}
                </span>
                <span className="font-mono text-xs bg-spritz text-ink border border-ink px-2 py-0.5 rounded">
                  {row.participants.length} 🎯
                </span>
              </button>
              <p className="px-4 pb-2 font-mono text-[10px] text-ink-soft">
                {row.participants.join(', ')}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
