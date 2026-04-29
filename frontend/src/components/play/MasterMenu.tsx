/**
 * MasterMenu — panneau de pilotage qui apparaît sur le tel du joueur
 * désigné master en mode B "Sans animateur".
 *
 * Boutons phase-aware :
 *   - listening  : ▶ Réponse  /  ⏭ Sauter  /  ⏸ Pause  /  🛑 Terminer
 *   - buzzed     : (rien — le buzzer répond, le master n'intervient pas)  /  ⏸ Pause  /  🛑 Terminer
 *   - cooldown   : ▶ Suivant  /  ⏸ Pause  /  🛑 Terminer
 *   - aucun round PLAYING (intermission ou waiting → après un round terminé) :
 *                 ▶ Manche suivante (ouvre le picker)  /  🛑 Terminer
 *   - paused     : ▶ Reprendre / 🛑 Terminer
 *   - tout au long : ⚖ Ajuster les points
 *
 * Le composant ne pilote QUE le UI : les actions sont passées par props.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CurrentTrackState } from '@tutti/shared';
import { Badge, Button, Card } from '../ui/index.js';

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
  onEndSession: () => Promise<void>;
  onPickRound: () => void; // ouvre le picker (modale gérée à l'extérieur)
  onAdjustPoints: () => void; // ouvre la sheet (modale gérée à l'extérieur)
}

export function MasterMenu(props: MasterMenuProps): JSX.Element {
  const { t } = useTranslation();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const phase = props.currentTrack?.phase ?? null;

  return (
    <Card tone="cream" size="md" className="!border-3 border-spritz-deep">
      <div className="flex items-center gap-2 mb-3">
        <span aria-hidden className="text-lg">
          👑
        </span>
        <p className="font-display text-base">{t('play.masterMenuTitle')}</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {/* ── Pause / Reprise (toujours visible quand on a un round) ───── */}
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

        {/* ── Phase listening : Réponse + Sauter ──────────────────────── */}
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

        {/* ── Phase cooldown : Suivant ─────────────────────────────────── */}
        {phase === 'phase3' ||
          (phase === 'phase3-revealed' && !props.isPaused && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => void props.onNextTrack()}
              disabled={props.busy}
              className="col-span-2"
            >
              ▶ {t('play.masterNext')} →
            </Button>
          ))}

        {/* ── Pas de round actif (intermission après round-end) : pick suivant ── */}
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

        {/* ── Ajuster les points (toujours dispo) ──────────────────────── */}
        <Button
          variant="ghost"
          size="sm"
          onClick={props.onAdjustPoints}
          disabled={props.busy}
          className="col-span-2"
        >
          ⚖ {t('play.masterAdjust')}
        </Button>

        {/* ── Terminer (avec confirm in-place) ─────────────────────────── */}
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
    </Card>
  );
}
