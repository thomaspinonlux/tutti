/**
 * <QuestionConsole /> — affichage central de la question pour le host quizz.
 *
 * Phases :
 *   - asking   : énoncé + choix (MCQ) ou indications (autres types)
 *                + timer countdown + actions "Révéler maintenant"
 *   - revealed : énoncé + bonne réponse + classement de la question
 *                + bouton "Question suivante"
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CurrentQuestionState, Participant } from '@tutti/shared';
import { Badge, Button, Card } from '../../ui/index.js';

interface RevealResult {
  participant_id: string;
  pseudo: string;
  team_id: string | null;
  is_correct: boolean;
  answered_at_ms: number;
  score: number;
  submitted: string;
}

interface Props {
  state: CurrentQuestionState;
  packBilingual: boolean;
  participants: Participant[];
  submittedSet: Set<string>;
  lastReveal: { question_index: number; results: RevealResult[] } | null;
  busy: boolean;
  /** null en publicView (mode B iPad) → masque les boutons. */
  onReveal: (() => void) | null;
  onNext: (() => void) | null;
  /** true en publicView : agrandit les polices pour la TV. */
  xl?: boolean;
}

export function QuestionConsole({
  state,
  packBilingual,
  participants,
  submittedSet,
  lastReveal,
  busy,
  onReveal,
  onNext,
  xl = false,
}: Props): JSX.Element {
  const { t } = useTranslation();

  // Timer : tick chaque 200ms.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, []);

  const startedAt = new Date(state.started_at).getTime();
  const elapsedMs = Math.max(0, now - startedAt);
  const remainingMs = Math.max(0, state.time_limit_sec * 1000 - elapsedMs);
  const remainingSec = Math.ceil(remainingMs / 1000);
  const ratio = Math.min(1, elapsedMs / (state.time_limit_sec * 1000));

  const expectedCount = participants.filter((p) => !p.is_kicked).length;
  const submittedCount = submittedSet.size;

  const isAsking = state.phase === 'asking';

  return (
    <div className="h-full flex flex-col">
      {/* Header : index + type + category + timer */}
      <header className="flex items-center justify-between mb-3 gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone="ink" tilt={-2}>
            #{state.question_index + 1}
          </Badge>
          <Badge tone="spritz" tilt={1}>
            {state.type.replace('_', ' ')}
          </Badge>
          {state.category && (
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-soft">
              {state.category}
            </span>
          )}
          <span className="font-mono text-[11px] text-ink-soft">{state.points} pts</span>
        </div>
        <TimerBar remainingSec={remainingSec} ratio={ratio} isAsking={isAsking} />
      </header>

      {/* Énoncé */}
      <Card size="lg" tone={isAsking ? 'cream' : 'spritz'} className="mb-4">
        <p
          className={`font-display leading-tight mb-2 ${
            xl ? 'text-5xl md:text-6xl 2xl:text-7xl' : 'text-3xl md:text-4xl'
          }`}
        >
          {state.text}
        </p>
        {packBilingual && state.text_alt && (
          <p className={`font-editorial italic text-ink-soft ${xl ? 'text-3xl' : 'text-xl'}`}>
            {state.text_alt}
          </p>
        )}
      </Card>

      {/* feat/quiz-question-media — embed YouTube (audio caché / video visible) */}
      {state.media_youtube_id && (state.media_type === 'AUDIO' || state.media_type === 'VIDEO') && (
        <QuizMediaEmbed
          youtubeId={state.media_youtube_id}
          startSec={state.media_start_sec ?? 0}
          durationSec={state.media_duration_sec ?? 10}
          kind={state.media_type === 'AUDIO' ? 'audio' : 'video'}
          xl={xl}
        />
      )}

      {/* Body type-specific */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {state.type === 'MCQ' && (
          <McqChoices
            choices={state.choices}
            choicesAlt={packBilingual ? state.choices_alt : undefined}
            revealAnswer={state.reveal?.answer ?? null}
          />
        )}
        {state.type === 'TRUE_FALSE' && (
          <TrueFalseDisplay revealAnswer={state.reveal?.answer ?? null} />
        )}
        {state.type === 'FREE_TEXT' && (
          <FreeTextDisplay
            revealAnswer={state.reveal?.answer ?? null}
            revealAlt={packBilingual ? state.reveal?.answer_alt : undefined}
          />
        )}
        {state.type === 'ESTIMATION' && (
          <EstimationDisplay
            min={state.estimation_min}
            max={state.estimation_max}
            unit={state.estimation_unit}
            revealAnswer={state.reveal?.answer ?? null}
          />
        )}

        {/* Phase revealed : classement */}
        {!isAsking && lastReveal && lastReveal.question_index === state.question_index && (
          <div className="mt-6">
            <p className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-2">
              {t('hostQuizz.questionResults')}
            </p>
            <ol className="space-y-1">
              {lastReveal.results.slice(0, 10).map((r, idx) => (
                <li
                  key={r.participant_id}
                  className={`flex items-center gap-2 px-3 py-1.5 border-2 border-ink rounded text-sm ${
                    r.is_correct ? 'bg-basil/20' : 'bg-cream'
                  }`}
                >
                  <span className="font-mono text-xs text-ink-soft w-5">{idx + 1}.</span>
                  <span className="flex-1 truncate font-medium">{r.pseudo}</span>
                  <span className="font-mono text-xs text-ink-soft truncate max-w-[40%]">
                    {r.submitted}
                  </span>
                  <span className="font-mono font-bold w-16 text-right">
                    {r.is_correct ? '+' : ''}
                    {r.score}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {/* Footer actions (cachés en publicView mode B) */}
      <footer className="mt-4 flex items-center justify-between gap-3">
        <p className="font-mono text-sm text-ink-soft">
          {isAsking
            ? t('hostQuizz.submitted', { count: submittedCount, total: expectedCount })
            : t('hostQuizz.phaseRevealed')}
        </p>
        <div className="flex gap-2">
          {isAsking && onReveal && (
            <Button onClick={onReveal} disabled={busy} variant="secondary">
              {t('hostQuizz.revealNow')}
            </Button>
          )}
          {!isAsking && onNext && (
            <Button onClick={onNext} disabled={busy}>
              {t('hostQuizz.nextQuestion')}
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function TimerBar({
  remainingSec,
  ratio,
  isAsking,
}: {
  remainingSec: number;
  ratio: number;
  isAsking: boolean;
}): JSX.Element {
  const pct = Math.round(ratio * 100);
  const tone = ratio > 0.75 ? 'bg-raspberry' : ratio > 0.5 ? 'bg-lemon' : 'bg-basil';
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-2xl font-bold tabular-nums w-12 text-right">
        {isAsking ? `${remainingSec}s` : '—'}
      </span>
      <div className="w-32 h-3 border-2 border-ink rounded overflow-hidden bg-cream">
        <div
          className={`h-full transition-[width] ${tone}`}
          style={{ width: isAsking ? `${100 - pct}%` : '0%' }}
        />
      </div>
    </div>
  );
}

function McqChoices({
  choices,
  choicesAlt,
  revealAnswer,
}: {
  choices: string[];
  choicesAlt?: string[];
  revealAnswer: string | null;
}): JSX.Element {
  return (
    <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {choices.map((choice, idx) => {
        const isCorrect =
          revealAnswer !== null &&
          choice.trim().toLowerCase() === revealAnswer.trim().toLowerCase();
        return (
          <li key={idx}>
            <div
              className={`flex items-center gap-3 p-4 border-2 border-ink rounded transition-colors ${
                revealAnswer === null
                  ? 'bg-cream'
                  : isCorrect
                    ? 'bg-basil text-ink'
                    : 'bg-cream-2 opacity-60'
              }`}
            >
              <span className="font-display text-2xl">{String.fromCharCode(65 + idx)}</span>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-lg truncate">{choice}</p>
                {choicesAlt && choicesAlt[idx] && (
                  <p className="font-editorial italic text-sm text-ink-soft truncate">
                    {choicesAlt[idx]}
                  </p>
                )}
              </div>
              {isCorrect && <span className="text-2xl">✓</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function TrueFalseDisplay({ revealAnswer }: { revealAnswer: string | null }): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-3">
      {(['true', 'false'] as const).map((opt) => {
        const isCorrect = revealAnswer === opt;
        return (
          <div
            key={opt}
            className={`p-6 border-2 border-ink rounded text-center transition-colors ${
              revealAnswer === null
                ? 'bg-cream'
                : isCorrect
                  ? opt === 'true'
                    ? 'bg-basil text-ink'
                    : 'bg-raspberry text-cream'
                  : 'bg-cream-2 opacity-50'
            }`}
          >
            <p className="font-display text-4xl">
              {opt === 'true' ? `✓ ${t('quizz.tfTrue')}` : `✗ ${t('quizz.tfFalse')}`}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function FreeTextDisplay({
  revealAnswer,
  revealAlt,
}: {
  revealAnswer: string | null;
  revealAlt?: string;
}): JSX.Element {
  const { t } = useTranslation();
  if (revealAnswer === null) {
    return (
      <p className="font-editorial italic text-ink-soft text-center py-8">
        {t('hostQuizz.freeTextWaiting')}
      </p>
    );
  }
  return (
    <Card tone="basil" size="lg" className="text-center">
      <p className="font-mono text-xs uppercase tracking-wider mb-2">
        {t('hostQuizz.correctAnswerLabel')}
      </p>
      <p className="font-display text-4xl mb-1">{revealAnswer}</p>
      {revealAlt && <p className="font-editorial italic text-xl text-ink-soft">{revealAlt}</p>}
    </Card>
  );
}

function EstimationDisplay({
  min,
  max,
  unit,
  revealAnswer,
}: {
  min?: number;
  max?: number;
  unit?: string;
  revealAnswer: string | null;
}): JSX.Element {
  const { t } = useTranslation();
  let target: number | null = null;
  if (revealAnswer !== null) {
    try {
      target = (JSON.parse(revealAnswer) as { target: number }).target;
    } catch {
      /* ignore */
    }
  }
  return (
    <div className="space-y-3">
      <p className="font-mono text-xs uppercase tracking-wider text-ink-soft text-center">
        {t('hostQuizz.estimationRange')} {min ?? '?'} — {max ?? '?'} {unit ?? ''}
      </p>
      {target !== null && (
        <Card tone="lemon" size="lg" className="text-center">
          <p className="font-mono text-xs uppercase tracking-wider mb-2">
            {t('hostQuizz.exactValueLabel')}
          </p>
          <p className="font-display text-5xl">
            {target} {unit ?? ''}
          </p>
        </Card>
      )}
    </div>
  );
}

// feat/quiz-question-media — embed YouTube IFrame qui joue [start, start+duration].
// `audio` = IFrame caché (0px display:none ne marche pas — YouTube refuse de
// jouer si non-visible). On utilise position absolute hors écran + opacity 0
// pour garder le player monté et audible mais invisible.
// `video` = IFrame visible 16:9 dans une Card.
interface QuizMediaEmbedProps {
  youtubeId: string;
  startSec: number;
  durationSec: number;
  kind: 'audio' | 'video';
  xl?: boolean;
}
function QuizMediaEmbed({
  youtubeId,
  startSec,
  durationSec,
  kind,
  xl,
}: QuizMediaEmbedProps): JSX.Element {
  const endSec = startSec + durationSec;
  // autoplay=1 + mute=0 → l'host doit avoir interagi avec la page (cas en
  // général car il a cliqué pour lancer la question). En cas de policy
  // navigateur stricte, jouera muted mais l'utilisateur cliquera unmute.
  const src =
    `https://www.youtube.com/embed/${encodeURIComponent(youtubeId)}` +
    `?autoplay=1&controls=${kind === 'video' ? 1 : 0}` +
    `&start=${startSec}&end=${endSec}` +
    `&modestbranding=1&rel=0&playsinline=1` +
    `&iv_load_policy=3&disablekb=1`;

  if (kind === 'audio') {
    // Caché visuellement mais monté + actif. Position absolute hors écran.
    return (
      <div
        aria-hidden="true"
        style={{ position: 'absolute', left: '-9999px', top: 0, width: 1, height: 1 }}
      >
        <iframe
          src={src}
          width="1"
          height="1"
          allow="autoplay; encrypted-media"
          title="YouTube audio extract"
        />
      </div>
    );
  }
  return (
    <div className={`mb-4 ${xl ? 'max-w-3xl mx-auto' : ''}`}>
      <div className="relative w-full overflow-hidden rounded-lg border-2 border-ink shadow-pop bg-black aspect-video">
        <iframe
          src={src}
          allow="autoplay; encrypted-media"
          allowFullScreen
          className="absolute inset-0 w-full h-full"
          title="YouTube video extract"
        />
      </div>
    </div>
  );
}
