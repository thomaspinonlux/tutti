/**
 * /admin/library/quiz-packs/:id — détail pack quiz officiel.
 *
 * Affiche : header éditable (name_fr/en, description_fr/en, visibility) +
 * liste des questions (read-only V1, 1 ligne par question avec aperçu).
 *
 * Édition individuelle des questions = future PR (out of scope).
 */

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  Card,
  Input,
  TitleHandwritten,
  Underline,
} from '../../components/ui/index.js';
import {
  getOfficialQuizPack,
  patchOfficialQuizPack,
  patchOfficialQuizQuestion,
  type OfficialQuizPackDetail,
  type OfficialQuizQuestion,
  type QuizQuestionMediaType,
  type Visibility,
} from '../../lib/adminLibrary.js';

// feat/quiz-question-media — parse "https://youtu.be/XXX", "https://youtube.com/
// watch?v=XXX", "https://youtube.com/shorts/XXX", ou ID brut 11 chars.
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;
function extractYoutubeId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (YT_ID_RE.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.hostname.includes('youtu.be')) {
      const id = url.pathname.replace(/^\//, '');
      return YT_ID_RE.test(id) ? id : null;
    }
    if (url.hostname.includes('youtube.com')) {
      const v = url.searchParams.get('v');
      if (v && YT_ID_RE.test(v)) return v;
      const m = url.pathname.match(/\/shorts\/([A-Za-z0-9_-]{11})/);
      if (m) return m[1] ?? null;
    }
  } catch {
    /* not a URL */
  }
  return null;
}

