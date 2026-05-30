/**
 * /admin/tracks/:id — édition d'une playlist (3 colonnes).
 *
 * Layout :
 *   - Sidebar (gauche) : nom + level + bouton publish + autres playlists
 *   - Centre : tracks réorganisables (drag & drop)
 *   - Droite : <TrackDetailsPanel /> (recherche / détails+aliases)
 *
 * Auto-save : toutes les modifs (nom, level, tracks, aliases) sont sauvegardées
 * dès qu'elles sont déclenchées. Un indicateur "Enregistré ✓" apparaît brièvement.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Playlist, PlaylistWithTracks, Track, TrackResult } from '@tutti/shared';
import {
  listPlaylists,
  getPlaylist,
  updatePlaylist,
  deletePlaylist,
  addTrack as apiAddTrack,
  deleteTrack as apiDeleteTrack,
  reorderTracks,
  updateTrackAliases,
  checkPlaylistAvailability,
} from '../../lib/playlists.js';
import { Button, Card, Badge, TitleHandwritten, Underline } from '../../components/ui/index.js';
import { SortableTrackList } from '../../components/admin/playlists/SortableTrackList.js';
import { TrackDetailsPanel } from '../../components/admin/playlists/TrackDetailsPanel.js';
import { AddTracksTabs } from '../../components/admin/playlists/import/AddTracksTabs.js';
import { SharePlaylistModal } from '../../components/admin/playlists/SharePlaylistModal.js';
import { AvailabilityCheckPanel } from '../../components/admin/playlists/AvailabilityCheckPanel.js';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function PlaylistEditPage(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [playlist, setPlaylist] = useState<PlaylistWithTracks | null>(null);
  const [allPlaylists, setAllPlaylists] = useState<Playlist[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const [name, setName] = useState('');
  const [shareModalOpen, setShareModalOpen] = useState(false);

  // Bootstrap
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([getPlaylist(id), listPlaylists()])
      .then(([p, list]) => {
        setPlaylist(p);
        setAllPlaylists(list);
        setName(p.name);
        setError(null);
      })
      .catch((err: unknown) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [id]);

  // Auto-save helper
  const flash = (): void => {
    setSaveState('saved');
    window.setTimeout(() => setSaveState('idle'), 1500);
  };

  const handleNameBlur = async (): Promise<void> => {
    if (!playlist || name.trim() === playlist.name) return;
    setSaveState('saving');
    try {
      const updated = await updatePlaylist(playlist.id, { name: name.trim() });
      setPlaylist((p) => (p ? { ...p, ...updated } : p));
      setAllPlaylists((list) => list.map((x) => (x.id === playlist.id ? { ...x, ...updated } : x)));
      flash();
    } catch {
      setSaveState('error');
    }
  };

  const handleTogglePublish = async (): Promise<void> => {
    if (!playlist) return;
    setSaveState('saving');
    try {
      const updated = await updatePlaylist(playlist.id, { is_published: !playlist.is_published });
      setPlaylist((p) => (p ? { ...p, ...updated } : p));
      flash();
    } catch {
      setSaveState('error');
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!playlist) return;
    if (!window.confirm(t('playlists.deleteConfirm'))) return;
    await deletePlaylist(playlist.id);
    navigate('/admin/tracks', { replace: true });
  };

  const handleReorder = async (next: Track[]): Promise<void> => {
    if (!playlist) return;
    setPlaylist((p) => (p ? { ...p, tracks: next.map((t, i) => ({ ...t, position: i })) } : p));
    setSaveState('saving');
    try {
      await reorderTracks(
        playlist.id,
        next.map((t) => t.id),
      );
      flash();
    } catch {
      setSaveState('error');
    }
  };

  const handleAddTrack = async (result: TrackResult): Promise<void> => {
    if (!playlist) return;
    // Idempotence côté client : ne pas ré-ajouter un track déjà présent (même provider+id).
    const exists = playlist.tracks.some(
      (t) => t.provider === result.provider && t.provider_track_id === result.provider_track_id,
    );
    if (exists) return;
    setSaveState('saving');
    try {
      const track = await apiAddTrack(playlist.id, {
        provider: result.provider,
        provider_track_id: result.provider_track_id,
      });
      setPlaylist((p) => (p ? { ...p, tracks: [...p.tracks, track] } : p));
      setSelectedTrack(track);
      // Recharge le level (recalculé serveur-side)
      const refreshed = await getPlaylist(playlist.id);
      setPlaylist(refreshed);
      flash();
    } catch {
      setSaveState('error');
    }
  };

  const handleDeleteTrack = async (track: Track): Promise<void> => {
    if (!playlist) return;
    setPlaylist((p) => (p ? { ...p, tracks: p.tracks.filter((t) => t.id !== track.id) } : p));
    if (selectedTrack?.id === track.id) setSelectedTrack(null);
    setSaveState('saving');
    try {
      await apiDeleteTrack(playlist.id, track.id);
      const refreshed = await getPlaylist(playlist.id);
      setPlaylist(refreshed);
      flash();
    } catch {
      setSaveState('error');
    }
  };

  const handleUpdateAliases = async (
    trackId: string,
    patch: { artist_aliases?: string[]; title_aliases?: string[] },
  ): Promise<void> => {
    if (!playlist) return;
    setSaveState('saving');
    try {
      const updated = await updateTrackAliases(playlist.id, trackId, patch);
      setPlaylist((p) =>
        p
          ? {
              ...p,
              tracks: p.tracks.map((t) => (t.id === trackId ? { ...t, ...updated } : t)),
            }
          : p,
      );
      if (selectedTrack?.id === trackId) {
        setSelectedTrack((s) => (s ? { ...s, ...updated } : s));
      }
      flash();
    } catch {
      setSaveState('error');
    }
  };

  const sortedTracks = useMemo(
    () => (playlist ? [...playlist.tracks].sort((a, b) => a.position - b.position) : []),
    [playlist],
  );

  if (loading) {
    return <p className="font-mono text-ink-soft">{t('common.loading')}</p>;
  }
  if (error || !playlist) {
    return (
      <div className="max-w-md">
        <p role="alert" className="text-raspberry mb-4">
          {error ?? t('common.error')}
        </p>
        <Link to="/admin/tracks">
          <Button variant="secondary" size="sm">
            ← {t('playlists.backToList')}
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr_320px] gap-6 max-w-[1400px] mx-auto">
      {/* ─── Colonne gauche : meta + sidebar playlists ───────────────────── */}
      <aside className="space-y-4">
        <Link to="/admin/tracks" className="font-mono text-xs text-ink-soft hover:text-ink">
          ← {t('playlists.backToList')}
        </Link>

        <Card size="sm">
          <label className="block">
            <span className="block text-xs font-mono uppercase tracking-wider text-ink/70 mb-1">
              {t('playlists.fieldName')}
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void handleNameBlur()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              className="w-full px-2 py-1 border-2 border-ink rounded bg-cream/30 text-sm font-display focus:bg-white focus:outline-none focus:ring-2 focus:ring-spritz"
            />
          </label>

          <dl className="mt-4 text-xs space-y-2">
            <div className="flex justify-between gap-2">
              <dt className="font-mono text-ink-soft uppercase tracking-wider">
                {t('playlists.fieldLevel')}
              </dt>
              <dd>
                <Badge
                  tone={
                    playlist.level === 'EASY'
                      ? 'basil'
                      : playlist.level === 'MEDIUM'
                        ? 'lemon'
                        : 'plum'
                  }
                >
                  {playlist.level}
                </Badge>
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="font-mono text-ink-soft uppercase tracking-wider">
                {t('playlists.fieldTracks')}
              </dt>
              <dd className="font-mono">{sortedTracks.length}</dd>
            </div>
          </dl>

          {/* feat/playlist-pool-random-selection — pool indicator + editable
              session size. Au lancement de la manche, on tire N tracks random
              dans le pool, anti-doublons cross-playlist (PR C). */}
          <PoolSessionSizeField
            playlistId={playlist.id}
            poolSize={sortedTracks.length}
            sessionSize={playlist.default_session_size ?? 15}
            onUpdated={(size) => setPlaylist((p) => (p ? { ...p, default_session_size: size } : p))}
          />

          <div className="mt-4 space-y-2">
            <Button
              variant={playlist.is_published ? 'secondary' : 'primary'}
              size="sm"
              onClick={() => void handleTogglePublish()}
              className="w-full"
            >
              {playlist.is_published ? t('playlists.unpublish') : t('playlists.publish')}
            </Button>
            {playlist.tracks.length > 0 && (
              <Link to={`/admin/sessions/new?playlist=${playlist.id}`} className="block">
                <Button variant="primary" size="sm" className="w-full">
                  ▶ {t('playlists.launchSession')}
                </Button>
              </Link>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShareModalOpen(true)}
              className="w-full"
            >
              ↗ {t('playlists.share')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleDelete()}
              className="w-full text-raspberry"
            >
              {t('playlists.delete')}
            </Button>
          </div>
        </Card>

        {allPlaylists.length > 1 && (
          <Card size="sm">
            <p className="text-xs font-mono uppercase tracking-wider text-ink-soft mb-2">
              {t('playlists.others')}
            </p>
            <ul className="space-y-1">
              {allPlaylists
                .filter((p) => p.id !== playlist.id)
                .map((p) => (
                  <li key={p.id}>
                    <Link
                      to={`/admin/tracks/${p.id}`}
                      className="block px-2 py-1 text-sm border border-ink rounded bg-white hover:bg-cream-2 truncate"
                    >
                      {p.name}{' '}
                      <span className="text-ink-soft text-xs">({p.tracks_count ?? 0})</span>
                    </Link>
                  </li>
                ))}
            </ul>
          </Card>
        )}
      </aside>

      {/* ─── Colonne centre : tracks ─────────────────────────────────────── */}
      <section>
        <header className="mb-6 flex items-center justify-between gap-3">
          <TitleHandwritten as="h1">
            <Underline>{playlist.name}</Underline>
          </TitleHandwritten>
          <SaveIndicator state={saveState} />
        </header>

        <AvailabilityCheckPanel
          playlistId={playlist.id}
          mode="workspace"
          onCheck={(id) => checkPlaylistAvailability(id)}
        />

        <SortableTrackList
          tracks={sortedTracks}
          selectedTrackId={selectedTrack?.id ?? null}
          onSelect={setSelectedTrack}
          onReorder={handleReorder}
          onDelete={handleDeleteTrack}
        />
      </section>

      {/* ─── Colonne droite : modes d'ajout + détails track ───────────────── */}
      <aside className="space-y-4">
        <AddTracksTabs
          playlistId={playlist.id}
          onImported={async () => {
            const refreshed = await getPlaylist(playlist.id);
            setPlaylist(refreshed);
            flash();
          }}
        />
        {selectedTrack && (
          <TrackDetailsPanel
            selected={selectedTrack}
            onAddTrack={handleAddTrack}
            onUpdateAliases={handleUpdateAliases}
          />
        )}
      </aside>

      <SharePlaylistModal
        playlistId={playlist.id}
        playlistName={playlist.name}
        open={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
      />
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }): JSX.Element | null {
  const { t } = useTranslation();
  if (state === 'idle') return null;
  if (state === 'saving') {
    return (
      <span className="font-mono text-xs text-ink-soft animate-fade-in">{t('common.saving')}</span>
    );
  }
  if (state === 'saved') {
    return (
      <span className="font-mono text-xs text-basil-deep animate-fade-in">{t('common.saved')}</span>
    );
  }
  return <span className="font-mono text-xs text-raspberry">{t('common.error')}</span>;
}

