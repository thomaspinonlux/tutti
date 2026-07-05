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
import { Button, Card } from '../ui/index.js';
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
  // fix/round-results-race-condition — état explicite de chargement. true
  // entre le mount et la résolution du fetch GET /results. Pendant cette
  // fenêtre on rend un loader, PAS le contenu, pour éviter qu'un champ
  // undefined côté `results` ne crash au 1er render (avant correctifs
  // d'optional chaining ci-dessous).
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setResults(null);
    setFetchErr(null);
    void getRoundResults(sessionId, round.id)
      .then((data) => {
        if (cancelled) return;
        setResults(data);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setFetchErr((err as Error).message);
        setIsLoading(false);
        console.warn('[RoundIntermission] /results fetch fail', err);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, round.id]);

  // Defensive (cf. Bug v2 historique) — fallback si round.playlist absent.
  const playlistName = round?.playlist?.name ?? '—';
  const roundPosition = round?.position ?? 0;

  // fix/round-results-race-condition — optional chaining + défauts sur TOUS
  // les accès à `results`. Chaque champ peut être undefined si le backend
  // renvoie un payload partiel (ex: déploiement intermédiaire, version API
  // décalée). Aucun `results.foo.bar` direct → toujours `results?.foo?.bar`
  // ou wrapping dans des fonctions safe ci-dessous.

  // Section 1 : podium de la manche (top 3 du round_ranking)
  const roundPodium = (results?.round_ranking ?? []).slice(0, 3);

  // Section 2 : cumul (prend de l'API si dispo, sinon fallback prop)
  const cumulList =
    (results?.cumulative_ranking && results.cumulative_ranking.length > 0
      ? results.cumulative_ranking
      : null) ??
    (cumulative ?? []).map((c, idx) => ({
      participant_id: c.id,
      pseudo: c.label,
      total_points: c.total_points ?? 0,
      rank: idx + 1,
    }));
  const cumulTop = (cumulList ?? []).slice(0, 8);

  // Section 3 : joueur le plus rapide — null si pas de buzz cette manche
  const fastest = results?.fastest_player ?? null;
  const fastestAvgSec =
    fastest && typeof fastest.avg_buzz_ms === 'number'
      ? (fastest.avg_buzz_ms / 1000).toFixed(2)
      : '—';
  const fastestFirstCount =
    fastest && typeof fastest.first_buzz_count === 'number' ? fastest.first_buzz_count : 0;

  // fix/round-results-race-condition — branche dédiée loading. On rend le
  // header + placeholder pour donner immédiatement du contexte visuel sans
  // toucher aux données encore non chargées. Buttons "Manche suivante" /
  // "Terminer" restent disponibles pour skip si jamais le fetch traîne.
  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto">
        <header className="text-center mb-8">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#FF5C4D] mb-2">
            {t('host.roundEnded', { n: roundPosition })}
          </p>
          <h2 className="font-display text-4xl text-white">{playlistName}</h2>
        </header>
        <Card size="lg" className="!bg-[#15151d]/80 !border !border-white/10 text-center mb-6">
          <p className="font-mono text-sm text-white/50 animate-fade-in">
            ⏳ {t('host.intermission.loading')}
          </p>
        </Card>
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

  return (
    <div className="max-w-4xl mx-auto">
      <header className="text-center mb-8">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#FF5C4D] mb-2">
          {t('host.roundEnded', { n: roundPosition })}
        </p>
        <h2 className="font-display text-4xl text-white">{playlistName}</h2>
      </header>

      {fetchErr && (
        <Card size="sm" className="!bg-[#15151d]/80 !border !border-white/10 border-raspberry mb-4">
          <p role="alert" className="text-raspberry text-sm">
            {t('host.intermission.fetchError')}: {fetchErr}
          </p>
        </Card>
      )}

      {/* ─── Section 1 — Podium de la manche ─────────────────────────── */}
      <Card
        size="lg"
        className="!bg-[#15151d]/80 !border !border-white/10 mb-6 border-2 border-spritz"
      >
        <p className="text-xs font-mono uppercase tracking-wider text-[#FF5C4D] mb-4 text-center">
          🏆 {t('host.intermission.roundPodium')}
        </p>
        {roundPodium.length === 0 ? (
          <p className="font-editorial italic text-white/50 text-center">
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
              return (
                <li
                  key={entry.participant_id ?? `podium-${idx}`}
                  className={`text-center rounded-xl ${height}`}
                  style={{
                    backgroundColor: idx === 0 ? '#FF5C4D22' : '#ffffff08',
                    border: `1px solid ${idx === 0 ? '#FF5C4D66' : '#ffffff14'}`,
                  }}
                >
                  <p className="text-3xl mb-1">{medal}</p>
                  <p className="font-display text-lg leading-tight px-2 break-words text-white">
                    {entry.pseudo ?? '?'}
                  </p>
                  <span
                    className="mt-2 inline-block rounded-full px-2.5 py-0.5 font-mono text-xs font-bold text-[#0B0B0F]"
                    style={{ backgroundColor: '#FF5C4D' }}
                  >
                    +{entry.points ?? 0} pts
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* ─── Section 2 — Classement général cumulé ─────────────────── */}
        <Card size="md" className="!bg-[#15151d]/80 !border !border-white/10">
          <p className="text-xs font-mono uppercase tracking-wider text-white/50 mb-3">
            📊 {t('host.intermission.cumulative')}
          </p>
          {cumulTop.length === 0 ? (
            <p className="font-editorial italic text-white/50">{t('host.noScoresYet')}</p>
          ) : (
            <ol className="space-y-1.5">
              {cumulTop.map((entry, idx) => (
                <li
                  key={entry.participant_id ?? `cumul-${idx}`}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm"
                  style={{
                    backgroundColor: idx === 0 ? '#FF5C4D1a' : '#ffffff08',
                    border: `1px solid ${idx === 0 ? '#FF5C4D55' : '#ffffff12'}`,
                  }}
                >
                  <span className="font-mono text-xs w-5 text-white/50">{idx + 1}.</span>
                  <span className="flex-1 truncate font-medium text-white">
                    {entry.pseudo ?? '?'}
                  </span>
                  <span className="font-mono text-sm font-bold tabular-nums text-white">
                    {entry.total_points ?? 0}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        {/* ─── Section 3 — Joueur le plus rapide ─────────────────────── */}
        <Card
          size="md"
          className="!bg-[#15151d]/80 !border !border-white/10 border-2 border-raspberry"
        >
          <p className="text-xs font-mono uppercase tracking-wider text-raspberry-deep mb-3">
            ⚡ {t('host.intermission.fastest')}
          </p>
          {fastest ? (
            <div className="text-center py-2">
              <p className="font-display text-2xl mb-1 text-white">{fastest.pseudo ?? '?'}</p>
              <p className="font-mono text-xs text-white/50">
                {t('host.intermission.avgBuzz', { ms: fastestAvgSec })}
              </p>
              {fastestFirstCount > 0 && (
                <p className="font-mono text-xs text-white/50 mt-1">
                  🥇 {fastestFirstCount}{' '}
                  {t('host.intermission.firstBuzzCount', { count: fastestFirstCount })}
                </p>
              )}
            </div>
          ) : (
            <p className="font-editorial italic text-white/50 text-center py-2">
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
