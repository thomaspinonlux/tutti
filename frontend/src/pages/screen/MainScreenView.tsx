/**
 * MainScreenView — vue iPad festive et publique pour le mode B.
 * Affichée pendant tout le gameplay (roundPlaying / intermission), elle ne
 * comporte AUCUN contrôle (pas de boutons next/skip/end). Tout le pilotage
 * passe par le tel du master via le master menu.
 *
 * Composition :
 *   - Header discret : manche en cours, position track, badge animateur
 *   - Pochette mystère floutée pendant l'écoute, défloutée au cooldown
 *   - Grand timer central avec barre de progression
 *   - Classement live top-8 à droite
 *   - Background Pop Cocktail animé + confetti ambient
 *   - Toast XL festif quand un joueur trouve un morceau
 *   - Mini-célébration entre morceaux (révélation du titre)
 *   - Overlay PAUSE quand le master a mis le jeu en pause
 *   - Pas de panneaux administratifs visibles
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  CorrectAnswerEntry,
  CumulativeScore,
  CurrentTrackState,
  Participant,
  SessionRoundWithPlaylist,
  SessionWithParticipants,
} from '@tutti/shared';
import {
  Badge,
  Card,
  MultiColorBar,
  TitleHandwritten,
  Underline,
} from '../../components/ui/index.js';

// ── Hook timer (dupe de celui de HostPage — petit, pas la peine d'extraire) ──

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
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [startedAtIso, durationMs]);
  return remaining;
}

// ── Background : couleurs Pop Cocktail qui pulsent + confetti ─────────────

function FestiveBackground(): JSX.Element {
  // 12 confettis avec positions / délais randomisés (computés une fois au mount)
  const [confettis] = useState(() =>
    Array.from({ length: 12 }, (_, i) => ({
      id: i,
      left: `${Math.round(Math.random() * 100)}%`,
      delay: `${Math.round(Math.random() * 12)}s`,
      duration: `${10 + Math.round(Math.random() * 8)}s`,
      color: ['#ee6c2a', '#4a8b3f', '#c8336e', '#e8c547', '#6e3a6e', '#e89a64'][i % 6],
      size: 8 + Math.round(Math.random() * 8),
    })),
  );
  return (
    <div aria-hidden className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
      {/* Calque de couleur qui pulse subtilement */}
      <div className="absolute inset-0 animate-color-pulse" />
      {/* Confettis qui tombent */}
      {confettis.map((c) => (
        <span
          key={c.id}
          className="absolute top-0 animate-confetti-fall"
          style={{
            left: c.left,
            width: `${c.size}px`,
            height: `${c.size}px`,
            backgroundColor: c.color,
            animationDelay: c.delay,
            animationDuration: c.duration,
          }}
        />
      ))}
    </div>
  );
}

// ── Pochette mystère ──────────────────────────────────────────────────────

