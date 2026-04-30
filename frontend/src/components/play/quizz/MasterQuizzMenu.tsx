/**
 * <MasterQuizzMenu /> — contrôles tel pour le joueur master en mode B Quizz.
 *
 * Affiche 3 boutons selon la phase courante :
 *   - WAITING (session pas démarrée)  : "Démarrer la première question"
 *   - asking (question en cours)      : "Révéler maintenant"
 *   - revealed (entre 2 questions)    : "Question suivante"
 *   + bouton "Terminer la session" toujours dispo (en bas, ghost).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  masterEndSession,
  masterNextQuestion,
  masterPlayQuestion,
  masterRevealQuestion,
} from '../../../lib/sessions.js';
import { Button, Card } from '../../ui/index.js';

interface Props {
  sessionId: string;
  token: string;
  /** 'waiting' | 'asking' | 'revealed' | 'no-active'. Dérivé de l'état socket. */
  phase: 'waiting' | 'asking' | 'revealed' | 'no-active' | 'ended';
}

export function MasterQuizzMenu({ sessionId, token, phase }: Props): JSX.Element {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wrap = async (fn: () => Promise<unknown>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handlePlayFirst = (): Promise<void> => wrap(() => masterPlayQuestion(sessionId, token, 0));
  const handleNext = (): Promise<void> => wrap(() => masterNextQuestion(sessionId, token));
  const handleReveal = (): Promise<void> => wrap(() => masterRevealQuestion(sessionId, token));
  const handleEnd = (): Promise<void> => {
    if (!window.confirm(t('hostQuizz.endConfirm'))) return Promise.resolve();
    return wrap(() => masterEndSession(sessionId, token));
  };

  if (phase === 'ended') {
    return (
      <Card tone="cream" size="sm" className="text-center">
        <p className="font-editorial italic text-ink-soft text-sm">{t('masterQuizz.endedHint')}</p>
      </Card>
    );
  }

  return (
    <Card size="sm" className="space-y-2">
      <p className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-1">
        {t('masterQuizz.title')}
      </p>

      {phase === 'waiting' && (
        <Button onClick={() => void handlePlayFirst()} disabled={busy} size="lg" className="w-full">
          {t('masterQuizz.startFirst')}
        </Button>
      )}

      {phase === 'no-active' && (
        <Button onClick={() => void handleNext()} disabled={busy} size="lg" className="w-full">
          {t('masterQuizz.nextQuestion')}
        </Button>
      )}

      {phase === 'asking' && (
        <Button
          onClick={() => void handleReveal()}
          disabled={busy}
          size="lg"
          variant="secondary"
          className="w-full"
        >
          {t('masterQuizz.revealNow')}
        </Button>
      )}

      {phase === 'revealed' && (
        <Button onClick={() => void handleNext()} disabled={busy} size="lg" className="w-full">
          {t('masterQuizz.nextQuestion')}
        </Button>
      )}

      <Button
        onClick={() => void handleEnd()}
        disabled={busy}
        variant="ghost"
        size="sm"
        className="w-full"
      >
        {t('masterQuizz.endSession')}
      </Button>

      {error && (
        <p role="alert" className="text-raspberry text-xs text-center">
          {error}
        </p>
      )}
    </Card>
  );
}
