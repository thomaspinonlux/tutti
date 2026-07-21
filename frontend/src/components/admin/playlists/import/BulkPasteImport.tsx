/**
 * <BulkPasteImport /> — Tab « Coller une liste ».
 *
 * L'utilisateur colle une liste de titres (un par ligne, ex. « Stromae - Alors
 * on danse »). On cherche chaque ligne via /api/music/search (Spotify OU
 * YouTube) et on récupère la meilleure correspondance, puis on importe tout
 * d'un coup dans la playlist.
 *
 * Contourne totalement la restriction Spotify sur la LECTURE des playlists
 * d'autres utilisateurs (403) : ici on ne lit aucune playlist, on fait des
 * RECHERCHES de titres (autorisées en Development Mode).
 */

import { useEffect, useMemo, useState } from 'react';
import type { MusicProviderId, TrackResult } from '@tutti/shared';
import { Button } from '../../../ui/index.js';
import { searchTracks as searchGeneric } from '../../../../lib/music.js';
import { importTracks } from '../../../../lib/spotifyApi.js';
import { useEstablishment } from '../../../../pages/admin/AdminLayout.js';

interface Props {
  playlistId: string;
  onImported: (count: number) => void;
}

const PROVIDER_LABELS: Record<string, string> = {
  spotify: 'Spotify',
  youtube: 'YouTube',
};

const MAX_LINES = 300;
const CONCURRENCY = 4; // recherches en parallèle par lot (gentil pour l'API)

interface LineResult {
  query: string;
  track: TrackResult | null;
}

