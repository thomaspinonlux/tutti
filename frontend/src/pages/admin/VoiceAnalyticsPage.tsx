/**
 * <VoiceAnalyticsPage /> — feat/voice-cascade-l3-assemblyai
 *
 * Dashboard super-admin pour la cascade voix Tutti :
 *   - Distribution des transcripts par niveau (L1 Web Speech, L2 Deepgram,
 *     L2-fallback Whisper, L3 AssemblyAI)
 *   - Latence moyenne par niveau
 *   - Taux d'escalade L2 → L3 (sert à décider si l'investissement L3 vaut le
 *     coup côté coût + UX)
 *   - Coût estimé en EUR sur la fenêtre (calcul ordre de grandeur)
 *
 * Route : /admin/voice-analytics (super admin uniquement, gating dans App.tsx
 * via SuperAdminRouteGuard).
 */

import { useEffect, useState } from 'react';
import { Card, TitleHandwritten, Underline } from '../../components/ui/index.js';
import { generateAliasesBatch, getVoiceAnalytics, type VoiceAnalytics } from '../../lib/admin.js';

const LEVEL_LABELS: Record<string, string> = {
  'web-speech': '🌐 L1 — Web Speech',
  deepgram: '⚡ L2 — Deepgram Nova-3',
  'whisper-fallback': '🛟 L2-fallback — Whisper',
  assemblyai: '🎯 L3 — AssemblyAI Universal-2',
  'manual-text': '⌨️  Saisie texte',
  unknown: '— inconnu (pré-cascade)',
};

const LEVEL_DESCRIPTIONS: Record<string, string> = {
  'web-speech': 'Reconnaissance côté navigateur, 0ms réseau.',
  deepgram: 'Nova-3 + Keyterm Prompting, latence ~300ms.',
  'whisper-fallback': 'Whisper appelé quand Deepgram timeout/erreur.',
  assemblyai: 'Universal-2 + word_boost, ~600-1500ms. Audio bruité / accent fort.',
  'manual-text': 'Réponse tapée au clavier (PR fail-soft).',
  unknown: 'Lignes legacy sans annotation level (avant PR 48).',
};

