/**
 * <TrackResultsList /> — liste des résultats Spotify (search ou playlist)
 * avec checkboxes individuelles, "Tout sélectionner/désélectionner",
 * filtres transverses, et action "Importer".
 *
 * Utilisée par les 3 modes (search-tracks / my-playlists / public-playlists).
 */

import { useEffect, useMemo, useState } from 'react';
import type { TrackResult } from '@tutti/shared';
import { Button, Card } from '../../../ui/index.js';
import {
  computeTrackFlags,
  DEFAULT_FILTER_OPTIONS,
  isPreSelected,
  type FilterOptions,
  type TrackFlags,
} from '../../../../lib/trackFilters.js';
import { checkDuplicates, importTracks } from '../../../../lib/spotifyApi.js';
import type { DuplicateCheckResult } from '../../../../lib/spotifyApi.js';
import { ImportFiltersBar } from './ImportFiltersBar.js';
import { TrackRowWithCheckbox } from './TrackRowWithCheckbox.js';

interface Props {
  tracks: TrackResult[];
  loading: boolean;
  emptyHint: string;
  playlistId: string;
  onImported: (count: number) => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
}

export function TrackResultsList({
  tracks,
  loading,
  emptyHint,
  playlistId,
  onImported,
  hasMore = false,
  onLoadMore,
}: Props): JSX.Element {
  const [filterOptions, setFilterOptions] = useState<FilterOptions>(DEFAULT_FILTER_OPTIONS);
  const [duplicates, setDuplicates] = useState<Map<string, DuplicateCheckResult>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importedToast, setImportedToast] = useState<string | null>(null);

  // Re-check duplicates quand la liste change (debounced via dépendance simple)
  useEffect(() => {
    if (tracks.length === 0) {
      setDuplicates(new Map());
      return;
    }
    let cancelled = false;
    void checkDuplicates(
      tracks.map((t) => ({
        provider_track_id: t.provider_track_id,
        artist: t.artist,
        title: t.title,
      })),
    )
      .then((res) => {
        if (cancelled) return;
        const map = new Map<string, DuplicateCheckResult>();
        res.results.forEach((r) => {
          if (r.provider_track_id) map.set(r.provider_track_id, r);
        });
        setDuplicates(map);
      })
      .catch(() => {
        if (!cancelled) setDuplicates(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [tracks]);

  // Calcule flags + pre-sélection à chaque changement
  const flagsMap = useMemo(() => {
    const m = new Map<string, TrackFlags>();
    tracks.forEach((t) => {
      const dup = duplicates.get(t.provider_track_id) ?? null;
      m.set(t.provider_track_id, computeTrackFlags(t, dup, filterOptions));
    });
    return m;
  }, [tracks, duplicates, filterOptions]);

  // Reset sélection quand tracks ou filterOptions changent (pré-sélectionne
  // automatiquement les tracks qui passent les filtres).
  useEffect(() => {
    const next = new Set<string>();
    tracks.forEach((t) => {
      const flags = flagsMap.get(t.provider_track_id);
      if (flags && isPreSelected(flags, filterOptions)) {
        next.add(t.provider_track_id);
      }
    });
    setSelected(next);
  }, [tracks, flagsMap, filterOptions]);

  const toggleOne = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = (): void => {
    setSelected(new Set(tracks.map((t) => t.provider_track_id)));
  };
  const selectNone = (): void => setSelected(new Set());

  const handleImport = async (): Promise<void> => {
    if (selected.size === 0) return;
    setImporting(true);
    setError(null);
    try {
      const selectedTracks = tracks.filter((t) => selected.has(t.provider_track_id));
      // Phase 3 — multi-source : groupe par provider et fait un call par groupe
      // (le backend exige un provider unique par requête /import-tracks).
      const byProvider = new Map<string, string[]>();
      for (const t of selectedTracks) {
        const key = t.provider;
        const list = byProvider.get(key) ?? [];
        list.push(t.provider_track_id);
        byProvider.set(key, list);
      }
      let totalImported = 0;
      let totalSkipped = 0;
      for (const [provider, ids] of byProvider.entries()) {
        const res = await importTracks(playlistId, provider as 'spotify' | 'youtube' | 'demo', ids);
        totalImported += res.imported;
        totalSkipped += res.skipped;
      }
      onImported(totalImported);
      setImportedToast(
        `✓ ${totalImported} morceau${totalImported > 1 ? 'x' : ''} importé${totalImported > 1 ? 's' : ''}` +
          (totalSkipped > 0 ? ` · ${totalSkipped} déjà présents` : ''),
      );
      window.setTimeout(() => setImportedToast(null), 3000);
      // Décoche les imports pour éviter double-click
      setSelected(new Set());
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-3">
      <ImportFiltersBar options={filterOptions} onChange={setFilterOptions} />

      {tracks.length > 0 && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={selectAll}>
              Tout sélectionner
            </Button>
            <Button variant="ghost" size="sm" onClick={selectNone}>
              Tout désélectionner
            </Button>
          </div>
          <span className="font-mono text-xs text-ink-soft">
            {selected.size} / {tracks.length} sélectionnés
          </span>
        </div>
      )}

      {loading && tracks.length === 0 && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-14 border-2 border-ink/20 rounded bg-cream-2/30 animate-pulse"
            />
          ))}
        </div>
      )}

      {!loading && tracks.length === 0 && (
        <p className="font-editorial italic text-sm text-ink-soft text-center py-12">{emptyHint}</p>
      )}

      {tracks.length > 0 && (
        <ul className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
          {tracks.map((t) => {
            const flags = flagsMap.get(t.provider_track_id) ?? {
              isRemix: false,
              outsideDurationRange: false,
              isDuplicate: false,
              duplicatePlaylistName: null,
            };
            return (
              <TrackRowWithCheckbox
                key={t.provider_track_id}
                track={t}
                flags={flags}
                selected={selected.has(t.provider_track_id)}
                onToggle={() => toggleOne(t.provider_track_id)}
              />
            );
          })}
        </ul>
      )}

      {hasMore && onLoadMore && (
        <div className="flex justify-center">
          <Button variant="ghost" size="sm" onClick={onLoadMore} disabled={loading}>
            {loading ? 'Chargement…' : '↓ Charger plus'}
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-raspberry text-sm">
          {error}
        </p>
      )}

      {importedToast && (
        <Card tone="basil" size="sm" className="text-center animate-fade-in">
          <p className="font-display text-lg">{importedToast}</p>
        </Card>
      )}

      {tracks.length > 0 && (
        <div className="sticky bottom-0 bg-cream pt-2 border-t-2 border-ink/10">
          <Button
            onClick={() => void handleImport()}
            disabled={selected.size === 0 || importing}
            className="w-full"
          >
            {importing
              ? 'Import en cours…'
              : `+ Importer ${selected.size} morceau${selected.size > 1 ? 'x' : ''}`}
          </Button>
        </div>
      )}
    </div>
  );
}
