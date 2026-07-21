/**
 * /admin/library — gestion bibliothèque officielle Tutti.
 *
 * V1 :
 *   - Onglets Playlists / Quizzes (Quizzes = placeholder vide)
 *   - Tableau playlists avec recherche texte + filtre visibility
 *   - Bouton "Réimporter tout" → POST /api/admin/library/reimport
 *
 * Out of scope V1 : édition manuelle, ajout/suppression, drag & drop.
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Playlist, QuestionSet } from '@tutti/shared';
import {
  Badge,
  Button,
  Card,
  Input,
  Modal,
  TitleHandwritten,
  Underline,
} from '../../components/ui/index.js';
import {
  listOfficialPlaylists,
  listOfficialQuizPacks,
  reimportOfficialLibrary,
  type ImportResult,
  type OfficialPlaylistSummary,
  type OfficialQuizPackSummary,
  type Visibility,
} from '../../lib/adminLibrary.js';
import { listPlaylists, createPlaylist, deletePlaylist } from '../../lib/playlists.js';
import { listQuestionSets, createQuestionSet } from '../../lib/questionSets.js';

// 4 onglets : Playlists officielles / personnelles, Quizzes officielles / personnels.
type Tab = 'playlists' | 'my-playlists' | 'quizzes' | 'my-quizzes';

const TABS = [
  { key: 'playlists', icon: '🎵', labelKey: 'library.tabPlaylists' },
  { key: 'my-playlists', icon: '🎧', labelKey: 'library.tabMyPlaylists' },
  { key: 'quizzes', icon: '❓', labelKey: 'library.tabQuizzes' },
  { key: 'my-quizzes', icon: '📝', labelKey: 'library.tabMyQuizzes' },
] as const satisfies { key: Tab; icon: string; labelKey: string }[];

export function LibraryPage(): JSX.Element {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('playlists');

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-6 flex items-start justify-between flex-wrap gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-2">
            {t('library.eyebrow')}
          </p>
          <TitleHandwritten as="h1">
            <Underline>{t('library.title')}</Underline>
          </TitleHandwritten>
          <p className="font-editorial italic text-ink-2 mt-1">{t('library.subtitle')}</p>
        </div>
      </header>

      {/* Onglets : officielles / personnelles × playlists / quizzes */}
      <div className="flex gap-2 border-b-2 border-ink mb-6 flex-wrap">
        {TABS.map(({ key, icon, labelKey }) => (
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
            {icon} {t(labelKey)}
          </button>
        ))}
      </div>

      {tab === 'playlists' && <PlaylistsTab />}
      {tab === 'my-playlists' && <MyPlaylistsTab />}
      {tab === 'quizzes' && <QuizzesTab />}
      {tab === 'my-quizzes' && <MyQuizzesTab />}
    </div>
  );
}

// ───── Playlists personnelles tab (ex Tutti Tracks) ────────────────────────
// Reprend la liste + création + bouton suppression 🗑 (déplacé depuis
// /admin/tracks). Le bouton est hors du <Link> pour ne pas naviguer au clic.

