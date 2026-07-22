/**
 * /admin/tracks — liste des playlists Tutti Tracks (étape 8).
 * Bouton "Nouvelle playlist" ouvre une modale de création.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Playlist } from '@tutti/shared';
import { listPlaylists, createPlaylist, deletePlaylist } from '../../lib/playlists.js';
import { listLibraryPlaylists, type LibraryPlaylistSummary } from '../../lib/library.js';

/** feat/provider-badge — libellé + emoji couleur par source audio. */
const PROVIDER_META: Record<string, { emoji: string; label: string }> = {
  spotify: { emoji: '🟢', label: 'Spotify' },
  youtube: { emoji: '🔴', label: 'YouTube' },
  apple_music: { emoji: '🍎', label: 'Apple Music' },
  deezer: { emoji: '🎧', label: 'Deezer' },
  demo: { emoji: '🎵', label: 'Démo' },
};

/**
 * Dérive la source d'une playlist perso depuis la répartition des tracks par
 * provider : source unique → ce provider ; plusieurs providers (legacy) →
 * provider majoritaire + drapeau `mixed`. null si la playlist est vide.
 */
function deriveSource(
  counts: Partial<Record<string, number>> | undefined,
): { emoji: string; label: string; mixed: boolean } | null {
  const entries = Object.entries(counts ?? {}).filter(([, n]) => (n ?? 0) > 0) as Array<
    [string, number]
  >;
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1]);
  const [topProvider] = entries[0]!;
  const meta = PROVIDER_META[topProvider] ?? { emoji: '🎵', label: topProvider };
  return { emoji: meta.emoji, label: meta.label, mixed: entries.length > 1 };
}

/**
 * Sources disponibles d'une playlist officielle. Contrairement aux perso
 * (mono-provider), les officielles sont multi-sources : on liste tous les
 * providers ayant au moins un track (badge par source jouable).
 */