export function VoiceAnalyticsPage(): JSX.Element {
  const [data, setData] = useState<VoiceAnalytics | null>(null);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void getVoiceAnalytics(days)
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError((err as Error).message);
        setLoading(false);
      });
  }, [days]);

  const fmtPct = (n: number): string => `${(n * 100).toFixed(1)}%`;
  const fmtMs = (n: number | null): string => (n === null ? '—' : `${n}ms`);
  const fmtEur = (n: number): string =>
    new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <header className="space-y-2">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep">
          Super admin · Voice cascade
        </p>
        <TitleHandwritten as="h1">
          <Underline>Voice analytics</Underline>
        </TitleHandwritten>
        <p className="font-editorial italic text-ink-soft">
          Distribution, latence et coût estimé de la cascade voix L1 → L2 → L3.
        </p>
      </header>

      {/* Window picker */}
      <div className="flex items-center gap-2 font-mono text-sm">
        <span className="text-ink-soft">Fenêtre :</span>
        {[1, 7, 30, 90].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDays(d)}
            className={`px-3 py-1.5 border-2 border-ink rounded ${
              days === d ? 'bg-ink text-cream' : 'bg-cream hover:bg-spritz/30'
            }`}
          >
            {d}j
          </button>
        ))}
      </div>

      {error && (
        <Card tone="cream" size="sm" className="border-raspberry">
          <p role="alert" className="text-raspberry text-sm">
            Erreur : {error}
          </p>
        </Card>
      )}

      {loading && <p className="font-mono text-sm text-ink-soft animate-pulse">⏳ Chargement…</p>}

      {data && !loading && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <SummaryCard
              label="Total transcripts"
              value={String(data.total)}
              hint={`Depuis ${new Date(data.since).toLocaleDateString('fr-FR')}`}
            />
            <SummaryCard
              label="Escalade L2 → L3"
              value={fmtPct(data.summary.escalation_rate_l2_l3)}
              hint={`${data.summary.l3_count} cas / ${data.summary.l2_count} L2`}
              tone={data.summary.escalation_rate_l2_l3 > 0.2 ? 'warn' : 'ok'}
            />
            <SummaryCard
              label="Latence moy. L2"
              value={fmtMs(data.summary.l2_avg_latency_ms)}
              hint="Deepgram backend"
            />
            <SummaryCard
              label="Coût estimé"
              value={fmtEur(data.cost_estimate_eur.total)}
              hint={`${data.window_days}j cumulé`}
            />
          </div>

          {/* Distribution table */}
          <Card tone="cream" size="md">
            <p className="text-xs font-mono uppercase tracking-wider text-ink-soft mb-3">
              Distribution par niveau
            </p>
            {data.distribution.length === 0 ? (
              <p className="font-editorial italic text-ink-soft">
                Aucun transcript persisté sur la fenêtre.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-ink-soft border-b-2 border-ink">
                    <tr>
                      <th className="py-2 pr-3 font-mono uppercase text-xs">Niveau</th>
                      <th className="py-2 pr-3 font-mono uppercase text-xs text-right">Count</th>
                      <th className="py-2 pr-3 font-mono uppercase text-xs text-right">%</th>
                      <th className="py-2 pr-3 font-mono uppercase text-xs text-right">
                        Latence moy.
                      </th>
                      <th className="py-2 pr-3 font-mono uppercase text-xs text-right">
                        Conf. moy.
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.distribution
                      .slice()
                      .sort((a, b) => b.count - a.count)
                      .map((row) => {
                        const pct = data.total > 0 ? row.count / data.total : 0;
                        return (
                          <tr key={row.level} className="border-b border-ink/15 align-top">
                            <td className="py-2 pr-3">
                              <p className="font-display font-semibold">
                                {LEVEL_LABELS[row.level] ?? row.level}
                              </p>
                              <p className="font-mono text-[11px] text-ink-soft">
                                {LEVEL_DESCRIPTIONS[row.level] ?? ''}
                              </p>
                            </td>
                            <td className="py-2 pr-3 text-right font-mono">{row.count}</td>
                            <td className="py-2 pr-3 text-right font-mono">{fmtPct(pct)}</td>
                            <td className="py-2 pr-3 text-right font-mono">
                              {fmtMs(row.avg_latency_ms)}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono">
                              {row.avg_confidence === null
                                ? '—'
                                : (row.avg_confidence * 100).toFixed(0) + '%'}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Cost breakdown */}
          <Card tone="cream" size="md">
            <p className="text-xs font-mono uppercase tracking-wider text-ink-soft mb-3">
              Coût estimé (ordre de grandeur)
            </p>
            <ul className="space-y-1.5 font-mono text-sm">
              <li className="flex justify-between">
                <span className="text-ink-soft">⚡ Deepgram</span>
                <span>{fmtEur(data.cost_estimate_eur.deepgram)}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-ink-soft">🛟 Whisper fallback</span>
                <span>{fmtEur(data.cost_estimate_eur.whisper_fallback)}</span>
              </li>
              <li className="flex justify-between">
                <span className="text-ink-soft">🎯 AssemblyAI</span>
                <span>{fmtEur(data.cost_estimate_eur.assemblyai)}</span>
              </li>
              <li className="flex justify-between border-t-2 border-ink pt-2 font-semibold">
                <span>Total</span>
                <span>{fmtEur(data.cost_estimate_eur.total)}</span>
              </li>
            </ul>
            <p className="font-editorial italic text-xs text-ink-soft mt-3">
              Calcul approximatif basé sur des durées moyennes de buzz (6s) et le pricing public de
              chaque API. À comparer avec les vraies factures.
            </p>
          </Card>

          {/* fix/ios-voice-cascade-mic-and-buzz-refused — Top 10 morceaux
              qui ratent le plus le match. Cible à enrichir en aliases. */}
          <Card size="md">
            <h2 className="font-display text-lg mb-3">🎯 Top 10 morceaux à problèmes</h2>
            {data.top_failed_tracks.length === 0 ? (
              <p className="font-editorial italic text-ink-soft">
                Pas assez de tentatives sur la fenêtre pour identifier des morceaux problématiques
                (seuil : ≥3 tentatives par track).
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b-2 border-ink">
                    <th className="font-mono text-[10px] uppercase tracking-wider py-2">#</th>
                    <th className="font-mono text-[10px] uppercase tracking-wider py-2">Morceau</th>
                    <th className="font-mono text-[10px] uppercase tracking-wider py-2">Artiste</th>
                    <th className="font-mono text-[10px] uppercase tracking-wider py-2 text-right">
                      Tentatives
                    </th>
                    <th className="font-mono text-[10px] uppercase tracking-wider py-2 text-right">
                      Match
                    </th>
                    <th className="font-mono text-[10px] uppercase tracking-wider py-2 text-right">
                      🤖
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_failed_tracks.map((t, i) => (
                    <FailedTrackRow key={t.track_id} track={t} index={i} />
                  ))}
                </tbody>
              </table>
            )}
            <p className="font-editorial italic text-xs text-ink-soft mt-3">
              Pour les morceaux à match-rate faible, enrichir les aliases titre/artiste via l'admin
              de la playlist. Ex : « Mistral Gagnant » mal transcrit par Deepgram en « Mister
              Algagnen » → ajouter cet alias résout le problème.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}

interface SummaryCardProps {
  label: string;
  value: string;
  hint?: string;
  tone?: 'ok' | 'warn';
}

function SummaryCard({ label, value, hint, tone }: SummaryCardProps): JSX.Element {
  const accent = tone === 'warn' ? 'border-raspberry text-raspberry-deep' : 'border-ink text-ink';
  return (
    <div className={`border-2 ${accent} bg-cream rounded-lg px-4 py-3 shadow-pop-sm`}>
      <p className="font-mono text-[10px] uppercase tracking-wider text-ink-soft">{label}</p>
      <p className="font-display text-2xl mt-1">{value}</p>
      {hint && <p className="font-mono text-[11px] text-ink-soft mt-1">{hint}</p>}
    </div>
  );
}

/**
 * feat/ai-aliases-voice-matching — bouton "🤖 Générer aliases" en ligne sur
 * chaque morceau du top failed. Évite à l'admin de quitter cette page pour
 * aller dans /admin/aliases régler manuellement.
 */
function FailedTrackRow({
  track,
  index,
}: {
  track: VoiceAnalytics['top_failed_tracks'][number];
  index: number;
}): JSX.Element {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const handleGenerate = async (): Promise<void> => {
    setState('busy');
    setErrMsg(null);
    try {
      const r = await generateAliasesBatch({
        trackIds: [track.track_id],
        locale: 'fr',
      });
      setState(r.processed > 0 ? 'done' : 'error');
      if (r.processed === 0) setErrMsg(r.results[0]?.error ?? 'EMPTY');
    } catch (err: unknown) {
      setState('error');
      setErrMsg(err instanceof Error ? err.message : 'Erreur');
    }
  };

  return (
    <tr className="border-b border-ink/10">
      <td className="py-2 font-mono text-xs text-ink-soft">{index + 1}</td>
      <td className="py-2 font-display">{track.title ?? '(sans titre)'}</td>
      <td className="py-2 text-ink-soft">{track.artist ?? '(inconnu)'}</td>
      <td className="py-2 text-right font-mono">{track.attempts}</td>
      <td className="py-2 text-right font-mono">
        <span
          className={
            track.match_rate < 0.3
              ? 'text-raspberry-deep font-semibold'
              : track.match_rate < 0.6
                ? 'text-ink'
                : 'text-basil'
          }
        >
          {Math.round(track.match_rate * 100)}%
        </span>
      </td>
      <td className="py-2 text-right">
        <button
          type="button"
          onClick={() => void handleGenerate()}
          disabled={state === 'busy' || state === 'done'}
          className={`px-2 py-1 font-mono text-[10px] uppercase border border-ink rounded ${
            state === 'done'
              ? 'bg-basil/30 text-basil-deep'
              : state === 'error'
                ? 'bg-raspberry/20 text-raspberry-deep'
                : 'bg-spritz/30 hover:bg-spritz/50'
          } disabled:opacity-50`}
          title={errMsg ?? 'Générer aliases via IA'}
        >
          {state === 'busy' ? '⏳' : state === 'done' ? '✓' : state === 'error' ? '✕' : '🤖'}
        </button>
      </td>
    </tr>
  );
}