export function BulkPasteImport({ playlistId, onImported }: Props): JSX.Element {
  const { establishment } = useEstablishment();
  const availableProviders = useMemo<MusicProviderId[]>(() => {
    const active = (establishment?.active_providers ?? ['spotify']) as MusicProviderId[];
    return active.filter((p): p is MusicProviderId => p === 'spotify' || p === 'youtube');
  }, [establishment]);
  const [provider, setProvider] = useState<MusicProviderId>(availableProviders[0] ?? 'spotify');
  useEffect(() => {
    if (availableProviders.length > 0 && !availableProviders.includes(provider)) {
      setProvider(availableProviders[0]!);
    }
  }, [availableProviders, provider]);

  const [text, setText] = useState('');
  const [results, setResults] = useState<LineResult[] | null>(null);
  const [included, setIncluded] = useState<Set<number>>(new Set());
  const [matching, setMatching] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);

  const parseLines = (raw: string): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const line of raw.split('\n')) {
      const q = line.trim().replace(/\s+/g, ' ');
      if (!q) continue;
      const key = q.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(q);
      if (out.length >= MAX_LINES) break;
    }
    return out;
  };

  const runMatching = async (): Promise<void> => {
    const lines = parseLines(text);
    if (lines.length === 0) {
      setError('Colle au moins un titre (un par ligne).');
      return;
    }
    setError(null);
    setImportedCount(null);
    setMatching(true);
    setResults(null);
    setProgress({ done: 0, total: lines.length });

    const out: LineResult[] = new Array(lines.length);
    let done = 0;
    // Traite par lots de CONCURRENCY pour aller vite sans marteler l'API.
    for (let i = 0; i < lines.length; i += CONCURRENCY) {
      const batch = lines.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (query, j) => {
          const idx = i + j;
          try {
            const res = await searchGeneric(query, { provider, limit: 3 });
            out[idx] = { query, track: res.results[0] ?? null };
          } catch {
            out[idx] = { query, track: null };
          } finally {
            done += 1;
            setProgress({ done, total: lines.length });
          }
        }),
      );
    }
    setResults(out);
    // Par défaut : tout ce qui a matché est coché.
    setIncluded(new Set(out.map((r, i) => (r.track ? i : -1)).filter((i) => i >= 0)));
    setMatching(false);
  };

  const toggle = (i: number): void => {
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const runImport = async (): Promise<void> => {
    if (!results) return;
    const ids = Array.from(
      new Set(
        results
          .map((r, i) => (r.track && included.has(i) ? r.track.provider_track_id : null))
          .filter((id): id is string => id !== null),
      ),
    );
    if (ids.length === 0) {
      setError('Aucun morceau sélectionné à importer.');
      return;
    }
    setError(null);
    setImporting(true);
    try {
      // provider est toujours 'spotify' | 'youtube' (availableProviders filtre).
      const res = await importTracks(playlistId, provider as 'spotify' | 'youtube', ids);
      setImportedCount(res.imported);
      onImported(res.imported);
      // On garde la liste affichée mais on vide la sélection importée.
      setResults(null);
      setIncluded(new Set());
      setText('');
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const matchedCount = results ? results.filter((r) => r.track).length : 0;
  const noMatch = results ? results.filter((r) => !r.track) : [];
  const selectedCount = results ? results.filter((r, i) => r.track && included.has(i)).length : 0;

  return (
    <div className="space-y-3">
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

      <div>
        <label className="block text-xs font-mono uppercase tracking-wider text-ink-soft mb-1">
          Colle tes titres (un par ligne)
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={'Stromae - Alors on danse\nDaft Punk - One More Time\nZaz - Je veux\n…'}
          className="w-full text-sm border-2 border-ink/20 rounded px-3 py-2 bg-white font-mono resize-y focus:border-ink outline-none"
        />
        <p className="font-mono text-[11px] text-ink-soft mt-1">
          Format libre : « Artiste - Titre » marche le mieux. Max {MAX_LINES} lignes · doublons
          ignorés.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void runMatching()}
          disabled={matching || importing || !text.trim()}
        >
          {matching ? '⏳ Recherche…' : '🔎 Chercher les correspondances'}
        </Button>
        {matching && progress && (
          <span className="font-mono text-xs text-ink-soft tabular-nums">
            {progress.done} / {progress.total}
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="text-raspberry text-sm">
          {error}
        </p>
      )}

      {importedCount !== null && (
        <p className="text-basil-deep text-sm font-medium">
          ✓ {importedCount} morceau{importedCount > 1 ? 'x' : ''} importé
          {importedCount > 1 ? 's' : ''} dans la playlist.
        </p>
      )}

      {results && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="font-mono text-xs text-ink-soft">
              {matchedCount} trouvé{matchedCount > 1 ? 's' : ''} sur {results.length} ·{' '}
              {noMatch.length} sans correspondance
            </p>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void runImport()}
              disabled={importing || selectedCount === 0}
            >
              {importing
                ? '⏳ Import…'
                : `➕ Importer ${selectedCount} morceau${selectedCount > 1 ? 'x' : ''}`}
            </Button>
          </div>

          {matchedCount > 0 && (
            <ul className="space-y-1.5 max-h-[45vh] overflow-y-auto pr-1">
              {results.map((r, i) =>
                r.track ? (
                  <li key={i}>
                    <label className="flex items-center gap-2 p-2 border-2 border-ink/15 rounded bg-cream cursor-pointer hover:bg-cream-2">
                      <input
                        type="checkbox"
                        checked={included.has(i)}
                        onChange={() => toggle(i)}
                        className="w-4 h-4 accent-ink shrink-0"
                      />
                      {r.track.cover_url ? (
                        <img
                          src={r.track.cover_url}
                          alt=""
                          loading="lazy"
                          className="w-9 h-9 rounded border border-ink/20 object-cover shrink-0"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded border border-ink/20 bg-cream-2 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{r.track.title}</p>
                        <p className="font-mono text-[11px] text-ink-soft truncate">
                          {r.track.artist}
                          {r.track.year ? ` · ${r.track.year}` : ''}
                        </p>
                      </div>
                      <span
                        className="font-mono text-[10px] text-ink-faded truncate max-w-[35%] hidden sm:block"
                        title={`recherché : ${r.query}`}
                      >
                        ↩ {r.query}
                      </span>
                    </label>
                  </li>
                ) : null,
              )}
            </ul>
          )}

          {noMatch.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer font-mono text-xs text-raspberry-deep">
                ⚠ {noMatch.length} titre{noMatch.length > 1 ? 's' : ''} non trouvé
                {noMatch.length > 1 ? 's' : ''} (clique pour voir)
              </summary>
              <ul className="mt-2 space-y-0.5 font-mono text-[11px] text-ink-soft">
                {noMatch.map((r, i) => (
                  <li key={i} className="truncate">
                    · {r.query}
                  </li>
                ))}
              </ul>
              <p className="font-mono text-[11px] text-ink-faded mt-1">
                Astuce : reformule ces lignes (« Artiste - Titre ») et relance la recherche.
              </p>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
