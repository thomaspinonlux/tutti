/**
 * <EcrireVoterJoueur /> — feat/jeux-de-salon
 * Téléphone d'un joueur au Bluff ou à la Réponse drôle :
 *   1. il écrit (mensonge crédible / réponse drôle), peut corriger ;
 *   2. il vote parmi les réponses de tous (la sienne est grisée).
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Socket } from 'socket.io-client';
import type { CurrentQuestionState } from '@tutti/shared';
import { submitQuizzAnswer } from '../../lib/sessions.js';
import { lireMesChoix, useEcrireVoter, useSecondesRestantes, voterQuizz } from '../../lib/jeuxDeSalon.js';
import { Button, Card } from '../ui/index.js';

interface Props {
  socket: Socket | null;
  sessionId: string;
  token: string;
  question: CurrentQuestionState;
}

export function EcrireVoterJoueur({ socket, sessionId, token, question }: Props): JSX.Element {
  const { t } = useTranslation();
  const bluff = question.type === 'BLUFF';
  const vue = useEcrireVoter(socket, sessionId, question.question_index);
  const finEcriture = new Date(question.started_at).getTime() + question.time_limit_sec * 1000;
  const restantEcriture = useSecondesRestantes(vue.etape === 'ecriture' ? finEcriture : null);
  const restantVote = useSecondesRestantes(vue.etape === 'vote' ? vue.finVote : null);

  const [texte, setTexte] = useState('');
  const [envoye, setEnvoye] = useState<string | null>(null);
  const [vote, setVote] = useState<string | null>(null);
  const [miens, setMiens] = useState<string[]>([]);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    setTexte('');
    setEnvoye(null);
    setVote(null);
    setMiens([]);
    setErreur(null);
  }, [question.question_index]);

  useEffect(() => {
    if (vue.etape !== 'vote') return;
    lireMesChoix(sessionId, token)
      .then(setMiens)
      .catch(() => undefined);
  }, [vue.etape, sessionId, token]);

  const envoyer = async (): Promise<void> => {
    const v = texte.trim();
    if (!v || occupe) return;
    setOccupe(true);
    setErreur(null);
    try {
      await submitQuizzAnswer(sessionId, token, v);
      setEnvoye(v);
    } catch (e: unknown) {
      setErreur((e as Error).message);
    } finally {
      setOccupe(false);
    }
  };

  // Fin de l'écriture : un texte tapé mais pas envoyé part quand même.
  useEffect(() => {
    if (restantEcriture !== null && restantEcriture <= 1 && !envoye && !occupe && texte.trim()) {
      void envoyer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restantEcriture]);

  const choisir = async (id: string): Promise<void> => {
    if (vote || occupe) return;
    setOccupe(true);
    setErreur(null);
    try {
      await voterQuizz(sessionId, token, id);
      setVote(id);
    } catch (e: unknown) {
      setErreur((e as Error).message);
    } finally {
      setOccupe(false);
    }
  };

  const enTete = (
    <Card tone="cream" size="md">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="font-mono text-xs uppercase tracking-wider text-ink-soft">
          {bluff ? t('jeux.bluff') : t('jeux.drole')}
          {vue.etape === 'vote' ? ` · ${t('jeux.vote')}` : ''}
        </span>
        <span className="font-mono text-2xl font-bold tabular-nums">
          {(vue.etape === 'vote' ? restantVote : restantEcriture) ?? '—'}s
        </span>
      </div>
      <p className="font-display text-2xl leading-tight">{question.text}</p>
    </Card>
  );

  if (vue.etape === 'vote') {
    return (
      <div className="space-y-3">
        {enTete}
        <p className="text-center font-medium">{bluff ? t('jeux.trouveLaVerite') : t('jeux.votePrefere')}</p>
        <ul className="space-y-2">
          {vue.choix.map((c) => {
            const mien = miens.includes(c.id);
            const choisi = vote === c.id;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={mien || !!vote || occupe || restantVote === 0}
                  onClick={() => void choisir(c.id)}
                  className={`w-full text-left p-4 border-2 border-ink rounded font-medium transition-colors ${
                    choisi ? 'bg-basil shadow-pop-sm' : mien ? 'bg-cream-2 opacity-50' : 'bg-cream hover:bg-cream-2'
                  }`}
                >
                  {c.texte}
                  {mien && <span className="block text-xs text-ink-soft mt-1">{t('jeux.taReponse')}</span>}
                </button>
              </li>
            );
          })}
        </ul>
        {vote && <p className="text-center text-ink-soft">{t('jeux.aVote')}</p>}
        {erreur && <p role="alert" className="text-raspberry text-sm text-center">{erreur}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {enTete}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void envoyer();
        }}
        className="space-y-2"
      >
        <input
          type="text"
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          disabled={restantEcriture === 0}
          autoFocus
          autoComplete="off"
          maxLength={80}
          placeholder={bluff ? t('jeux.placeholderBluff') : t('jeux.placeholderDrole')}
          className="w-full px-4 py-3 border-2 border-ink rounded text-lg font-medium bg-cream focus:bg-white"
        />
        <Button type="submit" size="lg" className="w-full" disabled={!texte.trim() || occupe || restantEcriture === 0}>
          {envoye ? t('jeux.corriger') : t('jeux.envoyer')}
        </Button>
      </form>
      {envoye && (
        <Card tone="basil" size="sm" className="text-center">
          <p className="font-medium">{t('jeux.envoye', { texte: envoye })}</p>
          <p className="text-sm text-ink-soft mt-1">{t('jeux.attenteVote', { n: vue.ecrits })}</p>
        </Card>
      )}
      {erreur && <p role="alert" className="text-raspberry text-sm text-center">{erreur}</p>}
    </div>
  );
}
