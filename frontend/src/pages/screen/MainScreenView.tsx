/**
 * MainScreenView — vue iPad festive et publique pour le mode B.
 *
 * Design : maquette tutti-brief/design-references/06-mode-b-3-phases.html
 *
 * Layout grid : [80px header] / [1fr main] / [100px footer]
 *   - Header ink : logo + manche + chrono morceau + indicateur phase
 *   - Main : center-stage (avec overlays phase-aware) + right panel
 *   - Footer ink : joueurs en ligne + barre progression morceau + boutons
 *     admin (Sauter / Donner réponse / Morceau suivant)
 *
 * Les boutons admin du footer dupliquent ceux du tel master (mode B), pour
 * permettre au créateur de piloter depuis l'iPad ou son tel selon la
 * situation. Auth Supabase requise (la page /host est gated par requireAuth).
 *
 * Phases :
 *   - phase1 : pochette mystère, buzz counter top-left, pas de timer
 *   - phase2 : pochette TOUJOURS mystère (correction spec — pas de leak),
 *              timer 15s en boîte jaune décollée à droite, toasts
 *              "Marie a trouvé !" empilés au top du stage
 *   - phase3 : reveal animé du morceau, confettis confinés au stage,
 *              bandeau "Jouez, chantez, dansez !" en bas du stage,
 *              recap des trouveurs en sidebar
 *   - phase3-revealed : idem phase3 mais via "Donner la réponse"
 *   - phase3-skipped : pas de reveal, message "Morceau passé"
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  CorrectAnswerEntry,
  CumulativeScore,
  CurrentTrackState,
  Participant,
  SessionRoundWithPlaylist,
  SessionWithParticipants,
} from '@tutti/shared';
import { Badge, Button, Card, TitleHandwritten, Underline } from '../../components/ui/index.js';

// ── Hooks utilitaires ─────────────────────────────────────────────────────

function useTimeRemaining(startedAtIso: string, durationMs: number): number {
  const [remaining, setRemaining] = useState(() => {
    const elapsed = Date.now() - new Date(startedAtIso).getTime();
    return Math.max(0, durationMs - elapsed);
  });
  useEffect(() => {
    const tick = (): void => {
      const elapsed = Date.now() - new Date(startedAtIso).getTime();
      setRemaining(Math.max(0, durationMs - elapsed));
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [startedAtIso, durationMs]);
  return remaining;
}

/** Tick chaque seconde — utilisé pour rafraîchir des compteurs côté UI. */
function useNowTick(intervalMs = 500): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Background ambient (color pulse continu, confettis seulement phase 3) ──

function FestiveBackground({ confettiActive }: { confettiActive: boolean }): JSX.Element {
  return (
    <div aria-hidden className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
      <div className="absolute inset-0 animate-color-pulse" />
      {confettiActive && <ConfettiBurst />}
    </div>
  );
}

/**
 * Confettis confinés au panneau central (cf. maquette : pas tout l'écran).
 * Spawn ~12 morceaux en burst, animation 5-9s, couleurs Pop Cocktail.
 */
function ConfettiBurst(): JSX.Element {
  const [pieces] = useState(() =>
    Array.from({ length: 14 }, (_, i) => ({
      id: i,
      left: `${Math.round(Math.random() * 100)}%`,
      delay: `${Math.round(Math.random() * 2000)}ms`,
      duration: `${4 + Math.round(Math.random() * 3)}s`,
      color: ['#ee6c2a', '#4a8b3f', '#c8336e', '#e8c547', '#6e3a6e', '#e89a64'][i % 6],
      width: 10 + Math.round(Math.random() * 6),
      height: 14 + Math.round(Math.random() * 6),
      rotate: Math.round(Math.random() * 360),
      isCircle: i % 3 === 0,
    })),
  );
  return (
    <>
      {pieces.map((c) => (
        <span
          key={c.id}
          className="absolute top-0 animate-confetti-fall border-2 border-ink"
          style={{
            left: c.left,
            width: `${c.width}px`,
            height: `${c.height}px`,
            backgroundColor: c.color,
            animationDelay: c.delay,
            animationDuration: c.duration,
            transform: `rotate(${c.rotate}deg)`,
            borderRadius: c.isCircle ? '50%' : '0',
          }}
        />
      ))}
    </>
  );
}

