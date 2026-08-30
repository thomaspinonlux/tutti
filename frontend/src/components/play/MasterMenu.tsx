/**
 * MasterMenu — panneau de pilotage qui apparaît sur le tel du joueur
 * désigné master EN MODE B "Sans animateur" (désigné DEPUIS LA CONSOLE).
 *
 * Boutons phase-aware :
 *   - listening  : ▶ Réponse  /  ⏭ Morceau suivant  /  ⏸ Pause  /  🛑 Terminer
 *   - buzzed     : (rien — le buzzer répond)  /  ⏸ Pause  /  🛑 Terminer
 *   - cooldown   : ▶ Suivant  /  ⏸ Pause  /  🛑 Terminer
 *   - pas de round PLAYING : ▶ Manche suivante (picker)  /  🛑 Terminer
 *   - paused     : ▶ Reprendre / 🛑 Terminer
 *   - tout au long : ⚖ Ajuster les points
 *
 * feat/manette-console-master :
 *   - titre + artiste (dévoilés au reveal comme partout — masqués en phase 1).
 *   - timeline EXACTE (affichage seul) : la position vient de la console
 *     (broadcast track:progress). Le scrub tactile a été retiré
 *     (fix/master-timeline-readonly) — trop de risque de toucher la barre par
 *     erreur en soirée. L'avance/recul se fait par les boutons ±10 s. La
 *     télécommande n'émet AUCUN son.
 */

import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
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
  /** feat/master-titres-restants — total de titres de la manche en cours. */
  tracksTotal?: number | null;
  /** feat/relancer-le-son-telecommande — relance le son sur la console. */
  onAudioKick?: () => void;
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
  /** feat/master-volume — volume 0..1 → commande serveur, la console applique. */
  onSetVolume?: (v: number) => void;
  /**
   * feat/synced-lyrics — paroles disponibles ET morceau révélé ? Calculé par
   * l'appelant depuis currentTrack.lyrics_available + la phase. Si false, le
   * bouton n'est PAS rendu (règle : pas de paroles vérifiées → pas de bouton).
   */
  lyricsAvailable?: boolean;
  /** Overlay paroles actuellement affiché (source de vérité = serveur). */
  lyricsOn?: boolean;
  onToggleLyrics?: (on: boolean) => void;
  onRejectLyrics?: () => void;
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

/**
 * feat/master-touch-buttons — vrais boutons tactiles pour la console animateur.
 * Zone tactile généreuse (≥ 56px), coins 12px, icône + label centrés, press
 * arcade (translate + ombre écrasée). Couleurs sémantiques :
 *   - coral    : Pause (fond spritz)
 *   - go       : Reprendre (fond basil/vert)
 *   - key      : action clé — Réponse / Suivant / Manche suivante (fond rose)
 *   - neutral  : contrôles courants — bord ink sur cream
 *   - endRound : Fin manche — bleu doux, calme, démarqué du destructif
 *   - danger   : Fin soirée — rouge (irréversible)
 */
type CtrlTone = 'coral' | 'go' | 'key' | 'neutral' | 'endRound' | 'danger';

const CTRL_TONES: Record<CtrlTone, string> = {
  coral: 'bg-spritz text-cream border-ink',
  go: 'bg-basil text-cream border-ink',
  key: 'bg-rose text-ink border-ink',
  neutral: 'bg-cream text-ink border-ink',
  // Bleu doux (accent one-off) : calme, non-alarmant, distinct du danger.
  endRound: 'bg-[#d9e8f0] text-[#2f5468] border-[#2f5468]/45',
  danger: 'bg-raspberry text-cream border-ink',
};

interface CtrlButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: CtrlTone;
  icon: ReactNode;
  label: ReactNode;
  /** Icône à côté du label (rangée) au lieu d'au-dessus (colonne). */
  row?: boolean;
}

