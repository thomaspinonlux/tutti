/**
 * <HostQuizzView /> — vue host pour les sessions Tutti Quizz (étape 15).
 *
 * Affichée par HostPage quand session.game_type === 'QUIZZ'.
 *
 * États possibles :
 *   - waiting        : la session n'a pas démarré (status=WAITING)
 *   - noActiveQuestion : status=PLAYING mais aucune question lancée
 *                       (juste après startSession ou avant prochaine)
 *   - asking         : question en cours, timer running
 *   - revealed       : réponse révélée + leaderboard
 *   - ended          : session terminée
 *
 * V0 : pas de round multi — on travaille direct sur session.question_set_id
 * et un index incrémental.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Socket } from 'socket.io-client';
import type {
  CumulativeScore,
  CurrentQuestionState,
  Participant,
  QuestionSetWithQuestions,
  Session,
  SessionWithParticipants,
} from '@tutti/shared';
import {
  endSession,
  nextQuestion,
  playQuestion,
  revealQuestion,
  startSession,
} from '../lib/sessions.js';
import { getQuestionSet } from '../lib/questionSets.js';
import { Badge, Button, Card, TitleHandwritten, Underline } from '../components/ui/index.js';
import { QuestionConsole } from '../components/host/quizz/QuestionConsole.js';
import { QuizzAnswersList } from '../components/host/quizz/QuizzAnswersList.js';
import { TvCastButton } from '../components/host/TvCastButton.js';

interface QuizzReveal {
  question_index: number;
  reveal: { answer: string; answer_alt?: string };
  results: Array<{
    participant_id: string;
    pseudo: string;
    team_id: string | null;
    is_correct: boolean;
    answered_at_ms: number;
    score: number;
    submitted: string;
  }>;
}

interface Props {
  session: SessionWithParticipants;
  cumulative: CumulativeScore[];
  socket: Socket | null;
  onSessionUpdate: (s: SessionWithParticipants) => void;
  onCumulativeUpdate: (c: CumulativeScore[]) => void;
  /**
   * true en mode B (sans animateur) : iPad = vue publique festive XL,
   * pas de boutons de pilotage (le master pilote depuis son tel).
   */
  publicView?: boolean;
}

