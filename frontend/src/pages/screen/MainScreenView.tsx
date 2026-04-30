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

// ── Background : couleurs Pop Cocktail qui pulsent + confetti conditionnel ──
//
// Important (correction spec) : les confettis ne sont PAS continus en fond.
// Ils se déclenchent uniquement à l'entrée en phase 3 (reveal du morceau).
// Pendant phases 1 et 2, seul le calque de couleur subtil tourne.

function FestiveBackground({ confettiActive }: { confettiActive: boolean }): JSX.Element {
  // 12 confettis avec positions / délais randomisés (computés une fois au mount)
  const [confettis] = useState(() =>
    Array.from({ length: 12 }, (_, i) => ({
      id: i,
      left: `${Math.round(Math.random() * 100)}%`,
      delay: `${Math.round(Math.random() * 3)}s`, // burst rapproché en phase 3
      duration: `${5 + Math.round(Math.random() * 4)}s`,
      color: ['#ee6c2a', '#4a8b3f', '#c8336e', '#e8c547', '#6e3a6e', '#e89a64'][i % 6],
      size: 8 + Math.round(Math.random() * 8),
    })),
  );
  return (
    <div aria-hidden className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
      {/* Calque de couleur qui pulse subtilement (continu, peu distrayant) */}
      <div className="absolute inset-0 animate-color-pulse" />
      {/* Confettis qui tombent — uniquement en phase 3 pour le moment "wow" */}
      {confettiActive &&
        confettis.map((c) => (
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

// ── Toast discret quand un joueur trouve (phase 2) ────────────────────────
//
// Correction spec : pas d'animation festive en phase 2 (réservée à la phase 3,
// pour préserver le suspense des retardataires). On affiche juste un toast
// discret en haut de l'écran "Marie a trouvé !" qui se cumule.
//
// Le moment "wow" festif (gros reveal + confetti + scores) arrive à l'entrée
// en phase 3 via Phase3Festive.

function FoundToast({ pseudo }: { pseudo: string }): JSX.Element {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-basil border-3 border-ink rounded-lg shadow-pop px-4 py-2 text-cream font-display text-lg animate-pop-in"
    >
      ✓ {t('screen.someoneFound', { pseudo })}
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
  // Stack des toasts "Marie a trouvé !" affichés discretement en haut.
  // Chaque entry est ajoutée 4s puis fade out — non bloquant, non révélateur.
  const [foundToasts, setFoundToasts] = useState<{ id: string; pseudo: string }[]>([]);
  const playingRound = session.rounds.find((r) => r.status === 'PLAYING') ?? null;
  const lastEnded = [...session.rounds].reverse().find((r) => r.status === 'ENDED') ?? null;
  const master = session.participants.find((p) => p.is_master) ?? null;
  const totalTracks = playingRound?.playlist.tracks_count ?? 0;
  const trackPosition = currentTrack
    ? currentTrack.track_index + 1
    : (playingRound?.current_track_index ?? 0) + 1;
  const playingRoundsCount = session.rounds.filter((r) => r.status !== 'PENDING').length;

  // Confetti : déclenché uniquement à l'entrée en phase 3 (reveal du morceau).
  // Pas en continu, pas en phase 2.
  const isPhase3 = currentTrack?.phase === 'phase3' || currentTrack?.phase === 'phase3-revealed';

  // Toast discret quand un joueur trouve, sans révéler l'artiste/titre.
  // Empile les "Marie a trouvé !", "Tom aussi !", "Lucie aussi !" en haut.
  useEffect(() => {
    if (correctAnswers.length === 0) return;
    const latest = correctAnswers[correctAnswers.length - 1];
    if (!latest) return;
    const id = `${latest.participant_id}-${correctAnswers.length}`;
    setFoundToasts((prev) => [...prev, { id, pseudo: latest.pseudo }]);
    const timer = window.setTimeout(() => {
      setFoundToasts((prev) => prev.filter((tt) => tt.id !== id));
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [correctAnswers.length]);

  // Reset les toasts à chaque nouveau track
  useEffect(() => {
    setFoundToasts([]);
  }, [currentTrack?.track_id]);

  return (
    <div className="min-h-screen flex flex-col relative">
      <FestiveBackground confettiActive={isPhase3} />
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

      {/* Toasts discrets "Marie a trouvé !" en haut, empilés (phase 2 sans
          révéler le morceau). Animation pop-in subtile, pas de confetti. */}
      {foundToasts.length > 0 && (
        <div
          aria-live="polite"
          className="fixed top-20 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2 max-w-md pointer-events-none"
        >
          {foundToasts.map((tt) => (
            <FoundToast key={tt.id} pseudo={tt.pseudo} />
          ))}
        </div>
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
  // Correction spec : la pochette reste mystère pendant phase 2.
  // Reveal seulement en phase 3 / phase3-revealed.
  const isRevealed = track?.phase === 'phase3' || track?.phase === 'phase3-revealed';
  const isPhase2 = track?.phase === 'phase2';
  const isPhase3 = isRevealed || track?.phase === 'phase3-skipped';

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
            <MysteryCover track={track} revealed={isRevealed} />

            <div className="mt-6">
              {track.phase === 'phase1' && <ListeningFestive />}
              {isPhase2 && phase2StartedAt && (
                <Phase2Festive phase2StartedAt={phase2StartedAt} correctAnswers={correctAnswers} />
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
  phase2StartedAt,
  correctAnswers,
}: {
  phase2StartedAt: string;
  correctAnswers: CorrectAnswerEntry[];
}): JSX.Element {
  const { t } = useTranslation();
  // Chrono dégressif depuis le démarrage de la phase 2 (15s).
  const remaining = useTimeRemaining(phase2StartedAt, 15_000);
  const seconds = Math.max(0, Math.ceil(remaining / 1000));
  const progress = remaining / 15_000; // 1 → 0

  // ⚠ Correction spec : on NE révèle PAS l'artiste/titre en phase 2.
  // Sinon les retardataires voient la réponse et le jeu est cassé.
  // On affiche juste : qui a déjà trouvé (noms seulement, pas de score)
  // + chrono dégressif. Le moment "wow" est réservé à la phase 3.

  return (
    <div className="py-2">
      {/* Gros chrono central — c'est la star de la phase 2 */}
      <p className="font-display text-7xl text-raspberry-deep mb-1 tabular-nums">{seconds}</p>
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-raspberry-deep mb-3">
        {t('screen.phase2Remaining', { seconds })}
      </p>

      <div className="h-2 border-2 border-ink rounded bg-cream-2 overflow-hidden max-w-md mx-auto mb-4">
        <div
          className="h-full bg-raspberry transition-[width] duration-200 ease-linear"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      {/* Liste des joueurs qui ont déjà trouvé — NOMS uniquement (pas de
          score, pas de position) pour préserver le suspense jusqu'à phase 3. */}
      {correctAnswers.length > 0 && (
        <div className="mt-3">
          <p className="font-editorial italic text-ink-2 text-base mb-2">
            {t('screen.phase2Heading', { count: correctAnswers.length })}
          </p>
          <ul className="flex items-center justify-center gap-2 flex-wrap">
            {correctAnswers.map((entry) => (
              <li key={entry.participant_id}>
                <Badge tone="basil" tilt={entry.position % 2 === 0 ? 1 : -1}>
                  ✓ {entry.pseudo}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="font-editorial italic text-ink-soft text-sm mt-4">
        {t('screen.phase2OthersHint')}
      </p>
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
  // C'est LE moment "wow" : reveal animé + confetti déclenchés au moment
  // précis (cf. FestiveBackground confettiActive=true en phase 3) + scores.
  const title = lastReveal?.title ?? track.title;
  const artist = lastReveal?.artist ?? track.artist;
  return (
    <div className="animate-reveal-pop">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-basil-deep mb-2">
        {t('host.reveal')}
      </p>
      <TitleHandwritten as="h3" className="text-4xl sm:text-5xl mb-2">
        <Underline>{title}</Underline>
      </TitleHandwritten>
      <p className="font-editorial italic text-2xl sm:text-3xl text-ink-2 mb-5">{artist}</p>
      {correctAnswers.length === 0 && track.phase === 'phase3-revealed' && (
        <Badge tone="cream" tilt={1}>
          {t('screen.nobodyFound')}
        </Badge>
      )}
      {correctAnswers.length > 0 && (
        <>
          <p className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-2">
            {t('screen.foundBy')}
          </p>
          <ul className="flex items-center justify-center gap-2 flex-wrap mt-1 mb-2">
            {correctAnswers.map((entry) => (
              <li key={entry.participant_id}>
                <Badge tone={entry.position === 1 ? 'spritz' : 'basil'}>
                  #{entry.position} {entry.pseudo} +{entry.score}
                </Badge>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="font-display text-2xl text-spritz-deep mt-5">🎉 {t('screen.danceMessage')}</p>
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
