/**
 * /play?session=CODE — flow joueur (étape 9 + résilience).
 *
 * Mobile-first absolu. C'est l'écran le plus vu en pratique.
 * Cf. docs/RESPONSIVE.md + docs/PLAYER_RESILIENCE.md.
 *
 * Steps :
 *   1. (Si pas d'identité en localStorage) saisie pseudo
 *   2. (Si TEAMS) choix d'une équipe
 *   3. Salle d'attente — Socket.IO connecté, état resync au reconnect
 *   4. Mode jeu (étape 10) — Wake Lock activé, écran reste allumé
 *
 * Persistance :
 *   - À chaque succès de /join, on sauvegarde dans localStorage par short_code.
 *   - Au montage, si on trouve une identité valide, on saute aux étapes 3/4.
 *   - On efface la persistance si la session passe en ENDED ou si le
 *     serveur rejette le token.
 */

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Socket } from 'socket.io-client';
import type {
  JoinResponse,
  Participant,
  PublicSessionView,
  SessionWithParticipants,
  Team,
} from '@tutti/shared';
import { getPublicSession, joinSession } from '../lib/sessions.js';
import {
  clearParticipantContext,
  connectAsParticipant,
  readParticipantContext,
  saveParticipantContext,
  type ParticipantContext,
} from '../lib/socket.js';
import { useWakeLock } from '../lib/useWakeLock.js';
import { ConnectionIndicator } from '../components/ConnectionIndicator.js';
import {
  Badge,
  Button,
  Card,
  Input,
  MultiColorBar,
  TitleHandwritten,
  Underline,
} from '../components/ui/index.js';

type Step = 'pseudo' | 'team' | 'waiting' | 'playing' | 'ended';

interface Toast {
  id: string;
  text: string;
  tone: 'basil' | 'spritz' | 'raspberry';
}

