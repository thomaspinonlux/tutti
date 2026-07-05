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

const CORAL = '#FF5C4D';

interface Props {
  sessionId: string;
  roundId: string;
  /** Change à chaque track:start broadcast pour forcer un refetch. */
  refetchKey?: string | number;
  className?: string;
  /** Thème sombre (console premium) — défaut clair. */
  dark?: boolean;
}

export function RoundProgramPanel({
  sessionId,
  roundId,
  refetchKey,
  className,
  dark = false,
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

  const header = (
    <>
      <header className="flex items-baseline justify-between mb-3">
        <p
          className="font-mono text-xs uppercase tracking-[0.2em]"
          style={{ color: dark ? CORAL : undefined }}
        >
          <span className={dark ? '' : 'text-spritz-deep'}>{t('host.programTitle')}</span>
        </p>
        {data && (
          <p
            className={`font-mono text-xs tabular-nums ${dark ? 'text-white/50' : 'text-ink-soft'}`}
          >
            {data.current_track_index + 1} / {data.total_tracks}
          </p>
        )}
      </header>

      {loading && !data && (
        <p className={`font-editorial italic text-sm ${dark ? 'text-white/50' : 'text-ink-soft'}`}>
          {t('host.programLoading')}
        </p>
      )}
      {error && (
        <p className="font-editorial italic text-raspberry text-sm">
          {t('host.programError', { error })}
        </p>
      )}

      {data && (
        <ul className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
          {data.tracks.map((track) => (
            <ProgramRow key={`${track.position}-${track.track_id}`} track={track} dark={dark} />
          ))}
        </ul>
      )}
    </>
  );

  if (dark) {
    return (
      <div
        className={`rounded-[20px] border border-white/[0.07] bg-[#15151d]/80 p-5 backdrop-blur-xl ${className ?? ''}`}
      >
        {header}
      </div>
    );
  }
  return (
    <Card tone="cream" size="md" className={className}>
      {header}
    </Card>
  );
}

function ProgramRow({ track, dark }: { track: RoundProgramItem; dark: boolean }): JSX.Element {
  const isPlayed = track.status === 'PLAYED';
  const isCurrent = track.status === 'CURRENT';

  const rowClass = [
    'flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors border',
    isCurrent
      ? dark
        ? 'border-[#FF5C4D66] bg-[#FF5C4D1f]'
        : 'bg-spritz/20 border-spritz-deep'
      : 'border-transparent',
    isPlayed ? 'opacity-50' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li className={rowClass}>
      <span
        className={`font-mono text-xs tabular-nums w-6 shrink-0 text-right ${dark ? 'text-white/45' : 'text-ink-soft'}`}
      >
        {String(track.position + 1).padStart(2, '0')}
      </span>

      {track.cover_url ? (
        <img
          src={track.cover_url}
          alt=""
          className={`w-9 h-9 rounded shrink-0 object-cover border ${dark ? 'border-white/10' : 'border-ink/10'}`}
          loading="lazy"
        />
      ) : (
        <div
          className={`w-9 h-9 rounded shrink-0 border ${dark ? 'border-white/10 bg-white/5' : 'border-ink/10 bg-cream-2'}`}
        />
      )}

      <div className="min-w-0 flex-1">
        <p className={`font-display text-sm break-words ${dark ? 'text-white' : 'text-ink'}`}>
          {track.title}
        </p>
        <p
          className={`font-editorial italic text-xs break-words ${dark ? 'text-white/55' : 'text-ink-2'}`}
        >
          {track.artist}
          {track.year ? ` · ${track.year}` : ''}
        </p>
      </div>

      <StatusBadge status={track.status} dark={dark} />
    </li>
  );
}

function StatusBadge({
  status,
  dark,
}: {
  status: RoundProgramItem['status'];
  dark: boolean;
}): JSX.Element | null {
  const { t } = useTranslation();
  if (status === 'CURRENT') {
    return (
      <span
        className={`font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${dark ? 'text-[#0B0B0F]' : 'bg-spritz-deep text-cream'}`}
        style={dark ? { backgroundColor: CORAL } : undefined}
      >
        {t('host.programStatusCurrent')}
      </span>
    );
  }
  if (status === 'PLAYED') {
    return (
      <span
        className={`font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${dark ? 'bg-white/10 text-white/50' : 'bg-ink/10 text-ink-soft'}`}
      >
        {t('host.programStatusPlayed')}
      </span>
    );
  }
  return null;
}