// ── Pochette mystère / révélée ────────────────────────────────────────────

function MysteryCover({
  track,
  revealed,
}: {
  track: CurrentTrackState;
  revealed: boolean;
}): JSX.Element {
  const cover = track.cover_url;
  if (!revealed) {
    // Mystère : flou + emoji ♪ centré (compromis vs maquette dégradé pur,
    // car on a la cover_url Spotify qu'on conserve sous le flou).
    return (
      <div className="relative w-72 h-72 sm:w-[360px] sm:h-[360px] mx-auto">
        <div
          className="w-full h-full border-[6px] border-ink rounded-2xl shadow-pop-xl overflow-hidden bg-gradient-to-br from-plum to-raspberry"
          style={{
            backgroundImage: cover ? `url(${cover})` : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(40px) saturate(0.4)',
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            aria-hidden
            className="font-display text-[200px] text-cream animate-float-question"
            style={{ textShadow: '6px 6px 0 #1a1410' }}
          >
            ?
          </span>
        </div>
      </div>
    );
  }
  // Révélée : cover_url claire, animation reveal-pop
  return (
    <div className="relative w-72 h-72 sm:w-[360px] sm:h-[360px] mx-auto animate-reveal-pop">
      <div
        className="w-full h-full border-[6px] border-ink rounded-2xl shadow-pop-xl overflow-hidden"
        style={{
          backgroundImage: cover ? `url(${cover})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundColor: cover ? undefined : '#3d2f24',
        }}
      />
    </div>
  );
}

// ── Phase 1 — Buzz counter (top-left du stage) ────────────────────────────

function Phase1BuzzCounter({ count }: { count: number }): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="absolute top-6 left-6 bg-ink text-cream px-4 py-3 rounded-xl flex items-center gap-2 font-bold text-sm tracking-wide shadow-pop">
      <span className="w-3 h-3 rounded-full bg-spritz animate-pulse-buzz" aria-hidden />
      <span>{t('screen.buzzCounter', { count })}</span>
    </div>
  );
}

// ── Phase 2 — Toasts "Marie a trouvé !" empilés au top du stage ───────────

function FoundToast({ pseudo, index }: { pseudo: string; index: number }): JSX.Element {
  const shadows = ['shadow-pop', 'shadow-pop'];
  const shadowColors = ['var(--c-spritz)', 'var(--c-basil)', 'var(--c-rasp)'];
  // Use inline style for shadow color rotation
  const shadowColor = shadowColors[index % shadowColors.length];
  void shadows;
  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-ink text-cream px-6 py-3 rounded-full flex items-center gap-2.5 font-bold text-lg animate-toast-slide"
      style={{
        boxShadow: `4px 4px 0 ${shadowColor}`,
        animationDelay: `${index * 100}ms`,
      }}
    >
      <span className="w-7 h-7 rounded-full bg-basil text-ink flex items-center justify-center text-base font-black">
        ✓
      </span>
      <span>{index === 0 ? `${pseudo} a trouvé !` : `${pseudo} aussi !`}</span>
    </div>
  );
}

function FoundStack({ correctAnswers }: { correctAnswers: CorrectAnswerEntry[] }): JSX.Element {
  return (
    <div className="absolute top-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3 z-20">
      {correctAnswers.map((entry, idx) => (
        <FoundToast key={entry.participant_id} pseudo={entry.pseudo} index={idx} />
      ))}
    </div>
  );
}

// ── Phase 2 — Timer jaune décollé à droite du stage ───────────────────────

function Phase2YellowTimer({ phase2StartedAt }: { phase2StartedAt: string }): JSX.Element {
  const { t } = useTranslation();
  const remaining = useTimeRemaining(phase2StartedAt, 15_000);
  const seconds = Math.max(0, Math.ceil(remaining / 1000));
  return (
    <div
      className="absolute top-1/2 right-6 -translate-y-1/2 bg-lemon border-4 border-ink rounded-2xl px-7 py-5 shadow-pop-lg text-center animate-timer-enter"
      style={{ transform: 'translateY(-50%) rotate(-3deg)' }}
    >
      <div className="font-bold text-[11px] uppercase tracking-widest mb-1">
        {t('screen.phase2TimerLabel')}
      </div>
      <div className="font-mono font-bold text-6xl leading-none animate-tick-pulse tabular-nums">
        {seconds}
      </div>
      <div className="font-editorial italic text-xs mt-1">{t('screen.phase2TimerSub')}</div>
    </div>
  );
}

// ── Phase 3 — Bandeau "Jouez, chantez, dansez !" en bas du stage ──────────

function Phase3DanceCall(): JSX.Element {
  const { t } = useTranslation();
  return (
    <div
      className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-ink text-cream px-9 py-4 rounded-full font-display text-2xl flex items-center gap-3 animate-dance-pulse"
      style={{ boxShadow: '6px 6px 0 #e8c547' }}
    >
      <span aria-hidden className="text-3xl inline-block animate-emoji-wave">
        🕺
      </span>
      <span>{t('screen.danceMessage')}</span>
      <span aria-hidden className="text-3xl inline-block animate-emoji-wave">
        💃
      </span>
    </div>
  );
}

// ── Header iPad (top, ink) ────────────────────────────────────────────────

function IPadHeader({
  round,
  totalTracks,
  trackPosition,
  currentTrack,
  phaseLabel,
}: {
  round: SessionRoundWithPlaylist | null;
  totalTracks: number;
  trackPosition: number;
  currentTrack: CurrentTrackState | null;
  phaseLabel: string;
}): JSX.Element {
  const { t } = useTranslation();
  const now = useNowTick(500);
  const elapsed = currentTrack ? now - new Date(currentTrack.started_at).getTime() : 0;
  const totalMs = currentTrack?.duration_ms ?? null;
  return (
    <header
      className="relative bg-ink text-cream px-8 flex items-center justify-between"
      style={{ height: 80 }}
    >
      <div className="flex items-center gap-5">
        <div className="font-display text-3xl text-spritz">
          Tutti
          <span aria-hidden className="inline-block w-3 h-3 bg-lemon rounded-full ml-1 align-top" />
        </div>
        <div className="font-editorial italic text-lg opacity-90 flex items-center gap-3">
          {round && (
            <span className="bg-basil text-ink px-3 py-1 rounded-full font-sans not-italic font-bold text-sm uppercase tracking-wider">
              {t('host.eyebrowPlaying', { round: round.position })}
              {totalTracks > 0 && (
                <>
                  {' '}
                  — {trackPosition}/{totalTracks}
                </>
              )}
            </span>
          )}
          {round && <span className="truncate max-w-md">{round.playlist.name}</span>}
        </div>
      </div>
      <div className="flex items-center gap-6">
        {currentTrack && totalMs && (
          <div className="font-mono text-base font-bold text-lemon tabular-nums">
            {formatTime(elapsed)} / {formatTime(totalMs)}
          </div>
        )}
        <div className="bg-spritz text-ink font-black text-xs px-3.5 py-1.5 rounded-full uppercase tracking-wider">
          {phaseLabel}
        </div>
      </div>
      {/* Multi-color signature bar */}
      <div className="absolute bottom-0 left-0 right-0 h-1 flex">
        <div className="flex-1 bg-spritz" />
        <div className="flex-1 bg-basil" />
        <div className="flex-1 bg-raspberry" />
        <div className="flex-1 bg-lemon" />
        <div className="flex-1 bg-plum" />
      </div>
    </header>
  );
}

// ── Footer iPad (bottom, ink) ─────────────────────────────────────────────

function IPadFooter({
  participantsCount,
  currentTrack,
  phase,
  busy,
  onSkipTrack,
  onGiveAnswer,
  onNextTrack,
}: {
  participantsCount: number;
  currentTrack: CurrentTrackState | null;
  phase: CurrentTrackState['phase'] | null;
  busy: boolean;
  onSkipTrack?: () => void;
  onGiveAnswer?: () => void;
  onNextTrack?: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const now = useNowTick(500);
  const elapsed = currentTrack ? now - new Date(currentTrack.started_at).getTime() : 0;
  const totalMs = currentTrack?.duration_ms ?? null;
  const progress = totalMs && totalMs > 0 ? Math.min(1, elapsed / totalMs) : 0;
  // Bouton "Suivant" mis en évidence en phase 3
  const nextHighlighted =
    phase === 'phase3' || phase === 'phase3-revealed' || phase === 'phase3-skipped';
  // Bouton "Donner réponse" disponible uniquement phase 1 (avant que quelqu'un trouve)
  const canGiveAnswer = phase === 'phase1';
  // Bouton "Sauter" disponible phase 1 et phase 2 (avant la festive)
  const canSkip = phase === 'phase1' || phase === 'phase2';

  return (
    <footer
      className="relative bg-ink text-cream px-8 flex items-center gap-6"
      style={{ height: 100 }}
    >
      <div className="flex items-center gap-2 font-bold text-sm">
        <span className="w-2.5 h-2.5 rounded-full bg-basil animate-pulse-buzz" aria-hidden />
        <span>{t('screen.online')}</span>
        <span className="bg-basil text-ink font-mono px-2.5 py-0.5 rounded-xl">
          {participantsCount}
        </span>
      </div>

      <div className="flex-1 flex items-center gap-3">
        {currentTrack && totalMs && (
          <>
            <span className="font-mono text-xs text-lemon whitespace-nowrap max-w-[200px] truncate">
              ♪ {phase === 'phase1' || phase === 'phase2' ? '???' : currentTrack.artist}
            </span>
            <div className="flex-1 h-2 bg-cream/15 rounded relative overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-spritz rounded transition-[width] duration-500 ease-linear"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <span className="font-mono text-xs text-lemon whitespace-nowrap">
              {formatTime(totalMs)}
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onSkipTrack}
          disabled={busy || !canSkip || !currentTrack || !onSkipTrack}
          className="!bg-cream !text-ink !border-cream hover:!bg-cream-2"
        >
          ⏭ {t('screen.btnSkip')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onGiveAnswer}
          disabled={busy || !canGiveAnswer || !currentTrack || !onGiveAnswer}
          className="!bg-cream !text-ink !border-cream hover:!bg-cream-2"
        >
          💡 {t('screen.btnGiveAnswer')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onNextTrack}
          disabled={busy || !currentTrack || !onNextTrack}
          className={nextHighlighted ? 'animate-btn-glow' : ''}
        >
          {t('screen.btnNext')} →
        </Button>
      </div>

      {/* Multi-color signature bar */}
      <div className="absolute bottom-0 left-0 right-0 h-1 flex">
        <div className="flex-1 bg-spritz" />
        <div className="flex-1 bg-basil" />
        <div className="flex-1 bg-raspberry" />
        <div className="flex-1 bg-lemon" />
        <div className="flex-1 bg-plum" />
      </div>
    </footer>
  );
}

// ── Sidebar : leaderboard cumulatif ───────────────────────────────────────

function LiveLeaderboard({ cumulative }: { cumulative: CumulativeScore[] }): JSX.Element {
  const { t } = useTranslation();
  const top = cumulative.slice(0, 5);
  return (
    <Card size="md" className="!border-4">
      <div className="flex items-center gap-2 mb-3">
        <span
          aria-hidden
          className="w-7 h-7 rounded-full bg-lemon border-2 border-ink flex items-center justify-center text-base"
        >
          🏆
        </span>
        <p className="font-display text-2xl">{t('screen.leaderboardLabel')}</p>
      </div>
      {top.length === 0 ? (
        <p className="font-editorial italic text-ink-soft text-sm py-6 text-center">
          {t('host.noScoresYet')}
        </p>
      ) : (
        <ul className="space-y-2">
          {top.map((entry, idx) => {
            const tone =
              idx === 0
                ? 'bg-lemon'
                : idx === 1
                  ? 'bg-cream-2'
                  : idx === 2
                    ? 'bg-cream-3'
                    : 'bg-cream-2';
            return (
              <li
                key={entry.id}
                className={`grid grid-cols-[32px_1fr_auto] gap-3 items-center px-3 py-2.5 border-2 border-ink rounded-xl ${tone} font-bold`}
              >
                <span className="font-display text-2xl text-center">{idx + 1}</span>
                <div className="min-w-0">
                  <div className="text-sm truncate">{entry.label}</div>
                  {entry.color && (
                    <span
                      aria-hidden
                      className="inline-block w-2.5 h-2.5 rounded-full border border-ink mt-0.5"
                      style={{ backgroundColor: entry.color }}
                    />
                  )}
                </div>
                <span className="font-mono text-lg tabular-nums">{entry.total_points}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ── Sidebar : "Sur ce morceau" recap (phase 3 only) ───────────────────────

function FindersRecap({ correctAnswers }: { correctAnswers: CorrectAnswerEntry[] }): JSX.Element {
  const { t } = useTranslation();
  if (correctAnswers.length === 0) return <></>;
  const medals = ['🥇', '🥈', '🥉'];
  return (
    <Card size="md" className="!border-4 animate-slide-up">
      <div className="flex items-center gap-2 mb-3">
        <span
          aria-hidden
          className="w-7 h-7 rounded-full bg-spritz border-2 border-ink flex items-center justify-center text-base"
        >
          🎯
        </span>
        <p className="font-display text-2xl">{t('screen.thisTrack')}</p>
      </div>
      <ul className="space-y-2">
        {correctAnswers.map((entry, idx) => (
          <li
            key={entry.participant_id}
            className="grid grid-cols-[auto_1fr_auto] gap-3 items-center px-3 py-2.5 bg-cream border-2 border-ink rounded-xl"
          >
            <span aria-hidden className="text-2xl">
              {medals[idx] ?? '🎯'}
            </span>
            <div className="font-bold">
              {entry.pseudo}
              <small className="block font-editorial italic font-normal text-xs opacity-70">
                {entry.matched_title
                  ? t('screen.finderArtistAndTitle', {
                      seconds: (entry.answered_at_ms / 1000).toFixed(1),
                    })
                  : t('screen.finderArtistOnly', {
                      seconds: (entry.answered_at_ms / 1000).toFixed(1),
                    })}
              </small>
            </div>
            <span className="font-mono font-bold text-lg text-basil-deep">+{entry.score}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ── Vue principale ────────────────────────────────────────────────────────

export interface MainScreenViewProps {
  session: SessionWithParticipants;
  currentTrack: CurrentTrackState | null;
  cumulative: CumulativeScore[];
  correctAnswers: CorrectAnswerEntry[];
  phase2StartedAt: string | null;
  lastReveal: { artist: string; title: string } | null;
  /** Compte de joueurs avec un buzz ouvert (phase 1 counter). */
  activeBuzzCount: number;
  /** Handlers admin (footer iPad — disponibles si auth Supabase). */
  busy?: boolean;
  onSkipTrack?: () => void;
  onGiveAnswer?: () => void;
  onNextTrack?: () => void;
}

export function MainScreenView(props: MainScreenViewProps): JSX.Element {
  const {
    session,
    currentTrack,
    cumulative,
    correctAnswers,
    phase2StartedAt,
    lastReveal,
    activeBuzzCount,
    busy = false,
    onSkipTrack,
    onGiveAnswer,
    onNextTrack,
  } = props;
  const { t } = useTranslation();

  const playingRound = session.rounds.find((r) => r.status === 'PLAYING') ?? null;
  const lastEnded = [...session.rounds].reverse().find((r) => r.status === 'ENDED') ?? null;
  const master = session.participants.find((p) => p.is_master) ?? null;
  const totalTracks = playingRound?.playlist.tracks_count ?? 0;
  const trackPosition = currentTrack
    ? currentTrack.track_index + 1
    : (playingRound?.current_track_index ?? 0) + 1;

  const phase = currentTrack?.phase ?? null;
  const isRevealed = phase === 'phase3' || phase === 'phase3-revealed';
  const isPhase3 = isRevealed || phase === 'phase3-skipped';
  const isPhase2 = phase === 'phase2';
  const isPhase1 = phase === 'phase1';

  const phaseLabel = useMemo(() => {
    if (phase === 'phase1') return t('screen.phaseLabel1');
    if (phase === 'phase2') return t('screen.phaseLabel2');
    if (phase === 'phase3-skipped') return t('screen.phaseLabel3Skipped');
    if (phase === 'phase3-revealed' || phase === 'phase3') return t('screen.phaseLabel3');
    return t('screen.phaseLabelWaiting');
  }, [phase, t]);

  // Compte des participants présents pour le footer.
  const participantsCount = useMemo(
    () => session.participants.filter((p) => !p.is_kicked).length,
    [session.participants],
  );

  return (
    <div className="min-h-screen flex flex-col relative">
      <FestiveBackground confettiActive={isRevealed} />

      <IPadHeader
        round={playingRound}
        totalTracks={totalTracks}
        trackPosition={trackPosition}
        currentTrack={currentTrack}
        phaseLabel={phaseLabel}
      />

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6 p-6 relative z-10">
        {/* Center stage */}
        <section className="relative bg-cream-2 border-4 border-ink rounded-3xl shadow-pop-lg flex flex-col items-center justify-center p-8 overflow-hidden min-h-[500px]">
          {!playingRound ? (
            <BetweenRoundsContent lastEnded={lastEnded} master={master} />
          ) : !currentTrack ? (
            <WaitingTrackContent round={playingRound} />
          ) : (
            <>
              {/* Phase 1 — buzz counter */}
              {isPhase1 && <Phase1BuzzCounter count={activeBuzzCount} />}

              {/* Phase 2 — found stack au top du stage */}
              {isPhase2 && correctAnswers.length > 0 && (
                <FoundStack correctAnswers={correctAnswers} />
              )}

              {/* Phase 2 — timer jaune décollé droite */}
              {isPhase2 && phase2StartedAt && (
                <Phase2YellowTimer phase2StartedAt={phase2StartedAt} />
              )}

              {/* Cover — mystère en phase 1+2, révélée en phase 3 */}
              <MysteryCover track={currentTrack} revealed={isRevealed} />

              {/* Track info — révélée en phase 3 uniquement */}
              {isRevealed && (
                <div className="text-center mt-6">
                  <div
                    className="font-display text-5xl text-ink leading-none mb-1 animate-slide-up"
                    style={{ animationDelay: '200ms' }}
                  >
                    {lastReveal?.artist ?? currentTrack.artist}
                  </div>
                  <div
                    className="font-editorial italic text-2xl text-raspberry font-semibold animate-slide-up"
                    style={{ animationDelay: '400ms' }}
                  >
                    {lastReveal?.title ?? currentTrack.title}
                  </div>
                </div>
              )}

              {/* Phase 3-skipped : message neutre, pas de reveal */}
              {phase === 'phase3-skipped' && (
                <div className="text-center mt-6">
                  <p className="font-display text-3xl text-ink-soft mb-1">⏭</p>
                  <p className="font-editorial italic text-ink-2 text-lg">
                    {t('screen.trackSkipped')}
                  </p>
                </div>
              )}

              {/* Phase 1 hint — "écoute et buzze" */}
              {isPhase1 && (
                <p className="font-editorial italic text-ink-2 text-lg mt-6">
                  {t('screen.listenAndBuzz')}
                </p>
              )}

              {/* Phase 3 — bandeau dance call */}
              {isRevealed && <Phase3DanceCall />}

              {/* Confettis confinés au stage */}
              {isRevealed && (
                <div aria-hidden className="absolute inset-0 pointer-events-none overflow-hidden">
                  <ConfettiBurst />
                </div>
              )}
            </>
          )}
        </section>

        {/* Right panel */}
        <aside className="flex flex-col gap-5 min-w-0">
          <LiveLeaderboard cumulative={cumulative} />
          {isPhase3 && correctAnswers.length > 0 && (
            <FindersRecap correctAnswers={correctAnswers} />
          )}
        </aside>
      </main>

      <IPadFooter
        participantsCount={participantsCount}
        currentTrack={currentTrack}
        phase={phase}
        busy={busy}
        onSkipTrack={onSkipTrack}
        onGiveAnswer={onGiveAnswer}
        onNextTrack={onNextTrack}
      />

      {/* Overlay PAUSE master */}
      {session.is_paused && (
        <div className="fixed inset-0 z-30 bg-ink/40 flex items-center justify-center animate-fade-in">
          <div className="bg-cream border-4 border-ink rounded-lg shadow-pop-xl px-12 py-10 text-center">
            <p className="text-7xl mb-2">⏸</p>
            <TitleHandwritten as="h2" className="text-4xl">
              {t('screen.pauseTitle')}
            </TitleHandwritten>
            <p className="font-editorial italic text-ink-2 mt-2 text-lg">{t('screen.pauseHint')}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sous-vues "en attente" (round pas démarré ou pas encore de track) ────

function WaitingTrackContent({ round }: { round: SessionRoundWithPlaylist }): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="text-center">
      <TitleHandwritten as="h2" className="mb-3">
        <Underline>{round.playlist.name}</Underline>
      </TitleHandwritten>
      <p className="font-editorial italic text-ink-2 text-xl">{t('screen.waitingTrack')}</p>
      <p className="font-mono text-sm text-ink-soft mt-3">{t('screen.waitingTrackHint')}</p>
    </div>
  );
}

function BetweenRoundsContent({
  lastEnded,
  master,
}: {
  lastEnded: SessionRoundWithPlaylist | null;
  master: Participant | null;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="text-center">
      {lastEnded ? (
        <>
          <Badge tone="cream" tilt={-1} className="mb-3">
            {t('host.roundEnded', { n: lastEnded.position })}
          </Badge>
          <TitleHandwritten as="h2" className="mb-4">
            <Underline>{lastEnded.playlist.name}</Underline>
          </TitleHandwritten>
        </>
      ) : (
        <TitleHandwritten as="h2" className="mb-4">
          <Underline>{t('screen.firstRoundComing')}</Underline>
        </TitleHandwritten>
      )}
      <p className="font-editorial italic text-ink-2 text-xl">
        {master
          ? t('screen.waitingMasterPick', { pseudo: master.pseudo })
          : t('screen.waitingAnyPick')}
      </p>
      <p className="font-mono text-sm text-ink-soft mt-3">{t('screen.takeABreak')}</p>
    </div>
  );
}

// (Référence non utilisée mais conservée pour TS — useRef est importé pour
// d'éventuelles refs futures.)
void useRef;
