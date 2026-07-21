/**
 * <BulkPasteImport /> — Tab « Coller une liste ».
 *
 * On colle (ou on importe un fichier Excel/CSV/PDF) une liste de titres, un par
 * ligne. Chaque ligne est cherchée (Spotify OU YouTube), la meilleure
 * correspondance est proposée, puis on importe tout d'un coup.
 *
 * Contourne la restriction Spotify sur la LECTURE des playlists d'autres
 * utilisateurs (403) : ici on ne lit aucune playlist, on fait des RECHERCHES.
 *
 * Économie de quota (les providers ont des limites strictes) :
 *   - Résultats CACHÉS par ligne : relancer « Chercher » ne re-cherche que les
 *     lignes pas encore résolues (aucune requête gaspillée).
 *   - Débit limité (concurrence 2 + pause) pour ne pas déclencher le 429.
 *   - Détection explicite des limites : Spotify 429 (rate limit, temporaire) et
 *     YouTube quota épuisé → message clair + arrêt propre (au lieu d'un faux
 *     « non trouvé » silencieux).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MusicProviderId, TrackResult } from '@tutti/shared';
import { Button } from '../../../ui/index.js';
import { searchTracks as searchGeneric } from '../../../../lib/music.js';
import { importTracks, searchTracks as searchSpotify } from '../../../../lib/spotifyApi.js';
import { parseTrackListFile } from '../../../../lib/trackListFile.js';
import { useEstablishment } from '../../../../pages/admin/AdminLayout.js';

interface Props {
  playlistId: string;
  onImported: (count: number) => void;
}

const PROVIDER_LABELS: Record<string, string> = { spotify: 'Spotify', youtube: 'YouTube' };
const MAX_LINES = 300;
const CONCURRENCY = 2; // doux pour ne pas déclencher les rate limits
const PACE_MS = 200; // petite pause entre requêtes d'un même worker

const sleep = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));

/** Détecte une erreur de LIMITE (quota/rate) et renvoie un message clair, ou
 *  null si c'est une erreur ponctuelle (à traiter comme « non trouvé »). */
function classifyLimit(provider: MusicProviderId, rawMsg: string): string | null {
  const m = rawMsg.toLowerCase();
  if (m.includes('429') || m.includes('rate limit') || m.includes('too many')) {
    return "Spotify t'a temporairement limité (trop de recherches d'affilée). La limite se lève toute seule en ~15 min — relance ensuite par petits lots (20-30 titres).";
  }
  if (
    provider === 'youtube' &&
    (m.includes('quota') ||
      m.includes('requête music') ||
      m.includes('403') ||
      m.includes('indisponible'))
  ) {
    return 'YouTube indisponible — quota du jour probablement épuisé (≈100 recherches/jour). Il se réinitialise chaque nuit (~9h, heure FR). Utilise Spotify en attendant.';
  }
  return null;
}