function MyPlaylistsTab(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    listPlaylists()
      .then(setPlaylists)
      .catch((err: unknown) => setError((err as Error).message));
  }, []);

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
    <div>
      <div className="flex justify-end mb-5">
        <Button onClick={() => setModalOpen(true)}>{t('playlists.newPlaylist')}</Button>
      </div>

      {error && (
        <Card tone="cream" className="border-raspberry mb-4">
          <p role="alert" className="text-raspberry font-medium">
            {error}
          </p>
        </Card>
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
            <li key={p.id} className="relative">
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

// ───── Quizzes personnels tab (ex Tutti Quizz) ─────────────────────────────

function MyQuizzesTab(): JSX.Element {
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
    <div>
      <div className="flex justify-end mb-5">
        <Button onClick={() => setModalOpen(true)}>{t('quizz.newPack')}</Button>
      </div>

      {error && (
        <Card tone="cream" className="border-raspberry mb-4">
          <p role="alert" className="text-raspberry font-medium">
            {error}
          </p>
        </Card>
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

// ───── Playlists tab ───────────────────────────────────────────────────────

// feat/admin-library-sortable-columns — colonnes triables côté client.
// Ordre par défaut = updated_at desc (renvoyé par l'API). Le user clique
// un en-tête → asc → desc → default. Un seul critère actif à la fois.
type SortKey =
  | 'name'
  | 'theme'
  | 'difficulty'
  | 'locale'
  | 'visibility'
  | 'updated_at'
  | 'track_count';
type SortOrder = 'asc' | 'desc' | null; // null = ordre par défaut (API)

const DIFFICULTY_RANK: Record<string, number> = { EASY: 1, MEDIUM: 2, EXPERT: 3 };

function comparePlaylists(
  a: OfficialPlaylistSummary,
  b: OfficialPlaylistSummary,
  key: SortKey,
): number {
  switch (key) {
    case 'name':
      return a.name_fr.localeCompare(b.name_fr, 'fr', { sensitivity: 'base' });
    case 'theme':
      return (a.theme ?? '').localeCompare(b.theme ?? '', 'fr', { sensitivity: 'base' });
    case 'difficulty':
      return (DIFFICULTY_RANK[a.difficulty] ?? 99) - (DIFFICULTY_RANK[b.difficulty] ?? 99);
    case 'locale':
      return a.locale_primary.localeCompare(b.locale_primary, 'fr', { sensitivity: 'base' });
    case 'visibility':
      return a.visibility.localeCompare(b.visibility);
    case 'updated_at':
      return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
    case 'track_count':
      return a.track_count - b.track_count;
  }
}

function PlaylistsTab(): JSX.Element {
  const { t } = useTranslation();
  const [playlists, setPlaylists] = useState<OfficialPlaylistSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [visibility, setVisibility] = useState<Visibility | 'all'>('all');
  const [reimporting, setReimporting] = useState(false);
  const [lastImport, setLastImport] = useState<ImportResult | null>(null);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>(null);

  // Toggle 3 états par colonne : default → asc → desc → default.
  const handleSort = (key: SortKey): void => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortOrder('asc');
      return;
    }
    if (sortOrder === 'asc') {
      setSortOrder('desc');
      return;
    }
    // sortOrder === 'desc' → reset
    setSortKey(null);
    setSortOrder(null);
  };

  // Liste triée côté frontend (ne touche pas l'API).
  const sortedPlaylists = useMemo(() => {
    if (!playlists) return null;
    if (!sortKey || !sortOrder) return playlists;
    const sorted = [...playlists].sort((a, b) => comparePlaylists(a, b, sortKey));
    return sortOrder === 'desc' ? sorted.reverse() : sorted;
  }, [playlists, sortKey, sortOrder]);

  const fetchPlaylists = async (): Promise<void> => {
    try {
      const data = await listOfficialPlaylists({
        visibility: visibility === 'all' ? undefined : visibility,
        q: q.trim() || undefined,
      });
      setPlaylists(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    void fetchPlaylists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibility]);

  const handleSearch = (e: React.FormEvent): void => {
    e.preventDefault();
    void fetchPlaylists();
  };

  const handleReimport = async (): Promise<void> => {
    if (!window.confirm(t('library.reimportConfirm'))) return;
    setReimporting(true);
    try {
      const result = await reimportOfficialLibrary();
      setLastImport(result);
      await fetchPlaylists();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setReimporting(false);
    }
  };

  return (
    <div>
      {/* Filtres + actions */}
      <div className="flex items-end gap-3 flex-wrap mb-5">
        <form onSubmit={handleSearch} className="flex items-end gap-2">
          <Input
            label={t('library.search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('library.searchPlaceholder')}
            className="w-64"
          />
          <Button type="submit" variant="secondary" size="md">
            🔍 {t('library.searchSubmit')}
          </Button>
        </form>
        <div>
          <label className="block text-xs font-mono uppercase tracking-wider text-ink-soft mb-1">
            {t('library.visibility')}
          </label>
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as Visibility | 'all')}
            className="border-2 border-ink rounded px-3 py-2 bg-cream font-medium"
          >
            <option value="all">{t('library.visibilityAll')}</option>
            <option value="public">{t('library.visibilityPublic')}</option>
            <option value="premium_only">{t('library.visibilityPremium')}</option>
            <option value="private">{t('library.visibilityPrivate')}</option>
          </select>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <Link
            to="/admin/library/audit"
            className="font-mono text-sm px-3 py-2 border-2 border-ink rounded hover:bg-cream transition-colors"
          >
            🔍 Audit tracks non jouables
          </Link>
          <Link
            to="/admin/library/tags"
            className="font-mono text-sm px-3 py-2 border-2 border-ink rounded hover:bg-cream transition-colors"
          >
            🏷️ Révision des tags
          </Link>
          <Button
            type="button"
            variant="primary"
            size="md"
            disabled={reimporting}
            onClick={() => void handleReimport()}
          >
            {reimporting ? '⏳ ' + t('library.reimporting') : '🔄 ' + t('library.reimportAll')}
          </Button>
        </div>
      </div>

      {lastImport && <ImportSummary result={lastImport} />}

      {error && (
        <Card tone="cream" className="border-raspberry mb-4">
          <p role="alert" className="text-raspberry font-medium">
            {error}
          </p>
        </Card>
      )}

      {!playlists ? (
        <p className="font-mono text-ink-soft animate-fade-in">{t('common.loading')}</p>
      ) : playlists.length === 0 ? (
        <Card tone="cream" size="lg" className="text-center">
          <p className="font-editorial italic text-ink-soft">{t('library.empty')}</p>
        </Card>
      ) : (
        <div className="border-2 border-ink rounded-lg overflow-x-auto bg-cream">
          <table className="w-full text-sm">
            <thead className="bg-ink text-cream font-mono text-xs uppercase tracking-wider">
              <tr>
                <SortableHeader
                  sortKey="name"
                  active={sortKey}
                  order={sortOrder}
                  onClick={handleSort}
                  align="left"
                >
                  {t('library.colName')}
                </SortableHeader>
                <SortableHeader
                  sortKey="theme"
                  active={sortKey}
                  order={sortOrder}
                  onClick={handleSort}
                  align="left"
                >
                  {t('library.colTheme')}
                </SortableHeader>
                <SortableHeader
                  sortKey="difficulty"
                  active={sortKey}
                  order={sortOrder}
                  onClick={handleSort}
                  align="left"
                >
                  {t('library.colDifficulty')}
                </SortableHeader>
                <SortableHeader
                  sortKey="locale"
                  active={sortKey}
                  order={sortOrder}
                  onClick={handleSort}
                  align="left"
                >
                  {t('library.colLocale')}
                </SortableHeader>
                <SortableHeader
                  sortKey="track_count"
                  active={sortKey}
                  order={sortOrder}
                  onClick={handleSort}
                  align="right"
                >
                  {t('library.colTracks')}
                </SortableHeader>
                <SortableHeader
                  sortKey="visibility"
                  active={sortKey}
                  order={sortOrder}
                  onClick={handleSort}
                  align="left"
                >
                  {t('library.colVisibility')}
                </SortableHeader>
                <SortableHeader
                  sortKey="updated_at"
                  active={sortKey}
                  order={sortOrder}
                  onClick={handleSort}
                  align="left"
                >
                  {t('library.colUpdated')}
                </SortableHeader>
                <th className="px-3 py-2 text-left">{t('library.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {(sortedPlaylists ?? playlists).map((p) => (
                <tr key={p.id} className="border-t border-ink/20 hover:bg-cream-2">
                  <td className="px-3 py-2 font-medium">
                    <Link to={`/admin/library/playlists/${p.id}`} className="hover:underline">
                      {p.name_fr}
                    </Link>
                    <p className="text-[10px] font-mono text-ink-soft">{p.slug}</p>
                  </td>
                  <td className="px-3 py-2 text-ink-soft">{p.theme ?? '—'}</td>
                  <td className="px-3 py-2">
                    <DifficultyBadge difficulty={p.difficulty} />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{p.locale_primary}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.track_count}</td>
                  <td className="px-3 py-2">
                    <VisibilityBadge visibility={p.visibility} />
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-soft">
                    {new Date(p.updated_at).toLocaleDateString('fr-FR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      to={`/admin/library/playlists/${p.id}`}
                      className="text-spritz-deep font-medium hover:underline"
                    >
                      {t('library.colEdit')} →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ───── Quizzes tab — feat/official-quiz-library ─────────────────────────

type QuizSortKey =
  | 'name_fr'
  | 'category'
  | 'difficulty'
  | 'locale'
  | 'visibility'
  | 'updated_at'
  | 'question_count';

function compareQuizPacks(
  a: OfficialQuizPackSummary,
  b: OfficialQuizPackSummary,
  key: QuizSortKey,
): number {
  switch (key) {
    case 'name_fr':
      return a.name_fr.localeCompare(b.name_fr, 'fr', { sensitivity: 'base' });
    case 'category':
      return (a.category ?? '').localeCompare(b.category ?? '', 'fr', { sensitivity: 'base' });
    case 'difficulty':
      return (DIFFICULTY_RANK[a.difficulty] ?? 99) - (DIFFICULTY_RANK[b.difficulty] ?? 99);
    case 'locale':
      return a.locale_primary.localeCompare(b.locale_primary, 'fr', { sensitivity: 'base' });
    case 'visibility':
      return a.visibility.localeCompare(b.visibility);
    case 'updated_at':
      return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
    case 'question_count':
      return a.question_count - b.question_count;
  }
}

function QuizzesTab(): JSX.Element {
  const { t } = useTranslation();
  const [packs, setPacks] = useState<OfficialQuizPackSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [visibility, setVisibility] = useState<Visibility | 'all'>('all');
  const [sortKey, setSortKey] = useState<QuizSortKey | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>(null);

  const fetchPacks = async (): Promise<void> => {
    try {
      const data = await listOfficialQuizPacks({
        visibility: visibility === 'all' ? undefined : visibility,
        q: q.trim() || undefined,
      });
      setPacks(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    void fetchPacks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibility]);

  const handleSearch = (e: React.FormEvent): void => {
    e.preventDefault();
    void fetchPacks();
  };

  const handleSort = (k: QuizSortKey): void => {
    if (sortKey !== k) {
      setSortKey(k);
      setSortOrder('asc');
      return;
    }
    if (sortOrder === 'asc') {
      setSortOrder('desc');
      return;
    }
    setSortKey(null);
    setSortOrder(null);
  };

  const sortedPacks = useMemo(() => {
    if (!packs) return null;
    if (!sortKey || !sortOrder) return packs;
    const sorted = [...packs].sort((a, b) => compareQuizPacks(a, b, sortKey));
    return sortOrder === 'desc' ? sorted.reverse() : sorted;
  }, [packs, sortKey, sortOrder]);

  return (
    <div>
      <div className="flex items-end gap-3 flex-wrap mb-5">
        <form onSubmit={handleSearch} className="flex items-end gap-2">
          <Input
            label={t('library.search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('library.searchPlaceholder')}
            className="w-64"
          />
          <Button type="submit" variant="secondary" size="md">
            🔍 {t('library.searchSubmit')}
          </Button>
        </form>
        <div>
          <label className="block text-xs font-mono uppercase tracking-wider text-ink-soft mb-1">
            {t('library.visibility')}
          </label>
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as Visibility | 'all')}
            className="border-2 border-ink rounded px-3 py-2 bg-cream font-medium"
          >
            <option value="all">{t('library.visibilityAll')}</option>
            <option value="public">{t('library.visibilityPublic')}</option>
            <option value="premium_only">{t('library.visibilityPremium')}</option>
            <option value="private">{t('library.visibilityPrivate')}</option>
          </select>
        </div>
      </div>

      {error && (
        <Card tone="cream" className="border-raspberry mb-4">
          <p role="alert" className="text-raspberry font-medium">
            {error}
          </p>
        </Card>
      )}

      {!packs ? (
        <p className="font-mono text-ink-soft animate-fade-in">{t('common.loading')}</p>
      ) : packs.length === 0 ? (
        <Card tone="cream" size="lg" className="text-center">
          <p className="font-editorial italic text-ink-soft">{t('library.empty')}</p>
        </Card>
      ) : (
        <div className="border-2 border-ink rounded-lg overflow-x-auto bg-cream">
          <table className="w-full text-sm">
            <thead className="bg-ink text-cream font-mono text-xs uppercase tracking-wider">
              <tr>
                <QuizSortableHeader
                  sortKey="name_fr"
                  active={sortKey}
                  order={sortOrder}
                  onClick={handleSort}
                  align="left"
                >
                  {t('library.colName')}
                </QuizSortableHeader>
                <QuizSortableHeader
                  sortKey="category"
                  active={sortKey}
                  order={sortOrder}
                  onClick={handleSort}
                  align="left"
                >
                  {t('library.colCategory')}
                </QuizSortableHeader>
                <QuizSortableHeader
                  sortKey="difficulty"
                  active={sortKey}
                  order={sortOrder}
                  onClick={handleSort}
                  align="left"
                >
                  {t('library.colDifficulty')}
                </QuizSortableHeader>
                <QuizSortableHeader
                  sortKey="locale"
                  active={sortKey}
                  order={sortOrder}
                  onClick={handleSort}
                  align="left"
                >
                  {t('library.colLocale')}
                </QuizSortableHeader>
                <QuizSortableHeader
                  sortKey="question_count"
                  active={sortKey}
                  order={sortOrder}
                  onClick={handleSort}
                  align="right"
                >
                  {t('library.colQuestions')}
                </QuizSortableHeader>
                <QuizSortableHeader
                  sortKey="visibility"
                  active={sortKey}
                  order={sortOrder}
                  onClick={handleSort}
                  align="left"
                >
                  {t('library.colVisibility')}
                </QuizSortableHeader>
                <QuizSortableHeader
                  sortKey="updated_at"
                  active={sortKey}
                  order={sortOrder}
                  onClick={handleSort}
                  align="left"
                >
                  {t('library.colUpdated')}
                </QuizSortableHeader>
                <th className="px-3 py-2 text-left">{t('library.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {(sortedPacks ?? packs).map((p) => (
                <tr key={p.id} className="border-t border-ink/20 hover:bg-cream-2">
                  <td className="px-3 py-2 font-medium">
                    <Link to={`/admin/library/quiz-packs/${p.id}`} className="hover:underline">
                      {p.name_fr}
                    </Link>
                    <p className="text-[10px] font-mono text-ink-soft">{p.slug}</p>
                  </td>
                  <td className="px-3 py-2 text-ink-soft">{p.category ?? '—'}</td>
                  <td className="px-3 py-2">
                    <DifficultyBadge difficulty={p.difficulty} />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{p.locale_primary}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{p.question_count}</td>
                  <td className="px-3 py-2">
                    <VisibilityBadge visibility={p.visibility} />
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-soft">
                    {new Date(p.updated_at).toLocaleDateString('fr-FR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      to={`/admin/library/quiz-packs/${p.id}`}
                      className="text-spritz-deep font-medium hover:underline"
                    >
                      {t('library.colEdit')} →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface QuizSortableHeaderProps {
  sortKey: QuizSortKey;
  active: QuizSortKey | null;
  order: SortOrder;
  onClick: (k: QuizSortKey) => void;
  align: 'left' | 'right';
  children: React.ReactNode;
}
function QuizSortableHeader({
  sortKey,
  active,
  order,
  onClick,
  align,
  children,
}: QuizSortableHeaderProps): JSX.Element {
  const isActive = active === sortKey && order !== null;
  const arrow = isActive ? (order === 'asc' ? ' ↑' : ' ↓') : '';
  const alignClass = align === 'right' ? 'text-right' : 'text-left';
  const activeClass = isActive ? 'bg-spritz/30 text-cream' : 'hover:bg-ink/80';
  return (
    <th
      scope="col"
      className={`px-3 py-2 ${alignClass} cursor-pointer select-none transition-colors ${activeClass}`}
      onClick={() => onClick(sortKey)}
      aria-sort={isActive ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        <span aria-hidden className="font-bold">
          {arrow}
        </span>
      </span>
    </th>
  );
}

// ───── Sub-components ─────────────────────────────────────────────────────

// feat/admin-library-sortable-columns — header cliquable avec indicateur ↑/↓.
// Hover : fond plus foncé. Active : indicateur visible + fond accent.
interface SortableHeaderProps {
  sortKey: SortKey;
  active: SortKey | null;
  order: SortOrder;
  onClick: (key: SortKey) => void;
  align: 'left' | 'right';
  children: React.ReactNode;
}
function SortableHeader({
  sortKey,
  active,
  order,
  onClick,
  align,
  children,
}: SortableHeaderProps): JSX.Element {
  const isActive = active === sortKey && order !== null;
  const arrow = isActive ? (order === 'asc' ? ' ↑' : ' ↓') : '';
  const alignClass = align === 'right' ? 'text-right' : 'text-left';
  const activeClass = isActive ? 'bg-spritz/30 text-cream' : 'hover:bg-ink/80';
  return (
    <th
      scope="col"
      className={`px-3 py-2 ${alignClass} cursor-pointer select-none transition-colors ${activeClass}`}
      onClick={() => onClick(sortKey)}
      aria-sort={isActive ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        <span aria-hidden className="font-bold">
          {arrow}
        </span>
      </span>
    </th>
  );
}

function VisibilityBadge({ visibility }: { visibility: Visibility }): JSX.Element {
  const cfg = {
    public: { bg: 'bg-basil/15 border-basil text-basil-deep', label: 'Public' },
    premium_only: {
      bg: 'bg-spritz/15 border-spritz text-spritz-deep',
      label: 'Premium only',
    },
    private: { bg: 'bg-ink/10 border-ink text-ink', label: 'Private' },
  }[visibility];
  return (
    <span
      className={`inline-block px-2 py-0.5 border text-[11px] font-mono uppercase rounded ${cfg.bg}`}
    >
      {cfg.label}
    </span>
  );
}

function DifficultyBadge({
  difficulty,
}: {
  difficulty: 'EASY' | 'MEDIUM' | 'EXPERT';
}): JSX.Element {
  const map = {
    EASY: 'bg-basil/15 border-basil text-basil-deep',
    MEDIUM: 'bg-lemon/30 border-ink text-ink',
    EXPERT: 'bg-raspberry/15 border-raspberry text-raspberry-deep',
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 border text-[11px] font-mono uppercase rounded ${map[difficulty]}`}
    >
      {difficulty.toLowerCase()}
    </span>
  );
}

function ImportSummary({ result }: { result: ImportResult }): JSX.Element {
  const { t } = useTranslation();
  const totals = result.files.reduce(
    (acc, r) => ({
      tracks: acc.tracks + r.total,
      spotMatch: acc.spotMatch + r.spotifyMatched,
      spotCache: acc.spotCache + r.spotifyAlreadyCached,
      spotMiss: acc.spotMiss + r.spotifyMissed,
      ytMatch: acc.ytMatch + r.youtubeMatched,
      ytCache: acc.ytCache + r.youtubeAlreadyCached,
      ytMiss: acc.ytMiss + r.youtubeMissed,
    }),
    { tracks: 0, spotMatch: 0, spotCache: 0, spotMiss: 0, ytMatch: 0, ytCache: 0, ytMiss: 0 },
  );
  return (
    <Card tone="basil" size="md" className="mb-4">
      <p className="font-display text-lg mb-1">✅ {t('library.importDone')}</p>
      <p className="text-sm text-ink-soft">
        {result.files.length} {t('library.playlistsCount')} · {totals.tracks}{' '}
        {t('library.tracksCount')} · {(result.durationMs / 1000).toFixed(1)}s
      </p>
      <ul className="text-xs font-mono mt-2 space-y-0.5">
        <li>
          Spotify : {totals.spotMatch} matched, {totals.spotCache} cached, {totals.spotMiss} missed
          {!result.spotifyAvailable && ' (clé absente)'}
        </li>
        <li>
          YouTube : {totals.ytMatch} matched, {totals.ytCache} cached, {totals.ytMiss} missed
          {!result.youtubeAvailable && ' (clé absente)'}
        </li>
      </ul>
    </Card>
  );
}
