/**
 * <SpotifyPlaylistsBrowser /> — wrapper qui affiche soit la grille de
 * playlists Spotify (mes / publiques), soit le panneau des tracks d'une
 * playlist sélectionnée. Utilisé par Tab 2 + Tab 3.
 */

import { useEffect, useState } from 'react';
import type { TrackResult } from '@tutti/shared';
import {
  getMyPlaylists,
  getSpotifyPlaylistTracks,
  searchPlaylists,
  type SpotifyPlaylistSummary,
} from '../../../../lib/spotifyApi.js';
import { Button, Input } from '../../../ui/index.js';
import { TrackResultsList } from './TrackResultsList.js';

interface Props {
  mode: 'my' | 'public';
  playlistId: string;
  onImported: (count: number) => void;
}

const PAGE_SIZE = 20;
const TRACKS_PAGE_SIZE = 50;

export function SpotifyPlaylistsBrowser({ mode, playlistId, onImported }: Props): JSX.Element {
  const [query, setQuery] = useState('');
  const [playlists, setPlaylists] = useState<SpotifyPlaylistSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedPlaylist, setSelectedPlaylist] = useState<SpotifyPlaylistSummary | null>(null);
  const [tracks, setTracks] = useState<TrackResult[]>([]);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [tracksOffset, setTracksOffset] = useState(0);
  const [tracksTotal, setTracksTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Mode 'my' : load au mount.
  useEffect(() => {
    if (mode !== 'my') return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getMyPlaylists({ limit: PAGE_SIZE, offset: 0 })
      .then((res) => {
        if (cancelled) return;
        setPlaylists(res.items);
        setTotal(res.total);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  // Mode 'public' : recherche avec debounce 500ms
  useEffect(() => {
    if (mode !== 'public') return;
    if (!query.trim()) {
      setPlaylists([]);
      setTotal(0);
      return;
    }
    let cancelled = false;
    const id = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void searchPlaylists({ q: query.trim(), market: 'FR', limit: PAGE_SIZE, offset: 0 })
        .then((res) => {
          if (cancelled) return;
          setPlaylists(res.items);
          setTotal(res.total);
        })
        .catch((err: unknown) => {
          if (!cancelled) setError((err as Error).message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 500);
    return () => {
      window.clearTimeout(id);
      cancelled = true;
    };
  }, [mode, query]);

  const openPlaylist = async (p: SpotifyPlaylistSummary): Promise<void> => {
    setSelectedPlaylist(p);
    setTracks([]);
    setTracksOffset(0);
    setTracksTotal(0);
    setTracksLoading(true);
    setError(null);
    try {
      const res = await getSpotifyPlaylistTracks(p.id, {
        limit: TRACKS_PAGE_SIZE,
        offset: 0,
        market: 'FR',
      });
      setTracks(res.items);
      setTracksTotal(res.total);
    } catch (err: unknown) {
      setError((err as Error).message);
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
      setError((err as Error).message);
    } finally {
      setTracksLoading(false);
    }
  };

  const closePanel = (): void => {
    setSelectedPlaylist(null);
    setTracks([]);
    setTracksOffset(0);
    setTracksTotal(0);
  };

  // Vue tracks de la playlist sélectionnée
  if (selectedPlaylist) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-3 p-3 border-2 border-ink rounded bg-cream">
          {selectedPlaylist.cover_url && (
            <img
              src={selectedPlaylist.cover_url}
              alt=""
              className="w-16 h-16 rounded border-2 border-ink object-cover"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="font-display text-lg truncate">{selectedPlaylist.name}</p>
            <p className="font-mono text-xs text-ink-soft truncate">
              {selectedPlaylist.owner_name} · {selectedPlaylist.tracks_count} morceaux
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={closePanel}>
            ← Retour
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-raspberry text-sm">
            {error}
          </p>
        )}
        <TrackResultsList
          tracks={tracks}
          loading={tracksLoading}
          emptyHint="Cette playlist n'a pas de tracks accessibles dans ta région."
          playlistId={playlistId}
          onImported={onImported}
          hasMore={tracks.length < tracksTotal}
          onLoadMore={() => void loadMoreTracks()}
        />
      </div>
    );
  }

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

      {loading && playlists.length === 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-20 border-2 border-ink/20 rounded bg-cream-2/30 animate-pulse"
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

      {playlists.length > 0 && (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[60vh] overflow-y-auto pr-1">
          {playlists.map((p) => (
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
                    className="w-14 h-14 rounded border-2 border-ink object-cover shrink-0"
                  />
                ) : (
                  <div className="w-14 h-14 rounded border-2 border-ink bg-cream-2 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{p.name}</p>
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

      {playlists.length > 0 && total > playlists.length && (
        <p className="text-xs text-ink-soft text-center font-mono">
          Affichage {playlists.length} sur {total} (filtre tes mots-clés pour affiner)
        </p>
      )}
    </div>
  );
}
