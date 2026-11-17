/**
 * <PlayersPanel /> — Feature 3
 *
 * Liste des joueurs côté animateur avec édition manuelle des points
 * (+5 / -5 / +10 / -10). Affiché sous le panneau "Programme de la manche"
 * dans la sidebar droite de RoundPlayingScreen.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CumulativeScore, Participant, ParticipantRole } from '@tutti/shared';
import { hostAdjustPoints, kickParticipant, setParticipantRole } from '../../lib/sessions.js';
import { Button, Card } from '../ui/index.js';
import { RoleSelector } from './RoleSelector.js';

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

  // feat/roles-en-partie — Thomas, 17/11 : pendant la partie, les mêmes trois
  // rôles qu'à l'accueil (Joueur / Animateur joueur / Animateur seul), au lieu
  // du seul bouton « animateur » qui ne donnait qu'animateur joueur.
  // L'écran change tout de suite ; l'événement participant:role_changed
  // remet ensuite la liste à jour pour tout le monde.
  const [roleLocal, setRoleLocal] = useState<Record<string, ParticipantRole>>({});
  // Dès que la liste reçue confirme le rôle, on rend la main à la liste.
  useEffect(() => {
    setRoleLocal((m) => {
      const reste = { ...m };
      let change = false;
      for (const p of participants) {
        if (reste[p.id] !== undefined && reste[p.id] === p.role) {
          delete reste[p.id];
          change = true;
        }
      }
      return change ? reste : m;
    });
  }, [participants]);
  const handleSetRole = async (pid: string, role: ParticipantRole): Promise<void> => {
    setBusy(pid);
    setError(null);
    setRoleLocal((m) => ({ ...m, [pid]: role }));
    try {
      await setParticipantRole(sessionId, pid, role);
    } catch (err) {
      setRoleLocal((m) => {
        const { [pid]: _retire, ...reste } = m;
        return reste;
      });
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // feat/kick-in-game — retirer un joueur pendant la partie (mauvaise connexion
  // / reconnexion). Serveur : is_kicked=true + broadcast participant:kicked →
  // le joueur retombe sur l'écran pseudo et peut se reconnecter proprement.
  const handleKick = async (pid: string, pseudo: string): Promise<void> => {
    if (!window.confirm(t('host.kickConfirmPlayer', { pseudo }))) return;
    setBusy(pid);
    setError(null);
    try {
      await kickParticipant(sessionId, pid);
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
                <RoleSelector
                  role={roleLocal[p.id] ?? p.role}
                  onSetRole={(r) => void handleSetRole(p.id, r)}
                  compact
                  dark={dark}
                />
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
                {/* feat/kick-in-game — retirer le joueur (mauvaise connexion). */}
                <button
                  type="button"
                  onClick={() => void handleKick(p.id, p.pseudo)}
                  disabled={isBusy}
                  title={t('host.kickPlayer')}
                  aria-label={t('host.kickPlayer')}
                  className={[
                    '!px-2 !py-1 text-xs font-mono rounded-lg border transition-colors',
                    dark
                      ? 'border-raspberry/40 text-raspberry hover:bg-raspberry/15'
                      : 'border-raspberry/40 text-raspberry hover:bg-raspberry/10',
                  ].join(' ')}
                >
                  ✕
                </button>
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
