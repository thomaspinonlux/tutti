/**
 * MasterMenu — panneau de pilotage qui apparaît sur le tel du joueur
 * désigné master EN MODE B "Sans animateur" (désigné DEPUIS LA CONSOLE).
 *
 * Boutons phase-aware :
 *   - listening  : ▶ Réponse  /  ⏭ Sauter  /  ⏸ Pause  /  🛑 Terminer
 *   - buzzed     : (rien — le buzzer répond)  /  ⏸ Pause  /  🛑 Terminer
 *   - cooldown   : ▶ Suivant  /  ⏸ Pause  /  🛑 Terminer
 *   - pas de round PLAYING : ▶ Manche suivante (picker)  /  🛑 Terminer
 *   - paused     : ▶ Reprendre / 🛑 Terminer
 *   - tout au long : ⚖ Ajuster les points
 *
 * feat/manette-console-master :
 *   - titre + artiste (dévoilés au reveal comme partout — masqués en phase 1).
 *   - timeline EXACTE + scrub tactile : la position vient de la console
 *     (broadcast track:progress) ; glisser la barre → seek serveur absolu →
 *     la console applique. La télécommande n'émet AUCUN son.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CurrentTrackState } from '@tutti/shared';
import { Badge, Button, Card } from '../ui/index.js';
import { PwaInstallButton } from '../PwaInstallButton.js';

export interface MasterProgress {
  position_ms: number;
  duration_ms: number | null;
  is_paused: boolean;
  /** Date.now() à la réception (interpolation locale entre 2 broadcasts). */
  at: number;
}

export interface MasterMenuProps {
  isPaused: boolean;
  currentTrack: CurrentTrackState | null;
  hasActiveRound: boolean;
  busy: boolean;
  onReveal: () => Promise<void>;
  onSkipTrack: () => Promise<void>;
  onNextTrack: () => Promise<void>;
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
  onRestartTrack?: () => Promise<void>;
  /** ±10s. Seek serveur → la console applique (pas de son ici). */
  onSeekBack?: () => void;
  onSeekForward?: () => void;
  /** Scrub tactile → seek serveur absolu (ms). */
  onSeekTo?: (ms: number) => void;
  /** Position/durée diffusées par la console (track:progress). */
  progress?: MasterProgress | null;
  onEndRound?: () => Promise<void>;
  onEndSession: () => Promise<void>;
  onPickRound: () => void;
  onAdjustPoints: () => void;
  /** feat/animator-full-control — score rapide (−5/+5/+10 par joueur), comme la console. */
  players?: { id: string; pseudo: string; score: number }[];
  onQuickAdjust?: (participantId: string, delta: number) => void;
}

