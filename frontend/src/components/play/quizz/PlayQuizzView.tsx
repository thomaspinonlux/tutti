/**
 * <PlayQuizzView /> — vue tel joueur pour les sessions Tutti Quizz.
 *
 * Phases gérées :
 *   - waitingNextQuestion : pas de question active (entre 2 questions ou avant
 *                           la 1ère). On affiche un placeholder.
 *   - asking              : UI de réponse adaptée au QuestionType.
 *   - submitted           : réponse envoyée, on attend le reveal.
 *   - revealed            : on affiche le résultat (correct / score) et la
 *                           bonne réponse. On reste là jusqu'à la prochaine.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Socket } from 'socket.io-client';
import type { CurrentQuestionState, QuestionType } from '@tutti/shared';
import { Button, Card, Badge } from '../../ui/index.js';
import { submitQuizzAnswer } from '../../../lib/sessions.js';

interface RevealResult {
  participant_id: string;
  pseudo: string;
  team_id: string | null;
  is_correct: boolean;
  answered_at_ms: number;
  score: number;
  submitted: string;
}

interface QuizzReveal {
  question_index: number;
  reveal: { answer: string; answer_alt?: string };
  results: RevealResult[];
}

interface Props {
  socket: Socket | null;
  sessionId: string;
  participantId: string;
  token: string;
  pseudo: string;
}

type LocalPhase = 'waitingNextQuestion' | 'asking' | 'submitted' | 'revealed';

export function PlayQuizzView({
  socket,
  sessionId,
  participantId,
  token,
  pseudo: _pseudo,
}: Props): JSX.Element {
  const { t } = useTranslation();

  const [activeQuestion, setActiveQuestion] = useState<CurrentQuestionState | null>(null);
  const [localPhase, setLocalPhase] = useState<LocalPhase>('waitingNextQuestion');
  const [submittedValue, setSubmittedValue] = useState<string | null>(null);
  const [reveal, setReveal] = useState<QuizzReveal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Sockets ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onStart = (msg: { state: CurrentQuestionState }): void => {
      setActiveQuestion(msg.state);
      setLocalPhase('asking');
      setSubmittedValue(null);
      setReveal(null);
      setError(null);
    };
    const onRevealed = (msg: QuizzReveal): void => {
      setReveal(msg);
      setLocalPhase('revealed');
    };

    socket.on('quizz:question_start', onStart);
    socket.on('quizz:question_revealed', onRevealed);

    return () => {
      socket.off('quizz:question_start', onStart);
      socket.off('quizz:question_revealed', onRevealed);
    };
  }, [socket]);

  // ── Submit ──────────────────────────────────────────────────────────────
  const submit = async (value: string): Promise<void> => {
    if (busy || localPhase !== 'asking') return;
    setBusy(true);
    setError(null);
    try {
      await submitQuizzAnswer(sessionId, token, value);
      setSubmittedValue(value);
      setLocalPhase('submitted');
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────

  if (localPhase === 'waitingNextQuestion' || !activeQuestion) {
    return (
      <Card tone="cream" size="md" className="text-center">
        <p className="font-display text-2xl mb-2">{t('playQuizz.waitingNextQuestion')}</p>
        <p className="font-editorial italic text-ink-soft text-sm">{t('playQuizz.waitingHint')}</p>
      </Card>
    );
  }

  // Si la phase serveur a basculé revealed (ex : reconnect après reveal),
  // on veut afficher le revealed.
  const phaseToRender: LocalPhase = activeQuestion.phase === 'revealed' ? 'revealed' : localPhase;

  if (phaseToRender === 'revealed') {
    return (
      <RevealedView
        question={activeQuestion}
        reveal={reveal}
        myParticipantId={participantId}
        mySubmitted={submittedValue}
      />
    );
  }

  // Asking ou submitted : on affiche l'UI mais désactivée si déjà répondu.
  return (
    <div className="space-y-3">
      <QuestionHeader question={activeQuestion} />
      <AnswerUI
        question={activeQuestion}
        disabled={localPhase !== 'asking' || busy}
        submittedValue={submittedValue}
        onSubmit={(v) => void submit(v)}
      />
      {phaseToRender === 'submitted' && (
        <Card tone="basil" size="sm" className="text-center">
          <p className="font-display text-xl">{t('playQuizz.submitted')}</p>
          <p className="font-editorial italic text-ink-soft text-sm mt-1">
            {t('playQuizz.submittedHint')}
          </p>
        </Card>
      )}
      {error && (
        <p role="alert" className="text-raspberry text-sm text-center">
          {error}
        </p>
      )}
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────

function QuestionHeader({ question }: { question: CurrentQuestionState }): JSX.Element {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, []);
  const startedAt = new Date(question.started_at).getTime();
  const elapsedMs = Math.max(0, now - startedAt);
  const remainingMs = Math.max(0, question.time_limit_sec * 1000 - elapsedMs);
  const remainingSec = Math.ceil(remainingMs / 1000);
  const ratio = Math.min(1, elapsedMs / (question.time_limit_sec * 1000));
  const tone = ratio > 0.75 ? 'bg-raspberry' : ratio > 0.5 ? 'bg-lemon' : 'bg-basil';

  return (
    <Card tone="cream" size="md">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <Badge tone="ink" tilt={-2}>
          #{question.question_index + 1}
        </Badge>
        <Badge tone="spritz" tilt={1}>
          {question.type.replace('_', ' ')}
        </Badge>
        <span className="ml-auto font-mono text-2xl font-bold tabular-nums">{remainingSec}s</span>
      </div>
      <div className="w-full h-2 border-2 border-ink rounded overflow-hidden bg-cream-2 mb-3">
        <div
          className={`h-full transition-[width] ${tone}`}
          style={{ width: `${Math.max(0, 100 - Math.round(ratio * 100))}%` }}
        />
      </div>
      <p className="font-display text-2xl leading-tight">{question.text}</p>
      {question.text_alt && (
        <p className="font-editorial italic text-base text-ink-soft mt-1">{question.text_alt}</p>
      )}
    </Card>
  );
}

// ── Answer UI par type ────────────────────────────────────────────────────

function AnswerUI({
  question,
  disabled,
  submittedValue,
  onSubmit,
}: {
  question: CurrentQuestionState;
  disabled: boolean;
  submittedValue: string | null;
  onSubmit: (value: string) => void;
}): JSX.Element {
  const type: QuestionType = question.type;
  if (type === 'MCQ') {
    return (
      <McqAnswer
        choices={question.choices}
        choicesAlt={question.choices_alt}
        disabled={disabled}
        submittedValue={submittedValue}
        onSubmit={onSubmit}
      />
    );
  }
  if (type === 'TRUE_FALSE') {
    return (
      <TrueFalseAnswer disabled={disabled} submittedValue={submittedValue} onSubmit={onSubmit} />
    );
  }
  if (type === 'FREE_TEXT') {
    return (
      <FreeTextAnswer disabled={disabled} submittedValue={submittedValue} onSubmit={onSubmit} />
    );
  }
  return (
    <EstimationAnswer
      min={question.estimation_min ?? 0}
      max={question.estimation_max ?? 100}
      unit={question.estimation_unit}
      disabled={disabled}
      submittedValue={submittedValue}
      onSubmit={onSubmit}
    />
  );
}

function McqAnswer({
  choices,
  choicesAlt,
  disabled,
  submittedValue,
  onSubmit,
}: {
  choices: string[];
  choicesAlt?: string[];
  disabled: boolean;
  submittedValue: string | null;
  onSubmit: (value: string) => void;
}): JSX.Element {
  return (
    <ul className="space-y-2">
      {choices.map((choice, idx) => {
        const isSelected = submittedValue === String(idx);
        return (
          <li key={idx}>
            <button
              type="button"
              onClick={() => onSubmit(String(idx))}
              disabled={disabled}
              aria-pressed={isSelected}
              className={`w-full flex items-center gap-3 p-4 border-2 border-ink rounded text-left font-medium transition-colors ${
                isSelected
                  ? 'bg-basil text-ink shadow-pop-sm'
                  : disabled
                    ? 'bg-cream-2 opacity-60 cursor-not-allowed'
                    : 'bg-cream hover:bg-cream-2 active:translate-y-0.5'
              }`}
            >
              <span className="font-display text-2xl shrink-0 w-8">
                {String.fromCharCode(65 + idx)}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-base truncate">{choice}</p>
                {choicesAlt && choicesAlt[idx] && (
                  <p className="font-editorial italic text-sm text-ink-soft truncate">
                    {choicesAlt[idx]}
                  </p>
                )}
              </div>
              {isSelected && <span className="text-2xl">✓</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function TrueFalseAnswer({
  disabled,
  submittedValue,
  onSubmit,
}: {
  disabled: boolean;
  submittedValue: string | null;
  onSubmit: (value: string) => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-3">
      {(['true', 'false'] as const).map((opt) => {
        const isSelected = submittedValue === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onSubmit(opt)}
            disabled={disabled}
            aria-pressed={isSelected}
            className={`p-6 border-2 border-ink rounded font-display text-3xl transition-colors ${
              isSelected
                ? opt === 'true'
                  ? 'bg-basil text-ink shadow-pop-sm'
                  : 'bg-raspberry text-cream shadow-pop-sm'
                : disabled
                  ? 'bg-cream-2 opacity-60 cursor-not-allowed'
                  : 'bg-cream active:translate-y-0.5 hover:bg-cream-2'
            }`}
          >
            {opt === 'true' ? `✓ ${t('quizz.tfTrue')}` : `✗ ${t('quizz.tfFalse')}`}
          </button>
        );
      })}
    </div>
  );
}

function FreeTextAnswer({
  disabled,
  submittedValue,
  onSubmit,
}: {
  disabled: boolean;
  submittedValue: string | null;
  onSubmit: (value: string) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [text, setText] = useState(submittedValue ?? '');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        onSubmit(text.trim());
      }}
      className="space-y-3"
    >
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={disabled}
        autoFocus
        placeholder={t('playQuizz.freeTextPlaceholder')}
        maxLength={120}
        className="w-full px-4 py-3 border-2 border-ink rounded text-lg font-medium bg-cream focus:bg-white"
      />
      <Button type="submit" disabled={disabled || !text.trim()} size="lg" className="w-full">
        {t('playQuizz.send')}
      </Button>
    </form>
  );
}

function EstimationAnswer({
  min,
  max,
  unit,
  disabled,
  submittedValue,
  onSubmit,
}: {
  min: number;
  max: number;
  unit?: string;
  disabled: boolean;
  submittedValue: string | null;
  onSubmit: (value: string) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const initial =
    submittedValue !== null && !Number.isNaN(Number.parseFloat(submittedValue))
      ? Number.parseFloat(submittedValue)
      : Math.round((min + max) / 2);
  const [value, setValue] = useState(initial);
  return (
    <div className="space-y-3">
      <div className="text-center">
        <p className="font-display text-5xl">
          {value} {unit ?? ''}
        </p>
        <p className="font-mono text-xs text-ink-soft mt-1">
          {min} {unit ?? ''} ↔ {max} {unit ?? ''}
        </p>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={Math.max(1, Math.round((max - min) / 100))}
        value={value}
        onChange={(e) => setValue(Number.parseInt(e.target.value, 10))}
        disabled={disabled}
        className="w-full h-3 accent-spritz"
      />
      <Button
        onClick={() => onSubmit(String(value))}
        disabled={disabled}
        size="lg"
        className="w-full"
      >
        {t('playQuizz.send')}
      </Button>
    </div>
  );
}

// ── Revealed ──────────────────────────────────────────────────────────────

function RevealedView({
  question,
  reveal,
  myParticipantId,
  mySubmitted,
}: {
  question: CurrentQuestionState;
  reveal: QuizzReveal | null;
  myParticipantId: string;
  mySubmitted: string | null;
}): JSX.Element {
  const { t } = useTranslation();
  const myResult = reveal?.results.find((r) => r.participant_id === myParticipantId);
  const isCorrect = myResult?.is_correct ?? false;
  const score = myResult?.score ?? 0;
  const myRank = reveal?.results.findIndex((r) => r.participant_id === myParticipantId) ?? -1;

  const tone = isCorrect ? 'basil' : 'raspberry';
  const correctAnswerDisplay = displayAnswer(reveal?.reveal.answer ?? null, question.type);

  return (
    <div className="space-y-3">
      <Card tone={tone as 'basil' | 'raspberry'} size="md" className="text-center">
        <p className="font-display text-4xl mb-1">
          {isCorrect ? `🎉 ${t('playQuizz.correct')}` : `❌ ${t('playQuizz.wrong')}`}
        </p>
        {isCorrect && score > 0 && <p className="font-display text-3xl">+{score} pts</p>}
        {!isCorrect && question.type === 'ESTIMATION' && score > 0 && (
          <p className="font-display text-3xl">+{score} pts</p>
        )}
        {myRank >= 0 && (
          <p className="font-mono text-xs uppercase tracking-wider mt-2">
            {t('playQuizz.rankOnQuestion', { rank: myRank + 1 })}
          </p>
        )}
      </Card>

      <Card tone="cream" size="sm">
        <p className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-1">
          {t('playQuizz.correctAnswerLabel')}
        </p>
        <p className="font-display text-2xl">{correctAnswerDisplay}</p>
        {mySubmitted !== null && (
          <p className="font-editorial italic text-sm text-ink-soft mt-2">
            {t('playQuizz.yourAnswer', { value: displayUserAnswer(mySubmitted, question) })}
          </p>
        )}
      </Card>
    </div>
  );
}

function displayAnswer(raw: string | null, type: QuestionType): string {
  if (raw === null) return '—';
  if (type === 'TRUE_FALSE') return raw === 'true' ? '✓ Vrai' : '✗ Faux';
  if (type === 'ESTIMATION') {
    try {
      const meta = JSON.parse(raw) as { target: number; unit?: string };
      return `${meta.target}${meta.unit ? ` ${meta.unit}` : ''}`;
    } catch {
      return raw;
    }
  }
  return raw;
}

function displayUserAnswer(value: string, question: CurrentQuestionState): string {
  if (question.type === 'MCQ') {
    const idx = Number.parseInt(value, 10);
    if (!Number.isNaN(idx) && idx >= 0 && idx < question.choices.length) {
      return `${String.fromCharCode(65 + idx)} — ${question.choices[idx]}`;
    }
  }
  if (question.type === 'TRUE_FALSE') return value === 'true' ? '✓ Vrai' : '✗ Faux';
  return value;
}
