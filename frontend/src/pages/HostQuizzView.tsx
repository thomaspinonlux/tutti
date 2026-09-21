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
 * feat/quiz-comme-le-blind-test — comme le blind test : la partie d'abord
 * (QR code, joueurs, manette), puis on choisit un THÈME et un niveau ; ses
 * questions s'ajoutent à la partie. En fin de manche, on choisit un autre
 * thème ou on termine. La partie n'est plus jamais tuée par un choix de thème.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
  ajouterThemeQuiz,
  endSession,
  listerThemesQuiz,
  nextQuestion,
  playQuestion,
  revealQuestion,
  startSession,
} from '../lib/sessions.js';
import { getShareableOrigin } from '../lib/platform.js';
import { QRCode } from '../components/host/QRCode.js';
import { ChoixThemeQuiz } from '../components/quizz/ChoixThemeQuiz.js';
import { getQuestionSet } from '../lib/questionSets.js';
import { Button, Card, TitleHandwritten, Underline } from '../components/ui/index.js';
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
  /** Badge « qui a la manette » (fourni par HostPage, comme au blind test). */
  enTete?: ReactNode;
}

export function HostQuizzView({
  session,
  cumulative,
  socket,
  onSessionUpdate,
  onCumulativeUpdate,
  publicView = false,
  enTete,
}: Props): JSX.Element {
  const { t } = useTranslation();

  const [pack, setPack] = useState<QuestionSetWithQuestions | null>(null);
  const [packError, setPackError] = useState<string | null>(null);
  const [activeQuestion, setActiveQuestion] = useState<CurrentQuestionState | null>(null);
  const [submittedSet, setSubmittedSet] = useState<Set<string>>(new Set());
  const [lastReveal, setLastReveal] = useState<QuizzReveal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Les questions de la partie : vides tant qu'aucun thème n'est choisi.
  const [setId, setSetId] = useState<string | null>(session.question_set_id ?? null);
  const [versionPack, setVersionPack] = useState(0);
  const [finDeManche, setFinDeManche] = useState(false);
  const [choixOuvert, setChoixOuvert] = useState(false);

  useEffect(() => {
    if (session.question_set_id) setSetId(session.question_set_id);
  }, [session.question_set_id]);

  useEffect(() => {
    if (!setId) return;
    getQuestionSet(setId)
      .then((p) => {
        setPack(p);
        setPackError(null);
      })
      .catch((err: unknown) => setPackError((err as Error).message));
  }, [setId, versionPack]);

  // ── Socket listeners ────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onQuestionStart = (msg: { state: CurrentQuestionState }): void => {
      setActiveQuestion(msg.state);
      setSubmittedSet(new Set());
      setLastReveal(null);
      setFinDeManche(false);
    };
    // Thème ajouté (depuis la console OU la manette) : on relit les questions.
    const onThemeAdded = (msg: { set_id: string }): void => {
      setSetId(msg.set_id);
      setVersionPack((v) => v + 1);
      setFinDeManche(false);
    };
    const onBlockEnded = (): void => {
      setFinDeManche(true);
      setActiveQuestion(null);
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
    socket.on('quizz:theme_added', onThemeAdded);
    socket.on('quizz:block_ended', onBlockEnded);

    return () => {
      socket.off('quizz:question_start', onQuestionStart);
      socket.off('quizz:answer_submitted', onAnswerSubmitted);
      socket.off('quizz:question_revealed', onQuestionRevealed);
      socket.off('session:ended', onSessionEnded);
      socket.off('quizz:theme_added', onThemeAdded);
      socket.off('quizz:block_ended', onBlockEnded);
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
      if (result.fin_de_manche) {
        // La partie continue : on propose un autre thème.
        setFinDeManche(true);
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
    } catch (err: unknown) {
      // fix/fin-de-quiz-sans-reponse — L'ÉCHEC SE DIT.
      // Sans capture, terminer devant la salle et échouer laissait l'écran
      // identique, sans message : l'animateur recliquait pendant que les
      // joueurs attendaient le podium.
      console.error('[Quiz] fin de session en échec :', err);
      window.alert(`Impossible de terminer : ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  // ── Render branches ─────────────────────────────────────────────────────

  const choixTheme = (
    <ChoixThemeQuiz
      charger={() => listerThemesQuiz(session.id)}
      ajouter={(packId, niveau) => ajouterThemeQuiz(session.id, packId, niveau)}
      onAjoute={(m) => {
        setSetId(m.set_id);
        setVersionPack((v) => v + 1);
        setFinDeManche(false);
        setChoixOuvert(false);
      }}
    />
  );
  const barreHaut = (
    <div className="fixed top-3 right-3 z-30 flex gap-2 items-center">
      {!publicView && <TvCastButton tvCode={session.tv_code} shortCode={session.short_code} />}
      {enTete}
    </div>
  );

  if (packError) {
    return (
      <div className="max-w-md mx-auto p-6">
        <p role="alert" className="text-raspberry">
          {packError}
        </p>
      </div>
    );
  }

  if (setId && !pack) {
    return (
      <div className="p-6">
        <p className="font-mono text-ink-soft">{t('common.loading')}</p>
      </div>
    );
  }

  // Session ENDED
  if (session.status === 'ENDED') {
    return <EndedView nom={pack?.name ?? 'Quiz'} cumulative={cumulative} mode={session.mode} />;
  }

  // Session WAITING (pas démarrée) : QR code, joueurs, choix du thème.
  if (session.status === 'WAITING') {
    return (
      <>
        {barreHaut}
        <WaitingView
          shortCode={session.short_code}
          nombreQuestions={pack?.questions.length ?? 0}
          participants={session.participants}
          choixTheme={publicView ? null : choixTheme}
          onStart={publicView ? null : () => void handleStartSession()}
          busy={busy}
          error={error}
        />
      </>
    );
  }

  if (!pack) {
    // Partie démarrée sans thème (ne devrait pas arriver) : on en propose un.
    return (
      <div className="max-w-2xl mx-auto p-8 space-y-4">
        {barreHaut}
        <p className="font-editorial italic text-ink-soft">
          {publicView ? t('quizTheme.waitingMaster') : t('quizTheme.noThemeYet')}
        </p>
        {!publicView && choixTheme}
      </div>
    );
  }

  // Session PLAYING
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 p-4 h-screen relative">
      {barreHaut}
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
            nom={pack.questions[0]?.category ?? pack.name}
            finDeManche={finDeManche}
            publicView={publicView}
            choixTheme={publicView ? null : choixTheme}
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

        {!publicView && activeQuestion && activeQuestion.phase !== 'asking' && (
          <Card size="sm">
            {choixOuvert ? (
              <>
                {choixTheme}
                <Button variant="ghost" size="sm" className="w-full mt-2" onClick={() => setChoixOuvert(false)}>
                  {t('quizTheme.hide')}
                </Button>
              </>
            ) : (
              <Button variant="secondary" size="sm" className="w-full" onClick={() => setChoixOuvert(true)}>
                {t('quizTheme.addTheme')}
              </Button>
            )}
          </Card>
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
  shortCode,
  nombreQuestions,
  participants,
  choixTheme,
  onStart,
  busy,
  error,
}: {
  shortCode: string;
  nombreQuestions: number;
  participants: Participant[];
  choixTheme: ReactNode | null;
  onStart: (() => void) | null;
  busy: boolean;
  error: string | null;
}): JSX.Element {
  const { t } = useTranslation();
  const connected = participants.filter((p) => !p.is_kicked);
  const playUrl = `${getShareableOrigin()}/play?session=${shortCode}`;

  return (
    <div className="max-w-5xl mx-auto p-6 grid gap-6 lg:grid-cols-[auto_1fr]">
      <Card size="lg" className="text-center">
        <p className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-3">
          {t('quizTheme.scanToJoin')}
        </p>
        <div className="inline-block rounded-xl bg-white p-3">
          <QRCode value={playUrl} size={240} />
        </div>
        <p className="font-mono text-3xl font-bold tracking-[0.2em] mt-3">{shortCode}</p>
      </Card>

      <div className="space-y-4">
        <Card size="md">
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
                  className="px-3 py-1.5 border-2 border-ink rounded font-medium text-sm bg-cream truncate"
                >
                  {p.is_master ? '👑 ' : ''}
                  {p.pseudo}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card size="md">
          <p className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-2">
            {t('quizTheme.title')}
            {nombreQuestions > 0 && ` · ${nombreQuestions} ${t('quizz.questionsCount')}`}
          </p>
          {choixTheme ?? (
            <p className="font-editorial italic text-ink-soft">{t('quizTheme.waitingMaster')}</p>
          )}
        </Card>

        {error && (
          <p role="alert" className="text-raspberry text-sm">
            {error}
          </p>
        )}

        {onStart && (
          <div className="flex justify-center">
            <Button onClick={onStart} disabled={busy || nombreQuestions === 0} size="lg">
              {busy ? t('common.saving') : t('quizTheme.startQuestions')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function NoActiveQuestion({
  nom,
  finDeManche,
  publicView,
  choixTheme,
  onNext,
  busy,
  error,
}: {
  nom: string;
  finDeManche: boolean;
  publicView: boolean;
  choixTheme: ReactNode | null;
  onNext: (() => void) | null;
  busy: boolean;
  error: string | null;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="max-w-2xl mx-auto p-8 text-center space-y-4">
      <TitleHandwritten as="h2" className="text-4xl">
        <Underline>{finDeManche ? t('quizTheme.blockEnded') : nom}</Underline>
      </TitleHandwritten>
      <p className="font-mono text-sm text-ink-soft">
        {finDeManche
          ? publicView
            ? t('quizTheme.waitingMaster')
            : t('quizTheme.blockEndedHint')
          : t('hostQuizz.readyToStart')}
      </p>
      {error && (
        <p role="alert" className="text-raspberry text-sm">
          {error}
        </p>
      )}
      {finDeManche && choixTheme && <div className="text-left">{choixTheme}</div>}
      {onNext && (
        <Button onClick={onNext} disabled={busy} size="lg">
          {finDeManche ? t('quizTheme.continue') : t('hostQuizz.firstQuestion')}
        </Button>
      )}
    </div>
  );
}

function EndedView({
  nom,
  cumulative,
  mode,
}: {
  nom: string;
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
        <p className="font-editorial italic text-ink-soft">{nom}</p>
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