function parseLines(raw: string): string[] {
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
  // Cache des résultats par ligne (clé = requête). null = cherché, sans match.
  const [resultMap, setResultMap] = useState<Record<string, TrackResult | null>>({});
  // Lignes matchées que l'utilisateur a décochées (clé = requête).
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [matching, setMatching] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [limitHit, setLimitHit] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Changer de provider invalide le cache (résultats spécifiques au provider).
  useEffect(() => {
    setResultMap({});
    setExcluded(new Set());
    setLimitHit(null);
    setImportedCount(null);
  }, [provider]);

  const lines = useMemo(() => parseLines(text), [text]);
  const attempted = (q: string): boolean => Object.prototype.hasOwnProperty.call(resultMap, q);
  const pending = lines.filter((l) => !attempted(l));
  const matchedLines = lines.filter((l) => resultMap[l]);
  const notFoundLines = lines.filter((l) => attempted(l) && resultMap[l] === null);
  const selectedCount = matchedLines.filter((l) => !excluded.has(l)).length;

  const handleFile = async (file: File | undefined | null): Promise<void> => {
    if (!file) return;
    setError(null);
    setFileNote(null);
    setFileLoading(true);
    try {
      const parsed = await parseTrackListFile(file);
      if (parsed.length === 0) {
        setFileNote(`Aucune ligne exploitable trouvée dans « ${file.name} ».`);
        return;
      }
      setText((prev) => {
        const base = prev.trim();
        return base ? `${base}\n${parsed.join('\n')}` : parsed.join('\n');
      });
      setFileNote(
        `${parsed.length} ligne${parsed.length > 1 ? 's' : ''} importée${
          parsed.length > 1 ? 's' : ''
        } depuis « ${file.name} ». Vérifie puis lance la recherche.`,
      );
    } catch (err: unknown) {
      setError(`Lecture du fichier impossible : ${(err as Error).message}`);
    } finally {
      setFileLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const searchOne = async (query: string): Promise<TrackResult | null> => {
    const found =
      provider === 'spotify'
        ? (await searchSpotify({ track: query, market: 'FR', limit: 3 })).items
        : (await searchGeneric(query, { provider: 'youtube', limit: 3 })).results;
    return found[0] ?? null;
  };

  const runMatching = async (): Promise<void> => {
    const todo = pending;
    if (lines.length === 0) {
      setError('Colle au moins un titre (un par ligne).');
      return;
    }
    if (todo.length === 0) return; // tout est déjà cherché
    setError(null);
    setLimitHit(null);
    setImportedCount(null);
    setMatching(true);
    setProgress({ done: 0, total: todo.length });

    const local: Record<string, TrackResult | null> = {};
    let done = 0;
    let aborted = false;
    let idx = 0;
    const worker = async (): Promise<void> => {
      while (idx < todo.length && !aborted) {
        const query = todo[idx++]!;
        try {
          local[query] = await searchOne(query);
        } catch (err: unknown) {
          const limitMsg = classifyLimit(provider, (err as Error).message ?? '');
          if (limitMsg) {
            aborted = true;
            setLimitHit(limitMsg);
            break;
          }
          local[query] = null; // erreur ponctuelle → non trouvé
        } finally {
          done += 1;
          setProgress({ done, total: todo.length });
        }
        await sleep(PACE_MS);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
    setResultMap((prev) => ({ ...prev, ...local }));
    setMatching(false);
    setProgress(null);
  };

  const toggle = (query: string): void => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(query)) next.delete(query);
      else next.add(query);
      return next;
    });
  };

  const runImport = async (): Promise<void> => {
    const ids = Array.from(
      new Set(
        matchedLines
          .filter((l) => !excluded.has(l))
          .map((l) => resultMap[l]?.provider_track_id)
          .filter((id): id is string => !!id),
      ),
    );
    if (ids.length === 0) {
      setError('Aucun morceau sélectionné à importer.');
      return;
    }
    setError(null);
    setImporting(true);
    try {
      const res = await importTracks(playlistId, provider as 'spotify' | 'youtube', ids);
      setImportedCount(res.imported);
      onImported(res.imported);
      // Reset complet après import réussi.
      setText('');
      setResultMap({});
      setExcluded(new Set());
      setLimitHit(null);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const resetSearch = (): void => {
    setResultMap({});
    setExcluded(new Set());
    setLimitHit(null);
  };

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

      {/* Upload fichier : Excel / CSV / PDF / TXT → pré-remplit la zone de texte. */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv,.tsv,.pdf,.txt"
          onChange={(e) => void handleFile(e.target.files?.[0])}
          className="hidden"
          id="tracklist-file"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={fileLoading || matching || importing}
        >
          {fileLoading ? '⏳ Lecture…' : '📎 Importer un fichier (Excel · CSV · PDF)'}
        </Button>
        <span className="font-mono text-[11px] text-ink-faded">
          ou colle directement ci-dessous
        </span>
      </div>

      {fileNote && <p className="text-[12px] text-spritz-deep font-medium">{fileNote}</p>}

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
          ignorés. Astuce : pour les grosses listes, préfère Spotify (petits lots) — le quota
          YouTube est limité à ~100 recherches/jour.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void runMatching()}
          disabled={matching || importing || pending.length === 0}
        >
          {matching && progress
            ? `⏳ Recherche… ${progress.done}/${progress.total}`
            : pending.length > 0
              ? `🔎 Chercher les correspondances (${pending.length})`
              : '🔎 Tout est cherché'}
        </Button>
        {Object.keys(resultMap).length > 0 && !matching && (
          <Button variant="ghost" size="sm" onClick={resetSearch}>
            ↺ Tout re-chercher
          </Button>
        )}
      </div>

      {limitHit && (
        <div className="p-2.5 border-2 border-raspberry rounded bg-raspberry/10">
          <p className="text-sm font-medium text-raspberry-deep">⛔ {limitHit}</p>
        </div>
      )}

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

      {(matchedLines.length > 0 || notFoundLines.length > 0) && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="font-mono text-xs text-ink-soft">
              {matchedLines.length} trouvé{matchedLines.length > 1 ? 's' : ''} ·{' '}
              {notFoundLines.length} sans correspondance
              {pending.length > 0 ? ` · ${pending.length} à chercher` : ''}
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

          {matchedLines.length > 0 && (
            <ul className="space-y-1.5 max-h-[45vh] overflow-y-auto pr-1">
              {matchedLines.map((l) => {
                const track = resultMap[l]!;
                return (
                  <li key={l}>
                    <label className="flex items-center gap-2 p-2 border-2 border-ink/15 rounded bg-cream cursor-pointer hover:bg-cream-2">
                      <input
                        type="checkbox"
                        checked={!excluded.has(l)}
                        onChange={() => toggle(l)}
                        className="w-4 h-4 accent-ink shrink-0"
                      />
                      {track.cover_url ? (
                        <img
                          src={track.cover_url}
                          alt=""
                          loading="lazy"
                          className="w-9 h-9 rounded border border-ink/20 object-cover shrink-0"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded border border-ink/20 bg-cream-2 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{track.title}</p>
                        <p className="font-mono text-[11px] text-ink-soft truncate">
                          {track.artist}
                          {track.year ? ` · ${track.year}` : ''}
                        </p>
                      </div>
                      <span
                        className="font-mono text-[10px] text-ink-faded truncate max-w-[35%] hidden sm:block"
                        title={`recherché : ${l}`}
                      >
                        ↩ {l}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          {notFoundLines.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer font-mono text-xs text-raspberry-deep">
                ⚠ {notFoundLines.length} titre{notFoundLines.length > 1 ? 's' : ''} non trouvé
                {notFoundLines.length > 1 ? 's' : ''} (clique pour voir)
              </summary>
              <ul className="mt-2 space-y-0.5 font-mono text-[11px] text-ink-soft">
                {notFoundLines.map((l) => (
                  <li key={l} className="truncate">
                    · {l}
                  </li>
                ))}
              </ul>
              <p className="font-mono text-[11px] text-ink-faded mt-1">
                Astuce : reformule ces lignes (« Artiste - Titre »), ou essaie l'autre source
                (Spotify / YouTube).
              </p>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
