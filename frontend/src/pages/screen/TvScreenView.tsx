/**
 * TvScreenView — rendu SOMBRE premium de l'écran JOUEUR / TV (états PLAYING /
 * PAUSED). Réservé à la TV (ScreenPage) : la console iPad (HostPage) continue
 * d'utiliser MainScreenView (identité crème). AUCUNE logique ici — même contrat
 * de props (MainScreenViewProps) que MainScreenView. Pas de bouton de contrôle.
 *
 * Design : cf. tutti-design-refs/SPEC_DESIGN_ecran_joueur.md — ambiance "salle
 * de concert" : la LUMIÈRE VIENT DU CONTENU (la pochette floutée éclaire tout
 * l'écran en fond). Pochette dominante au reveal, typo XXL, timer coral animé,
 * equalizer à l'écoute, noms de joueurs agrandis, transitions fluides.
 */

import { useMemo } from 'react';
import { getShareableOrigin } from '../../lib/platform.js';
import { useTranslation } from 'react-i18next';
import type {
  CorrectAnswerEntry,
  CumulativeScore,
  CurrentTrackState,
  Participant,
  SessionRoundWithPlaylist,
} from '@tutti/shared';
import { QRCode } from '../../components/host/QRCode.js';
import { useTimeElapsed, useTimeRemaining } from './MainScreenView.js';
import type { MainScreenViewProps } from './MainScreenView.js';
import { LyricsOverlay } from '../../components/screen/LyricsOverlay.js';

const CORAL = '#FF5C4D';
const PANEL =
  'rounded-[20px] bg-[#191922] border border-white/[0.07] shadow-[0_24px_70px_rgba(0,0,0,0.55)]';

// Keyframes locaux à la TV (préfixe tv-) — n'affectent pas la console.
const TV_STYLE = `
@keyframes tv-ken { 0%{transform:scale(1.15) translate(0,0)} 100%{transform:scale(1.28) translate(-2%,-2%)} }
@keyframes tv-eq { 0%,100%{transform:scaleY(0.35)} 50%{transform:scaleY(1)} }
@keyframes tv-rise { 0%{opacity:0;transform:translateY(24px)} 100%{opacity:1;transform:translateY(0)} }
@keyframes tv-cover-in { 0%{opacity:0;transform:scale(0.9)} 60%{opacity:1} 100%{opacity:1;transform:scale(1)} }
@keyframes tv-glow { 0%,100%{opacity:0.22} 50%{opacity:0.4} }
.tv-rise{animation:tv-rise 600ms cubic-bezier(0.22,1,0.36,1) both}
.tv-cover-in{animation:tv-cover-in 700ms cubic-bezier(0.22,1,0.36,1) both}
@media (prefers-reduced-motion:reduce){
  .tv-rise,.tv-cover-in{animation:none}
  .tv-ken,.tv-eq,.tv-glow-anim{animation:none !important}
}
`;

