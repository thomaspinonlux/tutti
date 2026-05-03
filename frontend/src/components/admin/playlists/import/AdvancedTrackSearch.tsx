/**
 * <AdvancedTrackSearch /> — Tab 1 : recherche track multi-source.
 * Spotify : artist + title + year range + decade chips (recherche structurée).
 * YouTube : query libre (l'API ne supporte pas les filtres structurés —
 * on bascule sur l'endpoint générique /api/music/search?provider=youtube).
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { MusicProviderId, TrackResult } from '@tutti/shared';
import { Input } from '../../../ui/index.js';
import { searchTracks as searchSpotify } from '../../../../lib/spotifyApi.js';
import { searchTracks as searchGeneric } from '../../../../lib/music.js';
import { TrackResultsList } from './TrackResultsList.js';
import { useEstablishment } from '../../../../pages/admin/AdminLayout.js';

interface Props {
  playlistId: string;
  onImported: (count: number) => void;
}

const DECADES = [
  { label: '60s', min: 1960, max: 1969 },
  { label: '70s', min: 1970, max: 1979 },
  { label: '80s', min: 1980, max: 1989 },
  { label: '90s', min: 1990, max: 1999 },
  { label: '2000s', min: 2000, max: 2009 },
  { label: '2010s', min: 2010, max: 2019 },
  { label: '2020s', min: 2020, max: 2029 },
];

// Spotify rejette limit > 10 sur ce client (400 "Invalid limit"). Cap dur.
const PAGE_SIZE = 10;

const PROVIDER_LABELS: Record<string, string> = {
  spotify: 'Spotify',
  youtube: 'YouTube',
  demo: 'Démo',
};

export function AdvancedTrackSearch({ playlistId, onImported }: Props): JSX.Element {
  // Phase 3 — provider toggle filtré par les sources actives du workspace
  const { establishment } = useEstablishment();
  const availableProviders = useMemo<MusicProviderId[]>(() => {
    const active = (establishment?.active_providers ?? ['spotify']) as MusicProviderId[];
    // On ne propose que spotify et youtube dans le toggle (demo n'est pas
    // une vraie source de recherche, deezer/apple_music = à venir)
    return active.filter((p): p is MusicProviderId => p === 'spotify' || p === 'youtube');
  }, [establishment]);
  const [provider, setProvider] = useState<MusicProviderId>(availableProviders[0] ?? 'spotify');

  // Si la liste des providers actifs change (ex: l'utilisateur active YouTube
  // dans Settings et revient sur cette page), aligne le provider courant.
  useEffect(() => {
    if (availableProviders.length > 0 && !availableProviders.includes(provider)) {
      setProvider(availableProviders[0]!);
    }
  }, [availableProviders, provider]);
  const [artist, setArtist] = useState('');
  const [track, setTrack] = useState('');
  const [yearMin, setYearMin] = useState<number | ''>('');
  const [yearMax, setYearMax] = useState<number | ''>('');
  // YouTube : query libre (artist + title concaténés, ou tape ce que tu veux)
  const [youtubeQuery, setYoutubeQuery] = useState('');
  const [tracks, setTracks] = useState<TrackResult[]>([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const pickDecade = (min: number, max: number): void => {
    setYearMin(min);
    setYearMax(max);
  };

  const runSpotify = async (nextOffset: number, append: boolean): Promise<void> => {
    const res = await searchSpotify({
      artist: artist.trim() || undefined,
      track: track.trim() || undefined,
      year_min: yearMin === '' ? undefined : yearMin,
      year_max: yearMax === '' ? undefined : yearMax,
      market: 'FR',
      limit: PAGE_SIZE,
      offset: nextOffset,
    });
    setTracks((prev) => (append ? [...prev, ...res.items] : res.items));
    setTotal(res.total);
    setHasNext(res.next !== null || res.items.length === PAGE_SIZE);
    setOffset(nextOffset);
  };

  const runYouTube = async (): Promise<void> => {
    const q = youtubeQuery.trim();
    if (q.length < 2) {
      setTracks([]);
      setHasNext(false);
      return;
    }
    const res = await searchGeneric(q, { provider: 'youtube', limit: 25 });
    setTracks(res.results);
    setTotal(res.results.length);
    setHasNext(false); // YouTube : pas de pagination V1
    setOffset(0);
  };

  const submit = async (e?: FormEvent): Promise<void> => {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (provider === 'spotify') {
        if (!artist.trim() && !track.trim() && !yearMin && !yearMax) {
          setLoading(false);
          return;
        }
        await runSpotify(0, false);
      } else {
        await runYouTube();
      }
      setHasSearched(true);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async (): Promise<void> => {
    if (loading || provider !== 'spotify') return;
    setLoading(true);
    try {
      await runSpotify(offset + PAGE_SIZE, true);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Debounce auto-search 500ms
  useEffect(() => {
    if (provider === 'spotify') {
      if (!artist && !track && !yearMin && !yearMax) {
        setTracks([]);
        setHasSearched(false);
        return;
      }
    } else {
      if (!youtubeQuery.trim()) {
        setTracks([]);
        setHasSearched(false);
        return;
      }
    }
    const id = window.setTimeout(() => {
      void submit();
    }, 500);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, artist, track, yearMin, yearMax, youtubeQuery]);

  // Reset résultats quand on change de provider
  useEffect(() => {
    setTracks([]);
    setHasSearched(false);
    setError(null);
    setOffset(0);
    setTotal(0);
    setHasNext(false);
  }, [provider]);

  return (
    <div className="space-y-3">
      {/* ── Toggle provider — visible uniquement si ≥2 sources actives ── */}
      {availableProviders.length >= 2 && (
        <div className="flex gap-2" role="tablist" aria-label="Source musique">
          {availableProviders.map((p) => {
            const selected = provider === p;
            return (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setProvider(p)}
                className={`px-3 py-1.5 border-2 border-ink rounded font-mono text-xs uppercase tracking-wider transition-colors ${
                  selected ? 'bg-spritz-deep text-cream' : 'bg-cream-2 text-ink hover:bg-cream-3'
                }`}
              >
                {PROVIDER_LABELS[p] ?? p}
              </button>
            );
          })}
        </div>
      )}

      <form onSubmit={(e) => void submit(e)} className="space-y-2">
        {provider === 'spotify' ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <Input
                label="Artiste"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                placeholder="Stromae"
                maxLength={100}
              />
              <Input
                label="Titre"
                value={track}
                onChange={(e) => setTrack(e.target.value)}
                placeholder="Alors on danse"
                maxLength={200}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                label="Année min"
                type="number"
                min={1900}
                max={2100}
                value={yearMin}
                onChange={(e) => setYearMin(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="1990"
              />
              <Input
                label="Année max"
                type="number"
                min={1900}
                max={2100}
                value={yearMax}
                onChange={(e) => setYearMax(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="1999"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DECADES.map((d) => {
                const active = yearMin === d.min && yearMax === d.max;
                return (
                  <button
                    key={d.label}
                    type="button"
                    onClick={() => pickDecade(d.min, d.max)}
                    aria-pressed={active}
                    className={`px-3 py-1 border-2 border-ink rounded text-xs font-mono uppercase transition-colors ${
                      active ? 'bg-ink text-cream' : 'bg-cream hover:bg-cream-2'
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <Input
            label="Recherche YouTube"
            value={youtubeQuery}
            onChange={(e) => setYoutubeQuery(e.target.value)}
            placeholder="Ex : Stromae Alors on danse"
            maxLength={200}
          />
        )}
      </form>

      {error && (
        <p role="alert" className="text-raspberry text-sm">
          {error}
        </p>
      )}

      {hasSearched && tracks.length > 0 && (
        <p className="font-mono text-xs text-ink-soft">
          {tracks.length} chargé{tracks.length > 1 ? 's' : ''}
          {provider === 'spotify' && total > tracks.length ? ` sur ${total} estimés` : ''}
          {hasNext ? ' · plus disponibles ↓' : ''}
        </p>
      )}

      <TrackResultsList
        tracks={tracks}
        loading={loading}
        emptyHint={
          hasSearched
            ? 'Aucun morceau trouvé. Essaye de simplifier les critères.'
            : provider === 'spotify'
              ? 'Renseigne au moins un critère pour lancer la recherche.'
              : 'Tape une recherche YouTube (artiste + titre).'
        }
        playlistId={playlistId}
        onImported={onImported}
        hasMore={hasNext}
        onLoadMore={() => void loadMore()}
      />
    </div>
  );
}