function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function MasterMenu(props: MasterMenuProps): JSX.Element {
  const { t } = useTranslation();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmEndRound, setConfirmEndRound] = useState(false);
  const [showScores, setShowScores] = useState(false);
  const phase = props.currentTrack?.phase ?? null;
  const track = props.currentTrack;

  // Tick 250ms pour interpoler la position entre deux broadcasts (sauf en pause).
  const [, force] = useState(0);
  useEffect(() => {
    if (props.isPaused) return;
    const id = window.setInterval(() => force((n) => (n + 1) % 1_000_000), 250);
    return () => window.clearInterval(id);
  }, [props.isPaused]);

  // Position live : progress console interpolé, sinon fallback started_at.
  const prog = props.progress ?? null;
  const durationMs = prog?.duration_ms ?? track?.duration_ms ?? null;
  let positionMs = 0;
  if (prog) {
    positionMs = prog.position_ms + (prog.is_paused || props.isPaused ? 0 : Date.now() - prog.at);
  } else if (track?.started_at) {
    positionMs = Math.max(0, Date.now() - new Date(track.started_at).getTime());
  }
  if (durationMs) positionMs = Math.min(positionMs, durationMs);

  // Scrub tactile.
  const barRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null); // fraction 0..1 pendant le drag
  const canScrub = !!durationMs && !!props.onSeekTo && props.hasActiveRound && !!track;
  const fracFromClientX = (clientX: number): number => {
    const el = barRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };
  const displayFrac = drag !== null ? drag : durationMs ? Math.min(1, positionMs / durationMs) : 0;
  const displayLeftMs = drag !== null && durationMs ? drag * durationMs : positionMs;

  const hasMeta = !!track && (!!track.title || !!track.artist);

  return (
    <Card tone="cream" size="md" className="!border-3 border-spritz-deep">
      <div className="flex items-center gap-2 mb-3">
        <span aria-hidden className="text-lg">
          👑
        </span>
        <p className="font-display text-base">{t('play.masterMenuTitle')}</p>
      </div>

      {/* feat/manette-console-master — titre + artiste + timeline exacte + scrub */}
      {props.hasActiveRound && track && (
        <div className="mb-3">
          <p className="font-medium text-sm truncate">
            {hasMeta ? (
              <>
                {track.title}
                {track.artist ? <span className="text-ink-soft"> — {track.artist}</span> : null}
              </>
            ) : (
              <span className="text-ink-soft">♪ Lecture en cours…</span>
            )}
          </p>
          <div className="flex items-center justify-between font-mono text-xs text-ink-soft mt-1 mb-1">
            <span className="tabular-nums">{fmtTime(displayLeftMs)}</span>
            {durationMs ? (
              <span className="tabular-nums">{fmtTime(durationMs)}</span>
            ) : (
              <span aria-hidden>♪</span>
            )}
          </div>
          {/* Barre : draggable si durée connue. Zone tactile généreuse (py-2). */}
          <div
            ref={barRef}
            role={canScrub ? 'slider' : undefined}
            aria-label={canScrub ? 'Position de lecture' : undefined}
            aria-valuemin={0}
            aria-valuemax={durationMs ?? undefined}
            aria-valuenow={canScrub ? Math.round(displayLeftMs) : undefined}
            className={`-mx-1 px-1 py-2 ${canScrub ? 'cursor-pointer touch-none' : ''}`}
            onPointerDown={
              canScrub
                ? (e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setDrag(fracFromClientX(e.clientX));
                  }
                : undefined
            }
            onPointerMove={
              canScrub
                ? (e) => {
                    if (drag === null) return;
                    setDrag(fracFromClientX(e.clientX));
                  }
                : undefined
            }
            onPointerUp={
              canScrub
                ? (e) => {
                    if (drag === null) return;
                    const f = fracFromClientX(e.clientX);
                    setDrag(null);
                    if (durationMs && props.onSeekTo) props.onSeekTo(f * durationMs);
                  }
                : undefined
            }
          >
            <div className="relative h-2 bg-ink/10 rounded-full">
              <div
                className={`absolute inset-y-0 left-0 bg-spritz rounded-full ${
                  drag !== null ? '' : 'transition-[width] duration-200 ease-linear'
                }`}
                style={{ width: `${Math.round(displayFrac * 100)}%` }}
              />
              {canScrub && (
                <div
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-spritz-deep border-2 border-white shadow"
                  style={{ left: `${Math.round(displayFrac * 100)}%` }}
                />
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {props.hasActiveRound && !props.isPaused && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void props.onPause()}
            disabled={props.busy}
          >
            ⏸ {t('play.masterPause')}
          </Button>
        )}
        {props.isPaused && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => void props.onResume()}
            disabled={props.busy}
          >
            ▶ {t('play.masterResume')}
          </Button>
        )}

        {props.hasActiveRound && track && props.onRestartTrack && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void props.onRestartTrack!()}
            disabled={props.busy}
          >
            🔄 {t('play.masterRestart')}
          </Button>
        )}

        {props.hasActiveRound &&
          track &&
          !props.isPaused &&
          props.onSeekBack &&
          props.onSeekForward && (
            <>
              <Button variant="ghost" size="sm" onClick={props.onSeekBack} disabled={props.busy}>
                ⏪ −10s
              </Button>
              <Button variant="ghost" size="sm" onClick={props.onSeekForward} disabled={props.busy}>
                +10s ⏩
              </Button>
            </>
          )}

        {phase === 'phase1' && !props.isPaused && (
          <>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void props.onReveal()}
              disabled={props.busy}
            >
              ▶ {t('play.masterReveal')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void props.onSkipTrack()}
              disabled={props.busy}
            >
              ⏭ {t('play.masterSkip')}
            </Button>
          </>
        )}

        {/* ── Morceau suivant (cooldown / après reveal) ─────────────────────
            BUG FIX : l'ancienne condition `phase3 || (phase3-revealed && !paused
            && <Button/>)` rendait `true` (donc RIEN) en phase3, et cachait le
            bouton en pause. On l'affiche dès qu'on est en phase3/phase3-revealed,
            même en pause (avancer reprend la lecture sur le morceau suivant). */}
        {props.hasActiveRound && track && (phase === 'phase3' || phase === 'phase3-revealed') && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => void props.onNextTrack()}
            disabled={props.busy}
            className="col-span-2"
          >
            ▶ {t('play.masterNext')} →
          </Button>
        )}

        {!props.hasActiveRound && (
          <Button
            variant="primary"
            size="sm"
            onClick={props.onPickRound}
            disabled={props.busy}
            className="col-span-2"
          >
            ▶ {t('play.masterPickRound')}
          </Button>
        )}

        <Button
          variant="ghost"
          size="sm"
          onClick={props.onAdjustPoints}
          disabled={props.busy}
          className="col-span-2"
        >
          ⚖ {t('play.masterAdjust')}
        </Button>

        {/* feat/animator-full-control — score rapide −5/+5/+10 par joueur (console-like). */}
        {props.players && props.players.length > 0 && props.onQuickAdjust && (
          <div className="col-span-2">
            <button
              type="button"
              onClick={() => setShowScores((s) => !s)}
              className="w-full text-xs font-mono text-ink-soft hover:text-ink py-1"
            >
              🏆 Scores {showScores ? '▲' : '▼'}
            </button>
            {showScores && (
              <ul className="space-y-1 mt-1 max-h-52 overflow-y-auto">
                {props.players.map((pl) => (
                  <li
                    key={pl.id}
                    className="flex items-center gap-1.5 bg-white/70 border border-ink/10 rounded px-2 py-1"
                  >
                    <span className="flex-1 min-w-0 truncate text-sm">{pl.pseudo}</span>
                    <span className="font-mono text-xs tabular-nums text-ink-soft w-8 text-right">
                      {pl.score}
                    </span>
                    {[-5, 5, 10].map((d) => (
                      <button
                        key={d}
                        type="button"
                        disabled={props.busy}
                        onClick={() => props.onQuickAdjust!(pl.id, d)}
                        className="px-1.5 py-0.5 text-xs font-mono border-2 border-ink/20 rounded hover:bg-cream-2 disabled:opacity-50"
                      >
                        {d > 0 ? `+${d}` : d}
                      </button>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {props.hasActiveRound && props.onEndRound && (
          <>
            {!confirmEndRound ? (
              <button
                type="button"
                onClick={() => setConfirmEndRound(true)}
                disabled={props.busy}
                className="col-span-2 text-xs font-mono text-ink-soft hover:text-ink hover:underline mt-1"
              >
                ⏹ {t('play.masterEndRound')}
              </button>
            ) : (
              <div className="col-span-2 mt-2 p-2 border-2 border-ink rounded bg-cream-2">
                <p className="text-xs font-medium text-ink mb-2">
                  {t('play.masterEndRoundConfirm')}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setConfirmEndRound(false);
                      void props.onEndRound!();
                    }}
                    disabled={props.busy}
                  >
                    {t('play.masterEndRoundYes')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmEndRound(false)}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {!confirmEnd ? (
          <button
            type="button"
            onClick={() => setConfirmEnd(true)}
            disabled={props.busy}
            className="col-span-2 text-xs font-mono text-raspberry hover:underline mt-1"
          >
            🛑 {t('play.masterEndSession')}
          </button>
        ) : (
          <div className="col-span-2 mt-2 p-2 border-2 border-raspberry rounded bg-cream-2">
            <p className="text-xs font-medium text-raspberry mb-2">
              {t('play.masterEndSessionConfirm')}
            </p>
            <div className="flex gap-2">
              <Button
                variant="danger"
                size="sm"
                onClick={() => void props.onEndSession()}
                disabled={props.busy}
              >
                {t('play.masterEndSessionYes')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmEnd(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}
      </div>

      {props.isPaused && (
        <Badge tone="plum" tilt={1} className="mt-3">
          ⏸ {t('play.masterPausedBadge')}
        </Badge>
      )}

      <PwaInstallButton className="mt-3" />
    </Card>
  );
}
