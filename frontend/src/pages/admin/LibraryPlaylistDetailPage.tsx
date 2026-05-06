/**
 * /admin/library/playlists/:id — détail playlist officielle V1.
 *
 *   - Header éditable inline : name_fr, name_en, description_fr, description_en
 *   - Méta read-only : id, theme, difficulty, locale_primary, track_count
 *   - Toggle visibility public/premium_only/private (save immédiat)
 *   - Liste tracks read-only avec liens Spotify + YouTube
 *   - Bouton "Resync depuis JSON source"
 *
 * Out of scope V1 : édition de tracks, drag & drop.
 */

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, Input, TitleHandwritten, Underline } from '../../components/ui/index.js';
import {
  getOfficialPlaylist,
  patchOfficialPlaylist,
  resyncOfficialPlaylist,
  type ImportFileReport,
  type OfficialPlaylistDetail,
  type Visibility,
} from '../../lib/adminLibrary.js';

export function LibraryPlaylistDetailPage(): JSX.Element {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const [playlist, setPlaylist] = useState<OfficialPlaylistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [resyncing, setResyncing] = useState(false);
  const [resyncReport, setResyncReport] = useState<ImportFileReport | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void getOfficialPlaylist(id)
      .then((p) => {
        if (!cancelled) setPlaylist(p);
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
    if (!id || !playlist) return;
    setSavingField(field);
    try {
      const updated = await patchOfficialPlaylist(id, { [field]: value });
      // Garde tracks (PATCH ne les renvoie pas) — merge la réponse base.
      setPlaylist((prev) => (prev ? { ...prev, ...updated, tracks: prev.tracks } : prev));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingField(null);
    }
  };

  const handleVisibilityChange = async (visibility: Visibility): Promise<void> => {
    if (!id || !playlist) return;
    setSavingField('visibility');
    try {
      const updated = await patchOfficialPlaylist(id, { visibility });
      setPlaylist((prev) => (prev ? { ...prev, ...updated, tracks: prev.tracks } : prev));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingField(null);
    }
  };

  const handleResync = async (): Promise<void> => {
    if (!id) return;
    if (!window.confirm(t('library.resyncConfirm'))) return;
    setResyncing(true);
    try {
      const report = await resyncOfficialPlaylist(id);
      setResyncReport(report);
      // Recharge détail (tracks ont été remplacés via deleteMany+createMany)
      const fresh = await getOfficialPlaylist(id);
      setPlaylist(fresh);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResyncing(false);
    }
  };

  if (error) {
    return (
      <p role="alert" className="text-raspberry">
        {t('common.error')} : {error}
      </p>
    );
  }
  if (!playlist) {
    return <p className="font-mono text-ink-soft animate-fade-in">{t('common.loading')}</p>;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <Link
        to="/admin/library"
        className="font-mono text-xs uppercase tracking-wider text-ink-soft hover:text-ink"
      >
        ← {t('library.backToList')}
      </Link>

      <header className="mt-3 mb-6">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-2">
          {t('library.detailEyebrow')}
        </p>
        <TitleHandwritten as="h1">
          <Underline>{playlist.name_fr}</Underline>
        </TitleHandwritten>
        <p className="font-mono text-[11px] text-ink-soft mt-1">{playlist.slug}</p>
      </header>

      {/* Champs éditables inline */}
      <Card tone="cream" size="md" className="mb-4">
        <p className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-3">
          {t('library.editableFields')}
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <InlineField
            label={t('library.fieldNameFr')}
            value={playlist.name_fr}
            saving={savingField === 'name_fr'}
            onSave={(v) => handleFieldSave('name_fr', v)}
          />
          <InlineField
            label={t('library.fieldNameEn')}
            value={playlist.name_en}
            saving={savingField === 'name_en'}
            onSave={(v) => handleFieldSave('name_en', v)}
          />
          <InlineField
            label={t('library.fieldDescriptionFr')}
            value={playlist.description_fr ?? ''}
            saving={savingField === 'description_fr'}
            onSave={(v) => handleFieldSave('description_fr', v.trim() || null)}
            multiline
          />
          <InlineField
            label={t('library.fieldDescriptionEn')}
            value={playlist.description_en ?? ''}
            saving={savingField === 'description_en'}
            onSave={(v) => handleFieldSave('description_en', v.trim() || null)}
            multiline
          />
        </div>
      </Card>

      {/* Méta read-only */}
      <Card tone="cream" size="md" className="mb-4">
        <p className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-3">
          {t('library.metaReadOnly')}
        </p>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <ReadOnlyMeta label={t('library.metaTheme')} value={playlist.theme ?? '—'} />
          <ReadOnlyMeta
            label={t('library.metaDifficulty')}
            value={playlist.difficulty.toLowerCase()}
          />
          <ReadOnlyMeta label={t('library.metaLocale')} value={playlist.locale_primary} />
          <ReadOnlyMeta label={t('library.metaTrackCount')} value={String(playlist.track_count)} />
          <ReadOnlyMeta label="ID" value={playlist.id} mono small />
        </dl>
      </Card>

      {/* Visibility toggle */}
      <Card tone="cream" size="md" className="mb-4">
        <p className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-3">
          {t('library.visibilityToggle')}
        </p>
        <div className="flex gap-2 flex-wrap">
          {(['public', 'premium_only', 'private'] as const).map((v) => (
            <button
              key={v}
              type="button"
              disabled={savingField === 'visibility'}
              onClick={() => void handleVisibilityChange(v)}
              className={`px-4 py-2 rounded-full border-2 font-medium text-sm transition-colors ${
                playlist.visibility === v
                  ? 'bg-ink text-cream border-ink'
                  : 'bg-cream text-ink border-ink hover:bg-cream-2'
              }`}
            >
              {t(
                v === 'public'
                  ? 'library.visibilityPublic'
                  : v === 'premium_only'
                    ? 'library.visibilityPremium'
                    : 'library.visibilityPrivate',
              )}
            </button>
          ))}
        </div>
      </Card>

      {/* Resync depuis JSON */}
      <Card tone="cream" size="md" className="mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-1">
              {t('library.resyncTitle')}
            </p>
            <p className="text-sm text-ink-soft">{t('library.resyncHint')}</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="md"
            disabled={resyncing}
            onClick={() => void handleResync()}
          >
            {resyncing ? '⏳ ' + t('library.resyncing') : '🔄 ' + t('library.resyncButton')}
          </Button>
        </div>
        {resyncReport && (
          <div className="mt-3 pt-3 border-t border-ink/15 text-xs font-mono">
            <p>
              ✅ Resync done · Spotify : {resyncReport.spotifyMatched} matched,{' '}
              {resyncReport.spotifyAlreadyCached} cached, {resyncReport.spotifyMissed} missed.
            </p>
            <p>
              YouTube : {resyncReport.youtubeMatched} matched, {resyncReport.youtubeAlreadyCached}{' '}
              cached, {resyncReport.youtubeMissed} missed.
            </p>
          </div>
        )}
      </Card>

      {/* Tracks read-only */}
      <Card tone="cream" size="md">
        <p className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-3">
          {t('library.tracksTitle')} ({playlist.tracks.length})
        </p>
        <div className="border-2 border-ink rounded overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink text-cream font-mono text-xs uppercase tracking-wider">
              <tr>
                <th className="px-2 py-1.5 text-right">#</th>
                <th className="px-2 py-1.5 text-left">{t('library.tracksTitleCol')}</th>
                <th className="px-2 py-1.5 text-left">{t('library.tracksArtist')}</th>
                <th className="px-2 py-1.5 text-right">{t('library.tracksYear')}</th>
                <th className="px-2 py-1.5 text-left">{t('library.tracksDifficulty')}</th>
                <th className="px-2 py-1.5 text-center">Spotify</th>
                <th className="px-2 py-1.5 text-center">YouTube</th>
              </tr>
            </thead>
            <tbody>
              {playlist.tracks.map((tr) => (
                <tr key={tr.id} className="border-t border-ink/20 hover:bg-cream-2">
                  <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums">
                    {tr.position}
                  </td>
                  <td className="px-2 py-1.5 font-medium">{tr.title}</td>
                  <td className="px-2 py-1.5 text-ink-soft">{tr.artist}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-ink-soft">
                    {tr.year ?? '—'}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[10px] uppercase">
                    {tr.difficulty.toLowerCase()}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {tr.spotify_id ? (
                      <a
                        href={`https://open.spotify.com/track/${tr.spotify_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-basil-deep hover:underline"
                      >
                        ▶
                      </a>
                    ) : (
                      <span className="text-ink-faded">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {tr.youtube_id ? (
                      <a
                        href={`https://www.youtube.com/watch?v=${tr.youtube_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-raspberry hover:underline"
                      >
                        ▶
                      </a>
                    ) : (
                      <span className="text-ink-faded">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ───── Sub-components ─────────────────────────────────────────────────────

interface InlineFieldProps {
  label: string;
  value: string;
  saving: boolean;
  onSave: (value: string) => void | Promise<void>;
  multiline?: boolean;
}

function InlineField({ label, value, saving, onSave, multiline }: InlineFieldProps): JSX.Element {
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraft(value);
    setDirty(false);
  }, [value]);

  const commit = (): void => {
    if (!dirty) return;
    void onSave(draft);
    setDirty(false);
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
            setDirty(e.target.value !== value);
          }}
          onBlur={commit}
          rows={3}
          className="w-full border-2 border-ink rounded px-3 py-2 bg-cream text-sm"
        />
      ) : (
        <Input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setDirty(e.target.value !== value);
          }}
          onBlur={commit}
        />
      )}
      <p className="text-[10px] font-mono text-ink-soft mt-1 h-3">
        {saving ? '⏳ Saving…' : dirty ? '✏️ Modifié' : ''}
      </p>
    </div>
  );
}

interface ReadOnlyMetaProps {
  label: string;
  value: string;
  mono?: boolean;
  small?: boolean;
}

function ReadOnlyMeta({ label, value, mono, small }: ReadOnlyMetaProps): JSX.Element {
  return (
    <div>
      <dt className="text-[10px] font-mono uppercase tracking-wider text-ink-soft">{label}</dt>
      <dd
        className={`mt-0.5 ${mono ? 'font-mono' : ''} ${small ? 'text-[11px] break-all' : 'text-sm'}`}
      >
        {value}
      </dd>
    </div>
  );
}