// ── Fond = pochette floutée plein cadre (la lumière vient du contenu) ───────
function AmbientBackdrop({ cover }: { cover: string | null }): JSX.Element {
  return (
    <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden bg-[#0B0B0F]">
      {cover && (
        <div
          key={cover}
          className="tv-ken absolute inset-0"
          style={{
            backgroundImage: `url(${cover})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(90px) saturate(1.1) brightness(0.5)',
            animation: 'tv-ken 24s ease-in-out infinite alternate',
          }}
        />
      )}
      {/* Scrim : lisibilité + vignettage bas. */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/35 to-black/80" />
      {!cover && (
        <div
          className="absolute left-1/2 top-[-12%] h-[55vh] w-[55vh] -translate-x-1/2 rounded-full blur-[130px]"
          style={{ backgroundColor: CORAL, opacity: 0.16 }}
        />
      )}
    </div>
  );
}

// ── Bandeau haut : labels d'état (PAS de contrôles) ───────────────────────
function TopRibbon({
  round,
  totalTracks,
  trackPosition,
  phaseLabel,
}: {
  round: SessionRoundWithPlaylist | null;
  totalTracks: number;
  trackPosition: number;
  phaseLabel: string;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <header className="flex items-center justify-between px-12 py-7">
      <div className="flex items-center gap-5">
        <span className="font-display text-[32px] leading-none tracking-tight text-white">
          Tutti
          <span
            aria-hidden
            className="ml-1 inline-block h-2.5 w-2.5 rounded-full align-top"
            style={{ backgroundColor: CORAL }}
          />
        </span>
        {round && (
          <span className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.28em] text-white/55">
            <span className="rounded-full border border-white/12 px-3.5 py-1.5">
              {t('host.eyebrowPlaying', { round: round.position })}
            </span>
            {totalTracks > 0 && (
              <span className="tabular-nums text-white/90">
                {trackPosition} <span className="text-white/35">/ {totalTracks}</span>
              </span>
            )}
            <span className="max-w-xs truncate text-white/45">{round.playlist.name}</span>
          </span>
        )}
      </div>
      <span
        className="rounded-full px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-[#0B0B0F]"
        style={{ backgroundColor: CORAL, boxShadow: `0 8px 30px ${CORAL}55` }}
      >
        {phaseLabel}
      </span>
    </header>
  );
}

// ── Equalizer "à l'écoute" (motif concert) ────────────────────────────────
function Equalizer(): JSX.Element {
  const bars = [0.0, 0.18, 0.36, 0.12, 0.28, 0.06, 0.22];
  return (
    <div aria-hidden className="flex h-9 items-end justify-center gap-1.5">
      {bars.map((d, i) => (
        <span
          key={i}
          className="w-1.5 rounded-full"
          style={{
            height: '100%',
            transformOrigin: 'bottom',
            backgroundColor: CORAL,
            animation: `tv-eq ${0.9 + (i % 3) * 0.25}s ease-in-out ${d}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

// ── Pochette mystère (phases 1/2) ─────────────────────────────────────────
function MysteryCoverDark({
  track,
  size,
}: {
  track: CurrentTrackState;
  size: string;
}): JSX.Element {
  const cover = track.cover_url;
  return (
    <div className="relative mx-auto tv-cover-in" style={{ width: size, aspectRatio: '1' }}>
      <div
        className="h-full w-full overflow-hidden rounded-[26px] ring-1 ring-white/12"
        style={{
          backgroundImage: cover ? `url(${cover})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundColor: '#101018',
          filter: 'blur(30px) saturate(0.5) brightness(0.55)',
        }}
      />
      <div
        aria-hidden
        className="tv-glow-anim absolute -inset-6 -z-10 rounded-full blur-3xl"
        style={{ backgroundColor: CORAL, animation: 'tv-glow 4s ease-in-out infinite' }}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          aria-hidden
          className="font-display text-[42%] leading-none text-white/95 animate-float-question"
          style={{ textShadow: `0 10px 50px ${CORAL}77` }}
        >
          ?
        </span>
      </div>
    </div>
  );
}

// ── Timer coral animé (phase 2 — fenêtre retardataires) ───────────────────
function CoralRingTimer({
  startedAt,
  durationMs,
  isPaused,
  size = 160,
}: {
  startedAt: string;
  durationMs: number;
  isPaused: boolean;
  /** Diamètre en px (fix/tv-phase2-countdown : 340 en plein centre). */
  size?: number;
}): JSX.Element {
  const remaining = useTimeRemaining(startedAt, durationMs, isPaused);
  const seconds = Math.max(0, Math.ceil(remaining / 1000));
  const ratio = Math.max(0, Math.min(1, remaining / durationMs));
  const R = 52;
  const C = 2 * Math.PI * R;
  const low = seconds <= 3;
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={R} fill="none" stroke="#ffffff12" strokeWidth="9" />
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          stroke={CORAL}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - ratio)}
          style={{
            transition: 'stroke-dashoffset 250ms linear',
            filter: `drop-shadow(0 0 10px ${CORAL}aa)`,
          }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className={`font-mono font-bold tabular-nums text-white ${low ? 'animate-tick-pulse' : ''}`}
          style={{ fontSize: Math.round(size * 0.33) }}
        >
          {seconds}
        </span>
      </div>
    </div>
  );
}

// ── Barre de progression audio coral (phase 1 — écoute) ───────────────────
function ListeningProgress({
  track,
  isPaused,
}: {
  track: CurrentTrackState;
  isPaused: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  const elapsed = useTimeElapsed(track.started_at, isPaused);
  const total = track.duration_ms ?? null;
  const ratio = total && total > 0 ? Math.min(1, elapsed / total) : null;
  return (
    <div className="mx-auto mt-11 flex w-[min(44vh,440px)] max-w-full flex-col items-center gap-4">
      <Equalizer />
      <p className="font-mono text-xs uppercase tracking-[0.34em] text-white/60">
        {t('screen.listenAndBuzz')}
      </p>
      {ratio !== null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/12">
          <div
            className="h-full rounded-full transition-[width] duration-500 ease-linear"
            style={{ width: `${Math.round(ratio * 100)}%`, backgroundColor: CORAL }}
          />
        </div>
      )}
    </div>
  );
}

// ── Pochette révélée (reveal) — élément star, éclairée ─────────────────────
function RevealCoverDark({
  track,
}: {
  track: CurrentTrackState;
  /** Conservé pour compat des appelants — plus affiché (doublon illisible). */
  title?: string;
}): JSX.Element {
  const cover = track.cover_url;
  return (
    <div className="relative aspect-square w-full max-w-[min(40vh,400px)] tv-cover-in">
      <div
        aria-hidden
        className="absolute -inset-10 -z-10 rounded-[40%] blur-[70px]"
        style={{ backgroundColor: CORAL, opacity: 0.32 }}
      />
      <div
        className="flex h-full w-full items-center justify-center overflow-hidden rounded-[28px] ring-1 ring-white/20 shadow-[0_50px_140px_rgba(0,0,0,0.7)]"
        style={
          cover
            ? {
                backgroundImage: `url(${cover})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }
            : { backgroundColor: '#181820' }
        }
      >
        {!cover && (
          <span aria-hidden className="text-[8rem] leading-none text-white/25">
            ♪
          </span>
        )}
      </div>
    </div>
  );
}

// ── Classement sombre (noms agrandis, leader coral) ───────────────────────
function DarkLeaderboard({
  cumulative,
  correctAnswers,
  compact,
}: {
  cumulative: CumulativeScore[];
  correctAnswers: CorrectAnswerEntry[];
  compact?: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  const deltaById = useMemo(() => {
    const m = new Map<string, number>();
    for (const ca of correctAnswers) {
      for (const key of [ca.participant_id, ca.team_id]) {
        if (!key) continue;
        m.set(key, (m.get(key) ?? 0) + ca.score);
      }
    }
    return m;
  }, [correctAnswers]);
  const rows = cumulative.slice(0, compact ? 5 : 8);
  return (
    <div className={`${PANEL} flex min-h-0 flex-1 flex-col p-6`}>
      <div className="mb-4 flex shrink-0 items-center gap-2.5">
        <span aria-hidden className="text-lg">
          🏆
        </span>
        <p className="font-mono text-xs font-bold uppercase tracking-[0.3em] text-white/55">
          {t('screen.leaderboardLabel')}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="py-12 text-center font-editorial text-lg italic text-white/45">
          {t('host.noScoresYet')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5 overflow-y-auto">
          {rows.map((entry, idx) => {
            const isLeader = idx === 0;
            const delta = deltaById.get(entry.id) ?? 0;
            return (
              <li
                key={entry.id}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-4 rounded-2xl px-4 py-3"
                style={{
                  backgroundColor: isLeader ? `${CORAL}22` : '#ffffff0a',
                  border: `1px solid ${isLeader ? `${CORAL}66` : '#ffffff12'}`,
                  boxShadow: isLeader ? `0 0 30px ${CORAL}22` : undefined,
                }}
              >
                <span
                  className="w-9 text-center font-display text-2xl"
                  style={{ color: isLeader ? CORAL : '#ffffff' }}
                >
                  {['🥇', '🥈', '🥉'][idx] ?? idx + 1}
                </span>
                <div className="flex min-w-0 items-center gap-2">
                  {entry.color && (
                    <span
                      aria-hidden
                      className="h-3 w-3 shrink-0 rounded-full ring-1 ring-white/30"
                      style={{ backgroundColor: entry.color }}
                    />
                  )}
                  <span
                    className={`truncate font-bold text-white ${isLeader ? 'text-2xl lg:text-3xl' : 'text-lg lg:text-2xl'}`}
                  >
                    {entry.label}
                  </span>
                </div>
                <div className="whitespace-nowrap text-right">
                  <span className="font-mono text-xl font-bold tabular-nums text-white lg:text-2xl">
                    {entry.total_points}
                  </span>
                  {delta > 0 && (
                    <span className="ml-2 font-mono text-sm font-bold" style={{ color: CORAL }}>
                      +{delta}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Panneau QR rejoindre (carte claire pour scan facile) ──────────────────
function JoinQrDark({ shortCode }: { shortCode: string }): JSX.Element {
  const { t } = useTranslation();
  const url = `${getShareableOrigin()}/play?session=${shortCode}`;
  return (
    <div className={`${PANEL} flex items-center gap-4 p-5`}>
      <div className="rounded-2xl bg-white p-2">
        <QRCode value={url} size={104} />
      </div>
      <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em]" style={{ color: CORAL }}>
          {t('screen.joinTitle')}
        </p>
        <p className="mt-1 font-mono text-2xl font-bold tracking-[0.2em] text-white">{shortCode}</p>
        <p className="mt-1 font-editorial text-xs italic text-white/45">{t('screen.joinHint')}</p>
      </div>
    </div>
  );
}

// ── Sous-vue "prêt / entre manches" ───────────────────────────────────────
function ReadyStage({
  round,
  lastEnded,
  master,
}: {
  round: SessionRoundWithPlaylist | null;
  lastEnded: SessionRoundWithPlaylist | null;
  master: Participant | null;
}): JSX.Element {
  const { t } = useTranslation();
  const title = round?.playlist.name ?? lastEnded?.playlist.name ?? t('screen.firstRoundComing');
  const totalTracks = round?.playlist.tracks_count ?? 0;
  return (
    <div className="flex flex-col items-center text-center tv-rise">
      <div className="relative mb-11 h-[min(38vh,360px)] w-[min(38vh,360px)]">
        <div
          aria-hidden
          className="absolute -inset-6 -z-10 rounded-full blur-3xl"
          style={{ backgroundColor: CORAL, opacity: 0.2 }}
        />
        <svg
          viewBox="0 0 120 120"
          className="h-full w-full animate-spin"
          style={{ animationDuration: '9s' }}
        >
          <circle cx="60" cy="60" r="58" fill="#0d0d13" stroke="#ffffff12" strokeWidth="1" />
          <circle cx="60" cy="60" r="44" fill="none" stroke="#ffffff10" strokeWidth="0.6" />
          <circle cx="60" cy="60" r="34" fill="none" stroke="#ffffff10" strokeWidth="0.6" />
          <circle cx="60" cy="60" r="24" fill="none" stroke="#ffffff10" strokeWidth="0.6" />
          <circle cx="60" cy="60" r="16" fill={CORAL} />
          <circle cx="60" cy="60" r="3" fill="#0B0B0F" />
        </svg>
      </div>
      {round && (
        <div className="mb-5 flex items-center gap-3 font-mono text-sm uppercase tracking-[0.3em] text-white/60">
          <span
            className="rounded-full px-4 py-1.5 text-[#0B0B0F]"
            style={{ backgroundColor: CORAL }}
          >
            {t('host.eyebrowPlaying', { round: round.position })}
          </span>
          {totalTracks > 0 && <span className="text-white">{totalTracks} titres</span>}
        </div>
      )}
      <h2 className="max-w-4xl font-display text-5xl leading-tight text-white lg:text-6xl">
        {title}
      </h2>
      <p className="mt-6 font-editorial text-xl italic text-white/55">
        {round
          ? t('screen.waitingTrack')
          : master
            ? t('screen.waitingMasterPick', { pseudo: master.pseudo })
            : t('screen.waitingAnyPick')}
      </p>
    </div>
  );
}

// ── Vue principale ────────────────────────────────────────────────────────
export function TvScreenView(props: MainScreenViewProps): JSX.Element {
  const { session, currentTrack, cumulative, correctAnswers, phase2StartedAt, lastReveal, lyrics } =
    props;
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
  const isPhase2 = phase === 'phase2';
  const isPhase1 = phase === 'phase1';
  const hadWinner = correctAnswers.length > 0;
  const showConfetti = isRevealed && hadWinner;

  // fix/tv-no-confetti — confettis RETIRÉS de la TV : même réduits, ils
  // figeaient sur le rendu de l'écran externe. Décision : zéro animation
  // canvas sur la TV. (`showConfetti` reste calculé pour la compat des props.)
  void showConfetti;

  const phaseLabel = useMemo(() => {
    if (phase === 'phase1') return t('screen.phaseLabel1');
    if (phase === 'phase2') return t('screen.phaseLabel2');
    if (phase === 'phase3-skipped') return t('screen.phaseLabel3Skipped');
    if (phase === 'phase3-revealed' || phase === 'phase3') return t('screen.phaseLabel3');
    return t('screen.phaseLabelWaiting');
  }, [phase, t]);

  const title = lastReveal?.title ?? currentTrack?.title ?? '';
  const artist = lastReveal?.artist ?? currentTrack?.artist ?? '';
  // feat/oeuvre-affichee — playlists film / série / dessin animé : `title` est
  // le nom de l'ŒUVRE (réponse) ; on affiche en plus le vrai titre de la
  // chanson, entre l'œuvre et l'interprète. Demande de Thomas : œuvre /
  // chanson / interprète, sur les trois écrans.
  const songTitle = lastReveal?.song_title ?? currentTrack?.song_title ?? null;
  // Fond ambiant = pochette du morceau (seulement au reveal — avant, on ne
  // divulgue rien, le fond reste neutre coral).
  const ambientCover = isRevealed ? (currentTrack?.cover_url ?? null) : null;

  return (
    <div className="relative flex min-h-screen flex-col text-white px-[2.5vmin] pt-[1.5vmin] pb-[3vmin]">
      <style>{TV_STYLE}</style>
      <AmbientBackdrop cover={ambientCover} />
      <TopRibbon
        round={playingRound}
        totalTracks={totalTracks}
        trackPosition={trackPosition}
        phaseLabel={phaseLabel}
      />

      {isRevealed && currentTrack && lyrics && lyrics.lines.length > 0 ? (
        /* ── REVEAL + PAROLES ──
           feat/synced-lyrics — quand l'animateur a demandé les paroles, elles
           prennent la zone centrale. Pochette / artiste / titre restent
           visibles, en plus petit, en colonne latérale.
           DOUBLE GARDE : `isRevealed` conditionne ce bloc — jamais de paroles
           en phase 1/2, même si la prop est fournie. */
        <main className="grid flex-1 grid-cols-1 gap-8 px-12 pb-12 lg:grid-cols-[1fr_320px]">
          <section className="flex min-h-0 items-center justify-center">
            <LyricsOverlay
              lines={lyrics.lines}
              getPositionMs={lyrics.getPositionMs}
              paused={lyrics.paused}
            />
          </section>
          <aside className="flex flex-col items-center justify-center gap-4 opacity-80">
            <div className="w-40">
              <RevealCoverDark track={currentTrack} title={title} />
            </div>
            <p className="text-center font-display text-2xl font-bold leading-tight text-white">
              {title}
            </p>
            {songTitle && (
              <p className="text-center font-display text-lg font-semibold leading-tight text-white/85">
                {songTitle}
              </p>
            )}
            <p className="text-center font-editorial text-xl italic" style={{ color: CORAL }}>
              {artist}
            </p>
          </aside>
        </main>
      ) : isRevealed && currentTrack ? (
        /* ── REVEAL ── */
        <main className="grid flex-1 grid-cols-1 gap-10 px-12 pb-12 lg:grid-cols-[1.5fr_1fr]">
          <section className="flex min-h-0 flex-col items-center justify-center gap-10 lg:flex-row">
            {/* fix/pochette-invisible-sur-la-tv — LA LARGEUR EST OBLIGATOIRE ICI.
                RevealCoverDark est en `w-full` : sans largeur sur ce conteneur,
                le pourcentage se résolvait contre un parent dimensionné par son
                contenu, donc contre lui-même → 0 px de large (mesuré 0×0 en
                navigateur). La pochette était bien rendue, mais invisible : la
                salle ne voyait jamais l'image à la révélation, alors que la
                console de l'animateur, elle, l'affichait. */}
            <div className="flex w-[min(40vh,400px)] shrink-0 items-center justify-center">
              <RevealCoverDark track={currentTrack} title={title} />
            </div>
            <div className="min-w-0 text-center lg:text-left">
              <span
                className="inline-block rounded-full px-4 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.32em] text-[#0B0B0F]"
                style={{ backgroundColor: CORAL, boxShadow: `0 8px 30px ${CORAL}55` }}
              >
                {t('screen.phaseLabel3')}
              </span>
              {/* fix/tv-reveal-legibility — taille de police ADAPTÉE à la
                  longueur du titre : un titre long descend en corps au lieu de
                  se faire découper en colonne étroite derrière le classement. */}
              <h1
                className={`tv-rise mt-6 break-words font-display font-bold leading-[0.95] text-white ${
                  title.length <= 14
                    ? 'text-6xl lg:text-7xl xl:text-8xl'
                    : title.length <= 26
                      ? 'text-5xl lg:text-6xl xl:text-7xl'
                      : 'text-4xl lg:text-5xl xl:text-6xl'
                }`}
                style={{ textShadow: '0 12px 60px rgba(0,0,0,0.6)', textWrap: 'balance' }}
                title={title}
              >
                {title}
              </h1>
              {songTitle && (
                <p
                  className="tv-rise mt-4 break-words font-display text-3xl font-semibold text-white/90 lg:text-4xl"
                  style={{ animationDelay: '80ms', textWrap: 'balance' }}
                >
                  {songTitle}
                </p>
              )}
              <p
                className="tv-rise mt-4 break-words font-editorial text-3xl font-semibold italic lg:text-4xl"
                style={{ color: CORAL, animationDelay: '110ms', textWrap: 'balance' }}
              >
                {artist}
              </p>
              {(currentTrack.year || currentTrack.album) && (
                <p
                  className="tv-rise mt-5 font-mono text-base uppercase tracking-[0.22em] text-white/55"
                  style={{ animationDelay: '220ms' }}
                >
                  {[currentTrack.album, currentTrack.year].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          </section>
          <aside className="flex min-h-0 flex-col gap-5">
            <DarkLeaderboard cumulative={cumulative} correctAnswers={correctAnswers} />
            <JoinQrDark shortCode={session.short_code} />
          </aside>
        </main>
      ) : (
        /* ── ÉCOUTE / ATTENTE ── */
        <main className="grid flex-1 grid-cols-1 gap-10 px-12 pb-12 lg:grid-cols-[1fr_360px]">
          <section className="relative flex flex-col items-center justify-center">
            {!playingRound || !currentTrack ? (
              <ReadyStage round={playingRound} lastEnded={lastEnded} master={master} />
            ) : phase === 'phase3-skipped' ? (
              <div className="text-center tv-rise">
                <p className="text-7xl">⏭</p>
                <p className="mt-4 font-editorial text-2xl italic text-white/60">
                  {t('screen.trackSkipped')}
                </p>
              </div>
            ) : (
              <>
                {/* fix/compteur-de-buzz-a-zero — la TV n'a pas accès au nombre
                    de buzz en cours : la pastille affichait « 0 personne a
                    buzzé » en grand pendant que douze joueurs buzzaient. On ne
                    l'affiche que si la valeur est réellement disponible. */}
                {isPhase1 && props.activeBuzzCount > 0 && (
                  <div className="absolute left-0 top-0 flex items-center gap-2 rounded-2xl bg-[#23232e] px-4 py-3 text-sm font-bold text-white ring-1 ring-white/10">
                    <span
                      aria-hidden
                      className="h-3 w-3 rounded-full animate-pulse-buzz"
                      style={{ backgroundColor: CORAL }}
                    />
                    {t('screen.buzzCounter', { count: props.activeBuzzCount })}
                  </div>
                )}
                {/* fix/tv-phase2-countdown — dès qu'un joueur a trouvé, le
                    compte à rebours devient L'ÉLÉMENT CENTRAL, en très grand :
                    c'est l'info que toute la salle attend. La pochette mystère
                    s'efface pendant cette fenêtre. */}
                {isPhase2 && phase2StartedAt ? (
                  <div className="text-center tv-rise">
                    <p className="mb-6 font-mono text-lg font-bold uppercase tracking-[0.34em] text-white/70">
                      {t('screen.phase2TimerLabel')}
                    </p>
                    <CoralRingTimer
                      startedAt={phase2StartedAt}
                      durationMs={10_000}
                      isPaused={session.is_paused}
                      size={340}
                    />
                    <p className="mt-6 font-editorial text-2xl italic text-white/55">
                      {t('screen.phase2TimerSub')}
                    </p>
                  </div>
                ) : (
                  <MysteryCoverDark track={currentTrack} size="min(44vh,440px)" />
                )}
                {isPhase1 && (
                  <ListeningProgress track={currentTrack} isPaused={session.is_paused} />
                )}
              </>
            )}
          </section>
          <aside className="flex min-h-0 flex-col gap-5">
            <DarkLeaderboard cumulative={cumulative} correctAnswers={correctAnswers} compact />
            <JoinQrDark shortCode={session.short_code} />
          </aside>
        </main>
      )}

      {/* Overlay PAUSE */}
      {session.is_paused && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/85 animate-fade-in">
          <div className={`${PANEL} px-16 py-12 text-center`}>
            <p className="text-7xl">⏸</p>
            <h2 className="mt-3 font-display text-5xl text-white">{t('screen.pauseTitle')}</h2>
            <p className="mt-2 font-editorial text-xl italic text-white/55">
              {t('screen.pauseHint')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
