/**
 * /play?session=CODE — flow joueur (étape 9).
 *
 * Mobile-first absolu. C'est l'écran le plus vu en pratique.
 * Référence : docs/RESPONSIVE.md.
 *
 * Steps :
 *   1. Saisie pseudo (+ vérif session existe et accepte les joueurs)
 *   2. Si session.mode === 'TEAMS' : choix d'une équipe parmi teams_config
 *   3. Salle d'attente (animation "ça démarre bientôt")
 *   4. Quand session:started arrive → redirect vers /play/game (étape 10)
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Socket } from 'socket.io-client';
import type { JoinResponse, PublicSessionView, Team } from '@tutti/shared';
import { getPublicSession, joinSession } from '../lib/sessions.js';
import { connectAsParticipant, saveParticipantContext } from '../lib/socket.js';
import {
  Badge,
  Button,
  Card,
  Input,
  MultiColorBar,
  TitleHandwritten,
  Underline,
} from '../components/ui/index.js';

type Step = 'pseudo' | 'team' | 'waiting' | 'playing';

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
  const [joinResponse, setJoinResponse] = useState<JoinResponse | null>(null);
  const [participantsCount, setParticipantsCount] = useState(0);

  const teams = useMemo<Team[]>(
    () => (view?.teams_config as Team[] | null) ?? [],
    [view?.teams_config],
  );

  // Bootstrap : récupère la session publique
  useEffect(() => {
    if (!shortCode) {
      setError(t('play.missingCode'));
      return;
    }
    void getPublicSession(shortCode)
      .then((v) => {
        setView(v);
        setParticipantsCount(v.participants_count);
        if (v.status !== 'WAITING') {
          setError(t('play.alreadyStarted'));
        }
      })
      .catch(() => setError(t('play.notFound')));
  }, [shortCode, t]);

  // Socket.IO une fois le joueur a un token
  useEffect(() => {
    if (!joinResponse) return;
    saveParticipantContext(joinResponse.token, joinResponse.participant.session_id);

    const socket: Socket = connectAsParticipant(joinResponse.token);
    socket.on('connect', () => {
      socket.emit('session:join', { sessionId: joinResponse.participant.session_id }, () => {
        // ack ignoré côté joueur (la salle d'attente n'a pas besoin de l'état complet)
      });
    });
    socket.on('participant:joined', () => setParticipantsCount((c) => c + 1));
    socket.on('participant:kicked', ({ participant }: { participant: { id: string } }) => {
      if (participant.id === joinResponse.participant.id) {
        setError(t('play.kicked'));
        setStep('pseudo');
      } else {
        setParticipantsCount((c) => Math.max(0, c - 1));
      }
    });
    socket.on('session:started', () => setStep('playing'));

    return () => {
      socket.disconnect();
    };
  }, [joinResponse, t]);

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
      const resp = await joinSession(shortCode, {
        pseudo: pseudo.trim(),
        team_id: teamId,
      });
      setJoinResponse(resp);
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
          {/* En-tête : marque + nom de l'établissement */}
          <header className="mb-6 text-center">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-1">
              {t('common.brand')}
            </p>
            <TitleHandwritten as="h1" className="text-3xl">
              <Underline>{view?.establishment_name ?? '…'}</Underline>
            </TitleHandwritten>
            <p className="font-mono text-xs tracking-[0.2em] text-ink-soft mt-2">{shortCode}</p>
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

          {step === 'waiting' && joinResponse && (
            <Card size="md" tone="basil" className="text-center">
              <p className="text-xs font-mono uppercase tracking-wider text-basil-deep mb-3">
                {t('play.youAreIn')}
              </p>
              <TitleHandwritten as="h2" className="mb-2">
                {joinResponse.participant.pseudo}
              </TitleHandwritten>
              {joinResponse.participant.team_id && (
                <Badge tone="ink" tilt={-1} className="mb-4">
                  {teams.find((t) => t.id === joinResponse.participant.team_id)?.name}
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
            </Card>
          )}
        </div>
      </main>
      <MultiColorBar height="md" />
    </div>
  );
}
