/**
 * TEMPORAIRE — harnais de preview pour capturer le restyle sombre de l'écran TV.
 * À SUPPRIMER après validation (route + fichier). Aucune logique produit.
 */
import { useState } from 'react';
import type { MainScreenViewProps } from './MainScreenView.js';
import { TvScreenView } from './TvScreenView.js';

const cover =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5c4d"/><stop offset="1" stop-color="#6e3a6e"/></linearGradient></defs><rect width="600" height="600" fill="url(#g)"/><circle cx="300" cy="300" r="120" fill="#0b0b0f"/><circle cx="300" cy="300" r="30" fill="#ff5c4d"/></svg>`,
  );

const players = [
  { id: 'p1', pseudo: 'Marie', team_id: null, is_master: false, is_kicked: false },
  { id: 'p2', pseudo: 'Thomas', team_id: null, is_master: true, is_kicked: false },
  { id: 'p3', pseudo: 'Léa', team_id: null, is_master: false, is_kicked: false },
];

const cumulative = [
  { id: 'p2', label: 'Thomas', color: null, total_points: 240 },
  { id: 'p1', label: 'Marie', color: null, total_points: 180 },
  { id: 'p3', label: 'Léa', color: null, total_points: 95 },
];

const round = {
  id: 'r1',
  position: 1,
  status: 'PLAYING',
  current_track_index: 2,
  playlist: { id: 'pl1', name: 'Totally 2000', tracks_count: 15 },
};

const baseSession = {
  short_code: 'KOMP-T94M',
  is_paused: false,
  participants: players,
  rounds: [round],
};

function track(phase: string) {
  return {
    round_id: 'r1',
    track_index: 2,
    track_id: 't1',
    provider: 'spotify',
    provider_track_id: 'x',
    artist: 'Daft Punk',
    title: 'One More Time',
    album: 'Discovery',
    year: 2001,
    cover_url: cover,
    started_at: new Date(Date.now() - 8000).toISOString(),
    duration_ms: 30000,
    phase,
    phase2_started_at: null,
    correct_answers: [],
  };
}

const answers = [
  {
    participant_id: 'p1',
    team_id: null,
    pseudo: 'Marie',
    position: 1,
    answered_at_ms: 4200,
    score: 30,
    score_title_bonus: 10,
  },
];

const SCENARIOS: Record<string, MainScreenViewProps> = {
  ready: {
    session: { ...baseSession, rounds: [{ ...round, status: 'PLAYING' }] },
    currentTrack: null,
    cumulative,
    correctAnswers: [],
    phase2StartedAt: null,
    lastReveal: null,
    activeBuzzCount: 0,
  } as unknown as MainScreenViewProps,
  listening: {
    session: baseSession,
    currentTrack: track('phase1'),
    cumulative,
    correctAnswers: [],
    phase2StartedAt: null,
    lastReveal: null,
    activeBuzzCount: 3,
  } as unknown as MainScreenViewProps,
  phase2: {
    session: baseSession,
    currentTrack: track('phase2'),
    cumulative,
    correctAnswers: answers,
    phase2StartedAt: new Date(Date.now() - 4000).toISOString(),
    lastReveal: null,
    activeBuzzCount: 0,
  } as unknown as MainScreenViewProps,
  reveal: {
    session: baseSession,
    currentTrack: track('phase3-revealed'),
    cumulative,
    correctAnswers: answers,
    phase2StartedAt: null,
    lastReveal: { artist: 'Daft Punk', title: 'One More Time' },
    activeBuzzCount: 0,
  } as unknown as MainScreenViewProps,
  pause: {
    session: { ...baseSession, is_paused: true },
    currentTrack: track('phase1'),
    cumulative,
    correctAnswers: [],
    phase2StartedAt: null,
    lastReveal: null,
    activeBuzzCount: 0,
  } as unknown as MainScreenViewProps,
};

export function TvPreview(): JSX.Element {
  const [key, setKey] = useState<keyof typeof SCENARIOS>('reveal');
  return (
    <div>
      <div className="fixed top-2 left-1/2 z-[999] -translate-x-1/2 flex gap-2 rounded-full bg-black/70 px-3 py-2">
        {Object.keys(SCENARIOS).map((k) => (
          <button
            key={k}
            data-scenario={k}
            onClick={() => setKey(k as keyof typeof SCENARIOS)}
            className={`rounded-full px-3 py-1 text-xs font-mono uppercase ${k === key ? 'bg-[#FF5C4D] text-black' : 'bg-white/10 text-white'}`}
          >
            {k}
          </button>
        ))}
      </div>
      <TvScreenView {...(SCENARIOS[key] as MainScreenViewProps)} />
    </div>
  );
}
