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
import { PwaInstallButton } from '../PwaInstallButton.js';

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
  /** feat/sans-animateur — recul/avance de 10s. Seek serveur → la console
   *  applique sur SON lecteur (la télécommande n'émet aucun son). */
  onSeekBack?: () => void;
  onSeekForward?: () => void;
  /** F3 (feat/playlist-search-and-host-improvements) — terminer la manche
   *  courante depuis l'interface du master en mode B. Affiche un bouton
   *  visible uniquement quand hasActiveRound. Avant : seul l'host desktop
   *  classique avait ce contrôle, le master mode B était bloqué. */
  onEndRound?: () => Promise<void>;
  onEndSession: () => Promise<void>;
  onPickRound: () => void; // ouvre le picker (modale gérée à l'extérieur)
  onAdjustPoints: () => void; // ouvre la sheet (modale gérée à l'extérieur)
}

export function MasterMenu(props: MasterMenuProps): JSX.Element {
  const { t } = useTranslation();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmEndRound, setConfirmEndRound] = useState(false);
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

        {/* ── Recommencer le morceau ─────────────────────────────────── */}
        {props.hasActiveRound && props.currentTrack && props.onRestartTrack && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void props.onRestartTrack!()}
            disabled={props.busy}
          >
            🔄 {t('play.masterRestart')}
          </Button>
        )}

        {/* ── Avance / recul ±10s (seek serveur → lecteur de la console) ── */}
        {props.hasActiveRound &&
          props.currentTrack &&
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

        {/* ── F3 — Terminer la manche (visible quand hasActiveRound) ──── */}
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

      {/* feat/pwa-installable — bouton "Installer Tutti" discret. Auto-hidden
          si déjà standalone ou navigateur non supporté (cf. usePwa). */}
      <PwaInstallButton className="mt-3" />
    </Card>
  );
}