function CtrlButton({
  tone = 'neutral',
  icon,
  label,
  row = false,
  className,
  ...rest
}: CtrlButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className={[
        'flex items-center justify-center min-h-[60px] rounded-xl border-2 px-2 text-center',
        'font-bold text-sm leading-tight select-none touch-manipulation',
        'shadow-arcade-sm transition-all duration-[80ms] ease-out',
        'active:translate-x-[2px] active:translate-y-[2px] active:shadow-arcade-flat',
        'disabled:opacity-40 disabled:active:translate-x-0 disabled:active:translate-y-0',
        row ? 'flex-row gap-2' : 'flex-col gap-1',
        CTRL_TONES[tone],
        className ?? '',
      ].join(' ')}
      {...rest}
    >
      <span aria-hidden className="text-2xl leading-none">
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

export function MasterMenu(props: MasterMenuProps): JSX.Element {
  const { t } = useTranslation();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmEndRound, setConfirmEndRound] = useState(false);
  const [showScores, setShowScores] = useState(false);
  // feat/master-volume — volume local de la manette (0..1, défaut plein).
  // Fire-and-forget : chaque changement pousse une commande serveur ; la console
  // est seule à émettre du son. Pas de lecture inverse (la manette est muette).
  const [volume, setVolume] = useState(1);
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

  // fix/master-timeline-readonly — la timeline est désormais AFFICHAGE SEUL.
  // Le scrub tactile (glisser le doigt pour déplacer la lecture) a été retiré :
  // en soirée, l'animateur touchait la barre par erreur en tenant son téléphone
  // et faisait sauter la musique. On garde l'avance/recul par boutons ±10 s
  // (gestes délibérés). Progression + temps restent affichés.
  const displayFrac = durationMs ? Math.min(1, positionMs / durationMs) : 0;
  const displayLeftMs = positionMs;

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
          {typeof props.tracksTotal === 'number' && props.tracksTotal > 0 && (
            <p className="font-mono text-[11px] uppercase tracking-widest text-ink-soft mb-1">
              Titre {track.track_index + 1}/{props.tracksTotal} · reste{' '}
              {Math.max(0, props.tracksTotal - (track.track_index + 1))}
            </p>
          )}
          {/* feat/pochettes-album — pochette du morceau en cours, à côté du
              titre. Rendue seulement si le serveur l'a fournie : avant la
              révélation elle est nulle pour un animateur-joueur (anti-triche). */}
          <div className="flex items-center gap-2.5">
            {track.cover_url && (
              <img
                src={track.cover_url}
                alt=""
                className="h-11 w-11 shrink-0 rounded-md border-2 border-ink object-cover"
              />
            )}
            <p className="min-w-0 flex-1 font-medium text-sm truncate">
              {hasMeta ? (
                <>
                  {track.title}
                  {track.artist ? <span className="text-ink-soft"> — {track.artist}</span> : null}
                </>
              ) : (
                <span className="text-ink-soft">♪ Lecture en cours…</span>
              )}
            </p>
          </div>
          <div className="flex items-center justify-between font-mono text-xs text-ink-soft mt-1 mb-1">
            <span className="tabular-nums">{fmtTime(displayLeftMs)}</span>
            {durationMs ? (
              <span className="tabular-nums">{fmtTime(durationMs)}</span>
            ) : (
              <span aria-hidden>♪</span>
            )}
          </div>
          {/* fix/master-timeline-readonly — barre de progression AFFICHAGE SEUL
              (non tactile) : plus de scrub accidental. Pas de handlers pointer,
              pas de poignée, pas de role="slider". */}
          <div className="-mx-1 px-1 py-2">
            <div className="relative h-2 bg-ink/10 rounded-full">
              <div
                className="absolute inset-y-0 left-0 bg-spritz rounded-full transition-[width] duration-200 ease-linear"
                style={{ width: `${Math.round(displayFrac * 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* feat/master-volume — réglage du volume de la console depuis la manette. */}
      {props.hasActiveRound && track && props.onAudioKick && (
        <button
          type="button"
          onClick={props.onAudioKick}
          disabled={props.busy}
          className="mb-3 w-full rounded-2xl border-4 border-ink bg-spritz py-3 font-display text-lg active:translate-y-0.5 disabled:opacity-50"
        >
          🔊 RELANCER LE SON
        </button>
      )}

      {props.hasActiveRound && track && props.onSetVolume && (
        <div className="mb-3 flex items-center gap-2">
          <span aria-hidden className="text-base">
            🔊
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(volume * 100)}
            onChange={(e) => {
              const v = Number(e.target.value) / 100;
              setVolume(v);
              props.onSetVolume!(v);
            }}
            aria-label={t('play.masterVolume')}
            className="flex-1 accent-spritz-deep touch-none"
          />
          <span className="font-mono text-xs text-ink-soft tabular-nums w-9 text-right">
            {Math.round(volume * 100)}%
          </span>
        </div>
      )}

      {/* ── feat/synced-lyrics — paroles (affichage MANUEL) ───────────────
          Rendu UNIQUEMENT si des paroles vérifiées existent pour le morceau
          ET qu'il est révélé (l'appelant calcule `lyricsAvailable`). */}
      {props.lyricsAvailable && props.onToggleLyrics && (
        <div className="flex items-center gap-2">
          <CtrlButton
            tone={props.lyricsOn ? 'go' : 'neutral'}
            icon="🎤"
            label={props.lyricsOn ? t('host.session.lyricsHide') : t('host.session.lyricsShow')}
            onClick={() => props.onToggleLyrics!(!props.lyricsOn)}
            disabled={props.busy}
          />
          {props.onRejectLyrics && (
            <button
              type="button"
              onClick={() => props.onRejectLyrics!()}
              disabled={props.busy}
              className="shrink-0 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-ink-soft underline underline-offset-2 disabled:opacity-40"
            >
              {t('host.session.lyricsWrong')}
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        {/* ── Pause ↔ Reprendre (toggle selon l'état) ─────────────────────── */}
        {props.hasActiveRound && !props.isPaused && (
          <CtrlButton
            tone="coral"
            icon="⏸"
            label={t('play.masterPause')}
            onClick={() => void props.onPause()}
            disabled={props.busy}
          />
        )}
        {props.isPaused && (
          <CtrlButton
            tone="go"
            icon="▶"
            label={t('play.masterResume')}
            onClick={() => void props.onResume()}
            disabled={props.busy}
          />
        )}

        {props.hasActiveRound && track && props.onRestartTrack && (
          <CtrlButton
            tone="neutral"
            icon="🔄"
            label={t('play.masterRestart')}
            onClick={() => void props.onRestartTrack!()}
            disabled={props.busy}
          />
        )}

        {props.hasActiveRound &&
          track &&
          !props.isPaused &&
          props.onSeekBack &&
          props.onSeekForward && (
            <>
              <CtrlButton
                tone="neutral"
                row
                icon="⏪"
                label="−10s"
                onClick={props.onSeekBack}
                disabled={props.busy}
              />
              <CtrlButton
                tone="neutral"
                row
                icon="⏩"
                label="+10s"
                onClick={props.onSeekForward}
                disabled={props.busy}
              />
            </>
          )}

        {/* Réponse (action clé, plus large) / Morceau suivant — phase1 */}
        {/* fix/boutons-identiques — RÉVÉLER + SAUTER : mêmes conditions que la
            console iPad (phase 1 ET phase 2, y compris en pause). Avant, la
            télécommande n'affichait ces boutons qu'en phase 1 hors pause :
            dès qu'un joueur avait trouvé, « Révéler la réponse » disparaissait
            et semblait « ne pas réagir ». */}
        {(phase === 'phase1' || phase === 'phase2') && (
          <div className="col-span-2 grid grid-cols-[1.4fr_1fr] gap-2.5">
            <CtrlButton
              tone="key"
              row
              icon="👁"
              label={t('play.masterReveal')}
              onClick={() => void props.onReveal()}
              disabled={props.busy}
            />
            <CtrlButton
              tone="neutral"
              row
              icon="⏭"
              label={t('play.masterSkip')}
              onClick={() => void props.onSkipTrack()}
              disabled={props.busy}
            />
          </div>
        )}

        {/* ── Morceau suivant (cooldown / après reveal) ─────────────────────
            BUG FIX : l'ancienne condition `phase3 || (phase3-revealed && !paused
            && <Button/>)` rendait `true` (donc RIEN) en phase3, et cachait le
            bouton en pause. On l'affiche dès qu'on est en phase3/phase3-revealed,
            même en pause (avancer reprend la lecture sur le morceau suivant). */}
        {props.hasActiveRound && track && (phase === 'phase3' || phase === 'phase3-revealed') && (
          <CtrlButton
            tone="key"
            row
            icon="▶"
            label={`${t('play.masterNext')} →`}
            onClick={() => void props.onNextTrack()}
            disabled={props.busy}
            className="col-span-2"
          />
        )}

        {!props.hasActiveRound && (
          <CtrlButton
            tone="key"
            row
            icon="▶"
            label={t('play.masterPickRound')}
            onClick={props.onPickRound}
            disabled={props.busy}
            className="col-span-2"
          />
        )}

        <CtrlButton
          tone="neutral"
          row
          icon="⚖"
          label={t('play.masterAdjust')}
          onClick={props.onAdjustPoints}
          disabled={props.busy}
          className="col-span-2"
        />

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

        {/* ── Zone fin : Fin manche | Fin soirée (côte à côte), confirmation
            en pleine largeur. Fin manche = bleu doux (calme), Fin soirée =
            rouge (irréversible). ─────────────────────────────────────────── */}
        {confirmEndRound && props.onEndRound && (
          <div className="col-span-2 mt-1 p-2.5 border-2 border-[#2f5468]/50 rounded-xl bg-[#d9e8f0]">
            <p className="text-xs font-medium text-[#2f5468] mb-2">
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

        {confirmEnd && (
          <div className="col-span-2 mt-1 p-2.5 border-2 border-raspberry rounded-xl bg-cream-2">
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

        {!confirmEndRound && !confirmEnd && (
          <div
            className={`col-span-2 grid gap-2.5 ${
              props.hasActiveRound && props.onEndRound ? 'grid-cols-2' : 'grid-cols-1'
            }`}
          >
            {props.hasActiveRound && props.onEndRound && (
              <CtrlButton
                tone="endRound"
                row
                icon="⏹"
                label={t('play.masterEndRound')}
                onClick={() => setConfirmEndRound(true)}
                disabled={props.busy}
              />
            )}
            <CtrlButton
              tone="danger"
              row
              icon="🛑"
              label={t('play.masterEndSession')}
              onClick={() => setConfirmEnd(true)}
              disabled={props.busy}
            />
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
