/**
 * <AdvancedTrackSearch /> — Tab 1 : recherche track multi-source.
 * Spotify : artist + title + year range + decade chips (recherche structurée).
 * YouTube / Apple Music : query libre (leurs API ne supportent pas les filtres
 * structurés → endpoint générique /api/music/search?provider=youtube|apple_music).
 * Le provider choisi est écrit tel quel sur la track importée (étanchéité :
 * une track importée en apple_music jouera en apple_music, pas de mix).
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { MusicProviderId, TrackResult } from '@tutti/shared';
import { Input } from '../../../ui/index.js';
import { searchTracks as searchSpotify } from '../../../../lib/spotifyApi.js';
import { searchTracks as searchGeneric } from '../../../../lib/music.js';
import { getAppleMusicStatus } from '../../../../lib/appleMusic.js';
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
  apple_music: '🍎 Apple Music',
  demo: 'Démo',
};

export function AdvancedTrackSearch({ playlistId, onImported }: Props): JSX.Element {
  // Phase 3 — provider toggle filtré par les sources actives du workspace
  const { establishment } = useEstablishment();
  // feat/apple-music-search — la RECHERCHE catalogue Apple n'utilise que le
  // developer token (app-level) : pas besoin que le host ait connecté son
  // compte. On expose donc Apple dès que le backend est configuré (ou déjà
  // connecté), indépendamment de active_providers.
  const [appleAvailable, setAppleAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getAppleMusicStatus()
      .then((s) => {
        if (!cancelled) setAppleAvailable(s.configured || s.connected);
      })
      .catch(() => {
        if (!cancelled) setAppleAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const availableProviders = useMemo<MusicProviderId[]>(() => {
    const active = (establishment?.active_providers ?? ['spotify']) as MusicProviderId[];
    // Sources de recherche réelles : spotify, youtube (demo = pas une vraie
    // recherche, deezer = à venir).
    const list = active.filter((p): p is MusicProviderId => p === 'spotify' || p === 'youtube');
    // Apple Music : exposé dès que le backend est configuré (recherche =
    // developer token seul, la connexion host n'est requise que pour la lecture).
    if (appleAvailable && !list.includes('apple_music')) list.push('apple_music');
    return list;
  }, [establishment, appleAvailable]);
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
  // YouTube / Apple Music : query libre (artiste + titre concaténés, ou tape
  // ce que tu veux) — recherche catalogue plein texte.
  const [freeQuery, setFreeQuery] = useState('');
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

  const runFreeSearch = async (): Promise<void> => {
    const q = freeQuery.trim();
    if (q.length < 2) {
      setTracks([]);
      setHasNext(false);
      return;
    }
    // provider ∈ { youtube, apple_music } → endpoint générique, provider écrit
    // tel quel sur les TrackResult (donc sur la track importée : étanchéité).
    const res = await searchGeneric(q, { provider, limit: 25 });
    setTracks(res.results);
    setTotal(res.results.length);
    setHasNext(false); // YouTube / Apple : pas de pagination V1
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
        await runFreeSearch();
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
      if (!freeQuery.trim()) {
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
  }, [provider, artist, track, yearMin, yearMax, freeQuery]);

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
            label={provider === 'apple_music' ? 'Recherche Apple Music' : 'Recherche YouTube'}
            value={freeQuery}
            onChange={(e) => setFreeQuery(e.target.value)}
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
              : provider === 'apple_music'
                ? 'Tape une recherche Apple Music (artiste + titre).'
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
