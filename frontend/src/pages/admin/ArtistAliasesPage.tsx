/**
 * <ArtistAliasesPage /> — fix/aliases-quality-v2-and-artists
 *
 * Dashboard super-admin pour les aliases d'artistes. Quand un joueur dit
 * juste "Green Day", la cascade match les morceaux de Green Day si
 * Artist.aliases contient des phonétiques FR (grine day, grine dé, ...).
 *
 * Route : /admin/aliases-artists (super admin, gating App.tsx).
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, TitleHandwritten, Underline } from '../../components/ui/index.js';
import {
  generateArtistAliasesBatch,
  listArtistAliases,
  patchArtistAliases,
  regenerateArtistAliasesById,
  type AliasArtistRow,
} from '../../lib/admin.js';

export function ArtistAliasesPage(): JSX.Element {
  const [filter, setFilter] = useState<'all' | 'missing' | 'present'>('missing');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<AliasArtistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [lastBatch, setLastBatch] = useState<{
    processed: number;
    failed: number;
    cost: number;
  } | null>(null);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const r = await listArtistAliases({
        hasAliases: filter === 'all' ? undefined : filter === 'present',
        page,
        pageSize,
      });
      setRows(r.artists);
      setTotal(r.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur chargement');
    } finally {
      setLoading(false);
    }
  }, [filter, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  const runBatchMissing = async (): Promise<void> => {
    if (batchRunning) return;
    if (!window.confirm(`Générer aliases IA pour les ${pageSize} prochains artistes ?`)) return;
    setBatchRunning(true);
    setError(null);
    try {
      const r = await generateArtistAliasesBatch({
        missingOnly: true,
        limit: pageSize,
        locale: 'fr',
      });
      setLastBatch({ processed: r.processed, failed: r.failed, cost: r.cost_estimate_eur });
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur batch');
    } finally {
      setBatchRunning(false);
    }
  };

  const regenerate = async (artistId: string): Promise<void> => {
    if (busy[artistId]) return;
    setBusy((b) => ({ ...b, [artistId]: true }));
    try {
      const updated = await regenerateArtistAliasesById(artistId, 'fr');
      setRows((rs) => rs.map((r) => (r.artist_id === artistId ? updated : r)));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : `Erreur regen ${artistId}`);
    } finally {
      setBusy((b) => ({ ...b, [artistId]: false }));
    }
  };

  const startEdit = (row: AliasArtistRow): void => {
    setEditing((e) => ({ ...e, [row.artist_id]: row.aliases.join(', ') }));
  };
  const cancelEdit = (artistId: string): void => {
    setEditing((e) => {
      const n = { ...e };
      delete n[artistId];
      return n;
    });
  };
  const saveEdit = async (artistId: string): Promise<void> => {
    const raw = editing[artistId] ?? '';
    const aliases = raw
      .split(/[,\n]+/)
      .map((a) => a.trim())
      .filter((a) => a.length >= 2);
    setBusy((b) => ({ ...b, [artistId]: true }));
    try {
      const updated = await patchArtistAliases(artistId, aliases);
      setRows((rs) => rs.map((r) => (r.artist_id === artistId ? updated : r)));
      cancelEdit(artistId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : `Erreur save ${artistId}`);
    } finally {
      setBusy((b) => ({ ...b, [artistId]: false }));
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <header className="space-y-2">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep">
          Super admin · Reco vocale · Artistes
        </p>
        <TitleHandwritten as="h1">
          <Underline>Aliases artistes</Underline>
        </TitleHandwritten>
        <p className="font-editorial italic text-ink-soft">
          Aliases de prononciation pour les artistes. Quand un joueur buzz juste « Green Day », ces
          aliases lui permettent de matcher tous les morceaux Green Day.
        </p>
        <p className="font-mono text-xs">
          <Link to="/admin/aliases" className="underline">
            ← Aliases tracks
          </Link>
        </p>
      </header>

      <Card tone="cream" size="md">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="font-display text-base">🤖 Générer aliases manquants</p>
            <p className="font-mono text-xs text-ink-soft">
              Lance la génération IA pour les {pageSize} prochains artistes sans aliases.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void runBatchMissing()}
            disabled={batchRunning}
            className="px-4 py-2 bg-spritz text-ink border-2 border-ink rounded-md shadow-pop-sm font-display disabled:opacity-50"
          >
            {batchRunning ? '⏳ En cours…' : '▶ Lancer'}
          </button>
        </div>
        {lastBatch && (
          <p className="mt-3 font-mono text-xs text-basil">
            Dernier batch : {lastBatch.processed} traités, {lastBatch.failed} échecs, coût estimé{' '}
            {lastBatch.cost}€
          </p>
        )}
      </Card>

      <div className="flex items-center gap-2 font-mono text-sm">
        <span className="text-ink-soft">Filtre :</span>
        {(['missing', 'present', 'all'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => {
              setFilter(f);
              setPage(1);
            }}
            className={`px-3 py-1.5 border-2 border-ink rounded ${
              filter === f ? 'bg-ink text-cream' : 'bg-cream hover:bg-spritz/30'
            }`}
          >
            {f === 'missing' ? 'Sans aliases' : f === 'present' ? 'Avec aliases' : 'Tous'}
          </button>
        ))}
        <span className="ml-auto text-ink-soft text-xs">
          {total} artistes · page {page}/{totalPages}
        </span>
      </div>

      {error && (
        <Card tone="cream" size="sm" className="border-raspberry">
          <p role="alert" className="text-raspberry text-sm">
            {error}
          </p>
        </Card>
      )}

      {loading ? (
        <p className="font-mono text-sm text-ink-soft animate-pulse">⏳ Chargement…</p>
      ) : rows.length === 0 ? (
        <Card tone="cream" size="md" className="text-center">
          <p className="font-editorial italic text-ink-soft">Aucun artiste ne match ce filtre.</p>
        </Card>
      ) : (
        <Card size="md">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b-2 border-ink">
                <th className="font-mono text-[10px] uppercase tracking-wider py-2">Artiste</th>
                <th className="font-mono text-[10px] uppercase tracking-wider py-2 w-1/2">
                  Aliases
                </th>
                <th className="font-mono text-[10px] uppercase tracking-wider py-2 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isEditing = editing[row.artist_id] !== undefined;
                const isBusy = busy[row.artist_id] === true;
                return (
                  <tr key={row.artist_id} className="border-b border-ink/10 align-top">
                    <td className="py-2 font-display">{row.name}</td>
                    <td className="py-2">
                      {isEditing ? (
                        <textarea
                          value={editing[row.artist_id]}
                          onChange={(e) =>
                            setEditing((s) => ({ ...s, [row.artist_id]: e.target.value }))
                          }
                          rows={2}
                          className="w-full font-mono text-xs border-2 border-ink rounded p-2"
                          placeholder="alias1, alias2"
                        />
                      ) : row.aliases.length === 0 ? (
                        <span className="text-ink-soft italic">aucun</span>
                      ) : (
                        <p className="font-mono text-xs leading-relaxed">
                          {row.aliases.map((a, i) => (
                            <span key={i}>
                              <span className="bg-cream-2 px-1 rounded">{a}</span>
                              {i < row.aliases.length - 1 && ' '}
                            </span>
                          ))}
                        </p>
                      )}
                      {row.aliases_source && (
                        <p className="mt-1 font-mono text-[10px] text-ink-soft">
                          source : {row.aliases_source}
                          {row.aliases_generated_at &&
                            ` · ${new Date(row.aliases_generated_at).toLocaleDateString('fr-FR')}`}
                        </p>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {isEditing ? (
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => void saveEdit(row.artist_id)}
                            disabled={isBusy}
                            className="px-2 py-1 font-mono text-[10px] uppercase bg-basil text-cream border border-ink rounded disabled:opacity-50"
                          >
                            ✓
                          </button>
                          <button
                            type="button"
                            onClick={() => cancelEdit(row.artist_id)}
                            className="px-2 py-1 font-mono text-[10px] uppercase border border-ink rounded"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => startEdit(row)}
                            disabled={isBusy}
                            className="px-2 py-1 font-mono text-[10px] uppercase border border-ink rounded hover:bg-cream-2 disabled:opacity-50"
                          >
                            Éditer
                          </button>
                          <button
                            type="button"
                            onClick={() => void regenerate(row.artist_id)}
                            disabled={isBusy}
                            className="px-2 py-1 font-mono text-[10px] uppercase bg-spritz/30 border border-ink rounded hover:bg-spritz/50 disabled:opacity-50"
                            title="Régénérer via IA"
                          >
                            {isBusy ? '⏳' : '🤖'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between font-mono text-sm">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 border-2 border-ink rounded disabled:opacity-30"
          >
            ← Page précédente
          </button>
          <span className="text-ink-soft">
            page {page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 border-2 border-ink rounded disabled:opacity-30"
          >
            Page suivante →
          </button>
        </div>
      )}
    </div>
  );
}
