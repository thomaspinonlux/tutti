/**
 * /host?session=CODE — salle d'attente de l'host (étape 9).
 *
 * Hôte connecté : on récupère la session via /api/sessions/by-code (vue publique
 * suffit pour avoir l'ID), puis on ouvre Socket.IO en mode "host" et on s'abonne
 * aux événements participant:joined / left / moved_team / kicked.
 *
 * Layout :
 *   - bloqué sub-lg via <MinScreen min="lg"> (cf. docs/RESPONSIVE.md)
 *   - lg → xl : 1 colonne empilée (QR en haut, participants dessous)
 *   - ≥ xl : 2 colonnes (QR à gauche, participants à droite)
 */

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Socket } from 'socket.io-client';
import type { Participant, SessionWithParticipants, Team } from '@tutti/shared';
import {
  getPublicSession,
  kickParticipant,
  moveParticipantTeam,
  startSession,
} from '../lib/sessions.js';
import { connectAsHost } from '../lib/socket.js';
import { MinScreen } from '../components/MinScreen.js';
import {
  Badge,
  Button,
  Card,
  MultiColorBar,
  TitleHandwritten,
  Underline,
} from '../components/ui/index.js';
import { QRCode } from '../components/host/QRCode.js';

interface Toast {
  id: string;
  text: string;
  tone: 'spritz' | 'basil' | 'raspberry';
}

export function HostPage(): JSX.Element {
  return (
    <MinScreen min="lg">
      <HostPageInner />
    </MinScreen>
  );
}

