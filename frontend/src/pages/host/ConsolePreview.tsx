/**
 * TEMPORAIRE — harnais de preview pour valider le nettoyage des contrôles de la
 * console animateur. À SUPPRIMER après validation (route + fichier). Aucune
 * logique produit : handlers no-op, données mock.
 */
import { useState } from 'react';
import type { CurrentTrackState } from '@tutti/shared';
import { Button, Card, MultiColorBar } from '../../components/ui/index.js';
import { PlayerControls } from '../../components/host/PlayerControls.js';

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
    <div className="min-h-screen bg-cream flex flex-col">
      <MultiColorBar height="md" />
      <div className="mx-auto w-full max-w-3xl p-6">
        <div className="mb-5 flex flex-wrap gap-2">
          {Object.keys(SCENARIOS).map((k) => (
            <button
              key={k}
              data-scenario={k}
              onClick={() => setKey(k as keyof typeof SCENARIOS)}
              className={`rounded-full border-2 border-ink px-3 py-1 text-xs font-mono uppercase ${k === key ? 'bg-ink text-cream' : 'bg-cream text-ink'}`}
            >
              {k}
            </button>
          ))}
        </div>

        {/* Contexte console mode A (carte spritz comme RoundPlayingScreen). */}
        <Card tone="spritz" size="lg" className="text-center">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-soft mb-2">
            Console animateur — contrôles
          </p>
          <p className="font-editorial italic text-ink-2 mb-2">Totally 2000 · morceau en cours</p>
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
          />
        </Card>

        {/* Footer mode B (sur fond ink) — boutons secondary bordés. */}
        <div className="mt-8">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-soft mb-2">
            Mode B — footer (sur fond sombre)
          </p>
          <div className="flex items-center gap-3 rounded-2xl bg-ink px-6 py-4">
            <span className="flex-1 text-cream font-mono text-xs">♪ progression…</span>
            <Button variant="secondary" size="sm" onClick={noop}>
              ⏭ Sauter
            </Button>
            <Button variant="secondary" size="sm" onClick={noop}>
              💡 Réponse
            </Button>
            <Button variant="primary" size="sm" onClick={noop}>
              Suivant →
            </Button>
          </div>
        </div>
      </div>
      <MultiColorBar height="md" />
    </div>
  );
}