/**
 * feat/playlist-pool-random-selection — Field "Pool de X morceaux — N/session"
 * + input éditable pour ajuster default_session_size côté playlist.
 *
 * Auto-save au blur (consistant avec le name field au-dessus).
 */
function PoolSessionSizeField(props: {
  playlistId: string;
  poolSize: number;
  sessionSize: number;
  onUpdated: (size: number) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [value, setValue] = useState(String(props.sessionSize));
  const [saving, setSaving] = useState(false);

  const commit = async (): Promise<void> => {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n < 3 || n > 50) {
      setValue(String(props.sessionSize)); // reset visuel
      return;
    }
    if (n === props.sessionSize) return;
    setSaving(true);
    try {
      const updated = await updatePlaylist(props.playlistId, {
        default_session_size: n,
      } as Parameters<typeof updatePlaylist>[1]);
      const newSize = (updated as { default_session_size?: number }).default_session_size ?? n;
      props.onUpdated(newSize);
    } catch (err) {
      console.warn('[PoolSessionSizeField] update failed', err);
      setValue(String(props.sessionSize));
    } finally {
      setSaving(false);
    }
  };

  const effective = Math.min(props.poolSize, props.sessionSize);

  return (
    <div className="mt-4 pt-3 border-t border-ink/15 space-y-2">
      <p className="text-xs font-mono uppercase tracking-wider text-ink-soft">
        🎲 {t('playlists.poolSessionTitle')}
      </p>
      <p className="font-mono text-[11px] text-ink-soft leading-snug">
        {t('playlists.poolSessionHint', { pool: props.poolSize, n: effective })}
      </p>
      <label className="flex items-center gap-2 text-xs">
        <span className="font-mono text-ink-soft shrink-0">{t('playlists.poolSizeLabel')}</span>
        <input
          type="number"
          min={3}
          max={50}
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          disabled={saving}
          className="w-16 px-2 py-1 border-2 border-ink rounded bg-cream/30 text-sm font-mono focus:bg-white focus:outline-none focus:ring-2 focus:ring-spritz"
        />
      </label>
    </div>
  );
}