export function HostQuizzView({
  session,
  cumulative,
  socket,
  onSessionUpdate,
  onCumulativeUpdate,
  publicView = false,
}: Props): JSX.Element {
  const { t } = useTranslation();

  const [pack, setPack] = useState<QuestionSetWithQuestions | null>(null);
  const [packError, setPackError] = useState<string | null>(null);
  const [activeQuestion, setActiveQuestion] = useState<CurrentQuestionState | null>(null);
  const [submittedSet, setSubmittedSet] = useState<Set<string>>(new Set());
  const [lastReveal, setLastReveal] = useState<QuizzReveal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Charge le pack lié à la session.
  useEffect(() => {
    if (!session.question_set_id) {
      setPackError(t('hostQuizz.noPackError'));
      return;
    }
    getQuestionSet(session.question_set_id)
      .then(setPack)
      .catch((err: unknown) => setPackError((err as Error).message));
  }, [session.question_set_id, t]);

  // ── Socket listeners ────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onQuestionStart = (msg: { state: CurrentQuestionState }): void => {
      setActiveQuestion(msg.state);
      setSubmittedSet(new Set());
      setLastReveal(null);
    };
    const onAnswerSubmitted = (msg: { participant_id: string }): void => {
      setSubmittedSet((s) => new Set([...s, msg.participant_id]));
    };
    const onQuestionRevealed = (msg: QuizzReveal): void => {
      setLastReveal(msg);
      setActiveQuestion((q) => (q ? { ...q, phase: 'revealed', reveal: msg.reveal } : q));
    };
    const onSessionEnded = (msg: { session: Session; cumulative: CumulativeScore[] }): void => {
      onSessionUpdate({ ...session, ...msg.session, participants: session.participants });
      onCumulativeUpdate(msg.cumulative);
      setActiveQuestion(null);
    };

    socket.on('quizz:question_start', onQuestionStart);
    socket.on('quizz:answer_submitted', onAnswerSubmitted);
    socket.on('quizz:question_revealed', onQuestionRevealed);
    socket.on('session:ended', onSessionEnded);

    return () => {
      socket.off('quizz:question_start', onQuestionStart);
      socket.off('quizz:answer_submitted', onAnswerSubmitted);
      socket.off('quizz:question_revealed', onQuestionRevealed);
      socket.off('session:ended', onSessionEnded);
    };
  }, [socket, session, onSessionUpdate, onCumulativeUpdate]);

  // ── Actions host ────────────────────────────────────────────────────────

  const handleStartSession = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const updated = await startSession(session.id);
      onSessionUpdate({ ...session, ...updated });
      // Lance immédiatement la première question.
      await playQuestion(session.id, 0);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleNext = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await nextQuestion(session.id);
      if (result.ended && result.session) {
        onSessionUpdate({ ...session, ...result.session });
        if (result.cumulative) onCumulativeUpdate(result.cumulative);
        setActiveQuestion(null);
      }
      // Sinon le state arrivera via socket onQuestionStart.
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleReveal = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await revealQuestion(session.id);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleEndSession = async (): Promise<void> => {
    if (!window.confirm(t('hostQuizz.endConfirm'))) return;
    setBusy(true);
    try {
      const updated = await endSession(session.id);
      onSessionUpdate({ ...session, ...updated });
    } finally {
      setBusy(false);
    }
  };

  // ── Render branches ─────────────────────────────────────────────────────

  if (packError) {
    return (
      <div className="max-w-md mx-auto p-6">
        <p role="alert" className="text-raspberry">
          {packError}
        </p>
      </div>
    );
  }

  if (!pack) {
    return (
      <div className="p-6">
        <p className="font-mono text-ink-soft">{t('common.loading')}</p>
      </div>
    );
  }

  // Session ENDED
  if (session.status === 'ENDED') {
    return <EndedView pack={pack} cumulative={cumulative} mode={session.mode} />;
  }

  // Session WAITING (pas démarrée)
  if (session.status === 'WAITING') {
    return (
      <WaitingView
        pack={pack}
        participants={session.participants}
        onStart={publicView ? null : () => void handleStartSession()}
        busy={busy}
        error={error}
      />
    );
  }

  // Session PLAYING
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 p-4 h-screen relative">
      {!publicView && (
        <div className="absolute top-2 right-2 z-30">
          <TvCastButton tvCode={session.tv_code} shortCode={session.short_code} />
        </div>
      )}
      <main className="min-w-0 overflow-hidden">
        {activeQuestion ? (
          <QuestionConsole
            state={activeQuestion}
            packBilingual={pack.is_bilingual}
            participants={session.participants}
            submittedSet={submittedSet}
            lastReveal={lastReveal}
            busy={busy}
            onReveal={publicView ? null : () => void handleReveal()}
            onNext={publicView ? null : () => void handleNext()}
            xl={publicView}
          />
        ) : (
          <NoActiveQuestion
            pack={pack}
            onNext={publicView ? null : () => void handleNext()}
            busy={busy}
            error={error}
          />
        )}
      </main>

      <aside className="space-y-3">
        <Card size="sm">
          <p className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-2">
            {t('hostQuizz.leaderboard')}
          </p>
          <ol className="space-y-1">
            {cumulative.slice(0, 8).map((c, idx) => (
              <li
                key={c.id}
                className="flex items-center justify-between text-sm border-b border-ink/10 pb-1 last:border-b-0"
              >
                <span className="font-mono text-xs text-ink-soft w-5">{idx + 1}.</span>
                <span className="flex-1 truncate">{c.label}</span>
                <span className="font-mono font-bold">{c.total_points}</span>
              </li>
            ))}
            {cumulative.length === 0 && (
              <li className="font-editorial italic text-xs text-ink-soft">
                {t('hostQuizz.noScoresYet')}
              </li>
            )}
          </ol>
        </Card>

        {activeQuestion?.phase === 'asking' && (
          <QuizzAnswersList participants={session.participants} submittedSet={submittedSet} />
        )}

        {!publicView && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleEndSession()}
            disabled={busy}
            className="w-full"
          >
            {t('hostQuizz.endSession')}
          </Button>
        )}
      </aside>
    </div>
  );
}

// ── Vues internes ─────────────────────────────────────────────────────────

