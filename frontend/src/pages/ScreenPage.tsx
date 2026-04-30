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
  if (session.game_type === 'QUIZZ') {
    return (
      <HostQuizzView
        session={session}
        cumulative={cumulative}
        socket={socket}
        onSessionUpdate={setSession}
        onCumulativeUpdate={setCumulative}
        publicView={true}
      />
    );
  }

  // TRACKS : MainScreenView en mode TV public
  return (
    <MainScreenView
      session={session}
      currentTrack={currentTrack}
      cumulative={cumulative}
      correctAnswers={correctAnswers}
      phase2StartedAt={phase2StartedAt}
      lastReveal={lastReveal}
      activeBuzzCount={activeBuzzers.size}
    />
  );
}
