/**
 * <QuestionFormModal /> — création/édition d'une question (4 types).
 *
 * Affiche un formulaire adapté au QuestionType choisi :
 *   - MCQ        : 2-6 choix lang1 (+ lang2 si bilingue) + index réponse
 *   - TRUE_FALSE : énoncé + bouton vrai/faux pour la réponse attendue
 *   - FREE_TEXT  : énoncé + réponse + alias optionnels
 *   - ESTIMATION : énoncé + target + min/max + unité
 *
 * Si bilingue (set.is_bilingual), 2 colonnes côte à côte (FR + EN).
 */

import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Question, QuestionSet, QuestionType, EstimationAnswer } from '@tutti/shared';
import { Modal, Button, Input } from '../../ui/index.js';
import {
  createQuestion,
  updateQuestion,
  type CreateQuestionInput,
} from '../../../lib/questionSets.js';

interface Props {
  open: boolean;
  set: QuestionSet;
  /** Si fourni : édition. Sinon : création. */
  question?: Question | null;
  onClose: () => void;
  onSaved: (q: Question) => void;
}

interface FormState {
  type: QuestionType;
  category: string;
  text_lang1: string;
  text_lang2: string;
  // MCQ
  choices_lang1: string[];
  choices_lang2: string[];
  mcq_correct_index: number;
  // TRUE_FALSE / FREE_TEXT / ESTIMATION
  answer_lang1: string;
  answer_lang2: string;
  // FREE_TEXT
  aliases_lang1: string;
  aliases_lang2: string;
  // ESTIMATION
  estimation_target: string;
  estimation_min: string;
  estimation_max: string;
  estimation_unit: string;
  // Common
  time_limit_sec: number;
  points: number;
}

const DEFAULT_STATE: FormState = {
  type: 'MCQ',
  category: '',
  text_lang1: '',
  text_lang2: '',
  choices_lang1: ['', '', '', ''],
  choices_lang2: ['', '', '', ''],
  mcq_correct_index: 0,
  answer_lang1: '',
  answer_lang2: '',
  aliases_lang1: '',
  aliases_lang2: '',
  estimation_target: '',
  estimation_min: '',
  estimation_max: '',
  estimation_unit: '',
  time_limit_sec: 30,
  points: 100,
};