export function LibraryQuizPackDetailPage(): JSX.Element {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [pack, setPack] = useState<OfficialQuizPackDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingField, setSavingField] = useState<string | null>(null);
  // feat/quiz-question-media — question expanded (form editor visible) si id ici.
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(null);

  const handleQuestionMediaSave = async (
    questionId: string,
    changes: Parameters<typeof patchOfficialQuizQuestion>[2],
  ): Promise<void> => {
    if (!id || !pack) return;
    try {
      const updated = await patchOfficialQuizQuestion(id, questionId, changes);
      setPack((prev) =>
        prev
          ? {
              ...prev,
              questions: prev.questions.map((q) => (q.id === questionId ? updated : q)),
            }
          : prev,
      );
    } catch (err) {
      setError((err as Error).message);
      throw err; // bubble up to editor for visual feedback
    }
  };

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void getOfficialQuizPack(id)
      .then((p) => {
        if (!cancelled) setPack(p);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleFieldSave = async (
    field: 'name_fr' | 'name_en' | 'description_fr' | 'description_en',
    value: string | null,
  ): Promise<void> => {
    if (!id || !pack) return;
    setSavingField(field);
    try {
      const updated = await patchOfficialQuizPack(id, { [field]: value });
      setPack((prev) => (prev ? { ...prev, ...updated, questions: prev.questions } : prev));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingField(null);
    }
  };

  const handleVisibility = async (visibility: Visibility): Promise<void> => {
    if (!id || !pack) return;
    setSavingField('visibility');
    try {
      const updated = await patchOfficialQuizPack(id, { visibility });
      setPack((prev) => (prev ? { ...prev, ...updated, questions: prev.questions } : prev));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingField(null);
    }
  };

  if (error) {
    return (
      <div className="max-w-4xl mx-auto">
        <Card tone="cream" className="border-raspberry">
          <p role="alert" className="text-raspberry font-medium">
            {error}
          </p>
          <Link
            to="/admin/library"
            className="mt-3 inline-block font-mono text-sm text-ink-soft hover:underline"
          >
            ← {t('library.backToList')}
          </Link>
        </Card>
      </div>
    );
  }
  if (!pack) {
    return <p className="font-mono text-ink-soft animate-fade-in">{t('common.loading')}</p>;
  }

  return (
    <div className="max-w-5xl mx-auto">
      <header className="mb-6">
        <Link
          to="/admin/library"
          className="font-mono text-sm text-ink-soft hover:underline mb-2 inline-block"
        >
          ← {t('library.backToList')}
        </Link>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-2">
          {t('library.detailEyebrow')} · Quizz
        </p>
        <TitleHandwritten as="h1">
          <Underline>{pack.name_fr}</Underline>
        </TitleHandwritten>
        <p className="font-mono text-xs text-ink-soft mt-1">
          {pack.slug} · {pack.category ?? '—'} · {pack.locale_primary}
        </p>
      </header>

      <Card size="md" className="mb-6">
        <p className="text-xs font-mono uppercase tracking-wider text-ink-soft mb-3">
          {t('library.editableFields')}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <EditableField
            label={t('library.fieldNameFr')}
            value={pack.name_fr}
            saving={savingField === 'name_fr'}
            onSave={(v) => handleFieldSave('name_fr', v)}
          />
          <EditableField
            label={t('library.fieldNameEn')}
            value={pack.name_en}
            saving={savingField === 'name_en'}
            onSave={(v) => handleFieldSave('name_en', v)}
          />
          <EditableField
            label={t('library.fieldDescriptionFr')}
            value={pack.description_fr ?? ''}
            saving={savingField === 'description_fr'}
            onSave={(v) => handleFieldSave('description_fr', v)}
            multiline
          />
          <EditableField
            label={t('library.fieldDescriptionEn')}
            value={pack.description_en ?? ''}
            saving={savingField === 'description_en'}
            onSave={(v) => handleFieldSave('description_en', v)}
            multiline
          />
        </div>
        <div className="mt-4">
          <label className="block text-xs font-mono uppercase tracking-wider text-ink-soft mb-1">
            {t('library.visibilityToggle')}
          </label>
          <select
            value={pack.visibility}
            onChange={(e) => void handleVisibility(e.target.value as Visibility)}
            disabled={savingField === 'visibility'}
            className="border-2 border-ink rounded px-3 py-2 bg-cream font-medium"
          >
            <option value="public">{t('library.visibilityPublic')}</option>
            <option value="premium_only">{t('library.visibilityPremium')}</option>
            <option value="private">{t('library.visibilityPrivate')}</option>
          </select>
        </div>
      </Card>

      <Card size="md">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-mono uppercase tracking-wider text-ink-soft">
            {t('library.quizQuestionsTitle')} ({pack.questions.length})
          </p>
        </div>
        <ol className="space-y-2">
          {pack.questions.map((q) => {
            const correctAnswerLabel =
              q.type === 'MCQ' && q.correct_answer_index !== null
                ? (q.choices_fr[q.correct_answer_index] ?? '—')
                : q.type === 'TRUE_FALSE'
                  ? q.correct_answer_bool === true
                    ? 'Vrai'
                    : 'Faux'
                  : (q.correct_answer_fr ?? '—');
            const isExpanded = expandedQuestionId === q.id;
            const hasMedia = q.media_type === 'AUDIO' || q.media_type === 'VIDEO';
            return (
              <li
                key={q.id}
                className="border-2 border-ink/20 rounded-lg px-3 py-2 hover:bg-cream-2 text-sm"
              >
                <div className="flex items-start gap-3">
                  <span className="font-mono text-xs text-ink-soft w-8 shrink-0">
                    #{q.position}
                  </span>
                  <Badge
                    tone={q.type === 'MCQ' ? 'spritz' : q.type === 'TRUE_FALSE' ? 'basil' : 'plum'}
                  >
                    {q.type}
                  </Badge>
                  {hasMedia && (
                    <span
                      className="text-xs font-mono px-2 py-0.5 border border-spritz rounded bg-spritz/10 text-spritz-deep"
                      title={`${q.media_type} · ${q.media_youtube_id} · ${q.media_start_sec ?? 0}s+${q.media_duration_sec ?? 0}s`}
                    >
                      {q.media_type === 'AUDIO' ? '🎵 audio' : '🎬 video'}
                    </span>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{q.question_fr}</p>
                    <p className="font-editorial italic text-xs text-ink-soft truncate">
                      → {correctAnswerLabel}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpandedQuestionId(isExpanded ? null : q.id)}
                    className="font-mono text-xs text-spritz-deep hover:underline shrink-0"
                  >
                    {isExpanded ? '✕ fermer' : hasMedia ? '✏︎ média' : '+ média'}
                  </button>
                </div>
                {isExpanded && (
                  <QuestionMediaEditor
                    question={q}
                    onSave={(changes) => handleQuestionMediaSave(q.id, changes)}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}

interface EditableFieldProps {
  label: string;
  value: string;
  saving: boolean;
  multiline?: boolean;
  onSave: (value: string) => Promise<void>;
}
function EditableField({
  label,
  value,
  saving,
  multiline,
  onSave,
}: EditableFieldProps): JSX.Element {
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    setDraft(value);
    setDirty(false);
  }, [value]);
  const handleBlur = (): void => {
    if (!dirty) return;
    void onSave(draft);
  };
  return (
    <div>
      <label className="block text-xs font-mono uppercase tracking-wider text-ink-soft mb-1">
        {label}
      </label>
      {multiline ? (
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setDirty(true);
          }}
          onBlur={handleBlur}
          rows={3}
          disabled={saving}
          className="w-full border-2 border-ink rounded px-2 py-1 bg-cream font-mono text-sm"
        />
      ) : (
        <Input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setDirty(true);
          }}
          onBlur={handleBlur}
          disabled={saving}
        />
      )}
      {saving && <p className="font-mono text-[10px] text-ink-soft mt-1">⏳</p>}
    </div>
  );
}

// feat/quiz-question-media — éditeur compact pour les champs média structurés
// d'une question. Affiché en disclosure sous la question quand expanded.
interface QuestionMediaEditorProps {
  question: OfficialQuizQuestion;
  onSave: (changes: {
    media_type: QuizQuestionMediaType;
    media_youtube_id: string | null;
    media_start_sec: number | null;
    media_duration_sec: number | null;
  }) => Promise<void>;
}
function QuestionMediaEditor({ question, onSave }: QuestionMediaEditorProps): JSX.Element {
  const [mediaType, setMediaType] = useState<QuizQuestionMediaType>(question.media_type);
  const [ytInput, setYtInput] = useState(question.media_youtube_id ?? '');
  const [startSec, setStartSec] = useState<string>(
    question.media_start_sec != null ? String(question.media_start_sec) : '',
  );
  const [durationSec, setDurationSec] = useState<string>(
    question.media_duration_sec != null ? String(question.media_duration_sec) : '10',
  );
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (): Promise<void> => {
    setLocalError(null);
    if (mediaType === 'NONE' || mediaType === 'IMAGE') {
      setSaving(true);
      try {
        await onSave({
          media_type: mediaType,
          media_youtube_id: null,
          media_start_sec: null,
          media_duration_sec: null,
        });
      } catch {
        // already handled upstream
      } finally {
        setSaving(false);
      }
      return;
    }
    const ytId = extractYoutubeId(ytInput);
    if (!ytId) {
      setLocalError('youtube_id invalide (11 chars ou URL YouTube)');
      return;
    }
    const start = Math.max(0, Math.floor(Number(startSec) || 0));
    const duration = Math.min(30, Math.max(1, Math.floor(Number(durationSec) || 10)));
    setSaving(true);
    try {
      await onSave({
        media_type: mediaType,
        media_youtube_id: ytId,
        media_start_sec: start,
        media_duration_sec: duration,
      });
    } catch {
      // error already surfaced upstream
    } finally {
      setSaving(false);
    }
  };

  const showYtFields = mediaType === 'AUDIO' || mediaType === 'VIDEO';

  return (
    <div className="mt-3 pl-12 border-t border-ink/10 pt-3 space-y-3">
      <p className="text-xs font-mono uppercase tracking-wider text-ink-soft">
        Média associé à la question (optionnel)
      </p>
      <div className="flex gap-3 flex-wrap">
        {(['NONE', 'AUDIO', 'VIDEO'] as QuizQuestionMediaType[]).map((opt) => (
          <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              name={`media_type_${question.id}`}
              value={opt}
              checked={mediaType === opt}
              onChange={() => setMediaType(opt)}
            />
            <span className="font-mono text-xs">
              {opt === 'NONE'
                ? 'Aucun'
                : opt === 'AUDIO'
                  ? '🎵 Audio (YouTube)'
                  : '🎬 Video (YouTube)'}
            </span>
          </label>
        ))}
      </div>
      {showYtFields && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-3">
            <label className="block text-xs font-mono uppercase tracking-wider text-ink-soft mb-1">
              YouTube URL ou ID
            </label>
            <Input
              value={ytInput}
              onChange={(e) => setYtInput(e.target.value)}
              placeholder="dQw4w9WgXcQ ou https://youtu.be/dQw4w9WgXcQ"
              disabled={saving}
            />
          </div>
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-ink-soft mb-1">
              Start at (s)
            </label>
            <Input
              type="number"
              min={0}
              value={startSec}
              onChange={(e) => setStartSec(e.target.value)}
              placeholder="30"
              disabled={saving}
            />
          </div>
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-ink-soft mb-1">
              Duration (s, max 30)
            </label>
            <Input
              type="number"
              min={1}
              max={30}
              value={durationSec}
              onChange={(e) => setDurationSec(e.target.value)}
              placeholder="10"
              disabled={saving}
            />
          </div>
        </div>
      )}
      {localError && (
        <p role="alert" className="text-xs font-mono text-raspberry">
          {localError}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={() => void handleSubmit()} disabled={saving}>
          {saving ? '⏳ Enregistrement…' : '✓ Enregistrer le média'}
        </Button>
      </div>
    </div>
  );
}
