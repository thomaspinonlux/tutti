/**
 * SeekBar — barre de temps SEEKABLE de la console animateur (extraite de
 * AnimatorTrackInfo). Affordance de seek renforcée : poignée (knob) visible,
 * barre plus haute et arrondie, temps écoulé / restant lisibles.
 *
 * Comportement INCHANGÉ : drag = valeur locale (dragMs), commit onSeek au
 * relâcher (pas de bataille avec le tick 250ms). Pointer capture pour le drag.
 */

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

export interface SeekBarProps {
  positionMs: number;
  durationMs: number;
  onSeek: (ms: number) => void;
}

function fmt(ms: number): string {
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

export function SeekBar({ positionMs, durationMs, onSeek }: SeekBarProps): JSX.Element {
  const { t } = useTranslation();
  const total = durationMs || 0;
  const [dragMs, setDragMs] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const seekable = total > 0;

  const msFromClientX = (clientX: number): number => {
    const el = barRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const ratio = r.width > 0 ? (clientX - r.left) / r.width : 0;
    return Math.min(total, Math.max(0, ratio * total));
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!seekable) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragMs(msFromClientX(e.clientX));
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragMs === null) return;
    setDragMs(msFromClientX(e.clientX));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragMs === null) return;
    const target = msFromClientX(e.clientX);
    setDragMs(null);
    onSeek(target);
  };

  const elapsed = Math.min(dragMs ?? positionMs, total);
  const remaining = Math.max(0, total - elapsed);
  const progress = total > 0 ? elapsed / total : 0;
  const dragging = dragMs !== null;

  return (
    <div className="mx-auto max-w-md">
      <div
        ref={barRef}
        role="slider"
        aria-label={t('host.seekBar')}
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(elapsed)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className={`group relative flex h-6 items-center ${seekable ? 'cursor-pointer touch-none' : ''}`}
      >
        {/* Rail */}
        <div className="relative h-2.5 w-full overflow-visible rounded-full border-2 border-ink bg-cream-2">
          {/* Remplissage */}
          <div
            className="h-full rounded-full bg-spritz-deep"
            style={{
              width: `${Math.round(progress * 100)}%`,
              transition: dragging ? 'none' : 'width 150ms linear',
            }}
          />
          {/* Poignée (knob) — affordance de seek */}
          {seekable && (
            <span
              aria-hidden
              className={`absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-cream shadow-pop-sm transition-transform ${
                dragging ? 'scale-110' : 'group-hover:scale-110'
              }`}
              style={{
                left: `${Math.round(progress * 100)}%`,
                transition: dragging ? 'none' : 'left 150ms linear, transform 120ms ease-out',
              }}
            />
          )}
        </div>
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-xs tabular-nums text-ink-soft">
        <span>{fmt(elapsed)}</span>
        <span>-{fmt(remaining)}</span>
      </div>
    </div>
  );
}
