/**
 * <TrackRowWithCheckbox /> — ligne de track avec checkbox + flags (remix /
 * durée hors-range / doublon). Utilisée par les 3 modes d'import.
 */

import type { TrackResult } from '@tutti/shared';
import type { TrackFlags } from '../../../../lib/trackFilters.js';
import { formatDurationMs } from '../../../../lib/trackFilters.js';

interface Props {
  track: TrackResult;
  flags: TrackFlags;
  selected: boolean;
  onToggle: () => void;
}

export function TrackRowWithCheckbox({ track, flags, selected, onToggle }: Props): JSX.Element {
  const popularity = track.popularity ?? 0;
  const stars =
    '★'.repeat(Math.round(popularity / 20)) + '☆'.repeat(5 - Math.round(popularity / 20));

  return (
    <li
      className={`flex items-center gap-3 px-3 py-2 border-2 rounded transition-colors ${
        selected ? 'bg-cream border-ink' : 'bg-cream-2/50 border-ink/30'
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="w-5 h-5 accent-ink shrink-0"
        aria-label={`Sélectionner ${track.title}`}
      />
      {track.cover_url ? (
        <img
          src={track.cover_url}
          alt=""
          loading="lazy"
          className="w-10 h-10 rounded border-2 border-ink shrink-0 object-cover"
        />
      ) : (
        <div className="w-10 h-10 rounded border-2 border-ink shrink-0 bg-cream-2" />
      )}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{track.title}</p>
        <p className="font-mono text-[11px] text-ink-soft truncate">
          {track.artist}
          {track.year && ` · ${track.year}`}
          {track.duration_ms && ` · ${formatDurationMs(track.duration_ms)}`}
          <span className="ml-2 text-ink/60">{stars}</span>
        </p>
        {(flags.isRemix || flags.outsideDurationRange || flags.isDuplicate) && (
          <div className="flex flex-wrap gap-1 mt-1">
            {flags.isRemix && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 border border-lemon-deep bg-lemon/40 rounded">
                ⚠️ Version non standard
              </span>
            )}
            {flags.outsideDurationRange && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 border border-plum bg-plum/20 rounded">
                ⏱ Hors range durée
              </span>
            )}
            {flags.isDuplicate && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 border border-raspberry bg-raspberry/15 rounded">
                ↺ Déjà dans {flags.duplicatePlaylistName ?? '?'}
              </span>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
