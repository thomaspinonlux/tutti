/**
 * <RoundProgramPanel /> — Phase 2.1
 *
 * Panel "Programme de la manche" affiché côté animateur (mode A iPad) pendant
 * un round PLAYING. Liste ordonnée des tracks avec statut PLAYED/CURRENT/UPCOMING.
 *
 * Auto-refresh : à chaque socket event 'track:start' on refetch (parent gère
 * la prop `refetchKey`).
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RoundProgramItem, RoundProgramResponse } from '@tutti/shared';
import { getRoundProgram } from '../../lib/sessions.js';
import { Card } from '../ui/index.js';

interface Props {
  sessionId: string;
  roundId: string;
  /** Change à chaque track:start broadcast pour forcer un refetch. */
  refetchKey?: string | number;
  className?: string;
}

export function RoundProgramPanel({
  sessionId,
  roundId,
  refetchKey,
  className,
}: Props): JSX.Element {
  const { t } = useTranslation();
  const [data, setData] = useState<RoundProgramResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getRoundProgram(sessionId, roundId)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, roundId, refetchKey]);

  return (
    <Card tone="cream" size="md" className={className}>
      <header className="flex items-baseline justify-between mb-3">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep">
          {t('host.programTitle')}
        </p>
        {data && (
          <p className="font-mono text-xs text-ink-soft tabular-nums">
            {data.current_track_index + 1} / {data.total_tracks}
          </p>
        )}
      </header>

      {loading && !data && (
        <p className="font-editorial italic text-ink-soft text-sm">{t('host.programLoading')}</p>
      )}
      {error && (
        <p className="font-editorial italic text-raspberry text-sm">
          {t('host.programError', { error })}
        </p>
      )}

      {data && (
        <ul className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
          {data.tracks.map((track) => (
            <ProgramRow key={`${track.position}-${track.track_id}`} track={track} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function ProgramRow({ track }: { track: RoundProgramItem }): JSX.Element {
  const isPlayed = track.status === 'PLAYED';
  const isCurrent = track.status === 'CURRENT';

  // Style par statut
  const rowClass = [
    'flex items-center gap-3 rounded px-2 py-1.5 transition-colors',
    isCurrent ? 'bg-spritz/20 border border-spritz-deep' : 'border border-transparent',
    isPlayed ? 'opacity-50' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li className={rowClass}>
      <span className="font-mono text-xs text-ink-soft tabular-nums w-6 shrink-0 text-right">
        {String(track.position + 1).padStart(2, '0')}
      </span>

      {track.cover_url ? (
        <img
          src={track.cover_url}
          alt=""
          className="w-9 h-9 rounded border border-ink/10 shrink-0 object-cover"
          loading="lazy"
        />
      ) : (
        <div className="w-9 h-9 rounded border border-ink/10 bg-cream-2 shrink-0" />
      )}

      <div className="min-w-0 flex-1">
        {/* feat/selection-ui-mirroring (item 3) — word-wrap au lieu de truncate :
            les titres/artistes longs s'enroulent sur plusieurs lignes au lieu
            d'être coupés ou de déborder. */}
        <p className="font-display text-sm text-ink break-words">{track.title}</p>
        <p className="font-editorial italic text-xs text-ink-2 break-words">
          {track.artist}
          {track.year ? ` · ${track.year}` : ''}
        </p>
      </div>

      <StatusBadge status={track.status} />
    </li>
  );
}

function StatusBadge({ status }: { status: RoundProgramItem['status'] }): JSX.Element | null {
  const { t } = useTranslation();
  if (status === 'CURRENT') {
    return (
      <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-spritz-deep text-cream shrink-0">
        {t('host.programStatusCurrent')}
      </span>
    );
  }
  if (status === 'PLAYED') {
    return (
      <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-ink/10 text-ink-soft shrink-0">
        {t('host.programStatusPlayed')}
      </span>
    );
  }
  return null;
}
