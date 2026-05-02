/**
 * <SpotifyPlaylistsBrowser /> — wrapper qui affiche soit la grille de
 * playlists Spotify (mes / publiques), soit le panneau des tracks d'une
 * playlist sélectionnée. Utilisé par Tab 2 + Tab 3.
 *
 * Notes :
 *   - Spotify cap limit à 10 sur ce client (cf. SpotifyProvider). Pagination
 *     via offset += 10 par "Charger plus".
 *   - Playlists owner=spotify (éditoriales) ne sont plus accessibles via API
 *     depuis nov 2024 pour les apps en Development Mode → filtrées par
 *     défaut, peuvent être affichées via toggle.
 */

import { useEffect, useState } from 'react';
import type { TrackResult } from '@tutti/shared';
import {
  getMyPlaylists,
  getSpotifyPlaylistTracks,
  searchPlaylists,
  type SpotifyPlaylistSummary,
} from '../../../../lib/spotifyApi.js';
import { Badge, Button, Input } from '../../../ui/index.js';
import { TrackResultsList } from './TrackResultsList.js';

interface Props {
  mode: 'my' | 'public';
  playlistId: string;
  onImported: (count: number) => void;
}

const PAGE_SIZE = 10;
const TRACKS_PAGE_SIZE = 10;

