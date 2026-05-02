/**
 * <ImportFiltersBar /> — toggles filtres transverses pour les 3 modes
 * d'import : exclure remix/live, durée min/max, exclure doublons.
 */

import { formatDurationMs, type FilterOptions } from '../../../../lib/trackFilters.js';

interface Props {
  options: FilterOptions;
  onChange: (next: FilterOptions) => void;
}

export function ImportFiltersBar({ options, onChange }: Props): JSX.Element {
  const update = <K extends keyof FilterOptions>(key: K, value: FilterOptions[K]): void => {
    onChange({ ...options, [key]: value });
  };

  return (
    <details className="border-2 border-ink rounded bg-cream-2/30">
      <summary className="cursor-pointer px-3 py-2 font-mono text-xs uppercase tracking-wider text-ink-soft">
        ⚙ Filtres d'import
      </summary>
      <div className="p-3 space-y-3 border-t-2 border-ink/20">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={options.excludeRemixes}
            onChange={(e) => update('excludeRemixes', e.target.checked)}
            className="w-4 h-4 accent-ink"
          />
          <span>Exclure remix / live / acoustic / cover…</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={options.excludeDuplicates}
            onChange={(e) => update('excludeDuplicates', e.target.checked)}
            className="w-4 h-4 accent-ink"
          />
          <span>Exclure doublons (autres playlists Tutti)</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={options.excludeOutsideDuration}
            onChange={(e) => update('excludeOutsideDuration', e.target.checked)}
            className="w-4 h-4 accent-ink"
          />
          <span>Exclure morceaux hors range de durée</span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="block text-xs font-mono uppercase tracking-wider text-ink-soft mb-1">
              Min ({formatDurationMs(options.minDurationMs)})
            </span>
            <input
              type="range"
              min={0}
              max={300_000}
              step={15_000}
              value={options.minDurationMs}
              onChange={(e) => update('minDurationMs', Number.parseInt(e.target.value, 10))}
              className="w-full accent-spritz"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-mono uppercase tracking-wider text-ink-soft mb-1">
              Max ({formatDurationMs(options.maxDurationMs)})
            </span>
            <input
              type="range"
              min={120_000}
              max={900_000}
              step={15_000}
              value={options.maxDurationMs}
              onChange={(e) => update('maxDurationMs', Number.parseInt(e.target.value, 10))}
              className="w-full accent-spritz"
            />
          </label>
        </div>
      </div>
    </details>
  );
}
