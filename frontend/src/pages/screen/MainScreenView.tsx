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
import { fireConfetti } from '../../components/ui/Confetti.js';
import { QRCode } from '../../components/host/QRCode.js';

// ── Hooks utilitaires ─────────────────────────────────────────────────────

/**
 * Timer pause-aware : décompte vers 0 sur durationMs, gelé quand isPaused=true.
 * Reset auto quand startedAtIso change.
 *
 * Implémentation : on décrémente `remaining` par delta réel entre 2 ticks
 * UNIQUEMENT quand !isPaused. Pendant pause, on rafraîchit la ref de
 * dernier tick mais on ne décrémente pas, donc le timer fige.
 */
export function useTimeRemaining(
  startedAtIso: string,
  durationMs: number,
  isPaused = false,
): number {
  const [remaining, setRemaining] = useState(durationMs);
  const lastTickRef = useRef<number>(Date.now());

  // Reset à chaque nouveau started_at (= nouveau morceau ou phase)
  useEffect(() => {
    setRemaining(durationMs);
    lastTickRef.current = Date.now();
  }, [startedAtIso, durationMs]);

  useEffect(() => {
    const tick = (): void => {
      const now = Date.now();
      const delta = now - lastTickRef.current;
      lastTickRef.current = now;
      if (!isPaused) {
        setRemaining((r) => Math.max(0, r - delta));
      }
    };
    // Met à jour immédiatement la ref pour ne pas accumuler le delta de la
    // période de pause si on entre/sort de pause.
    lastTickRef.current = Date.now();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [isPaused]);

  return remaining;
}

/**
 * Compteur "temps écoulé" pause-aware. Démarre à 0 quand startedAtIso change,
 * incrémente par delta de tick si !isPaused, fige sinon.
 */
export function useTimeElapsed(startedAtIso: string | null, isPaused = false): number {
  // Amorce depuis l'horloge serveur (now - started_at), PAS depuis 0 : sinon la barre
  // repart à 0 à chaque (re)montage — très visible quand le son est sur la TV
  // (positionMs undefined → on tombe sur ce fallback) → barre figée / en retard.
  const seed = (): number => {
    if (!startedAtIso) return 0;
    const ms = Date.now() - new Date(startedAtIso).getTime();
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  };
  const [elapsed, setElapsed] = useState(seed);
  const lastTickRef = useRef<number>(Date.now());

  useEffect(() => {
    setElapsed(seed());
    lastTickRef.current = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAtIso]);

  useEffect(() => {
    if (!startedAtIso) return;
    const tick = (): void => {
      const now = Date.now();
      const delta = now - lastTickRef.current;
      lastTickRef.current = now;
      if (!isPaused) setElapsed((e) => e + delta);
    };
    lastTickRef.current = Date.now();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [isPaused, startedAtIso]);

  return elapsed;
}

export function formatTime(ms: number): string {
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
  const { t } = useTranslation();
  // Couleurs Pop Cocktail tournantes pour la shadow décalée — cohérent
  // avec la maquette qui alterne spritz / basil / raspberry.
  const shadowColors = ['#ee6c2a', '#4a8b3f', '#c8336e'];
  const shadowColor = shadowColors[index % shadowColors.length];
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
      <span>
        {index === 0
          ? t('screen.toastFirstFound', { pseudo })
          : t('screen.toastAlsoFound', { pseudo })}
      </span>
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

function Phase2YellowTimer({
  phase2StartedAt,
  isPaused,
}: {
  phase2StartedAt: string;
  isPaused: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  const remaining = useTimeRemaining(phase2StartedAt, 10_000, isPaused);
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
  isPaused,
  positionMs,
  durationMs,
}: {
  round: SessionRoundWithPlaylist | null;
  totalTracks: number;
  trackPosition: number;
  currentTrack: CurrentTrackState | null;
  phaseLabel: string;
  isPaused: boolean;
  positionMs?: number;
  durationMs?: number;
}): JSX.Element {
  const { t } = useTranslation();
  // Source de vérité Spotify si dispo, sinon fallback interpolation
  const fallbackElapsed = useTimeElapsed(currentTrack?.started_at ?? null, isPaused);
  const elapsed = positionMs ?? fallbackElapsed;
  const totalMs = durationMs ?? currentTrack?.duration_ms ?? null;
  const remaining = totalMs ? Math.max(0, totalMs - elapsed) : null;
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
        {currentTrack && totalMs && remaining !== null && (
          <div className="font-mono text-base font-bold text-lemon tabular-nums">
            -{formatTime(remaining)}
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
  isPaused,
  positionMs,
  durationMs,
  onSkipTrack,
  onGiveAnswer,
  onNextTrack,
}: {
  participantsCount: number;
  currentTrack: CurrentTrackState | null;
  phase: CurrentTrackState['phase'] | null;
  busy: boolean;
  isPaused: boolean;
  positionMs?: number;
  durationMs?: number;
  onSkipTrack?: () => void;
  onGiveAnswer?: () => void;
  onNextTrack?: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const fallbackElapsed = useTimeElapsed(currentTrack?.started_at ?? null, isPaused);
  const elapsed = positionMs ?? fallbackElapsed;
  const totalMs = durationMs ?? currentTrack?.duration_ms ?? null;
  const progress = totalMs && totalMs > 0 ? Math.min(1, elapsed / totalMs) : 0;
  // Bouton "Suivant" mis en évidence en phase 3
  const nextHighlighted =
    phase === 'phase3' || phase === 'phase3-revealed' || phase === 'phase3-skipped';
  // Refonte #1 — bouton "Révéler la réponse" : phase 1 ET phase 2 (avant la festive)
  const canGiveAnswer = phase === 'phase1' || phase === 'phase2';
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
          variant="secondary"
          size="sm"
          onClick={onSkipTrack}
          disabled={busy || !canSkip || !currentTrack || !onSkipTrack}
        >
          ⏭ {t('screen.btnSkip')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={onGiveAnswer}
          disabled={busy || !canGiveAnswer || !currentTrack || !onGiveAnswer}
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

/**
 * Feature — QR code permanent sur l'écran TV pour permettre aux joueurs de
 * rejoindre la partie à tout moment (en cours de morceau inclus).
 */
function JoinQrPanel({ shortCode }: { shortCode: string }): JSX.Element {
  const { t } = useTranslation();
  const url = `${window.location.origin}/play?session=${shortCode}`;
  return (
    <Card size="sm" tone="cream" className="text-center">
      <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-spritz-deep mb-2">
        {t('screen.joinTitle')}
      </p>
      <div className="flex justify-center mb-2">
        <QRCode value={url} size={140} />
      </div>
      <p className="font-mono text-lg font-bold tracking-[0.2em] text-ink">{shortCode}</p>
      <p className="font-editorial italic text-[10px] text-ink-soft mt-1">{t('screen.joinHint')}</p>
    </Card>
  );
}

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
                {(entry.score_title_bonus ?? 0) > 0
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

// ── Écran RÉSULTAT (reveal phase 3) — maquette validée ────────────────────
// Reskin layout uniquement : réutilise les tokens couleur existants (ink,
// cream, plum/raspberry, lemon, spritz, basil…). Pochette dominante à gauche,
// titre > artiste, chip playlist + mini QR en haut, classement CUMUL DE LA
// PARTIE à droite (total cumulé + delta du morceau).

/** Grande pochette : vraie cover si dispo, sinon dégradé + titre en fallback. */
function RevealCover({ track, title }: { track: CurrentTrackState; title: string }): JSX.Element {
  const cover = track.cover_url;
  return (
    <div className="relative aspect-square w-full max-w-[min(48vh,540px)] animate-reveal-pop">
      <div
        className="w-full h-full border-[6px] border-ink rounded-2xl shadow-pop-xl overflow-hidden flex items-center justify-center bg-gradient-to-br from-plum to-raspberry"
        style={
          cover
            ? {
                backgroundImage: `url(${cover})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }
            : undefined
        }
      >
        {!cover && (
          <span
            className="font-display text-cream text-center px-6 text-4xl lg:text-5xl leading-tight"
            style={{ textShadow: '4px 4px 0 #1a1410' }}
          >
            {title}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Classement = CUMUL DE LA PARTIE (réutilise `cumulative`, total cumulé — aucun
 * nouveau champ backend). Par joueur, on ajoute en petit le gain de CE morceau
 * (delta `+30 ✦` si double), pour voir le classement général ET qui vient de
 * scorer. Leader doré (bg-lemon). Match cumul↔delta par id (participant OU team).
 */
function RevealLeaderboard({
  cumulative,
  correctAnswers,
}: {
  cumulative: CumulativeScore[];
  correctAnswers: CorrectAnswerEntry[];
}): JSX.Element {
  const { t } = useTranslation();
  // Delta de CE morceau par id (clé = participant_id en solo, team_id en équipe ;
  // les deux espaces d'id sont disjoints → un seul map couvre les 2 modes).
  const deltaById = useMemo(() => {
    const m = new Map<string, { gain: number; double: boolean }>();
    for (const ca of correctAnswers) {
      for (const key of [ca.participant_id, ca.team_id]) {
        if (!key) continue;
        const cur = m.get(key) ?? { gain: 0, double: false };
        cur.gain += ca.score;
        cur.double = cur.double || (ca.score_title_bonus ?? 0) > 0;
        m.set(key, cur);
      }
    }
    return m;
  }, [correctAnswers]);

  const rows = cumulative.slice(0, 8);
  const medals = ['🥇', '🥈', '🥉'];
  return (
    <Card size="md" className="!border-4 flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-2 mb-4 shrink-0">
        <span
          aria-hidden
          className="w-9 h-9 rounded-full bg-lemon border-2 border-ink flex items-center justify-center text-lg"
        >
          🏆
        </span>
        <p className="font-display text-2xl lg:text-3xl">{t('screen.leaderboardLabel')}</p>
      </div>
      {rows.length === 0 ? (
        <p className="font-editorial italic text-ink-soft text-center py-12 text-lg">
          {t('host.noScoresYet')}
        </p>
      ) : (
        <ul className="space-y-2.5 overflow-y-auto">
          {rows.map((entry, idx) => {
            const isLeader = idx === 0;
            const delta = deltaById.get(entry.id);
            return (
              <li
                key={entry.id}
                className={`grid grid-cols-[auto_1fr_auto] gap-3 items-center px-4 py-3 border-2 border-ink rounded-xl ${
                  isLeader ? 'bg-lemon shadow-pop' : 'bg-cream'
                }`}
              >
                <span className="font-display text-2xl lg:text-3xl w-10 text-center">
                  {medals[idx] ?? idx + 1}
                </span>
                <div className="min-w-0 flex items-center gap-2">
                  {entry.color && (
                    <span
                      aria-hidden
                      className="inline-block w-3 h-3 rounded-full border border-ink shrink-0"
                      style={{ backgroundColor: entry.color }}
                    />
                  )}
                  <span
                    className={`truncate font-bold ${isLeader ? 'text-2xl lg:text-3xl' : 'text-lg lg:text-xl'}`}
                  >
                    {entry.label}
                  </span>
                </div>
                <div className="text-right whitespace-nowrap">
                  <span className="font-mono font-bold tabular-nums text-ink text-xl lg:text-2xl">
                    {entry.total_points}
                  </span>
                  <span className="font-mono text-xs lg:text-sm text-ink-soft"> pts</span>
                  {delta && delta.gain > 0 && (
                    <span className="ml-2 font-mono text-sm lg:text-base font-bold text-basil-deep">
                      +{delta.gain}
                      {delta.double && (
                        <span className="text-basil" aria-label={t('screen.doubleAnswer')}>
                          {' '}
                          ✦
                        </span>
                      )}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Layout résultat complet (remplace le `<main>` standard pendant le reveal). */
function RevealResultMain({
  track,
  reveal,
  playlistName,
  cumulative,
  correctAnswers,
  joinCode,
  showConfetti,
}: {
  track: CurrentTrackState;
  reveal: { artist: string; title: string } | null;
  playlistName: string;
  cumulative: CumulativeScore[];
  correctAnswers: CorrectAnswerEntry[];
  joinCode: string;
  showConfetti: boolean;
}): JSX.Element {
  const title = reveal?.title ?? track.title;
  const artist = reveal?.artist ?? track.artist;
  const joinUrl = `${window.location.origin}/play?session=${joinCode}`;
  return (
    <main className="flex-1 grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-6 p-6 relative z-10">
      {/* Gauche — pochette dominante + infos */}
      <section className="relative bg-cream-2 border-4 border-ink rounded-3xl shadow-pop-lg flex flex-col p-6 lg:p-8 overflow-hidden min-h-[500px]">
        {/* Haut : chip playlist (gauche) + MINI QR rejoindre en coin (droite) */}
        <div className="shrink-0 flex items-start justify-between gap-3">
          <span className="inline-flex items-center gap-2 font-mono text-xs sm:text-sm uppercase tracking-[0.2em] text-spritz-deep bg-cream border-2 border-ink rounded-full px-4 py-1.5 shadow-pop-sm">
            <span aria-hidden>♪</span>
            <span className="truncate max-w-[50vw] lg:max-w-sm">{playlistName}</span>
          </span>
          <div className="flex flex-col items-center shrink-0">
            <QRCode value={joinUrl} size={72} className="!p-1.5 !shadow-pop !border-2" />
            <span className="font-mono text-[9px] uppercase tracking-wider text-ink-soft mt-0.5">
              {joinCode}
            </span>
          </div>
        </div>
        {/* Pochette GRANDE — remplit le centre */}
        <div className="flex-1 flex items-center justify-center my-4 lg:my-6 min-h-0">
          <RevealCover track={track} title={title} />
        </div>
        {/* Titre très grand (serif) > artiste grand dessous */}
        <div className="shrink-0">
          <div
            className="font-display text-ink leading-[0.92] text-5xl sm:text-6xl lg:text-7xl xl:text-8xl mb-2 animate-slide-up"
            title={title}
          >
            {title}
          </div>
          <div
            className="font-editorial italic font-semibold text-raspberry text-2xl sm:text-3xl lg:text-4xl animate-slide-up"
            style={{ animationDelay: '150ms' }}
          >
            {artist}
          </div>
        </div>
        {showConfetti && (
          <div aria-hidden className="absolute inset-0 pointer-events-none overflow-hidden">
            <ConfettiBurst />
          </div>
        )}
      </section>

      {/* Droite — classement CUMUL DE LA PARTIE, large, leader doré */}
      <aside className="min-w-0 flex flex-col">
        <RevealLeaderboard cumulative={cumulative} correctAnswers={correctAnswers} />
      </aside>
    </main>
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
  /** Position audio en ms (depuis Spotify SDK si dispo, sinon interpolation). */
  positionMs?: number;
  /** Durée totale track en ms (depuis SDK ou track meta). */
  durationMs?: number;
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
    positionMs,
    durationMs,
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
  // Confettis SEULEMENT s'il y a au moins un gagnant (correctAnswers > 0).
  // "Donner la réponse" sans gagnant → reveal sans fête.
  const hadWinner = correctAnswers.length > 0;
  const showConfetti = isRevealed && hadWinner;

  // Burst canvas-confetti plein-écran quand on bascule en phase reveal+gagnant.
  // Un burst PAR track (key = track_id) — pas de double-tir si re-render.
  // Tir multi-points pour effet plus impressionnant que la salve unique au centre.
  const lastConfettiTrackRef = useRef<string | null>(null);
  const trackKey = currentTrack?.track_id ?? null;
  useEffect(() => {
    if (!showConfetti || !trackKey) return;
    if (lastConfettiTrackRef.current === trackKey) return;
    lastConfettiTrackRef.current = trackKey;
    // Triple burst : centre + 2 côtés
    fireConfetti({ x: 0.5, y: 0.5, particleCount: 100 });
    window.setTimeout(() => fireConfetti({ x: 0.2, y: 0.4, particleCount: 60 }), 200);
    window.setTimeout(() => fireConfetti({ x: 0.8, y: 0.4, particleCount: 60 }), 400);
  }, [showConfetti, trackKey]);

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
      <FestiveBackground confettiActive={showConfetti} />

      <IPadHeader
        round={playingRound}
        totalTracks={totalTracks}
        trackPosition={trackPosition}
        currentTrack={currentTrack}
        phaseLabel={phaseLabel}
        isPaused={session.is_paused}
        positionMs={positionMs}
        durationMs={durationMs}
      />

      {isRevealed && currentTrack && playingRound ? (
        /* Écran RÉSULTAT (reveal) — maquette validée, tokens existants réutilisés. */
        <RevealResultMain
          track={currentTrack}
          reveal={lastReveal}
          playlistName={playingRound.playlist.name}
          cumulative={cumulative}
          correctAnswers={correctAnswers}
          joinCode={session.short_code}
          showConfetti={showConfetti}
        />
      ) : (
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

                {/* Phase 2 — timer jaune décollé droite (gelé si pause) */}
                {isPhase2 && phase2StartedAt && (
                  <Phase2YellowTimer
                    phase2StartedAt={phase2StartedAt}
                    isPaused={session.is_paused}
                  />
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

                {/* Confettis confinés au stage — seulement si gagnant. */}
                {showConfetti && (
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
            {/* Refonte #5 — affichage live phase 2 (entre 1er gagnant et fin) :
              les retardataires voient les positions actuelles + qui a déjà
              le bonus titre, pour estimer s'ils peuvent encore scorer. */}
            {isPhase2 && correctAnswers.length > 0 && (
              <FindersRecap correctAnswers={correctAnswers} />
            )}
            {isPhase3 && correctAnswers.length > 0 && (
              <FindersRecap correctAnswers={correctAnswers} />
            )}
            {/* Feature — QR code permanent pour rejoindre en cours de partie */}
            <JoinQrPanel shortCode={session.short_code} />
          </aside>
        </main>
      )}

      <IPadFooter
        participantsCount={participantsCount}
        currentTrack={currentTrack}
        phase={phase}
        busy={busy}
        isPaused={session.is_paused}
        positionMs={positionMs}
        durationMs={durationMs}
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