export function PlayPage(): JSX.Element {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const shortCode = (params.get('session') ?? '').toUpperCase();

  const [view, setView] = useState<PublicSessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('pseudo');
  const [pseudo, setPseudo] = useState('');
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [identity, setIdentity] = useState<ParticipantContext | null>(null);
  const [participantsCount, setParticipantsCount] = useState(0);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const hadConnectionRef = useRef(false);

  const teams = useMemo<Team[]>(
    () => (view?.teams_config as Team[] | null) ?? [],
    [view?.teams_config],
  );

  // ── Wake Lock pendant PLAYING ─────────────────────────────────────────
  useWakeLock(step === 'playing');

  // ── Bootstrap : récupère la session publique + auto-resume éventuel ──
  useEffect(() => {
    if (!shortCode) {
      setError(t('play.missingCode'));
      return;
    }
    void getPublicSession(shortCode)
      .then((v) => {
        setView(v);
        setParticipantsCount(v.participants_count);

        const stored = readParticipantContext(shortCode);
        if (stored) {
          if (v.status === 'ENDED') {
            clearParticipantContext(shortCode);
            setStep('ended');
            return;
          }
          setIdentity(stored);
          setPseudo(stored.pseudo);
          setSelectedTeam(stored.teamId);
          setStep(v.status === 'PLAYING' ? 'playing' : 'waiting');
          return;
        }

        if (v.status !== 'WAITING') {
          setError(t('play.alreadyStarted'));
        }
      })
      .catch(() => setError(t('play.notFound')));
  }, [shortCode, t]);

  // ── Socket.IO une fois qu'on a une identité ───────────────────────────
  useEffect(() => {
    if (!identity) return;
    const sock = connectAsParticipant(identity.token);
    setSocket(sock);

    sock.on('connect', () => {
      const wasReconnect = hadConnectionRef.current;
      hadConnectionRef.current = true;
      sock.emit(
        'session:join',
        { sessionId: identity.sessionId },
        (resp: { ok: boolean; session?: SessionWithParticipants; error?: string }) => {
          if (!resp.ok) {
            clearParticipantContext(shortCode);
            setError(resp.error ?? t('play.kicked'));
            setIdentity(null);
            setStep('pseudo');
            return;
          }
          if (resp.session) {
            setParticipantsCount(resp.session.participants.length);
            if (resp.session.status === 'PLAYING') setStep('playing');
            else if (resp.session.status === 'ENDED') {
              clearParticipantContext(shortCode);
              setStep('ended');
            } else setStep('waiting');
          }
          if (wasReconnect) {
            pushToast(setToasts, t('connection.toastReconnected'), 'basil');
          }
        },
      );
    });

    sock.on('participant:joined', () => setParticipantsCount((c) => c + 1));
    sock.on('participant:kicked', ({ participant }: { participant: Participant }) => {
      if (participant.id === identity.participantId) {
        clearParticipantContext(shortCode);
        setError(t('play.kicked'));
        setIdentity(null);
        setStep('pseudo');
      } else {
        setParticipantsCount((c) => Math.max(0, c - 1));
      }
    });
    sock.on('session:started', () => setStep('playing'));
    sock.on('session:ended', () => {
      clearParticipantContext(shortCode);
      setStep('ended');
    });

    return () => {
      sock.disconnect();
      setSocket(null);
    };
  }, [identity, shortCode, t]);

  // ── Submit handlers ───────────────────────────────────────────────────
  const handlePseudoSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!pseudo.trim()) return;
    if (view?.mode === 'TEAMS') {
      setStep('team');
      return;
    }
    void doJoin(null);
  };

  const handleTeamSubmit = (): void => {
    if (!selectedTeam) return;
    void doJoin(selectedTeam);
  };

  const doJoin = async (teamId: string | null): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const resp: JoinResponse = await joinSession(shortCode, {
        pseudo: pseudo.trim(),
        team_id: teamId,
      });
      const ctx: ParticipantContext = {
        token: resp.token,
        participantId: resp.participant.id,
        sessionId: resp.participant.session_id,
        pseudo: resp.participant.pseudo,
        teamId: resp.participant.team_id ?? null,
      };
      saveParticipantContext(shortCode, ctx);
      setIdentity(ctx);
      setStep('waiting');
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <MultiColorBar height="md" />
      <main className="flex-1 px-4 py-6 flex items-start justify-center">
        <div className="w-full max-w-[500px]">
          <header className="mb-6 relative">
            <div className="absolute top-0 right-0">
              {identity && <ConnectionIndicator socket={socket} />}
            </div>
            <div className="text-center">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-1">
                {t('common.brand')}
              </p>
              <TitleHandwritten as="h1" className="text-3xl">
                <Underline>{view?.establishment_name ?? '…'}</Underline>
              </TitleHandwritten>
              <p className="font-mono text-xs tracking-[0.2em] text-ink-soft mt-2">{shortCode}</p>
            </div>
          </header>

          {error && (
            <Card tone="raspberry" size="sm" className="mb-4">
              <p role="alert" className="text-sm font-medium text-raspberry-deep">
                {error}
              </p>
            </Card>
          )}

          {step === 'pseudo' && view?.status === 'WAITING' && (
            <Card size="md">
              <form onSubmit={handlePseudoSubmit} className="space-y-4">
                <p className="font-editorial italic text-ink-2 text-center mb-2">
                  {t('play.pseudoTagline')}
                </p>
                <Input
                  label={t('play.pseudoLabel')}
                  value={pseudo}
                  onChange={(e) => setPseudo(e.target.value)}
                  placeholder={t('play.pseudoPlaceholder')}
                  required
                  minLength={1}
                  maxLength={40}
                  autoFocus
                />
                <Button
                  type="submit"
                  disabled={submitting || !pseudo.trim()}
                  size="lg"
                  className="w-full"
                >
                  {view?.mode === 'TEAMS' ? t('play.continueToTeam') : t('play.joinNow')}
                </Button>
              </form>
            </Card>
          )}

          {step === 'team' && (
            <Card size="md">
              <p className="font-editorial italic text-ink-2 text-center mb-4">
                {t('play.chooseTeam')}
              </p>
              <ul className="space-y-2 mb-4">
                {teams.map((team) => (
                  <li key={team.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedTeam(team.id)}
                      aria-pressed={selectedTeam === team.id}
                      className={`w-full px-4 py-3 border-2 rounded font-bold text-base transition-colors min-h-[44px] ${
                        selectedTeam === team.id
                          ? 'border-ink shadow-pop-sm text-cream'
                          : 'border-ink bg-cream text-ink hover:bg-cream-2'
                      }`}
                      style={selectedTeam === team.id ? { backgroundColor: team.color } : undefined}
                    >
                      {team.name}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  onClick={() => setStep('pseudo')}
                  className="flex-1"
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  type="button"
                  size="md"
                  onClick={handleTeamSubmit}
                  disabled={!selectedTeam || submitting}
                  className="flex-1"
                >
                  {submitting ? t('play.joining') : t('play.joinNow')}
                </Button>
              </div>
            </Card>
          )}

          {step === 'waiting' && identity && (
            <Card size="md" tone="basil" className="text-center">
              <p className="text-xs font-mono uppercase tracking-wider text-basil-deep mb-3">
                {t('play.youAreIn')}
              </p>
              <TitleHandwritten as="h2" className="mb-2">
                {identity.pseudo}
              </TitleHandwritten>
              {identity.teamId && (
                <Badge tone="ink" tilt={-1} className="mb-4">
                  {teams.find((t2) => t2.id === identity.teamId)?.name}
                </Badge>
              )}
              <p className="font-editorial italic text-ink-2 mt-4">{t('play.waitingMessage')}</p>
              <p className="font-mono text-xs text-ink-soft mt-3">
                {participantsCount} {t('play.participantsConnected')}
              </p>
              <div className="mt-6 h-1 bg-cream-3 rounded overflow-hidden relative" aria-hidden>
                <div className="absolute inset-y-0 w-1/3 bg-spritz animate-pulse" />
              </div>
            </Card>
          )}

          {step === 'playing' && (
            <Card size="md" tone="spritz" className="text-center">
              <TitleHandwritten as="h2" className="mb-2">
                {t('play.gameStarting')}
              </TitleHandwritten>
              <p className="font-editorial italic text-ink-2">{t('play.gameStartingHint')}</p>
              {identity && (
                <p className="font-mono text-xs text-ink-soft mt-4">
                  {identity.pseudo}
                  {identity.teamId
                    ? ` · ${teams.find((t2) => t2.id === identity.teamId)?.name ?? ''}`
                    : ''}
                </p>
              )}
            </Card>
          )}

          {step === 'ended' && (
            <Card size="md" tone="cream" className="text-center">
              <TitleHandwritten as="h2" className="mb-2">
                {t('play.endedTitle')}
              </TitleHandwritten>
              <p className="font-editorial italic text-ink-2">{t('play.endedHint')}</p>
            </Card>
          )}
        </div>
      </main>

      <div className="fixed bottom-4 right-4 z-40 space-y-2 max-w-[280px]">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`px-3 py-2 border-2 border-ink rounded shadow-pop bg-white animate-pop-in font-medium text-sm ${
              toast.tone === 'basil'
                ? 'border-l-8 border-l-basil'
                : toast.tone === 'spritz'
                  ? 'border-l-8 border-l-spritz'
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
