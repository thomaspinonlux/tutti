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

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input, TitleHandwritten, Underline } from '../../components/ui/index.js';
import {
  listOfficialPlaylists,
  reimportOfficialLibrary,
  type ImportResult,
  type OfficialPlaylistSummary,
  type Visibility,
} from '../../lib/adminLibrary.js';

type Tab = 'playlists' | 'quizzes';

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

      {/* Onglets Playlists | Quizzes */}
      <div className="flex gap-2 border-b-2 border-ink mb-6">
        <button
          type="button"
          onClick={() => setTab('playlists')}
          className={`px-4 py-2 font-display text-lg border-2 border-ink border-b-0 rounded-t-md transition-colors ${
            tab === 'playlists'
              ? 'bg-cream text-ink shadow-pop-sm'
              : 'bg-cream-2 text-ink-soft hover:bg-cream'
          }`}
        >
          🎵 {t('library.tabPlaylists')}
        </button>
        <button
          type="button"
          onClick={() => setTab('quizzes')}
          className={`px-4 py-2 font-display text-lg border-2 border-ink border-b-0 rounded-t-md transition-colors ${
            tab === 'quizzes'
              ? 'bg-cream text-ink shadow-pop-sm'
              : 'bg-cream-2 text-ink-soft hover:bg-cream'
          }`}
        >
          ❓ {t('library.tabQuizzes')}
        </button>
      </div>

      {tab === 'playlists' ? <PlaylistsTab /> : <QuizzesTab />}
    </div>
  );
}

// ───── Playlists tab ───────────────────────────────────────────────────────

function PlaylistsTab(): JSX.Element {
  const { t } = useTranslation();
  const [playlists, setPlaylists] = useState<OfficialPlaylistSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [visibility, setVisibility] = useState<Visibility | 'all'>('all');
  const [reimporting, setReimporting] = useState(false);
  const [lastImport, setLastImport] = useState<ImportResult | null>(null);

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
        <div className="ml-auto">
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
                <th className="px-3 py-2 text-left">{t('library.colName')}</th>
                <th className="px-3 py-2 text-left">{t('library.colTheme')}</th>
                <th className="px-3 py-2 text-left">{t('library.colDifficulty')}</th>
                <th className="px-3 py-2 text-left">{t('library.colLocale')}</th>
                <th className="px-3 py-2 text-right">{t('library.colTracks')}</th>
                <th className="px-3 py-2 text-left">{t('library.colVisibility')}</th>
                <th className="px-3 py-2 text-left">{t('library.colUpdated')}</th>
                <th className="px-3 py-2 text-left">{t('library.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {playlists.map((p) => (
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

// ───── Quizzes tab (placeholder V1) ───────────────────────────────────────

function QuizzesTab(): JSX.Element {
  const { t } = useTranslation();
  return (
    <Card tone="cream" size="lg" className="text-center">
      <p className="font-display text-2xl mb-2">🚧</p>
      <p className="font-editorial italic text-ink-2">{t('library.quizzesPlaceholder')}</p>
    </Card>
  );
}

// ───── Sub-components ─────────────────────────────────────────────────────

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
