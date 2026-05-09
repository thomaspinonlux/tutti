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
import { Badge, Card, Input, TitleHandwritten, Underline } from '../../components/ui/index.js';
import {
  getOfficialQuizPack,
  patchOfficialQuizPack,
  type OfficialQuizPackDetail,
  type Visibility,
} from '../../lib/adminLibrary.js';

export function LibraryQuizPackDetailPage(): JSX.Element {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [pack, setPack] = useState<OfficialQuizPackDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingField, setSavingField] = useState<string | null>(null);

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
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{q.question_fr}</p>
                    <p className="font-editorial italic text-xs text-ink-soft truncate">
                      → {correctAnswerLabel}
                    </p>
                  </div>
                </div>
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