function HostPageInner(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const shortCode = params.get('session');

  const [session, setSession] = useState<SessionWithParticipants | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [starting, setStarting] = useState(false);

  // Bootstrap : retrouver l'ID de session via le short_code, puis fetch host details
  useEffect(() => {
    if (!shortCode) {
      setError(t('host.missingCode'));
      return;
    }
    let cancelled = false;
    let socket: Socket | null = null;

    const init = async (): Promise<void> => {
      try {
        // 1. Récupérer l'ID via le short_code (route publique mais OK pour l'host)
        const publicView = await getPublicSession(shortCode);
        // 2. Récupérer la session complète (auth host)
        // Le short_code est unique, mais on n'a pas l'id direct dans le view publique.
        // → On passe par Socket.IO directement avec un emit session:join qui retourne
        //   la session complète. Mais pour ça on doit connaître l'ID. Solution :
        //   on appelle l'endpoint by-id quand on a l'ID. Comme la vue publique n'expose
        //   pas l'ID, on ajoute un appel spécial : on se connecte au socket et on emit
        //   session:join avec un short_code → renvoie session.
        // Pour simplifier en V1 : on ajoute l'ID dans la vue host via Socket.IO.

        // Plus simple en V1 : on fait un GET /by-id côté host (impossible sans id).
        // → Pour rester simple, on récupère directement via Socket.IO en passant
        //   short_code au lieu de sessionId. On adapte le backend.
        // Pour V1.0 : on fait un fetch supplémentaire by-id en passant l'id stocké
        // côté localStorage si le host vient de créer la session, sinon on lookup
        // par publicView.short_code et on cherche la session du tenant courant.

        // Approche pragmatique : on requête /api/sessions/by-id en utilisant
        // le résultat du publicView (mais il n'a pas d'id). → On ajoute une
        // route GET /by-code-host qui retourne l'objet complet pour le host.
        // Workaround : on utilise le short_code via socket.io (qui a accès DB).
        if (cancelled) return;
        socket = await connectAsHost();
        socket.on('connect_error', (err) => {
          if (cancelled) return;
          setError(`Socket: ${err.message}`);
        });
        socket.emit(
          'session:join_by_code',
          { shortCode: publicView.short_code },
          (resp: { ok: boolean; session?: SessionWithParticipants; error?: string }) => {
            if (cancelled) return;
            if (!resp.ok || !resp.session) {
              setError(resp.error ?? t('host.notFound'));
              return;
            }
            setSession(resp.session);
            socket?.on('participant:joined', ({ participant }: { participant: Participant }) => {
              setSession((s) => (s ? { ...s, participants: [...s.participants, participant] } : s));
              pushToast(setToasts, t('host.toastJoined', { pseudo: participant.pseudo }), 'spritz');
            });
            socket?.on(
              'participant:moved_team',
              ({ participant }: { participant: Participant }) => {
                setSession((s) =>
                  s
                    ? {
                        ...s,
                        participants: s.participants.map((p) =>
                          p.id === participant.id ? participant : p,
                        ),
                      }
                    : s,
                );
              },
            );
            socket?.on('participant:kicked', ({ participant }: { participant: Participant }) => {
              setSession((s) =>
                s
                  ? {
                      ...s,
                      participants: s.participants.filter((p) => p.id !== participant.id),
                    }
                  : s,
              );
              pushToast(
                setToasts,
                t('host.toastKicked', { pseudo: participant.pseudo }),
                'raspberry',
              );
            });
            socket?.on('session:started', () => {
              pushToast(setToasts, t('host.toastStarted'), 'basil');
            });
          },
        );
      } catch (err: unknown) {
        if (!cancelled) setError((err as Error).message);
      }
    };

    void init();

    return () => {
      cancelled = true;
      socket?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortCode]);

  const handleStart = async (): Promise<void> => {
    if (!session) return;
    setStarting(true);
    try {
      const updated = await startSession(session.id);
      setSession((s) => (s ? { ...s, status: updated.status, started_at: updated.started_at } : s));
      // Étape 10 : redirect vers la page de jeu host. Pour l'instant on reste sur /host.
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const handleMove = async (participantId: string, teamId: string | null): Promise<void> => {
    if (!session) return;
    try {
      await moveParticipantTeam(session.id, participantId, teamId);
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  };

  const handleKick = async (participantId: string): Promise<void> => {
    if (!session) return;
    if (!window.confirm(t('host.kickConfirm'))) return;
    try {
      await kickParticipant(session.id, participantId);
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  };

  if (error) {
    return (
      <div className="min-h-screen flex flex-col">
        <MultiColorBar height="md" />
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md text-center">
            <p className="text-raspberry font-medium mb-4">{error}</p>
            <Button variant="secondary" onClick={() => navigate('/admin/dashboard')}>
              {t('host.backDashboard')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="font-mono text-ink-soft">{t('common.loading')}</p>
      </div>
    );
  }

  const teams = (session.teams_config as Team[] | null) ?? [];
  const playUrl = `${window.location.origin}/play?session=${session.short_code}`;

  return (
    <div className="min-h-screen flex flex-col">
      <MultiColorBar height="md" />

      <main className="flex-1 px-8 py-10">
        <header className="max-w-7xl mx-auto mb-10">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-2">
            {t('host.eyebrow')}
          </p>
          <TitleHandwritten as="h1">
            <Underline>{t('host.title')}</Underline>
          </TitleHandwritten>
        </header>

        <div className="max-w-7xl mx-auto grid gap-8 lg:grid-cols-1 xl:grid-cols-[auto_1fr]">
          {/* QR + code */}
          <Card size="lg" tone="cream" className="text-center">
            <p className="text-xs font-mono uppercase tracking-wider text-ink-soft mb-3">
              {t('host.scanToJoin')}
            </p>
            <QRCode value={playUrl} size={280} className="mx-auto mb-4" />
            <p className="font-mono text-3xl tracking-[0.2em] text-ink mb-1">
              {session.short_code}
            </p>
            <p className="font-editorial italic text-sm text-ink-soft">{playUrl}</p>
          </Card>

          {/* Participants */}
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <p className="font-display text-2xl">
                {t('host.participants')}{' '}
                <span className="text-ink-soft">({session.participants.length})</span>
              </p>
              <Button
                onClick={() => void handleStart()}
                disabled={
                  starting || session.participants.length < 1 || session.status !== 'WAITING'
                }
                size="lg"
              >
                {session.status === 'PLAYING'
                  ? t('host.alreadyStarted')
                  : starting
                    ? t('host.starting')
                    : t('host.startGame')}
              </Button>
            </div>

            {session.mode === 'TEAMS' ? (
              <TeamsView
                teams={teams}
                participants={session.participants}
                onMove={handleMove}
                onKick={handleKick}
              />
            ) : (
              <ParticipantsList participants={session.participants} onKick={handleKick} />
            )}
          </div>
        </div>
      </main>

      {/* Toasts en bas à droite */}
      <div className="fixed bottom-4 right-4 z-40 space-y-2 max-w-xs">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`px-4 py-2 border-2 border-ink rounded shadow-pop bg-white animate-pop-in font-medium text-sm ${
              toast.tone === 'spritz'
                ? 'border-l-8 border-l-spritz'
                : toast.tone === 'basil'
                  ? 'border-l-8 border-l-basil'
                  : 'border-l-8 border-l-raspberry'
            }`}
          >
            {toast.text}
          </div>
        ))}
      </div>

      <MultiColorBar height="md" />
    </div>
  );
}

function ParticipantsList({
  participants,
  onKick,
}: {
  participants: Participant[];
  onKick: (id: string) => void;
}): JSX.Element {
  const { t } = useTranslation();
  if (participants.length === 0) {
    return (
      <Card>
        <p className="font-editorial italic text-ink-soft text-center py-6">
          {t('host.waitingForPlayers')}
        </p>
      </Card>
    );
  }
  return (
    <Card>
      <ul className="space-y-2">
        {participants.map((p) => (
          <li
            key={p.id}
            className="flex items-center justify-between gap-3 px-3 py-2 border-2 border-ink rounded bg-cream-2 group"
          >
            <span className="font-medium">{p.pseudo}</span>
            <button
              type="button"
              onClick={() => onKick(p.id)}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-raspberry hover:underline"
            >
              {t('host.kick')}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TeamsView({
  teams,
  participants,
  onMove,
  onKick,
}: {
  teams: Team[];
  participants: Participant[];
  onMove: (participantId: string, teamId: string | null) => void;
  onKick: (id: string) => void;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {teams.map((team) => {
        const members = participants.filter((p) => p.team_id === team.id);
        return (
          <Card key={team.id} className="!border-3" style={{ borderColor: team.color }}>
            <div className="flex items-center justify-between gap-2 mb-3">
              <Badge tone="ink" tilt={-1}>
                {team.name}
              </Badge>
              <span className="font-mono text-xs text-ink-soft">{members.length}</span>
            </div>
            {members.length === 0 ? (
              <p className="font-editorial italic text-xs text-ink-soft py-2">
                {t('host.teamEmpty')}
              </p>
            ) : (
              <ul className="space-y-1">
                {members.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{p.pseudo}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <select
                        aria-label={t('host.moveToTeam')}
                        value={p.team_id ?? ''}
                        onChange={(e) => onMove(p.id, e.target.value || null)}
                        className="text-xs border border-ink rounded px-1 py-0.5 bg-cream"
                      >
                        {teams.map((t2) => (
                          <option key={t2.id} value={t2.id}>
                            {t2.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => onKick(p.id)}
                        className="text-xs text-raspberry hover:underline"
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function pushToast(
  set: React.Dispatch<React.SetStateAction<Toast[]>>,
  text: string,
  tone: Toast['tone'],
): void {
  const id = crypto.randomUUID();
  set((prev) => [...prev, { id, text, tone }]);
  window.setTimeout(() => {
    set((prev) => prev.filter((t) => t.id !== id));
  }, 4000);
}
