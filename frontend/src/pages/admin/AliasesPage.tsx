/**
 * <AliasesPage /> — feat/ai-aliases-voice-matching
 *
 * Dashboard super-admin pour gérer les aliases de prononciation des tracks.
 *   - Actions globales : batch "missing only" (génère pour les tracks sans
 *     aliases) + stats coût estimé
 *   - Liste paginée des tracks avec édition manuelle inline
 *   - Régénération IA par track
 *
 * Route : /admin/aliases (super admin, gating App.tsx SuperAdminRouteGuard).
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, TitleHandwritten, Underline } from '../../components/ui/index.js';
import {
  generateAliasesBatch,
  listAliases,
  patchTrackAliases,
  regenerateTrackAliases,
  type AliasTrackRow,
} from '../../lib/admin.js';

export function AliasesPage(): JSX.Element {
  const [filter, setFilter] = useState<'all' | 'missing' | 'present'>('missing');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<AliasTrackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [lastBatchResult, setLastBatchResult] = useState<{
    processed: number;
    failed: number;
    cost: number;
  } | null>(null);
  // edit state — keyed by track_id
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const r = await listAliases({
        hasAliases: filter === 'all' ? undefined : filter === 'present',
        page,
        pageSize,
      });
      setRows(r.tracks);
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
    if (
      !window.confirm(`Générer aliases IA pour les ${pageSize} prochaines tracks sans aliases ?`)
    ) {
      return;
    }
    setBatchRunning(true);
    setError(null);
    try {
      const r = await generateAliasesBatch({ missingOnly: true, limit: pageSize, locale: 'fr' });
      setLastBatchResult({
        processed: r.processed,
        failed: r.failed,
        cost: r.cost_estimate_eur,
      });
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur batch');
    } finally {
      setBatchRunning(false);
    }
  };

  const regenerate = async (trackId: string): Promise<void> => {
    if (busy[trackId]) return;
    setBusy((b) => ({ ...b, [trackId]: true }));
    try {
      const updated = await regenerateTrackAliases(trackId, 'fr');
      setRows((rs) => rs.map((r) => (r.track_id === trackId ? updated : r)));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : `Erreur regen ${trackId}`);
    } finally {
      setBusy((b) => ({ ...b, [trackId]: false }));
    }
  };

  const startEdit = (row: AliasTrackRow): void => {
    setEditing((e) => ({ ...e, [row.track_id]: row.aliases.join(', ') }));
  };

  const cancelEdit = (trackId: string): void => {
    setEditing((e) => {
      const next = { ...e };
      delete next[trackId];
      return next;
    });
  };

  const saveEdit = async (trackId: string): Promise<void> => {
    const raw = editing[trackId] ?? '';
    const aliases = raw
      .split(/[,\n]+/)
      .map((a) => a.trim())
      .filter((a) => a.length >= 2);
    setBusy((b) => ({ ...b, [trackId]: true }));
    try {
      const updated = await patchTrackAliases(trackId, aliases);
      setRows((rs) => rs.map((r) => (r.track_id === trackId ? updated : r)));
      cancelEdit(trackId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : `Erreur save ${trackId}`);
    } finally {
      setBusy((b) => ({ ...b, [trackId]: false }));
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <header className="space-y-2">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep">
          Super admin · Reco vocale
        </p>
        <TitleHandwritten as="h1">
          <Underline>Aliases IA</Underline>
        </TitleHandwritten>
        <p className="font-editorial italic text-ink-soft">
          Aliases de prononciation gérés par Claude Sonnet 4.5. Améliore le matching vocal pour les
          titres mal transcrits (accents, phonétique FR→EN, etc.).
        </p>
        <p className="font-mono text-xs flex gap-4">
          <Link to="/admin/aliases-artists" className="underline">
            Aliases artistes →
          </Link>
          <Link to="/admin/library/tags" className="underline">
            🎼 Chansons &amp; paramètres →
          </Link>
        </p>
      </header>

      {/* Global actions */}
      <Card tone="cream" size="md">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="font-display text-base">🤖 Générer aliases manquants</p>
            <p className="font-mono text-xs text-ink-soft">
              Lance la génération IA pour les {pageSize} prochaines tracks sans aliases.
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
        {lastBatchResult && (
          <p className="mt-3 font-mono text-xs text-basil">
            Dernier batch : {lastBatchResult.processed} traités, {lastBatchResult.failed} échecs,
            coût estimé {lastBatchResult.cost}€
          </p>
        )}
      </Card>

      {/* Filters */}
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
          {total} tracks · page {page}/{totalPages}
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
          <p className="font-editorial italic text-ink-soft">Aucune track ne match ce filtre.</p>
        </Card>
      ) : (
        <Card size="md">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b-2 border-ink">
                <th className="font-mono text-[10px] uppercase tracking-wider py-2">Morceau</th>
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
                const isEditing = editing[row.track_id] !== undefined;
                const isBusy = busy[row.track_id] === true;
                return (
                  <tr key={row.track_id} className="border-b border-ink/10 align-top">
                    <td className="py-2 font-display">{row.title}</td>
                    <td className="py-2 text-ink-soft">{row.artist}</td>
                    <td className="py-2">
                      {isEditing ? (
                        <textarea
                          value={editing[row.track_id]}
                          onChange={(e) =>
                            setEditing((s) => ({ ...s, [row.track_id]: e.target.value }))
                          }
                          rows={3}
                          className="w-full font-mono text-xs border-2 border-ink rounded p-2"
                          placeholder="alias1, alias2, alias3"
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
                            onClick={() => void saveEdit(row.track_id)}
                            disabled={isBusy}
                            className="px-2 py-1 font-mono text-[10px] uppercase bg-basil text-cream border border-ink rounded disabled:opacity-50"
                          >
                            ✓
                          </button>
                          <button
                            type="button"
                            onClick={() => cancelEdit(row.track_id)}
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
                            onClick={() => void regenerate(row.track_id)}
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

      {/* Pagination */}
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
