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
  masterAjouterThemeQuiz,
  masterEndSession,
  masterListerThemesQuiz,
  masterNextQuestion,
  masterPlayQuestion,
  masterRevealQuestion,
} from '../../../lib/sessions.js';
import { Button, Card } from '../../ui/index.js';
import { ChoixThemeQuiz } from '../../quizz/ChoixThemeQuiz.js';

interface Props {
  sessionId: string;
  token: string;
  /** 'waiting' | 'asking' | 'revealed' | 'no-active'. Dérivé de l'état socket. */
  phase: 'waiting' | 'asking' | 'revealed' | 'no-active' | 'ended';
  /** feat/quiz-comme-le-blind-test — la manche est finie : choisir un thème. */
  finDeManche?: boolean;
}

export function MasterQuizzMenu({ sessionId, token, phase, finDeManche = false }: Props): JSX.Element {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Comme au blind test : le téléphone qui a la manette choisit les thèmes.
  // Ouvert d'office avant la 1re question et en fin de manche.
  const [choixOuvert, setChoixOuvert] = useState(false);
  const afficherChoix = choixOuvert || phase === 'waiting' || finDeManche;

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
  const handleNext = (): Promise<void> =>
    wrap(async () => {
      // En fin de manche, l'annonce arrive par socket (quizz:block_ended).
      const r = await masterNextQuestion(sessionId, token);
      if (!r.fin_de_manche) setChoixOuvert(false);
    });
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

      {finDeManche && (
        <div>
          <p className="font-display text-lg">{t('quizTheme.blockEnded')}</p>
          <p className="font-editorial italic text-ink-soft text-sm">{t('quizTheme.blockEndedHint')}</p>
        </div>
      )}

      {afficherChoix && phase !== 'asking' && (
        <ChoixThemeQuiz
          charger={() => masterListerThemesQuiz(sessionId, token)}
          ajouter={(packId, niveau) => masterAjouterThemeQuiz(sessionId, token, packId, niveau)}
        />
      )}

      {phase === 'waiting' && (
        <Button onClick={() => void handlePlayFirst()} disabled={busy} size="lg" className="w-full">
          {t('masterQuizz.startFirst')}
        </Button>
      )}

      {!afficherChoix && phase !== 'asking' && (
        <Button
          onClick={() => setChoixOuvert(true)}
          disabled={busy}
          variant="secondary"
          size="sm"
          className="w-full"
        >
          {t('quizTheme.addTheme')}
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
