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
  CumulativeScore,
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
  kickParticipant,
  moveParticipantTeam,
  startRound,
  startSession,
} from '../lib/sessions.js';
import { connectAsHost } from '../lib/socket.js';
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
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState(false);
  const [expressModalOpen, setExpressModalOpen] = useState(false);
  const [forcedSelection, setForcedSelection] = useState(false);

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
      await startSession(session.id);
      if (pendingRound) {
        await startRound(session.id, pendingRound.id);
      }
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handlePickPlaylist = async (playlistId: string): Promise<void> => {
    if (!session) return;
    setBusy(true);
    try {
      const round = await createRound(session.id, playlistId);
      await startRound(session.id, round.id);
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

  const teams = (session.teams_config as Team[] | null) ?? [];
  const playUrl = `${window.location.origin}/play?session=${session.short_code}`;

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
          {(effectivePhase === 'roundPlaying' ||
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
              onStart={handleStartSession}
              onMove={async (pid, tid) => {
                await moveParticipantTeam(session.id, pid, tid);
              }}
              onKick={async (pid) => {
                if (window.confirm(t('host.kickConfirm'))) {
                  await kickParticipant(session.id, pid);
                }
              }}
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
              onEndRound={handleEndCurrentRound}
              busy={busy}
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
    </div>
  );
}

// ── Sous-écrans ─────────────────────────────────────────────────────────────

function WaitingPhase({
  shortCode,
  playUrl,
  participants,
  teams,
  mode,
  busy,
  hasPendingRound,
  onStart,
  onMove,
  onKick,
}: {
  shortCode: string;
  playUrl: string;
  participants: Participant[];
  teams: Team[];
  mode: 'SOLO' | 'TEAMS';
  busy: boolean;
  hasPendingRound: boolean;
  onStart: () => Promise<void>;
  onMove: (participantId: string, teamId: string | null) => Promise<void>;
  onKick: (participantId: string) => Promise<void>;
}): JSX.Element {
  const { t } = useTranslation();
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
          <Button
            onClick={() => void onStart()}
            disabled={busy || participants.length < 1}
            size="lg"
          >
            {busy
              ? t('host.starting')
              : hasPendingRound
                ? t('host.startBlindTestWithFirstRound')
                : t('host.startBlindTest')}
          </Button>
        </div>

        {mode === 'TEAMS' ? (
          <TeamsView teams={teams} participants={participants} onMove={onMove} onKick={onKick} />
        ) : (
          <ParticipantsList participants={participants} onKick={onKick} />
        )}
      </div>
    </div>
  );
}

function RoundPlayingScreen({
  round,
  cumulative,
  onEndRound,
  busy,
}: {
  round: SessionRoundWithPlaylist;
  cumulative: CumulativeScore[];
  onEndRound: () => Promise<void>;
  busy: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  const top3 = cumulative.slice(0, 3);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card tone="spritz" size="lg" className="text-center">
        <p className="text-xs font-mono uppercase tracking-wider text-spritz-deep mb-2">
          {t('host.currentRound', { n: round.position })}
        </p>
        <TitleHandwritten as="h2" className="mb-4">
          <Underline>{round.playlist.name}</Underline>
        </TitleHandwritten>
        <Badge tone="cream" tilt={-1} className="mb-4">
          {round.playlist.tracks_count ?? 0} {t('playlists.tracksCount')}
        </Badge>
        <p className="font-editorial italic text-ink-2 mt-4 mb-6">{t('host.gameLoopComingSoon')}</p>
        <Button variant="danger" size="md" onClick={() => void onEndRound()} disabled={busy}>
          {t('host.endRound')}
        </Button>
      </Card>

      <Card size="lg">
        <p className="text-xs font-mono uppercase tracking-wider text-ink-soft mb-4">
          {t('host.cumulativeScores')}
        </p>
        {top3.length === 0 ? (
          <p className="font-editorial italic text-sm text-ink-soft">{t('host.noScoresYet')}</p>
        ) : (
          <ol className="space-y-2">
            {top3.map((entry, idx) => (
              <li
                key={entry.id}
                className="flex items-center gap-3 px-3 py-2 border-2 border-ink rounded bg-white"
              >
                <span className="font-display text-2xl w-8 text-center text-spritz-deep">
                  {idx + 1}
                </span>
                {entry.color && (
                  <span
                    aria-hidden
                    className="w-3 h-3 rounded-full border-2 border-ink shrink-0"
                    style={{ backgroundColor: entry.color }}
                  />
                )}
                <span className="font-medium flex-1">{entry.label}</span>
                <Badge tone="ink">{entry.total_points}</Badge>
              </li>
            ))}
          </ol>
        )}
      </Card>
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
  onKick,
}: {
  participants: Participant[];
  onKick: (id: string) => Promise<void>;
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
        {participants.map((p) => (
          <li
            key={p.id}
            className="flex items-center justify-between gap-3 px-3 py-2 border-2 border-ink rounded bg-cream-2 group"
          >
            <span className="font-medium">{p.pseudo}</span>
            <button
              type="button"
              onClick={() => void onKick(p.id)}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-raspberry hover:underline"
            >
              {t('host.kick')}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TeamsView({
  teams,
  participants,
  onMove,
  onKick,
}: {
  teams: Team[];
  participants: Participant[];
  onMove: (participantId: string, teamId: string | null) => Promise<void>;
  onKick: (id: string) => Promise<void>;
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
                {members.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{p.pseudo}</span>
                    <div className="flex items-center gap-1 shrink-0">
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
                ))}
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
