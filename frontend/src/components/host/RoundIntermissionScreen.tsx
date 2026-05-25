/**
 * <RoundIntermissionScreen /> — écran "Manche X terminée".
 *
 * feat/round-end-rankings — refonte avec 3 sections :
 *   1. PODIUM DE LA MANCHE — top 3 sur le round courant uniquement
 *   2. CLASSEMENT GÉNÉRAL CUMULÉ — top N depuis le début de la session
 *   3. JOUEUR LE PLUS RAPIDE — best avg buzz_time_ms du round + count
 *      des premiers buzz
 *
 * Données récupérées via GET /api/sessions/:id/rounds/:roundId/results
 * (calculé à la volée depuis ScoreEvent agrégé). Fallback gracieux si
 * fetch échoue : on affiche au moins le cumulative passé en prop.
 *
 * Boutons en bas : "Manche suivante →" + "Terminer le blind test".
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CumulativeScore, SessionRoundWithPlaylist } from '@tutti/shared';
import { Badge, Button, Card, TitleHandwritten, Underline } from '../ui/index.js';
import { getRoundResults, type RoundResults } from '../../lib/sessions.js';

interface Props {
  sessionId: string;
  round: SessionRoundWithPlaylist;
  cumulative: CumulativeScore[];
  onNextRound: () => void;
  onEndSession: () => void | Promise<void>;
  loading?: boolean;
}

export function RoundIntermissionScreen({
  sessionId,
  round,
  cumulative,
  onNextRound,
  onEndSession,
  loading,
}: Props): JSX.Element {
  const { t } = useTranslation();
  const [results, setResults] = useState<RoundResults | null>(null);
  const [fetchErr, setFetchErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getRoundResults(sessionId, round.id)
      .then((data) => {
        if (!cancelled) setResults(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setFetchErr((err as Error).message);
        console.warn('[RoundIntermission] /results fetch fail', err);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, round.id]);

  // Defensive (cf. Bug v2 historique) — fallback si round.playlist absent.
  const playlistName = round?.playlist?.name ?? '—';
  const roundPosition = round?.position ?? 0;

  // Section 1 : podium de la manche (top 3 du round_ranking)
  const roundPodium = results?.round_ranking.slice(0, 3) ?? [];

  // Section 2 : cumul (prend de l'API si dispo, sinon fallback prop)
  const cumulList =
    results?.cumulative_ranking ??
    cumulative.map((c, idx) => ({
      participant_id: c.id,
      pseudo: c.label,
      total_points: c.total_points,
      rank: idx + 1,
    }));
  const cumulTop = cumulList.slice(0, 8);

  // Section 3 : joueur le plus rapide
  const fastest = results?.fastest_player ?? null;

  return (
    <div className="max-w-4xl mx-auto">
      <header className="text-center mb-8">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-2">
          {t('host.roundEnded', { n: roundPosition })}
        </p>
        <TitleHandwritten as="h2">
          <Underline>{playlistName}</Underline>
        </TitleHandwritten>
      </header>

      {fetchErr && (
        <Card tone="cream" size="sm" className="border-raspberry mb-4">
          <p role="alert" className="text-raspberry text-sm">
            {t('host.intermission.fetchError')}: {fetchErr}
          </p>
        </Card>
      )}

      {/* ─── Section 1 — Podium de la manche ─────────────────────────── */}
      <Card tone="cream" size="lg" className="mb-6 border-2 border-spritz">
        <p className="text-xs font-mono uppercase tracking-wider text-spritz-deep mb-4 text-center">
          🏆 {t('host.intermission.roundPodium')}
        </p>
        {roundPodium.length === 0 ? (
          <p className="font-editorial italic text-ink-soft text-center">
            {t('host.intermission.noPoints')}
          </p>
        ) : (
          <ol className="grid grid-cols-3 gap-3 items-end">
            {/* 2nd | 1st | 3rd — podium classique */}
            {([1, 0, 2] as const).map((idx) => {
              const entry = roundPodium[idx];
              if (!entry) return <div key={idx} aria-hidden />;
              const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉';
              const height = idx === 0 ? 'pt-4 pb-6' : idx === 1 ? 'pt-3 pb-4' : 'pt-2 pb-3';
              const tone = idx === 0 ? 'bg-lemon' : idx === 1 ? 'bg-cream-2' : 'bg-spritz/30';
              return (
                <li
                  key={entry.participant_id}
                  className={`text-center border-2 border-ink rounded-lg ${tone} ${height}`}
                >
                  <p className="text-3xl mb-1">{medal}</p>
                  <p className="font-display text-lg leading-tight px-2 break-words">
                    {entry.pseudo}
                  </p>
                  <Badge tone="ink" className="mt-2">
                    +{entry.points} pts
                  </Badge>
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* ─── Section 2 — Classement général cumulé ─────────────────── */}
        <Card tone="cream" size="md">
          <p className="text-xs font-mono uppercase tracking-wider text-ink-soft mb-3">
            📊 {t('host.intermission.cumulative')}
          </p>
          {cumulTop.length === 0 ? (
            <p className="font-editorial italic text-ink-soft">{t('host.noScoresYet')}</p>
          ) : (
            <ol className="space-y-1.5">
              {cumulTop.map((entry, idx) => (
                <li
                  key={entry.participant_id}
                  className={`flex items-center gap-2 px-2 py-1.5 border rounded text-sm ${
                    idx === 0 ? 'border-spritz bg-spritz/10' : 'border-ink/20 bg-white'
                  }`}
                >
                  <span className="font-mono text-xs w-5 text-ink-soft">{idx + 1}.</span>
                  <span className="flex-1 truncate font-medium">{entry.pseudo}</span>
                  <Badge tone={idx === 0 ? 'spritz' : 'ink'}>{entry.total_points}</Badge>
                </li>
              ))}
            </ol>
          )}
        </Card>

        {/* ─── Section 3 — Joueur le plus rapide ─────────────────────── */}
        <Card tone="cream" size="md" className="border-2 border-raspberry">
          <p className="text-xs font-mono uppercase tracking-wider text-raspberry-deep mb-3">
            ⚡ {t('host.intermission.fastest')}
          </p>
          {fastest ? (
            <div className="text-center py-2">
              <p className="font-display text-2xl mb-1">{fastest.pseudo}</p>
              <p className="font-mono text-xs text-ink-soft">
                {t('host.intermission.avgBuzz', {
                  ms: (fastest.avg_buzz_ms / 1000).toFixed(2),
                })}
              </p>
              {fastest.first_buzz_count > 0 && (
                <p className="font-mono text-xs text-ink-soft mt-1">
                  🥇 {fastest.first_buzz_count}{' '}
                  {t('host.intermission.firstBuzzCount', { count: fastest.first_buzz_count })}
                </p>
              )}
            </div>
          ) : (
            <p className="font-editorial italic text-ink-soft text-center py-2">
              {t('host.intermission.noBuzz')}
            </p>
          )}
        </Card>
      </div>

      {/* ─── Boutons d'action ──────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Button variant="primary" size="lg" onClick={onNextRound} disabled={loading}>
          {t('host.nextRound')} →
        </Button>
        <Button variant="ghost" size="lg" onClick={() => void onEndSession()} disabled={loading}>
          {t('host.endBlindTest')}
        </Button>
      </div>
    </div>
  );
}
