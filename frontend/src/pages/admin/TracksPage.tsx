/**
 * /admin/tracks — liste des playlists Tutti Tracks (étape 8).
 * Bouton "Nouvelle playlist" ouvre une modale de création.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Playlist } from '@tutti/shared';
import { listPlaylists, createPlaylist } from '../../lib/playlists.js';
import {
  Button,
  Card,
  Input,
  Modal,
  Badge,
  TitleHandwritten,
  Underline,
} from '../../components/ui/index.js';

export function TracksPage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    listPlaylists()
      .then(setPlaylists)
      .catch((err: unknown) => setError((err as Error).message));
  }, []);

  return (
    <div className="max-w-5xl mx-auto">
      <header className="flex items-center justify-between mb-8">
        <TitleHandwritten as="h1">
          <Underline>{t('tracks.title')}</Underline>
        </TitleHandwritten>
        <Button onClick={() => setModalOpen(true)}>{t('playlists.newPlaylist')}</Button>
      </header>

      {error && (
        <p role="alert" className="text-raspberry mb-4">
          {t('common.error')} : {error}
        </p>
      )}

      {playlists === null && <p className="font-mono text-ink-soft">{t('common.loading')}</p>}

      {playlists !== null && playlists.length === 0 && (
        <Card tone="cream" size="lg">
          <p className="font-editorial italic text-ink-2 mb-4">{t('playlists.emptyState')}</p>
          <Button onClick={() => setModalOpen(true)}>{t('playlists.newPlaylist')}</Button>
        </Card>
      )}

      {playlists && playlists.length > 0 && (
        <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {playlists.map((p, idx) => (
            <li key={p.id}>
              <Link to={`/admin/tracks/${p.id}`} className="block group">
                <Card
                  tone={p.is_published ? 'spritz' : 'default'}
                  size="sm"
                  className="h-full transition-transform group-hover:-translate-y-0.5 group-hover:shadow-pop-lg"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <Badge
                      tone={p.level === 'EASY' ? 'basil' : p.level === 'MEDIUM' ? 'lemon' : 'plum'}
                      tilt={idx % 2 === 0 ? -1 : 1}
                    >
                      {p.level}
                    </Badge>
                    {p.is_published && (
                      <Badge tone="ink" tilt={-2}>
                        {t('playlists.published')}
                      </Badge>
                    )}
                  </div>
                  <p className="font-display text-xl mb-1 truncate">{p.name}</p>
                  <p className="font-mono text-xs text-ink-soft">
                    {p.tracks_count ?? 0} {t('playlists.tracksCount')} · {p.language.toUpperCase()}
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <NewPlaylistModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(p) => navigate(`/admin/tracks/${p.id}`)}
      />
    </div>
  );
}

function NewPlaylistModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (p: Playlist) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<'fr' | 'en'>('fr');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setErr(null);
    try {
      const playlist = await createPlaylist({ name: name.trim(), language });
      onCreated(playlist);
      setName('');
      onClose();
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('playlists.newPlaylist')}>
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <Input
          label={t('playlists.fieldName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('playlists.namePlaceholder')}
          required
          minLength={1}
          maxLength={120}
          autoFocus
        />
        <div>
          <span className="block text-xs font-mono uppercase tracking-wider text-ink/70 mb-1">
            {t('playlists.fieldLanguage')}
          </span>
          <div className="flex gap-2">
            {(['fr', 'en'] as const).map((lng) => (
              <button
                key={lng}
                type="button"
                onClick={() => setLanguage(lng)}
                aria-pressed={language === lng}
                className={`flex-1 px-3 py-1.5 border-2 border-ink rounded font-medium transition-colors ${
                  language === lng ? 'bg-ink text-cream' : 'bg-cream text-ink hover:bg-cream-2'
                }`}
              >
                {lng.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
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
            {submitting ? t('common.saving') : t('playlists.create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