export function QuestionFormModal({ open, set, question, onClose, onSaved }: Props): JSX.Element {
  const { t } = useTranslation();
  const [state, setState] = useState<FormState>(DEFAULT_STATE);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Initialise / reset le formulaire à chaque ouverture/changement de question.
  useEffect(() => {
    if (!open) return;
    if (question) {
      // Édition : hydrate depuis la question existante.
      const next: FormState = {
        type: question.type,
        category: question.category ?? '',
        text_lang1: question.text_lang1,
        text_lang2: question.text_lang2 ?? '',
        choices_lang1:
          question.type === 'MCQ' && question.choices_lang1.length > 0
            ? [...question.choices_lang1, '', '', '', ''].slice(0, 6)
            : ['', '', '', ''],
        choices_lang2:
          question.type === 'MCQ' && question.choices_lang2.length > 0
            ? [...question.choices_lang2, '', '', '', ''].slice(0, 6)
            : ['', '', '', ''],
        mcq_correct_index: 0,
        answer_lang1: question.answer_lang1,
        answer_lang2: question.answer_lang2 ?? '',
        aliases_lang1: question.answer_aliases_lang1.join(', '),
        aliases_lang2: question.answer_aliases_lang2.join(', '),
        estimation_target: '',
        estimation_min: '',
        estimation_max: '',
        estimation_unit: '',
        time_limit_sec: question.time_limit_sec,
        points: question.points,
      };
      // MCQ : retrouver l'index de la réponse correcte
      if (question.type === 'MCQ') {
        const idx = question.choices_lang1.findIndex(
          (c) => c.trim().toLowerCase() === question.answer_lang1.trim().toLowerCase(),
        );
        next.mcq_correct_index = idx >= 0 ? idx : 0;
      }
      // ESTIMATION : décoder le JSON
      if (question.type === 'ESTIMATION') {
        try {
          const meta = JSON.parse(question.answer_lang1) as EstimationAnswer;
          next.estimation_target = String(meta.target);
          next.estimation_min = String(meta.min);
          next.estimation_max = String(meta.max);
          next.estimation_unit = meta.unit ?? '';
        } catch {
          /* ignore */
        }
      }
      setState(next);
    } else {
      setState(DEFAULT_STATE);
    }
    setErr(null);
  }, [open, question]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setState((s) => ({ ...s, [key]: value }));
  };

  const setChoice = (lang: 'lang1' | 'lang2', idx: number, value: string): void => {
    setState((s) => {
      const next = [...(lang === 'lang1' ? s.choices_lang1 : s.choices_lang2)];
      next[idx] = value;
      return lang === 'lang1' ? { ...s, choices_lang1: next } : { ...s, choices_lang2: next };
    });
  };

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setErr(null);

    if (!state.text_lang1.trim()) {
      setErr(t('quizz.errorTextRequired'));
      return;
    }
    if (set.is_bilingual && !state.text_lang2.trim()) {
      setErr(t('quizz.errorTextLang2Required'));
      return;
    }

    let payload: CreateQuestionInput;
    try {
      payload = buildPayload(state, set);
    } catch (err: unknown) {
      setErr((err as Error).message);
      return;
    }

    setSubmitting(true);
    try {
      const saved = question
        ? await updateQuestion(set.id, question.id, payload)
        : await createQuestion(set.id, payload);
      onSaved(saved);
      onClose();
    } catch (err: unknown) {
      setErr((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const showLang2 = set.is_bilingual;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={question ? t('quizz.editQuestion') : t('quizz.newQuestion')}
      size="lg"
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        {/* Type + Category + Points + Time limit */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <label className="block">
            <span className="block text-xs font-mono uppercase tracking-wider text-ink/70 mb-1">
              {t('quizz.fieldType')}
            </span>
            <select
              value={state.type}
              onChange={(e) => setField('type', e.target.value as QuestionType)}
              disabled={!!question}
              className="w-full px-2 py-1.5 border-2 border-ink rounded font-medium bg-cream"
            >
              <option value="MCQ">MCQ</option>
              <option value="TRUE_FALSE">TRUE / FALSE</option>
              <option value="FREE_TEXT">FREE TEXT</option>
              <option value="ESTIMATION">ESTIMATION</option>
            </select>
          </label>
          <Input
            label={t('quizz.fieldCategory')}
            value={state.category}
            onChange={(e) => setField('category', e.target.value)}
            placeholder={t('quizz.categoryPlaceholder')}
          />
          <Input
            label={t('quizz.fieldPoints')}
            type="number"
            min={10}
            max={1000}
            step={10}
            value={state.points}
            onChange={(e) => setField('points', Number.parseInt(e.target.value || '100', 10))}
          />
          <Input
            label={t('quizz.fieldTimeLimit')}
            type="number"
            min={5}
            max={120}
            step={5}
            value={state.time_limit_sec}
            onChange={(e) =>
              setField('time_limit_sec', Number.parseInt(e.target.value || '30', 10))
            }
          />
        </div>

        {/* Énoncé bilingue */}
        <div className={showLang2 ? 'grid grid-cols-1 md:grid-cols-2 gap-3' : ''}>
          <label className="block">
            <span className="block text-xs font-mono uppercase tracking-wider text-ink/70 mb-1">
              {t('quizz.fieldText')} ({set.language_1.toUpperCase()})
            </span>
            <textarea
              value={state.text_lang1}
              onChange={(e) => setField('text_lang1', e.target.value)}
              rows={2}
              required
              placeholder={t('quizz.textPlaceholder')}
              className="w-full px-3 py-2 border-2 border-ink rounded font-medium bg-cream resize-none"
            />
          </label>
          {showLang2 && (
            <label className="block">
              <span className="block text-xs font-mono uppercase tracking-wider text-ink/70 mb-1">
                {t('quizz.fieldText')} ({(set.language_2 ?? '').toUpperCase()})
              </span>
              <textarea
                value={state.text_lang2}
                onChange={(e) => setField('text_lang2', e.target.value)}
                rows={2}
                required
                placeholder={t('quizz.textPlaceholder')}
                className="w-full px-3 py-2 border-2 border-ink rounded font-medium bg-cream resize-none"
              />
            </label>
          )}
        </div>

        {/* Champ spécifique au type */}
        {state.type === 'MCQ' && (
          <McqFields
            state={state}
            showLang2={showLang2}
            language1={set.language_1}
            language2={set.language_2}
            setChoice={setChoice}
            setCorrect={(i) => setField('mcq_correct_index', i)}
          />
        )}
        {state.type === 'TRUE_FALSE' && (
          <TrueFalseFields
            value={state.answer_lang1}
            onChange={(v) => {
              setField('answer_lang1', v);
              setField('answer_lang2', v);
            }}
          />
        )}
        {state.type === 'FREE_TEXT' && (
          <FreeTextFields
            state={state}
            showLang2={showLang2}
            language1={set.language_1}
            language2={set.language_2}
            setField={setField}
          />
        )}
        {state.type === 'ESTIMATION' && <EstimationFields state={state} setField={setField} />}

        {err && (
          <p role="alert" className="text-sm text-raspberry">
            {err}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" size="sm" disabled={submitting}>
            {submitting ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Sous-composants par type ─────────────────────────────────────────────

function McqFields({
  state,
  showLang2,
  language1,
  language2,
  setChoice,
  setCorrect,
}: {
  state: FormState;
  showLang2: boolean;
  language1: string;
  language2: string | null;
  setChoice: (lang: 'lang1' | 'lang2', idx: number, value: string) => void;
  setCorrect: (idx: number) => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <p className="text-xs font-mono uppercase tracking-wider text-ink/70">
        {t('quizz.fieldChoices')} — {t('quizz.checkCorrect')}
      </p>
      {state.choices_lang1.map((_, idx) => (
        <div key={idx} className={`flex gap-2 ${showLang2 ? 'md:items-center' : ''}`}>
          <button
            type="button"
            onClick={() => setCorrect(idx)}
            aria-pressed={state.mcq_correct_index === idx}
            className={`shrink-0 w-8 h-8 rounded-full border-2 border-ink font-bold transition-colors ${
              state.mcq_correct_index === idx ? 'bg-basil text-ink' : 'bg-cream'
            }`}
          >
            {state.mcq_correct_index === idx ? '✓' : String.fromCharCode(65 + idx)}
          </button>
          <div className={`flex-1 ${showLang2 ? 'grid grid-cols-1 md:grid-cols-2 gap-2' : ''}`}>
            <input
              type="text"
              value={state.choices_lang1[idx] ?? ''}
              onChange={(e) => setChoice('lang1', idx, e.target.value)}
              placeholder={`${t('quizz.choicePlaceholder')} ${idx + 1} (${language1.toUpperCase()})`}
              className="w-full px-3 py-1.5 border-2 border-ink rounded font-medium bg-cream"
            />
            {showLang2 && (
              <input
                type="text"
                value={state.choices_lang2[idx] ?? ''}
                onChange={(e) => setChoice('lang2', idx, e.target.value)}
                placeholder={`${t('quizz.choicePlaceholder')} ${idx + 1} (${(language2 ?? '').toUpperCase()})`}
                className="w-full px-3 py-1.5 border-2 border-ink rounded font-medium bg-cream"
              />
            )}
          </div>
        </div>
      ))}
      <p className="text-[11px] font-mono text-ink-soft pt-1">{t('quizz.mcqHint')}</p>
    </div>
  );
}

function TrueFalseFields({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div>
      <span className="block text-xs font-mono uppercase tracking-wider text-ink/70 mb-1">
        {t('quizz.fieldCorrectAnswer')}
      </span>
      <div className="flex gap-2">
        {(['true', 'false'] as const).map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            aria-pressed={value === opt}
            className={`flex-1 px-3 py-2 border-2 border-ink rounded font-bold transition-colors ${
              value === opt
                ? opt === 'true'
                  ? 'bg-basil text-ink'
                  : 'bg-raspberry text-cream'
                : 'bg-cream text-ink hover:bg-cream-2'
            }`}
          >
            {opt === 'true' ? `✓ ${t('quizz.tfTrue')}` : `✗ ${t('quizz.tfFalse')}`}
          </button>
        ))}
      </div>
    </div>
  );
}

function FreeTextFields({
  state,
  showLang2,
  language1,
  language2,
  setField,
}: {
  state: FormState;
  showLang2: boolean;
  language1: string;
  language2: string | null;
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div className={showLang2 ? 'grid grid-cols-1 md:grid-cols-2 gap-3' : ''}>
        <Input
          label={`${t('quizz.fieldCorrectAnswer')} (${language1.toUpperCase()})`}
          value={state.answer_lang1}
          onChange={(e) => setField('answer_lang1', e.target.value)}
          placeholder={t('quizz.answerPlaceholder')}
          required
        />
        {showLang2 && (
          <Input
            label={`${t('quizz.fieldCorrectAnswer')} (${(language2 ?? '').toUpperCase()})`}
            value={state.answer_lang2}
            onChange={(e) => setField('answer_lang2', e.target.value)}
            placeholder={t('quizz.answerPlaceholder')}
            required
          />
        )}
      </div>
      <div className={showLang2 ? 'grid grid-cols-1 md:grid-cols-2 gap-3' : ''}>
        <Input
          label={`${t('quizz.fieldAliases')} (${language1.toUpperCase()})`}
          value={state.aliases_lang1}
          onChange={(e) => setField('aliases_lang1', e.target.value)}
          placeholder={t('quizz.aliasesPlaceholder')}
        />
        {showLang2 && (
          <Input
            label={`${t('quizz.fieldAliases')} (${(language2 ?? '').toUpperCase()})`}
            value={state.aliases_lang2}
            onChange={(e) => setField('aliases_lang2', e.target.value)}
            placeholder={t('quizz.aliasesPlaceholder')}
          />
        )}
      </div>
      <p className="text-[11px] font-mono text-ink-soft">{t('quizz.aliasesHint')}</p>
    </div>
  );
}

function EstimationFields({
  state,
  setField,
}: {
  state: FormState;
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Input
        label={t('quizz.fieldEstimationTarget')}
        type="number"
        value={state.estimation_target}
        onChange={(e) => setField('estimation_target', e.target.value)}
        placeholder="42"
        required
      />
      <Input
        label={t('quizz.fieldEstimationMin')}
        type="number"
        value={state.estimation_min}
        onChange={(e) => setField('estimation_min', e.target.value)}
        placeholder="0"
        required
      />
      <Input
        label={t('quizz.fieldEstimationMax')}
        type="number"
        value={state.estimation_max}
        onChange={(e) => setField('estimation_max', e.target.value)}
        placeholder="100"
        required
      />
      <Input
        label={t('quizz.fieldEstimationUnit')}
        value={state.estimation_unit}
        onChange={(e) => setField('estimation_unit', e.target.value)}
        placeholder={t('quizz.unitPlaceholder')}
      />
    </div>
  );
}

// ── Construction du payload API ──────────────────────────────────────────

function buildPayload(s: FormState, set: QuestionSet): CreateQuestionInput {
  const base: CreateQuestionInput = {
    type: s.type,
    category: s.category.trim() || null,
    text_lang1: s.text_lang1.trim(),
    text_lang2: set.is_bilingual ? s.text_lang2.trim() : null,
    answer_lang1: '',
    answer_lang2: null,
    time_limit_sec: s.time_limit_sec,
    points: s.points,
  };

  if (s.type === 'MCQ') {
    const choices1 = s.choices_lang1.map((c) => c.trim()).filter(Boolean);
    const choices2 = set.is_bilingual ? s.choices_lang2.map((c) => c.trim()).filter(Boolean) : [];
    if (choices1.length < 2) throw new Error('MCQ : au moins 2 choix requis.');
    if (set.is_bilingual && choices2.length !== choices1.length) {
      throw new Error('MCQ : nombre de choix différent entre les 2 langues.');
    }
    if (s.mcq_correct_index < 0 || s.mcq_correct_index >= choices1.length) {
      throw new Error('MCQ : index de la bonne réponse invalide.');
    }
    base.choices_lang1 = choices1;
    base.choices_lang2 = choices2;
    base.answer_lang1 = choices1[s.mcq_correct_index]!;
    base.answer_lang2 = set.is_bilingual ? (choices2[s.mcq_correct_index] ?? null) : null;
    return base;
  }

  if (s.type === 'TRUE_FALSE') {
    if (s.answer_lang1 !== 'true' && s.answer_lang1 !== 'false') {
      throw new Error('TRUE_FALSE : sélectionne vrai ou faux.');
    }
    base.answer_lang1 = s.answer_lang1;
    base.answer_lang2 = set.is_bilingual ? s.answer_lang1 : null;
    return base;
  }

  if (s.type === 'FREE_TEXT') {
    if (!s.answer_lang1.trim()) throw new Error('FREE_TEXT : réponse requise.');
    if (set.is_bilingual && !s.answer_lang2.trim()) {
      throw new Error('FREE_TEXT : réponse en langue 2 requise.');
    }
    base.answer_lang1 = s.answer_lang1.trim();
    base.answer_lang2 = set.is_bilingual ? s.answer_lang2.trim() : null;
    base.answer_aliases_lang1 = parseAliases(s.aliases_lang1);
    base.answer_aliases_lang2 = set.is_bilingual ? parseAliases(s.aliases_lang2) : [];
    return base;
  }

  // ESTIMATION
  const target = Number.parseFloat(s.estimation_target);
  const min = Number.parseFloat(s.estimation_min);
  const max = Number.parseFloat(s.estimation_max);
  if (Number.isNaN(target) || Number.isNaN(min) || Number.isNaN(max)) {
    throw new Error('ESTIMATION : valeurs numériques invalides.');
  }
  if (min >= max) throw new Error('ESTIMATION : min doit être < max.');
  if (target <= min || target >= max) {
    throw new Error('ESTIMATION : la cible doit être strictement entre min et max.');
  }
  const meta: EstimationAnswer = {
    target,
    min,
    max,
    unit: s.estimation_unit.trim() || undefined,
  };
  base.answer_lang1 = JSON.stringify(meta);
  base.answer_lang2 = set.is_bilingual ? JSON.stringify(meta) : null;
  return base;
}

function parseAliases(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