function MysteryCover({
  track,
  revealed,
}: {
  track: CurrentTrackState;
  revealed: boolean;
}): JSX.Element {
  const cover = track.cover_url;
  return (
    <div className="relative w-72 h-72 sm:w-96 sm:h-96 mx-auto">
      <div
        className={[
          'w-full h-full border-3 border-ink rounded shadow-pop-xl overflow-hidden',
          revealed ? 'animate-cover-blur-out' : '',
        ].join(' ')}
        style={{
          filter: revealed ? undefined : 'blur(40px) saturate(0.4)',
          transform: revealed ? undefined : 'scale(0.92)',
          backgroundColor: '#3d2f24',
          backgroundImage: cover ? `url(${cover})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
      {!revealed && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span aria-hidden className="text-7xl drop-shadow-lg">
            🎵
          </span>
        </div>
      )}
    </div>
  );
}

// ── Toast festif XL "Marie a trouvé en 3.2s !" ────────────────────────────

function BuzzCelebration({
  entry,
  onDismiss,
}: {
  entry: CorrectAnswerEntry;
  onDismiss: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const seconds = (entry.answered_at_ms / 1000).toFixed(1);

  useEffect(() => {
    const t1 = window.setTimeout(onDismiss, 3500);
    return () => window.clearTimeout(t1);
  }, [onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none animate-fade-in"
    >
      <div className="bg-spritz border-4 border-ink rounded-lg shadow-pop-xl px-10 py-8 text-center animate-reveal-pop max-w-2xl">
        <p className="text-6xl mb-3" aria-hidden>
          🎉
        </p>
        <p className="font-display text-5xl text-cream mb-2">{entry.pseudo}</p>
        <p className="font-editorial italic text-2xl text-cream-2 mb-1">
          {t('screen.foundInSeconds', { seconds })}
        </p>
        <p className="font-display text-4xl text-cream mt-3">+{entry.score} pts</p>
        {entry.position > 1 && (
          <p className="font-mono text-xs text-cream-2 mt-2 uppercase tracking-widest">
            {t('screen.positionInRound', { n: entry.position })}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Classement live ───────────────────────────────────────────────────────

function LiveLeaderboard({ cumulative }: { cumulative: CumulativeScore[] }): JSX.Element {
  const { t } = useTranslation();
  const top = cumulative.slice(0, 8);
  return (
    <Card size="lg" className="h-full">
      <p className="text-xs font-mono uppercase tracking-[0.2em] text-spritz-deep mb-4">
        {t('screen.leaderboardLabel')}
      </p>
      {top.length === 0 ? (
        <p className="font-editorial italic text-ink-soft text-sm py-8 text-center">
          {t('host.noScoresYet')}
        </p>
      ) : (
        <ol className="space-y-2">
          {top.map((entry, idx) => {
            const tone =
              idx === 0
                ? 'bg-spritz/15'
                : idx === 1
                  ? 'bg-basil/15'
                  : idx === 2
                    ? 'bg-plum/15'
                    : '';
            return (
              <li
                key={entry.id}
                className={[
                  'flex items-center gap-3 px-3 py-2 border-2 border-ink rounded',
                  tone || 'bg-white',
                ].join(' ')}
              >
                <span
                  className={[
                    'font-display w-8 text-center',
                    idx === 0
                      ? 'text-3xl text-spritz-deep'
                      : idx === 1
                        ? 'text-2xl text-basil-deep'
                        : idx === 2
                          ? 'text-2xl text-plum'
                          : 'text-xl text-ink-soft',
                  ].join(' ')}
                >
                  {idx + 1}
                </span>
                {entry.color && (
                  <span
                    aria-hidden
                    className="w-3 h-3 rounded-full border-2 border-ink shrink-0"
                    style={{ backgroundColor: entry.color }}
                  />
                )}
                <span className="font-medium flex-1 truncate">{entry.label}</span>
                <Badge tone="ink">{entry.total_points}</Badge>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

// ── Vue principale ────────────────────────────────────────────────────────

export interface MainScreenViewProps {
  session: SessionWithParticipants;
  currentTrack: CurrentTrackState | null;
  cumulative: CumulativeScore[];
  /** Bonnes réponses du track courant, dans l'ordre d'arrivée. */
  correctAnswers: CorrectAnswerEntry[];
  /** Date ISO de démarrage de la phase 2 si on y est, sinon null. */
  phase2StartedAt: string | null;
  /** Reveal master (phase3-revealed) ou null. */
  lastReveal: { artist: string; title: string } | null;
}

export function MainScreenView({
  session,
  currentTrack,
  cumulative,
  correctAnswers,
  phase2StartedAt,
  lastReveal,
}: MainScreenViewProps): JSX.Element {
  const { t } = useTranslation();
  const [celebration, setCelebration] = useState<CorrectAnswerEntry | null>(null);
  const playingRound = session.rounds.find((r) => r.status === 'PLAYING') ?? null;
  const lastEnded = [...session.rounds].reverse().find((r) => r.status === 'ENDED') ?? null;
  const master = session.participants.find((p) => p.is_master) ?? null;
  const totalTracks = playingRound?.playlist.tracks_count ?? 0;
  const trackPosition = currentTrack
    ? currentTrack.track_index + 1
    : (playingRound?.current_track_index ?? 0) + 1;
  const playingRoundsCount = session.rounds.filter((r) => r.status !== 'PENDING').length;

  // Déclenche la célébration XL à chaque nouvelle bonne réponse.
  useEffect(() => {
    if (correctAnswers.length === 0) return;
    const latest = correctAnswers[correctAnswers.length - 1];
    if (latest) setCelebration(latest);
  }, [correctAnswers.length]);

  return (
    <div className="min-h-screen flex flex-col relative">
      <FestiveBackground />
      <MultiColorBar height="md" />

      <main className="flex-1 px-6 lg:px-10 py-6 max-w-7xl mx-auto w-full relative z-10">
        {/* Header discret */}
        <header className="flex items-center justify-between flex-wrap gap-3 mb-6">
          <div className="flex items-center gap-2">
            <Badge tone="cream" tilt={-1}>
              {t('host.eyebrowPlaying', { round: playingRoundsCount })}
            </Badge>
            {playingRound && totalTracks > 0 && (
              <Badge tone="ink" tilt={1}>
                {t('host.trackPosition', { current: trackPosition, total: totalTracks })}
              </Badge>
            )}
          </div>
          {master && (
            <p className="font-mono text-xs text-ink-soft">
              👑 {t('screen.animatorIs', { pseudo: master.pseudo })}
            </p>
          )}
        </header>

        {playingRound ? (
          <PlayingFestive
            round={playingRound}
            track={currentTrack}
            cumulative={cumulative}
            correctAnswers={correctAnswers}
            phase2StartedAt={phase2StartedAt}
            lastReveal={lastReveal}
          />
        ) : (
          <BetweenRoundsFestive lastEnded={lastEnded} cumulative={cumulative} master={master} />
        )}
      </main>

      <MultiColorBar height="md" />

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

      {/* Toast festif buzz */}
      {celebration && (
        <BuzzCelebration entry={celebration} onDismiss={() => setCelebration(null)} />
      )}
    </div>
  );
}

// ── Sous-vue : round en cours ────────────────────────────────────────────

function PlayingFestive({
  round,
  track,
  cumulative,
  correctAnswers,
  phase2StartedAt,
  lastReveal,
}: {
  round: SessionRoundWithPlaylist;
  track: CurrentTrackState | null;
  cumulative: CumulativeScore[];
  correctAnswers: CorrectAnswerEntry[];
  phase2StartedAt: string | null;
  lastReveal: { artist: string; title: string } | null;
}): JSX.Element {
  const { t } = useTranslation();
  const isPhase3 =
    track?.phase === 'phase3' ||
    track?.phase === 'phase3-revealed' ||
    track?.phase === 'phase3-skipped';
  const isPhase2 = track?.phase === 'phase2';

  return (
    <div className="grid gap-8 lg:grid-cols-[3fr_2fr] items-start">
      <div className="text-center">
        {!track ? (
          <Card tone="cream" size="lg" className="text-center py-16">
            <TitleHandwritten as="h2" className="mb-3">
              <Underline>{round.playlist.name}</Underline>
            </TitleHandwritten>
            <p className="font-editorial italic text-ink-2 text-xl">{t('screen.waitingTrack')}</p>
            <p className="font-mono text-sm text-ink-soft mt-3">{t('screen.waitingTrackHint')}</p>
          </Card>
        ) : (
          <>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-3">
              {round.playlist.name}
            </p>
            <MysteryCover track={track} revealed={isPhase2 || isPhase3} />

            <div className="mt-6">
              {track.phase === 'phase1' && <ListeningFestive />}
              {isPhase2 && phase2StartedAt && (
                <Phase2Festive
                  track={track}
                  phase2StartedAt={phase2StartedAt}
                  correctAnswers={correctAnswers}
                />
              )}
              {isPhase3 && (
                <Phase3Festive
                  track={track}
                  correctAnswers={correctAnswers}
                  lastReveal={lastReveal}
                />
              )}
            </div>
          </>
        )}
      </div>

      <LiveLeaderboard cumulative={cumulative} />
    </div>
  );
}

function ListeningFestive(): JSX.Element {
  const { t } = useTranslation();
  return (
    <div>
      <p className="font-display text-5xl text-ink mb-3">🎵</p>
      <p className="font-editorial italic text-ink-2 text-lg mb-2">{t('screen.listenAndBuzz')}</p>
      <p className="font-mono text-xs text-ink-soft">{t('screen.firstToFindWins')}</p>
    </div>
  );
}

function Phase2Festive({
  track,
  phase2StartedAt,
  correctAnswers,
}: {
  track: CurrentTrackState;
  phase2StartedAt: string;
  correctAnswers: CorrectAnswerEntry[];
}): JSX.Element {
  const { t } = useTranslation();
  // Chrono dégressif depuis le démarrage de la phase 2 (15s).
  const remaining = useTimeRemaining(phase2StartedAt, 15_000);
  const seconds = Math.ceil(remaining / 1000);
  const progress = 1 - remaining / 15_000;
  return (
    <div>
      {/* Reveal artiste + titre dès la phase 2 (cf. spec : on révèle quand
          la 1ʳᵉ bonne réponse arrive, le morceau continue). */}
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-basil-deep mb-2">
        {t('host.reveal')}
      </p>
      <TitleHandwritten as="h3" className="text-3xl mb-1 animate-reveal-pop">
        <Underline>{track.title}</Underline>
      </TitleHandwritten>
      <p className="font-editorial italic text-2xl text-ink-2 mb-4">{track.artist}</p>

      {/* Chrono visible "Encore Xs pour buzzer" */}
      <Badge tone="raspberry" tilt={-1} className="mb-3">
        ⏱ {t('screen.phase2Remaining', { seconds })}
      </Badge>
      <div className="h-2 border-2 border-ink rounded bg-cream-2 overflow-hidden max-w-md mx-auto mt-2 mb-4">
        <div
          className="h-full bg-raspberry transition-[width] duration-200 ease-linear"
          style={{ width: `${Math.round((1 - progress) * 100)}%` }}
        />
      </div>

      {/* Liste des joueurs qui ont déjà trouvé */}
      {correctAnswers.length > 0 && (
        <div className="mt-3">
          <p className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-2">
            {t('screen.foundBy')}
          </p>
          <ul className="flex items-center justify-center gap-2 flex-wrap">
            {correctAnswers.map((entry) => (
              <li key={entry.participant_id}>
                <Badge
                  tone={entry.position === 1 ? 'spritz' : 'basil'}
                  tilt={entry.position % 2 === 0 ? 1 : -1}
                >
                  #{entry.position} {entry.pseudo} +{entry.score}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Phase3Festive({
  track,
  correctAnswers,
  lastReveal,
}: {
  track: CurrentTrackState;
  correctAnswers: CorrectAnswerEntry[];
  lastReveal: { artist: string; title: string } | null;
}): JSX.Element {
  const { t } = useTranslation();
  if (track.phase === 'phase3-skipped') {
    return (
      <div>
        <p className="font-display text-3xl text-ink-soft mb-2">⏭</p>
        <p className="font-editorial italic text-ink-2 text-lg">{t('screen.trackSkipped')}</p>
      </div>
    );
  }
  // phase3 (post-phase2 normal) ou phase3-revealed (master a donné la réponse)
  const title = lastReveal?.title ?? track.title;
  const artist = lastReveal?.artist ?? track.artist;
  return (
    <div className="animate-reveal-pop">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-basil-deep mb-2">
        {t('host.reveal')}
      </p>
      <TitleHandwritten as="h3" className="text-3xl mb-1">
        <Underline>{title}</Underline>
      </TitleHandwritten>
      <p className="font-editorial italic text-2xl text-ink-2 mb-4">{artist}</p>
      {correctAnswers.length === 0 && track.phase === 'phase3-revealed' && (
        <Badge tone="cream" tilt={1}>
          {t('screen.nobodyFound')}
        </Badge>
      )}
      {correctAnswers.length > 0 && (
        <ul className="flex items-center justify-center gap-2 flex-wrap mt-3">
          {correctAnswers.map((entry) => (
            <li key={entry.participant_id}>
              <Badge tone={entry.position === 1 ? 'spritz' : 'basil'}>
                #{entry.position} {entry.pseudo} +{entry.score}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <p className="font-editorial italic text-ink-soft text-sm mt-4">
        🎵 {t('screen.festivePhase')}
      </p>
    </div>
  );
}

// ── Sous-vue : entre les manches (intermission ou roundSelection) ────────

function BetweenRoundsFestive({
  lastEnded,
  cumulative,
  master,
}: {
  lastEnded: SessionRoundWithPlaylist | null;
  cumulative: CumulativeScore[];
  master: Participant | null;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="grid gap-8 lg:grid-cols-[3fr_2fr] items-start">
      <Card tone="basil" size="lg" className="text-center py-16">
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
      </Card>

      <LiveLeaderboard cumulative={cumulative} />
    </div>
  );
}
