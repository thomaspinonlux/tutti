/**
 * <PlayersPanel /> — Feature 3
 *
 * Liste des joueurs côté animateur avec édition manuelle des points
 * (+5 / -5 / +10 / -10). Affiché sous le panneau "Programme de la manche"
 * dans la sidebar droite de RoundPlayingScreen.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CumulativeScore, Participant } from '@tutti/shared';
import { hostAdjustPoints, toggleParticipantMaster } from '../../lib/sessions.js';
import { Button, Card } from '../ui/index.js';

const CORAL = '#FF5C4D';

interface Props {
  sessionId: string;
  participants: Participant[];
  cumulative: CumulativeScore[];
  className?: string;
  /** Thème sombre (console premium) — défaut clair. */
  dark?: boolean;
}

export function PlayersPanel({
  sessionId,
  participants,
  cumulative,
  className,
  dark = false,
}: Props): JSX.Element {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Map participant_id → score (depuis cumulative). En SOLO la cumulative
  // a un entry par participant ; en TEAMS un entry par team. Pour l'affichage
  // par joueur, on cherche dans cumulative par id (matche en SOLO).
  const scoreByPid = new Map<string, number>();
  cumulative.forEach((entry) => {
    scoreByPid.set(entry.id, entry.total_points);
  });

  const handleAdjust = async (pid: string, delta: number): Promise<void> => {
    setBusy(pid);
    setError(null);
    try {
      await hostAdjustPoints(sessionId, pid, delta);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // fix/provider-master-manette (BUG 2) — désigne CE joueur comme animateur
  // (manette sur son tel). Toggle atomique côté serveur (1 seul master) ; le
  // broadcast participant:master_changed rafraîchit `participants` → l'état
  // actif (p.is_master) se met à jour + la manette s'active sur le tel du joueur.
  const handleToggleMaster = async (pid: string): Promise<void> => {
    setBusy(pid);
    setError(null);
    try {
      await toggleParticipantMaster(sessionId, pid);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const adjustClass = dark
    ? '!px-2 !py-1 text-xs font-mono rounded-lg border border-white/15 bg-white/[0.06] text-white hover:bg-white/[0.14] transition-colors disabled:opacity-40'
    : '!px-2 !py-1 !text-xs';

  const body = (
    <>
      <p
        className={`font-mono text-xs uppercase tracking-[0.2em] mb-3 ${dark ? '' : 'text-spritz-deep'}`}
        style={dark ? { color: CORAL } : undefined}
      >
        {t('host.playersTitle')}
      </p>
      {participants.length === 0 && (
        <p className={`font-editorial italic text-sm ${dark ? 'text-white/50' : 'text-ink-soft'}`}>
          {t('host.playersEmpty')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-raspberry mb-2">
          {error}
        </p>
      )}
      <ul className="space-y-1.5 max-h-[40vh] overflow-y-auto pr-1">
        {participants.map((p) => {
          const score = scoreByPid.get(p.id) ?? 0;
          const isBusy = busy === p.id;
          const initial = p.pseudo.charAt(0).toUpperCase();
          return (
            <li
              key={p.id}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-xl flex-wrap ${dark ? 'border border-white/10 bg-white/[0.05]' : 'border-2 border-ink bg-white'}`}
            >
              <span
                aria-hidden
                className={`w-7 h-7 rounded-full flex items-center justify-center font-display text-sm shrink-0 ${dark ? 'text-[#0B0B0F]' : 'border-2 border-ink bg-spritz'}`}
                style={dark ? { backgroundColor: CORAL } : undefined}
              >
                {initial}
              </span>
              <div className="flex-1 min-w-0">
                <p className={`font-medium text-sm truncate ${dark ? 'text-white' : ''}`}>
                  {p.pseudo}
                </p>
                <p
                  className={`font-mono text-[10px] tabular-nums ${dark ? 'text-white/45' : 'text-ink-soft'}`}
                >
                  {score} {t('host.playersPts')}
                </p>
              </div>
              <div className="flex gap-1 shrink-0 flex-wrap justify-end">
                <button
                  type="button"
                  onClick={() => void handleToggleMaster(p.id)}
                  disabled={isBusy}
                  aria-pressed={p.is_master}
                  title={p.is_master ? t('host.masterRevoke') : t('host.masterAssign')}
                  className={[
                    '!px-2 !py-1 text-xs font-mono rounded-lg border transition-colors',
                    p.is_master
                      ? 'border-basil bg-basil/20 text-basil'
                      : dark
                        ? 'border-white/15 text-white/60 hover:bg-white/10'
                        : 'border-ink/25 text-ink-soft hover:bg-cream-2',
                  ].join(' ')}
                >
                  🎙️{p.is_master ? ' ✓' : ''}
                </button>
                {dark ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleAdjust(p.id, -5)}
                      disabled={isBusy}
                      className={adjustClass}
                    >
                      -5
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleAdjust(p.id, +5)}
                      disabled={isBusy}
                      className={adjustClass}
                    >
                      +5
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleAdjust(p.id, +10)}
                      disabled={isBusy}
                      className={adjustClass}
                    >
                      +10
                    </button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleAdjust(p.id, -5)}
                      disabled={isBusy}
                      className={adjustClass}
                    >
                      -5
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleAdjust(p.id, +5)}
                      disabled={isBusy}
                      className={adjustClass}
                    >
                      +5
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleAdjust(p.id, +10)}
                      disabled={isBusy}
                      className={adjustClass}
                    >
                      +10
                    </Button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );

  if (dark) {
    return (
      <div
        className={`rounded-[20px] border border-white/[0.07] bg-[#15151d]/80 p-4 backdrop-blur-xl ${className ?? ''}`}
      >
        {body}
      </div>
    );
  }
  return (
    <Card tone="cream" size="sm" className={className}>
      {body}
    </Card>
  );
}
