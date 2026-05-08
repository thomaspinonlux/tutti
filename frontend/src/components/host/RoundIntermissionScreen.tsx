/**
 * <RoundIntermissionScreen /> — écran "Manche X terminée" affiché entre 2 manches.
 * Mini-podium de la manche + boutons "Manche suivante" / "Terminer le blind test".
 *
 * V1 : on n'a pas encore les scores par-manche (étape 10), on affiche les
 * scores cumulés actuels. Le mini-podium par-manche viendra avec les events.
 */

import { useTranslation } from 'react-i18next';
import type { CumulativeScore, SessionRoundWithPlaylist } from '@tutti/shared';
import { Badge, Button, Card, TitleHandwritten, Underline } from '../ui/index.js';

interface Props {
  round: SessionRoundWithPlaylist;
  cumulative: CumulativeScore[];
  onNextRound: () => void;
  onEndSession: () => void | Promise<void>;
  loading?: boolean;
}

export function RoundIntermissionScreen({
  round,
  cumulative,
  onNextRound,
  onEndSession,
  loading,
}: Props): JSX.Element {
  const { t } = useTranslation();
  // Bug v2 (fix/end-round-blank-page-v2) — logs entry + crash defense.
  // Le composant lit round.playlist.name : si playlist absent (race ou
  // payload socket dégradé), throw au render → React unmount subtree →
  // page host vide. Defensive : fallback sur title générique si plus rien.
  console.info(
    `[RoundIntermissionScreen] Mounted round.id=${round?.id ?? 'NULL'} position=${
      round?.position ?? '?'
    } playlist.name=${round?.playlist?.name ?? 'MISSING'} cumulative.count=${cumulative.length}`,
  );
  const top3 = cumulative.slice(0, 3);
  const playlistName = round?.playlist?.name ?? '—';
  const roundPosition = round?.position ?? 0;

  return (
    <div className="max-w-3xl mx-auto">
      <header className="text-center mb-8">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-2">
          {t('host.roundEnded', { n: roundPosition })}
        </p>
        <TitleHandwritten as="h2">
          <Underline>{playlistName}</Underline>
        </TitleHandwritten>
      </header>

      <Card tone="cream" size="lg" className="mb-6">
        <p className="text-xs font-mono uppercase tracking-wider text-ink-soft mb-4 text-center">
          {t('host.cumulativeScores')}
        </p>
        {top3.length === 0 ? (
          <p className="font-editorial italic text-ink-soft text-center">{t('host.noScoresYet')}</p>
        ) : (
          <ol className="space-y-2">
            {top3.map((entry, idx) => (
              <li
                key={entry.id}
                className="flex items-center gap-3 px-3 py-2 border-2 border-ink rounded bg-white"
              >
                <span className="font-display text-2xl w-8 text-center text-spritz-deep">
                  {idx + 1}
                </span>
                {entry.color && (
                  <span
                    aria-hidden
                    className="w-3 h-3 rounded-full border-2 border-ink shrink-0"
                    style={{ backgroundColor: entry.color }}
                  />
                )}
                <span className="font-medium flex-1">{entry.label}</span>
                <Badge tone="ink">{entry.total_points}</Badge>
              </li>
            ))}
          </ol>
        )}
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
