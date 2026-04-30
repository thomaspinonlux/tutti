/**
 * /admin/quizz — liste des packs de questions Tutti Quizz (étape 15).
 * Bouton "Nouveau pack" ouvre une modale de création.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { QuestionSet } from '@tutti/shared';
import { listQuestionSets, createQuestionSet } from '../../lib/questionSets.js';
import {
  Button,
  Card,
  Input,
  Modal,
  Badge,
  TitleHandwritten,
  Underline,
} from '../../components/ui/index.js';

export function QuizzPage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [sets, setSets] = useState<QuestionSet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    listQuestionSets()
      .then(setSets)
      .catch((err: unknown) => setError((err as Error).message));
  }, []);

  return (
    <div className="max-w-5xl mx-auto">
      <header className="flex items-center justify-between mb-8">
        <TitleHandwritten as="h1">
          <Underline>{t('quizz.title')}</Underline>
        </TitleHandwritten>
        <Button onClick={() => setModalOpen(true)}>{t('quizz.newPack')}</Button>
      </header>

      {error && (
        <p role="alert" className="text-raspberry mb-4">
          {t('common.error')} : {error}
        </p>
      )}

      {sets === null && <p className="font-mono text-ink-soft">{t('common.loading')}</p>}

      {sets !== null && sets.length === 0 && (
        <Card tone="cream" size="lg">
          <p className="font-editorial italic text-ink-2 mb-4">{t('quizz.emptyState')}</p>
          <Button onClick={() => setModalOpen(true)}>{t('quizz.newPack')}</Button>
        </Card>
      )}

      {sets && sets.length > 0 && (
        <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sets.map((s, idx) => (
            <li key={s.id}>
              <Link to={`/admin/quizz/${s.id}`} className="block group">
                <Card
                  tone={s.is_published ? 'spritz' : 'default'}
                  size="sm"
                  className="h-full transition-transform group-hover:-translate-y-0.5 group-hover:shadow-pop-lg"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <Badge tone={s.is_bilingual ? 'plum' : 'basil'} tilt={idx % 2 === 0 ? -1 : 1}>
                      {s.is_bilingual
                        ? `${s.language_1.toUpperCase()} · ${(s.language_2 ?? '').toUpperCase()}`
                        : s.language_1.toUpperCase()}
                    </Badge>
                    {s.is_published && (
                      <Badge tone="ink" tilt={-2}>
                        {t('playlists.published')}
                      </Badge>
                    )}
                  </div>
                  <p className="font-display text-xl mb-1 truncate">{s.name}</p>
                  <p className="font-mono text-xs text-ink-soft">
                    {s.questions_count ?? 0} {t('quizz.questionsCount')}
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <NewPackModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(s) => navigate(`/admin/quizz/${s.id}`)}
      />
    </div>
  );
}

function NewPackModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (s: QuestionSet) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [language1, setLanguage1] = useState<'fr' | 'en'>('fr');
  const [bilingual, setBilingual] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const language2: 'fr' | 'en' = language1 === 'fr' ? 'en' : 'fr';

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setErr(null);
    try {
      const set = await createQuestionSet({
        name: name.trim(),
        language_1: language1,
        is_bilingual: bilingual,
        language_2: bilingual ? language2 : undefined,
      });
      onCreated(set);
      setName('');
      onClose();
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('quizz.newPack')}>
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <Input
          label={t('quizz.fieldName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('quizz.namePlaceholder')}
          required
          minLength={1}
          maxLength={120}
          autoFocus
        />
        <div>
          <span className="block text-xs font-mono uppercase tracking-wider text-ink/70 mb-1">
            {t('quizz.fieldLanguage1')}
          </span>
          <div className="flex gap-2">
            {(['fr', 'en'] as const).map((lng) => (
              <button
                key={lng}
                type="button"
                onClick={() => setLanguage1(lng)}
                aria-pressed={language1 === lng}
                className={`flex-1 px-3 py-1.5 border-2 border-ink rounded font-medium transition-colors ${
                  language1 === lng ? 'bg-ink text-cream' : 'bg-cream text-ink hover:bg-cream-2'
                }`}
              >
                {lng.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={bilingual}
            onChange={(e) => setBilingual(e.target.checked)}
            className="w-4 h-4 accent-ink"
          />
          <span className="text-sm">
            {t('quizz.bilingualToggle')}{' '}
            {bilingual && (
              <span className="font-mono text-xs text-ink-soft">
                ({language1.toUpperCase()} + {language2.toUpperCase()})
              </span>
            )}
          </span>
        </label>
        {err && (
          <p role="alert" className="text-sm text-raspberry">
            {err}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" size="sm" disabled={submitting || !name.trim()}>
            {submitting ? t('common.saving') : t('quizz.create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