export function SpotifyPlaylistsBrowser({ mode, playlistId, onImported }: Props): JSX.Element {
  const [query, setQuery] = useState('');
  const [playlists, setPlaylists] = useState<SpotifyPlaylistSummary[]>([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedPlaylist, setSelectedPlaylist] = useState<SpotifyPlaylistSummary | null>(null);
  const [tracks, setTracks] = useState<TrackResult[]>([]);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [tracksOffset, setTracksOffset] = useState(0);
  const [tracksTotal, setTracksTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tracksError, setTracksError] = useState<string | null>(null);
  const [showSpotifyOwned, setShowSpotifyOwned] = useState(false);

  const fetchPage = async (queryStr: string, off: number, append: boolean): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res =
        mode === 'my'
          ? await getMyPlaylists({ limit: PAGE_SIZE, offset: off })
          : await searchPlaylists({ q: queryStr, market: 'FR', limit: PAGE_SIZE, offset: off });
      setPlaylists((prev) => (append ? [...prev, ...res.items] : res.items));
      setTotal(res.total);
      setOffset(off);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Mode 'my' : load au mount
  useEffect(() => {
    if (mode !== 'my') return;
    void fetchPage('', 0, false);
    return () => {
      setPlaylists([]);
      setOffset(0);
      setTotal(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Mode 'public' : debounce 500ms
  useEffect(() => {
    if (mode !== 'public') return;
    if (!query.trim()) {
      setPlaylists([]);
      setOffset(0);
      setTotal(0);
      return;
    }
    const id = window.setTimeout(() => {
      void fetchPage(query.trim(), 0, false);
    }, 500);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, query]);

  const loadMore = (): void => {
    void fetchPage(query.trim(), offset + PAGE_SIZE, true);
  };

  const openPlaylist = async (p: SpotifyPlaylistSummary): Promise<void> => {
    setSelectedPlaylist(p);
    setTracks([]);
    setTracksOffset(0);
    setTracksTotal(0);
    setTracksLoading(true);
    setTracksError(null);
    try {
      const res = await getSpotifyPlaylistTracks(p.id, {
        limit: TRACKS_PAGE_SIZE,
        offset: 0,
        market: 'FR',
      });
      setTracks(res.items);
      setTracksTotal(res.total);
    } catch (err: unknown) {
      setTracksError((err as Error).message);
    } finally {
      setTracksLoading(false);
    }
  };

  const loadMoreTracks = async (): Promise<void> => {
    if (!selectedPlaylist || tracksLoading) return;
    setTracksLoading(true);
    try {
      const nextOffset = tracksOffset + TRACKS_PAGE_SIZE;
      const res = await getSpotifyPlaylistTracks(selectedPlaylist.id, {
        limit: TRACKS_PAGE_SIZE,
        offset: nextOffset,
        market: 'FR',
      });
      setTracks((prev) => [...prev, ...res.items]);
      setTracksOffset(nextOffset);
    } catch (err: unknown) {
      setTracksError((err as Error).message);
    } finally {
      setTracksLoading(false);
    }
  };

  const closePanel = (): void => {
    setSelectedPlaylist(null);
    setTracks([]);
    setTracksOffset(0);
    setTracksTotal(0);
    setTracksError(null);
  };

  // Vue tracks de la playlist sélectionnée
  if (selectedPlaylist) {
    const isForbidden =
      tracksError !== null &&
      (tracksError.toLowerCase().includes('forbidden') ||
        tracksError.toLowerCase().includes('éditoriale'));
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-3 p-3 border-2 border-ink rounded bg-cream">
          {selectedPlaylist.cover_url && (
            <img
              src={selectedPlaylist.cover_url}
              alt=""
              className="w-16 h-16 rounded border-2 border-ink object-cover shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="font-display text-lg leading-tight break-words">
              {selectedPlaylist.name}
            </p>
            <p className="font-mono text-xs text-ink-soft truncate">
              {selectedPlaylist.owner_name} · {selectedPlaylist.tracks_count} morceaux
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={closePanel}>
            ← Retour
          </Button>
        </div>
        {isForbidden && (
          <div className="p-3 border-2 border-raspberry rounded bg-raspberry/10">
            <p className="font-display text-base mb-1">🔒 Playlist éditoriale Spotify</p>
            <p className="text-sm text-ink-soft">
              Cette playlist a été créée par Spotify. Depuis novembre 2024, l'API Spotify ne permet
              plus l'accès à ces playlists pour les apps en Development Mode. Choisis une playlist
              créée par un utilisateur (badge <Badge tone="basil">Communauté</Badge>).
            </p>
          </div>
        )}
        {tracksError && !isForbidden && (
          <p role="alert" className="text-raspberry text-sm">
            {tracksError}
          </p>
        )}
        {!isForbidden && (
          <TrackResultsList
            tracks={tracks}
            loading={tracksLoading}
            emptyHint="Cette playlist n'a pas de tracks accessibles dans ta région."
            playlistId={playlistId}
            onImported={onImported}
            hasMore={tracks.length < tracksTotal}
            onLoadMore={() => void loadMoreTracks()}
          />
        )}
      </div>
    );
  }

  // Filtre par défaut : on cache les playlists owner=spotify (inaccessibles)
  const visiblePlaylists = showSpotifyOwned
    ? playlists
    : playlists.filter((p) => !p.is_spotify_owned);
  const hiddenCount = playlists.length - visiblePlaylists.length;

  // Vue grille de playlists
  return (
    <div className="space-y-3">
      {mode === 'public' && (
        <Input
          label="Cherche une playlist"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="années 80, hits 2010, rock français…"
          maxLength={100}
          autoFocus
        />
      )}

      {error && (
        <p role="alert" className="text-raspberry text-sm">
          {error}
        </p>
      )}

      {hiddenCount > 0 && (
        <label className="flex items-center gap-2 text-xs font-mono text-ink-soft">
          <input
            type="checkbox"
            checked={showSpotifyOwned}
            onChange={(e) => setShowSpotifyOwned(e.target.checked)}
            className="w-3.5 h-3.5 accent-ink"
          />
          <span>
            Inclure {hiddenCount} playlist{hiddenCount > 1 ? 's' : ''} éditoriale
            {hiddenCount > 1 ? 's' : ''} Spotify (inaccessibles via API)
          </span>
        </label>
      )}

      {loading && playlists.length === 0 && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-24 border-2 border-ink/20 rounded bg-cream-2/30 animate-pulse"
            />
          ))}
        </div>
      )}

      {!loading && playlists.length === 0 && (
        <p className="font-editorial italic text-sm text-ink-soft text-center py-12">
          {mode === 'my'
            ? 'Aucune playlist Spotify détectée sur ton compte.'
            : query
              ? "Aucune playlist trouvée. Essaye d'autres mots-clés."
              : 'Tape une recherche pour explorer les playlists publiques.'}
        </p>
      )}

      {visiblePlaylists.length > 0 && (
        <ul className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
          {visiblePlaylists.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => void openPlaylist(p)}
                className="w-full flex items-start gap-3 p-3 border-2 border-ink rounded bg-cream hover:bg-cream-2 active:translate-y-0.5 transition-transform text-left"
              >
                {p.cover_url ? (
                  <img
                    src={p.cover_url}
                    alt=""
                    loading="lazy"
                    className="w-16 h-16 rounded border-2 border-ink object-cover shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 rounded border-2 border-ink bg-cream-2 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-0.5">
                    <p className="font-medium text-sm leading-tight break-words line-clamp-2">
                      {p.name}
                    </p>
                    {p.is_spotify_owned ? (
                      <Badge tone="plum" tilt={1}>
                        Officielle
                      </Badge>
                    ) : (
                      <Badge tone="basil" tilt={-1}>
                        Communauté
                      </Badge>
                    )}
                  </div>
                  <p className="font-mono text-[11px] text-ink-soft truncate">
                    {p.owner_name} · {p.tracks_count} morceaux
                    {p.followers_count !== null && p.followers_count > 0 && (
                      <> · {p.followers_count.toLocaleString('fr-FR')} ♥</>
                    )}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {playlists.length < total && (
        <div className="flex justify-center">
          <Button variant="ghost" size="sm" onClick={loadMore} disabled={loading}>
            {loading ? 'Chargement…' : `↓ Charger plus (${total - playlists.length} restantes)`}
          </Button>
        </div>
      )}
    </div>
  );
}
