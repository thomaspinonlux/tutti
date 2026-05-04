/**
 * /screen?session=CODE — vue TV externe en cast par code.
 *
 * Utilisée pour afficher la session sur une grande TV séparée du host (mode
 * "cast par code" sans Chromecast/AirPlay). Connect anonyme via socket
 * spectator (read-only) + snapshot REST initial.
 *
 * Adapte le rendu selon session.game_type :
 *   - TRACKS : MainScreenView Tutti Tracks (festive iPad/TV XL)
 *   - QUIZZ  : HostQuizzView en publicView (mode TV)
 *
 * Pas d'authentification ni de contrôles — purement spectateur.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Socket } from 'socket.io-client';
import type {
  CorrectAnswerEntry,
  CumulativeScore,
  CurrentTrackState,
  Participant,
  Session,
  SessionRoundWithPlaylist,
  SessionWithParticipants,
} from '@tutti/shared';
import { getSessionSnapshot } from '../lib/sessions.js';
import { connectAsSpectator } from '../lib/socket.js';
import {
  Button,
  Card,
  Input,
  MultiColorBar,
  TitleHandwritten,
  Underline,
} from '../components/ui/index.js';
import { MainScreenView } from './screen/MainScreenView.js';
import { HostQuizzView } from './HostQuizzView.js';
import { QRCode } from '../components/host/QRCode.js';

export function ScreenPage(): JSX.Element {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const shortCode = (params.get('session') ?? '').toUpperCase();

  const [codeInput, setCodeInput] = useState('');
  const [session, setSession] = useState<SessionWithParticipants | null>(null);
  const [cumulative, setCumulative] = useState<CumulativeScore[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentTrack, setCurrentTrack] = useState<CurrentTrackState | null>(null);
  const [correctAnswers, setCorrectAnswers] = useState<CorrectAnswerEntry[]>([]);
  const [phase2StartedAt, setPhase2StartedAt] = useState<string | null>(null);
  const [lastReveal, setLastReveal] = useState<{ artist: string; title: string } | null>(null);
  const [activeBuzzers, setActiveBuzzers] = useState<Set<string>>(new Set());

  // ── Bootstrap : snapshot + socket ───────────────────────────────────────
  useEffect(() => {
    if (!shortCode) return;
    let cancelled = false;
    let sock: Socket | null = null;

    const init = async (): Promise<void> => {
      try {
        const snap = await getSessionSnapshot(shortCode);
        if (cancelled) return;
        setSession(snap.session);
        setCumulative(snap.cumulative);
        setError(null);

        sock = connectAsSpectator(shortCode);
        sock.on('connect_error', (err) => {
          if (!cancelled) setError(`Socket: ${err.message}`);
        });
        setSocket(sock);

        // ── Listeners ─────────────────────────────────────────────────
        sock.on('participant:joined', ({ participant }: { participant: Participant }) => {
          setSession((s) => (s ? { ...s, participants: [...s.participants, participant] } : s));
        });
        sock.on('participant:kicked', ({ participant }: { participant: Participant }) => {
          setSession((s) =>
            s ? { ...s, participants: s.participants.filter((p) => p.id !== participant.id) } : s,
          );
        });
        sock.on('participant:moved_team', ({ participant }: { participant: Participant }) => {
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
        sock.on(
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
        sock.on('session:started', ({ session: srv }: { session: Session }) => {
          setSession((prev) => (prev ? { ...prev, ...srv } : prev));
        });
        sock.on(
          'session:ended',
          ({
            session: srv,
            cumulative: c,
          }: {
            session: Session;
            cumulative: CumulativeScore[];
          }) => {
            setSession((prev) => (prev ? { ...prev, ...srv } : prev));
            setCumulative(c);
          },
        );
        sock.on('round:created', ({ round }: { round: SessionRoundWithPlaylist }) => {
          setSession((prev) => (prev ? { ...prev, rounds: [...prev.rounds, round] } : prev));
        });
        sock.on('round:started', ({ round }: { round: SessionRoundWithPlaylist }) => {
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
        sock.on('round:ended', ({ round }: { round: SessionRoundWithPlaylist }) => {
          setSession((prev) =>
            prev
              ? { ...prev, rounds: prev.rounds.map((r) => (r.id === round.id ? round : r)) }
              : prev,
          );
          setCurrentTrack(null);
        });
        // Tracks gameplay events
        sock.on('track:start', ({ state }: { state: CurrentTrackState }) => {
          setCurrentTrack(state);
          setCorrectAnswers([]);
          setPhase2StartedAt(null);
          setLastReveal(null);
          setActiveBuzzers(new Set());
        });
        sock.on('buzz:received', (payload: { participant_id: string; expires_at_ms: number }) => {
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
        });
        sock.on('track:correct_answer', (entry: CorrectAnswerEntry) => {
          setCorrectAnswers((prev) => [...prev, entry]);
        });
        sock.on(
          'track:phase_changed',
          (payload: {
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
        sock.on('track:revealed', (payload: { artist: string; title: string }) => {
          setLastReveal({ artist: payload.artist, title: payload.title });
        });
        // Sync pause/resume — la TV doit refléter l'état serveur.
        sock.on('session:paused', () => {
          setSession((prev) => (prev ? { ...prev, is_paused: true } : prev));
        });
        sock.on('session:resumed', () => {
          setSession((prev) => (prev ? { ...prev, is_paused: false } : prev));
        });
      } catch (err: unknown) {
        if (!cancelled) setError((err as Error).message);
      }
    };

    void init();
    return () => {
      cancelled = true;
      sock?.disconnect();
      setSocket(null);
    };
  }, [shortCode]);

  // ── No code yet : ask for it ────────────────────────────────────────────
  if (!shortCode) {
    const submit = (e: FormEvent): void => {
      e.preventDefault();
      const v = codeInput.trim().toUpperCase();
      if (!v) return;
      setParams({ session: v });
    };
    return (
      <div className="min-h-screen flex flex-col bg-cream">
        <MultiColorBar height="md" />
        <main className="flex-1 flex items-center justify-center p-8">
          <Card size="lg" className="max-w-md w-full text-center">
            <TitleHandwritten as="h1" className="mb-4">
              <Underline>{t('screen.castTitle')}</Underline>
            </TitleHandwritten>
            <p className="font-editorial italic text-ink-soft mb-4">{t('screen.castSubtitle')}</p>
            <form onSubmit={submit} className="space-y-3">
              <Input
                label={t('screen.codeLabel')}
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                placeholder="KOMP-XXXX"
                autoFocus
                maxLength={20}
                className="text-center font-mono uppercase tracking-widest"
              />
              <Button type="submit" size="lg" className="w-full" disabled={!codeInput.trim()}>
                {t('screen.castButton')}
              </Button>
            </form>
          </Card>
        </main>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <Card size="lg" className="max-w-md text-center">
          <p className="text-raspberry font-medium mb-3">{error}</p>
          <Button onClick={() => setParams({})} variant="secondary">
            {t('common.cancel')}
          </Button>
        </Card>
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

  // ── Render selon game_type ──────────────────────────────────────────────
  // Bug 1 — Si la session est ENDED, on bascule sur l'écran Podium final
  // pour que la TV reflète immédiatement l'event session:ended (sans
  // rechargement manuel). Idem pour QUIZZ.
  return (
    <FullscreenWrapper>
      {session.status === 'ENDED' ? (
        <ScreenEndedView session={session} cumulative={cumulative} shortCode={session.short_code} />
      ) : session.game_type === 'QUIZZ' ? (
        <HostQuizzView
          session={session}
          cumulative={cumulative}
          socket={socket}
          onSessionUpdate={setSession}
          onCumulativeUpdate={setCumulative}
          publicView={true}
        />
      ) : (
        <MainScreenView
          session={session}
          currentTrack={currentTrack}
          cumulative={cumulative}
          correctAnswers={correctAnswers}
          phase2StartedAt={phase2StartedAt}
          lastReveal={lastReveal}
          activeBuzzCount={activeBuzzers.size}
        />
      )}
    </FullscreenWrapper>
  );
}

/**
 * Bug 1 — vue Podium final pour l'écran TV. Affichée quand session.status
 * passe à ENDED (broadcast 'session:ended' reçu).
 */