function officialSources(p: LibraryPlaylistSummary): Array<{ emoji: string; label: string }> {
  const out: Array<{ emoji: string; label: string }> = [];
  if (p.spotify_count > 0) out.push(PROVIDER_META.spotify!);
  if (p.youtube_count > 0) out.push(PROVIDER_META.youtube!);
  if ((p.apple_music_count ?? 0) > 0) out.push(PROVIDER_META.apple_music!);
  return out;
}
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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // feat/tracks-official-tab — bascule Mes playlists ↔ Bibliothèque officielle.
  const [tab, setTab] = useState<'mine' | 'official'>('mine');

  useEffect(() => {
    listPlaylists()
      .then(setPlaylists)
      .catch((err: unknown) => setError((err as Error).message));
  }, []);

  // feat/delete-playlist — suppression d'une playlist depuis la liste, avec
  // confirmation. Le bouton est en dehors du <Link> (pas de navigation au clic).
  const handleDelete = async (p: Playlist): Promise<void> => {
    if (
      !window.confirm(
        `Supprimer la playlist « ${p.name} » ?\nCette action est définitive (la playlist et ses morceaux seront retirés).`,
      )
    ) {
      return;
    }
    setDeletingId(p.id);
    setError(null);
    try {
      await deletePlaylist(p.id);
      setPlaylists((prev) => (prev ? prev.filter((x) => x.id !== p.id) : prev));
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      <header className="flex items-center justify-between mb-8 flex-wrap gap-3">
        <TitleHandwritten as="h1">
          <Underline>{t('tracks.title')}</Underline>
        </TitleHandwritten>
        <div className="flex items-center gap-2 flex-wrap">
          <Link to="/admin/sessions/new">
            <Button variant="secondary">▶ {t('dashboard.newSession')}</Button>
          </Link>
          <Button onClick={() => setModalOpen(true)}>{t('playlists.newPlaylist')}</Button>
        </div>
      </header>

      {/* Onglets Mes playlists / Bibliothèque officielle — même système visuel
          que la page /admin/library (#164 : boutons à bordure basse). */}
      <div className="flex gap-2 border-b-2 border-ink mb-6 flex-wrap">
        {(
          [
            { key: 'mine', icon: '🎧', label: t('library.tabMyPlaylists') },
            { key: 'official', icon: '🎵', label: t('library.title') },
          ] as const
        ).map(({ key, icon, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-4 py-2 font-display text-lg border-2 border-ink border-b-0 rounded-t-md transition-colors ${
              tab === key
                ? 'bg-cream text-ink shadow-pop-sm'
                : 'bg-cream-2 text-ink-soft hover:bg-cream'
            }`}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="text-raspberry mb-4">
          {t('common.error')} : {error}
        </p>
      )}

      {tab === 'official' && <OfficialPlaylistsTab />}

      {tab === 'mine' && playlists === null && (
        <p className="font-mono text-ink-soft">{t('common.loading')}</p>
      )}

      {tab === 'mine' && playlists !== null && playlists.length === 0 && (
        <Card tone="cream" size="lg">
          <p className="font-editorial italic text-ink-2 mb-4">{t('playlists.emptyState')}</p>
          <Button onClick={() => setModalOpen(true)}>{t('playlists.newPlaylist')}</Button>
        </Card>
      )}

      {tab === 'mine' && playlists && playlists.length > 0 && (
        <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {playlists.map((p, idx) => (
            <li key={p.id} className="relative">
              {/* feat/delete-playlist — bouton suppression, hors du <Link>. */}
              <button
                type="button"
                onClick={() => void handleDelete(p)}
                disabled={deletingId === p.id}
                aria-label={`Supprimer la playlist ${p.name}`}
                title="Supprimer la playlist"
                className="absolute bottom-2 right-2 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-white border-2 border-ink text-raspberry hover:bg-raspberry hover:text-white shadow-pop transition-colors disabled:opacity-50"
              >
                {deletingId === p.id ? '…' : '🗑'}
              </button>
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
                  <p className="font-mono text-xs text-ink-soft flex items-center gap-1.5 flex-wrap">
                    <span>
                      {p.tracks_count ?? 0} {t('playlists.tracksCount')} ·{' '}
                      {p.language.toUpperCase()}
                    </span>
                    {(() => {
                      const source = deriveSource(p.provider_counts);
                      if (!source) return null;
                      return (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-ink/20 bg-cream-2 text-ink-soft"
                          title={
                            source.mixed
                              ? `Sources mixtes — majoritaire : ${source.label}`
                              : `Source : ${source.label}`
                          }
                        >
                          {source.emoji} {source.label}
                          {source.mixed && <span className="text-ink-faded">· mixte</span>}
                        </span>
                      );
                    })()}
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

// ───── Bibliothèque officielle (lecture seule) ─────────────────────────────
// Playlists officielles Tutti côté animateur (endpoint host GET /api/library/
// playlists). LECTURE SEULE : pas de corbeille 🗑, pas de navigation vers la
// gestion. Badge niveau + sources disponibles (multi-provider).
//
// NB : la GESTION de la bibliothèque (réimport, édition, visibilité, tags) reste
// sur /admin/library — page SUPER-ADMIN distincte, ce n'est PAS un doublon :
// audiences différentes (animateur = lecture ; super-admin = administration).
function OfficialPlaylistsTab(): JSX.Element {
  const { t } = useTranslation();
  const [playlists, setPlaylists] = useState<LibraryPlaylistSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listLibraryPlaylists()
      .then(setPlaylists)
      .catch((err: unknown) => setError((err as Error).message));
  }, []);

  if (error) {
    return (
      <p role="alert" className="text-raspberry mb-4">
        {t('common.error')} : {error}
      </p>
    );
  }
  if (playlists === null) {
    return <p className="font-mono text-ink-soft">{t('common.loading')}</p>;
  }
  if (playlists.length === 0) {
    return (
      <Card tone="cream" size="lg" className="text-center">
        <p className="font-editorial italic text-ink-soft">{t('library.empty')}</p>
      </Card>
    );
  }

  return (
    <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {playlists.map((p, idx) => {
        const sources = officialSources(p);
        return (
          <li key={p.id}>
            <Card tone="default" size="sm" className={`h-full ${p.locked ? 'opacity-70' : ''}`}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <Badge
                  tone={
                    p.difficulty === 'EASY' ? 'basil' : p.difficulty === 'MEDIUM' ? 'lemon' : 'plum'
                  }
                  tilt={idx % 2 === 0 ? -1 : 1}
                >
                  {p.difficulty}
                </Badge>
                {p.locked && (
                  <Badge tone="ink" tilt={-2}>
                    🔒 Premium
                  </Badge>
                )}
              </div>
              <p className="font-display text-xl mb-1 truncate">{p.name_fr}</p>
              <p className="font-mono text-xs text-ink-soft flex items-center gap-1.5 flex-wrap">
                <span>
                  {p.track_count} {t('playlists.tracksCount')} · {p.locale_primary.toUpperCase()}
                </span>
                {sources.length > 0 && (
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-ink/20 bg-cream-2 text-ink-soft"
                    title={`Sources disponibles : ${sources.map((s) => s.label).join(', ')}`}
                  >
                    {sources.map((s) => s.emoji).join(' ')}
                  </span>
                )}
              </p>
            </Card>
          </li>
        );
      })}
    </ul>
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
