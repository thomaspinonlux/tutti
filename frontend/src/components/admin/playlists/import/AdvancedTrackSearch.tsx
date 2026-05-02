/**
 * <AdvancedTrackSearch /> — Tab 1 : recherche track multi-critères Spotify.
 * Champs : artist, track, year range (slider double), decade chips.
 */

import { useEffect, useState, type FormEvent } from 'react';
import type { TrackResult } from '@tutti/shared';
import { Input } from '../../../ui/index.js';
import { searchTracks } from '../../../../lib/spotifyApi.js';
import { TrackResultsList } from './TrackResultsList.js';

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

export function AdvancedTrackSearch({ playlistId, onImported }: Props): JSX.Element {
  const [artist, setArtist] = useState('');
  const [track, setTrack] = useState('');
  const [yearMin, setYearMin] = useState<number | ''>('');
  const [yearMax, setYearMax] = useState<number | ''>('');
  const [tracks, setTracks] = useState<TrackResult[]>([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const pickDecade = (min: number, max: number): void => {
    setYearMin(min);
    setYearMax(max);
  };

  const submit = async (e?: FormEvent): Promise<void> => {
    e?.preventDefault();
    if (!artist.trim() && !track.trim() && !yearMin && !yearMax) return;
    setLoading(true);
    setError(null);
    setOffset(0);
    try {
      const res = await searchTracks({
        artist: artist.trim() || undefined,
        track: track.trim() || undefined,
        year_min: yearMin === '' ? undefined : yearMin,
        year_max: yearMax === '' ? undefined : yearMax,
        market: 'FR',
        limit: PAGE_SIZE,
        offset: 0,
      });
      setTracks(res.items);
      setTotal(res.total);
      setHasSearched(true);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async (): Promise<void> => {
    if (loading) return;
    setLoading(true);
    try {
      const nextOffset = offset + PAGE_SIZE;
      const res = await searchTracks({
        artist: artist.trim() || undefined,
        track: track.trim() || undefined,
        year_min: yearMin === '' ? undefined : yearMin,
        year_max: yearMax === '' ? undefined : yearMax,
        market: 'FR',
        limit: PAGE_SIZE,
        offset: nextOffset,
      });
      setTracks((prev) => [...prev, ...res.items]);
      setOffset(nextOffset);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Debounce auto-search 500ms si critères non vides
  useEffect(() => {
    if (!artist && !track && !yearMin && !yearMax) {
      setTracks([]);
      setHasSearched(false);
      return;
    }
    const id = window.setTimeout(() => {
      void submit();
    }, 500);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artist, track, yearMin, yearMax]);

  return (
    <div className="space-y-3">
      <form onSubmit={(e) => void submit(e)} className="space-y-2">
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
      </form>

      {error && (
        <p role="alert" className="text-raspberry text-sm">
          {error}
        </p>
      )}

      {hasSearched && total > 0 && (
        <p className="font-mono text-xs text-ink-soft">
          {tracks.length === total
            ? `${total} résultat${total > 1 ? 's' : ''} (Spotify)`
            : `${tracks.length} sur ${total} chargés (Spotify)`}
        </p>
      )}

      <TrackResultsList
        tracks={tracks}
        loading={loading}
        emptyHint={
          hasSearched
            ? 'Aucun morceau trouvé. Essaye de simplifier les critères.'
            : 'Renseigne au moins un critère pour lancer la recherche.'
        }
        playlistId={playlistId}
        onImported={onImported}
        hasMore={tracks.length < total}
        onLoadMore={() => void loadMore()}
      />
    </div>
  );
}
