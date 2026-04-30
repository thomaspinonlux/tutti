/**
 * /admin/quizz/:id — édition d'un pack de questions (2 colonnes).
 *
 * Layout :
 *   - Sidebar gauche : nom + langue + bilingue + bouton publier + supprimer
 *                      + sidebar autres packs
 *   - Centre : liste des questions (drag&drop) + bouton "Nouvelle question"
 *
 * Auto-save : nom/langue/publish auto, questions via modale dédiée.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Question, QuestionSet, QuestionSetWithQuestions } from '@tutti/shared';
import {
  listQuestionSets,
  getQuestionSet,
  updateQuestionSet,
  deleteQuestionSet,
  deleteQuestion,
  reorderQuestions,
} from '../../lib/questionSets.js';
import { Button, Card, Badge, TitleHandwritten, Underline } from '../../components/ui/index.js';
import { SortableQuestionList } from '../../components/admin/quizz/SortableQuestionList.js';
import { QuestionFormModal } from '../../components/admin/quizz/QuestionFormModal.js';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function QuizzPackEditPage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [pack, setPack] = useState<QuestionSetWithQuestions | null>(null);
  const [allPacks, setAllPacks] = useState<QuestionSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);

  // Bootstrap
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([getQuestionSet(id), listQuestionSets()])
      .then(([p, list]) => {
        setPack(p);
        setAllPacks(list);
        setName(p.name);
        setDescription(p.description ?? '');
        setCoverUrl(p.cover_url ?? '');
        setError(null);
      })
      .catch((err: unknown) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [id]);

  const flash = (): void => {
    setSaveState('saved');
    window.setTimeout(() => setSaveState('idle'), 1500);
  };

  const handleNameBlur = async (): Promise<void> => {
    if (!pack || name.trim() === pack.name) return;
    setSaveState('saving');
    try {
      const updated = await updateQuestionSet(pack.id, { name: name.trim() });
      setPack((p) => (p ? { ...p, ...updated } : p));
      setAllPacks((list) => list.map((x) => (x.id === pack.id ? { ...x, ...updated } : x)));
      flash();
    } catch {
      setSaveState('error');
    }
  };

  const handleDescriptionBlur = async (): Promise<void> => {
    if (!pack) return;
    const trimmed = description.trim();
    if (trimmed === (pack.description ?? '')) return;
    setSaveState('saving');
    try {
      const updated = await updateQuestionSet(pack.id, {
        description: trimmed.length > 0 ? trimmed : null,
      });
      setPack((p) => (p ? { ...p, ...updated } : p));
      flash();
    } catch {
      setSaveState('error');
    }
  };

  const handleCoverUrlBlur = async (): Promise<void> => {
    if (!pack) return;
    const trimmed = coverUrl.trim();
    if (trimmed === (pack.cover_url ?? '')) return;
    setSaveState('saving');
    try {
      const updated = await updateQuestionSet(pack.id, {
        cover_url: trimmed.length > 0 ? trimmed : null,
      });
      setPack((p) => (p ? { ...p, ...updated } : p));
      flash();
    } catch {
      setSaveState('error');
    }
  };

  const handleTogglePublish = async (): Promise<void> => {
    if (!pack) return;
    setSaveState('saving');
    try {
      const updated = await updateQuestionSet(pack.id, { is_published: !pack.is_published });
      setPack((p) => (p ? { ...p, ...updated } : p));
      flash();
    } catch {
      setSaveState('error');
    }
  };

  const handleToggleBilingual = async (): Promise<void> => {
    if (!pack) return;
    setSaveState('saving');
    try {
      const next = !pack.is_bilingual;
      const updated = await updateQuestionSet(pack.id, {
        is_bilingual: next,
        language_2: next ? (pack.language_1 === 'fr' ? 'en' : 'fr') : null,
      });
      setPack((p) => (p ? { ...p, ...updated } : p));
      flash();
    } catch {
      setSaveState('error');
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!pack) return;
    if (!window.confirm(t('quizz.deleteConfirm'))) return;
    await deleteQuestionSet(pack.id);
    navigate('/admin/quizz', { replace: true });
  };

  const handleReorder = async (next: Question[]): Promise<void> => {
    if (!pack) return;
    setPack((p) => (p ? { ...p, questions: next.map((q, i) => ({ ...q, position: i })) } : p));
    setSaveState('saving');
    try {
      await reorderQuestions(
        pack.id,
        next.map((q) => q.id),
      );
      flash();
    } catch {
      setSaveState('error');
    }
  };

  const handleDeleteQuestion = async (q: Question): Promise<void> => {
    if (!pack) return;
    if (!window.confirm(t('quizz.deleteQuestionConfirm'))) return;
    setPack((p) => (p ? { ...p, questions: p.questions.filter((x) => x.id !== q.id) } : p));
    setSaveState('saving');
    try {
      await deleteQuestion(pack.id, q.id);
      flash();
    } catch {
      setSaveState('error');
    }
  };

  const handleQuestionSaved = (saved: Question): void => {
    if (!pack) return;
    setPack((p) => {
      if (!p) return p;
      const exists = p.questions.some((q) => q.id === saved.id);
      const questions = exists
        ? p.questions.map((q) => (q.id === saved.id ? saved : q))
        : [...p.questions, saved];
      return { ...p, questions };
    });
    setEditingQuestion(null);
    flash();
  };

  const sortedQuestions = useMemo(
    () => (pack ? [...pack.questions].sort((a, b) => a.position - b.position) : []),
    [pack],
  );

  if (loading) {
    return <p className="font-mono text-ink-soft">{t('common.loading')}</p>;
  }
  if (error || !pack) {
    return (
      <div className="max-w-md">
        <p role="alert" className="text-raspberry mb-4">
          {error ?? t('common.error')}
        </p>
        <Link to="/admin/quizz">
          <Button variant="secondary" size="sm">
            ← {t('quizz.backToList')}
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6 max-w-[1200px] mx-auto">
      {/* ─── Colonne gauche : meta + sidebar packs ──────────────────────── */}
      <aside className="space-y-4">
        <Link to="/admin/quizz" className="font-mono text-xs text-ink-soft hover:text-ink">
          ← {t('quizz.backToList')}
        </Link>

        <Card size="sm">
          <label className="block">
            <span className="block text-xs font-mono uppercase tracking-wider text-ink/70 mb-1">
              {t('quizz.fieldName')}
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void handleNameBlur()}
              className="w-full px-2 py-1.5 border-2 border-ink rounded font-bold bg-cream"
            />
          </label>

          <label className="block mt-3">
            <span className="block text-xs font-mono uppercase tracking-wider text-ink/70 mb-1">
              {t('quizz.fieldDescription')}
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => void handleDescriptionBlur()}
              rows={2}
              maxLength={300}
              placeholder={t('quizz.descriptionPlaceholder')}
              className="w-full px-2 py-1.5 border-2 border-ink rounded text-sm bg-cream resize-none"
            />
          </label>

          <label className="block mt-3">
            <span className="block text-xs font-mono uppercase tracking-wider text-ink/70 mb-1">
              {t('quizz.fieldCover')}
            </span>
            <input
              type="url"
              value={coverUrl}
              onChange={(e) => setCoverUrl(e.target.value)}
              onBlur={() => void handleCoverUrlBlur()}
              placeholder="https://…"
              className="w-full px-2 py-1.5 border-2 border-ink rounded text-xs font-mono bg-cream"
            />
            {coverUrl && (
              <img
                src={coverUrl}
                alt=""
                className="mt-2 w-full h-24 object-cover border-2 border-ink rounded"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            )}
          </label>

          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <Badge tone={pack.is_bilingual ? 'plum' : 'basil'} tilt={-1}>
              {pack.is_bilingual
                ? `${pack.language_1.toUpperCase()} · ${(pack.language_2 ?? '').toUpperCase()}`
                : pack.language_1.toUpperCase()}
            </Badge>
            {pack.is_published && (
              <Badge tone="ink" tilt={1}>
                {t('playlists.published')}
              </Badge>
            )}
          </div>

          <label className="mt-3 flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={pack.is_bilingual}
              onChange={() => void handleToggleBilingual()}
              className="w-4 h-4 accent-ink"
            />
            <span>{t('quizz.bilingualToggle')}</span>
          </label>

          <div className="mt-3 flex flex-col gap-2">
            <Button
              variant={pack.is_published ? 'ghost' : 'primary'}
              size="sm"
              onClick={() => void handleTogglePublish()}
            >
              {pack.is_published ? t('quizz.unpublish') : t('quizz.publish')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void handleDelete()}>
              {t('common.delete')}
            </Button>
          </div>

          <p className="mt-3 font-mono text-[10px] text-ink-soft">
            {saveState === 'saving' && t('common.saving')}
            {saveState === 'saved' && `✓ ${t('common.saved')}`}
            {saveState === 'error' && `✗ ${t('common.error')}`}
            {saveState === 'idle' && ' '}
          </p>
        </Card>

        {allPacks.length > 1 && (
          <div className="space-y-1">
            <p className="px-1 text-xs font-mono uppercase tracking-wider text-ink-soft">
              {t('quizz.otherPacks')}
            </p>
            {allPacks
              .filter((p) => p.id !== pack.id)
              .slice(0, 8)
              .map((p) => (
                <Link
                  key={p.id}
                  to={`/admin/quizz/${p.id}`}
                  className="block px-3 py-1.5 border-2 border-ink rounded text-sm font-medium hover:bg-cream-2 transition-colors truncate"
                >
                  {p.name}
                </Link>
              ))}
          </div>
        )}
      </aside>

      {/* ─── Colonne centrale : liste des questions ─────────────────────── */}
      <section>
        <header className="flex items-center justify-between mb-4">
          <TitleHandwritten as="h2">
            <Underline>
              {t('quizz.questionsTitle')} ({pack.questions.length})
            </Underline>
          </TitleHandwritten>
          <Button
            onClick={() => {
              setEditingQuestion(null);
              setModalOpen(true);
            }}
          >
            + {t('quizz.newQuestion')}
          </Button>
        </header>

        <SortableQuestionList
          questions={sortedQuestions}
          onSelect={(q) => {
            setEditingQuestion(q);
            setModalOpen(true);
          }}
          onReorder={(next) => void handleReorder(next)}
          onDelete={(q) => void handleDeleteQuestion(q)}
        />
      </section>

      <QuestionFormModal
        open={modalOpen}
        set={pack}
        question={editingQuestion}
        onClose={() => {
          setModalOpen(false);
          setEditingQuestion(null);
        }}
        onSaved={handleQuestionSaved}
      />
    </div>
  );
}