function WaitingView({
  pack,
  participants,
  onStart,
  busy,
  error,
}: {
  pack: QuestionSetWithQuestions;
  participants: Participant[];
  onStart: (() => void) | null;
  busy: boolean;
  error: string | null;
}): JSX.Element {
  const { t } = useTranslation();
  const connected = participants.filter((p) => !p.is_kicked);

  return (
    <div className="max-w-3xl mx-auto p-8 space-y-6">
      <header className="text-center">
        <TitleHandwritten as="h1" className="text-5xl mb-3">
          <Underline>{pack.name}</Underline>
        </TitleHandwritten>
        <Badge tone={pack.is_bilingual ? 'plum' : 'basil'}>
          {pack.is_bilingual
            ? `${pack.language_1.toUpperCase()} · ${(pack.language_2 ?? '').toUpperCase()}`
            : pack.language_1.toUpperCase()}
        </Badge>
        <p className="font-mono text-sm text-ink-soft mt-2">
          {pack.questions.length} {t('quizz.questionsCount')}
        </p>
      </header>

      <Card size="lg">
        <p className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-2">
          {t('hostQuizz.connected', { count: connected.length })}
        </p>
        {connected.length === 0 ? (
          <p className="font-editorial italic text-ink-soft">{t('hostQuizz.waitingForPlayers')}</p>
        ) : (
          <ul className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {connected.map((p) => (
              <li
                key={p.id}
                className="px-3 py-1.5 border-2 border-ink rounded font-medium text-sm bg-cream"
              >
                {p.pseudo}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {error && (
        <p role="alert" className="text-raspberry text-sm">
          {error}
        </p>
      )}

      {onStart && (
        <div className="flex justify-center">
          <Button onClick={onStart} disabled={busy || connected.length === 0} size="lg">
            {busy ? t('common.saving') : t('hostQuizz.startSession')}
          </Button>
        </div>
      )}
    </div>
  );
}

function NoActiveQuestion({
  pack,
  onNext,
  busy,
  error,
}: {
  pack: QuestionSetWithQuestions;
  onNext: (() => void) | null;
  busy: boolean;
  error: string | null;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="max-w-xl mx-auto p-8 text-center space-y-4">
      <TitleHandwritten as="h2" className="text-4xl">
        <Underline>{pack.name}</Underline>
      </TitleHandwritten>
      <p className="font-mono text-sm text-ink-soft">{t('hostQuizz.readyToStart')}</p>
      {error && (
        <p role="alert" className="text-raspberry text-sm">
          {error}
        </p>
      )}
      {onNext && (
        <Button onClick={onNext} disabled={busy} size="lg">
          {t('hostQuizz.firstQuestion')}
        </Button>
      )}
    </div>
  );
}

function EndedView({
  pack,
  cumulative,
  mode,
}: {
  pack: QuestionSetWithQuestions;
  cumulative: CumulativeScore[];
  mode: string;
}): JSX.Element {
  const { t } = useTranslation();
  const podium = cumulative.slice(0, 3);
  const rest = cumulative.slice(3);

  const positions = useMemo(
    () => [
      { rank: 1, tone: 'lemon', medal: '🥇' },
      { rank: 2, tone: 'spritz', medal: '🥈' },
      { rank: 3, tone: 'plum', medal: '🥉' },
    ],
    [],
  );

  return (
    <div className="max-w-3xl mx-auto p-8 space-y-6">
      <header className="text-center">
        <TitleHandwritten as="h1" className="text-5xl mb-2">
          <Underline>{t('hostQuizz.endedTitle')}</Underline>
        </TitleHandwritten>
        <p className="font-editorial italic text-ink-soft">{pack.name}</p>
        <p className="font-mono text-xs text-ink-soft uppercase tracking-wider mt-1">
          {mode === 'TEAMS' ? t('hostQuizz.byTeams') : t('hostQuizz.solo')}
        </p>
      </header>

      <ul className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {podium.map((c, idx) => {
          const meta = positions[idx]!;
          return (
            <li key={c.id}>
              <Card tone={meta.tone as 'lemon' | 'spritz' | 'plum'} size="lg">
                <p className="text-4xl mb-2">{meta.medal}</p>
                <p className="font-display text-2xl mb-1 truncate">{c.label}</p>
                <p className="font-mono text-sm">{c.total_points} pts</p>
              </Card>
            </li>
          );
        })}
      </ul>

      {rest.length > 0 && (
        <Card size="sm">
          <ol className="space-y-1">
            {rest.map((c, idx) => (
              <li key={c.id} className="flex items-center justify-between text-sm">
                <span className="font-mono text-xs text-ink-soft w-6">{idx + 4}.</span>
                <span className="flex-1 truncate">{c.label}</span>
                <span className="font-mono font-bold">{c.total_points}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