function ScreenEndedView({
  session,
  cumulative,
  shortCode,
}: {
  session: SessionWithParticipants;
  cumulative: CumulativeScore[];
  shortCode: string;
}): JSX.Element {
  const { t } = useTranslation();
  void session;
  const [first, second, third, ...rest] = cumulative;
  const winnerName = first?.label ?? '';
  const url = `${window.location.origin}/play?session=${shortCode}`;
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-cream p-8">
      <p className="font-mono text-sm uppercase tracking-[0.3em] text-spritz-deep mb-4">
        {t('screen.endedEyebrow')}
      </p>
      <h1 className="font-display text-7xl mb-2 text-center">{t('screen.endedTitle')}</h1>
      {winnerName && (
        <p className="font-editorial italic text-3xl text-raspberry mb-8 text-center">
          {t('screen.endedWinner', { name: winnerName })}
        </p>
      )}
      {cumulative.length > 0 ? (
        <ol className="space-y-3 max-w-2xl w-full mb-8">
          {[first, second, third].filter(Boolean).map((entry, idx) => (
            <li
              key={entry!.id}
              className="flex items-center gap-4 px-5 py-4 border-4 border-ink rounded-xl bg-white shadow-pop-lg"
            >
              <span aria-hidden className="text-4xl">
                {['🥇', '🥈', '🥉'][idx]}
              </span>
              {entry!.color && (
                <span
                  aria-hidden
                  className="w-5 h-5 rounded-full border-2 border-ink shrink-0"
                  style={{ backgroundColor: entry!.color }}
                />
              )}
              <span className="font-display text-3xl flex-1 truncate">{entry!.label}</span>
              <span className="font-mono text-2xl font-bold">{entry!.total_points}</span>
            </li>
          ))}
          {rest.length > 0 && (
            <li className="px-5 py-3 border-2 border-ink/30 rounded bg-cream-2/40">
              <ul className="space-y-1">
                {rest.map((entry, idx) => (
                  <li
                    key={entry.id}
                    className="flex items-center gap-3 font-mono text-sm text-ink-soft"
                  >
                    <span className="w-6 text-right">{idx + 4}.</span>
                    <span className="flex-1 truncate">{entry.label}</span>
                    <span className="tabular-nums">{entry.total_points}</span>
                  </li>
                ))}
              </ul>
            </li>
          )}
        </ol>
      ) : (
        <p className="font-editorial italic text-ink-soft mb-8">{t('screen.endedNoScores')}</p>
      )}
      {/* QR pour rejouer / nouvelle partie */}
      <div className="text-center">
        <p className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-2">
          {t('screen.endedRematch')}
        </p>
        <QRCode value={url} size={140} />
        <p className="font-mono text-lg font-bold tracking-[0.2em] text-ink mt-2">{shortCode}</p>
      </div>
    </div>
  );
}

/**
 * <FullscreenWrapper /> — bouton "Plein écran" (déclenche requestFullscreen
 * au 1er click — Chrome bloque l'auto-fullscreen sans interaction utilisateur)
 * + bouton "Sortir" en plein écran. Compat Safari (webkit prefix).
 */
function FullscreenWrapper({ children }: { children: React.ReactNode }): JSX.Element {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = (): void => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const enterFullscreen = async (): Promise<void> => {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      /* refusé */
    }
  };

  const exitFullscreen = async (): Promise<void> => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="relative">
      {children}
      <div className="fixed top-2 right-2 z-50 flex gap-1">
        {!isFullscreen ? (
          <button
            type="button"
            onClick={() => void enterFullscreen()}
            aria-label="Plein écran"
            className="px-2 py-1 text-xs font-mono bg-cream/80 border-2 border-ink rounded hover:bg-cream"
          >
            ⛶ Plein écran
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void exitFullscreen()}
            aria-label="Quitter plein écran"
            className="px-2 py-1 text-xs font-mono bg-cream/80 border-2 border-ink rounded hover:bg-cream"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
