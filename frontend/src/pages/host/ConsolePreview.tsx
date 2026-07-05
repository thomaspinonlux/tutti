/**
 * TEMPORAIRE — harnais de preview : console animateur en thème SOMBRE premium
 * (cohérent avec l'écran TV). À SUPPRIMER après validation. Handlers no-op.
 */
import { useState } from 'react';
import type { CurrentTrackState } from '@tutti/shared';
import { PlayerControls } from '../../components/host/PlayerControls.js';
import { SeekBar } from '../../components/host/SeekBar.js';

const CORAL = '#FF5C4D';
const PANEL =
  'rounded-[24px] bg-[#15151d]/80 backdrop-blur-xl border border-white/[0.07] shadow-[0_24px_70px_rgba(0,0,0,0.55)]';

function track(phase: string, index = 3): CurrentTrackState {
  return {
    round_id: 'r1',
    track_index: index,
    track_id: 't1',
    provider: 'spotify',
    provider_track_id: 'x',
    artist: 'Daft Punk',
    title: 'One More Time',
    album: 'Discovery',
    year: 2001,
    cover_url: null,
    started_at: new Date().toISOString(),
    duration_ms: 30000,
    phase: phase as CurrentTrackState['phase'],
    phase2_started_at: null,
    correct_answers: [],
  };
}

const SCENARIOS: Record<string, { isPaused: boolean; ct: CurrentTrackState; total: number }> = {
  'en cours': { isPaused: false, ct: track('phase1'), total: 15 },
  'en pause': { isPaused: true, ct: track('phase1'), total: 15 },
  'phase 2': { isPaused: false, ct: track('phase2'), total: 15 },
  'dernier morceau': { isPaused: false, ct: track('phase1', 14), total: 15 },
};

const noop = (): void => undefined;

export function ConsolePreview(): JSX.Element {
  const [key, setKey] = useState<keyof typeof SCENARIOS>('en cours');
  const s = SCENARIOS[key]!;
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0B0B0F] to-[#14141C] text-white">
      <div className="mx-auto w-full max-w-3xl p-8">
        <div className="mb-6 flex flex-wrap gap-2">
          {Object.keys(SCENARIOS).map((k) => (
            <button
              key={k}
              data-scenario={k}
              onClick={() => setKey(k as keyof typeof SCENARIOS)}
              className={`rounded-full px-3 py-1 text-xs font-mono uppercase ${
                k === key ? 'text-[#0B0B0F]' : 'bg-white/10 text-white'
              }`}
              style={k === key ? { backgroundColor: CORAL } : undefined}
            >
              {k}
            </button>
          ))}
        </div>

        {/* Carte console (panneau premium sombre). */}
        <div className={`${PANEL} p-8`}>
          <div className="mb-6 flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-white/50">
              Console animateur
            </span>
            <span
              className="rounded-full px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-[#0B0B0F]"
              style={{ backgroundColor: CORAL }}
            >
              Manche 1
            </span>
          </div>

          {/* Bloc morceau (privé animateur). */}
          <div className="mb-6 flex items-center gap-4">
            <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl bg-white/[0.06] ring-1 ring-white/10 font-display text-3xl text-white/70">
              ♪
            </div>
            <div className="min-w-0">
              <p className="font-display text-3xl leading-tight text-white">One More Time</p>
              <p className="font-editorial text-lg italic text-white/55">Daft Punk</p>
              <p className="font-mono text-xs text-white/40">Discovery · 2001</p>
            </div>
          </div>

          {/* Barre de temps (seek) sombre. */}
          <SeekBar positionMs={11_000} durationMs={30_000} onSeek={noop} dark />

          {/* Contrôles sombres. */}
          <PlayerControls
            currentTrack={s.ct}
            isPaused={s.isPaused}
            busy={false}
            totalTracks={s.total}
            onNextTrack={noop}
            onEndRound={noop}
            onPauseAudio={noop}
            onResumeAudio={noop}
            onRestartTrack={noop}
            onRevealAnswer={noop}
            dark
          />
        </div>
      </div>
    </div>
  );
}
