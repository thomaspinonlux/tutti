/**
 * <BacJoueur /> — feat/jeux-de-salon
 * Téléphone d'un joueur au P'tit Bac : la lettre, une case par catégorie,
 * une seule validation (la grille part entière).
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CurrentQuestionState } from '@tutti/shared';
import { submitQuizzAnswer } from '../../lib/sessions.js';
import { useSecondesRestantes } from '../../lib/jeuxDeSalon.js';
import { Button, Card } from '../ui/index.js';

interface Props {
  sessionId: string;
  token: string;
  question: CurrentQuestionState;
}

export function BacJoueur({ sessionId, token, question }: Props): JSX.Element {
  const { t } = useTranslation();
  const categories = question.choices;
  const lettre = question.lettre ?? '?';
  const fin = new Date(question.started_at).getTime() + question.time_limit_sec * 1000;
  const restant = useSecondesRestantes(question.phase === 'asking' ? fin : null);
  const [cases, setCases] = useState<string[]>(() => categories.map(() => ''));
  const [envoye, setEnvoye] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    setCases(categories.map(() => ''));
    setEnvoye(false);
    setErreur(null);
  }, [question.question_index]);

  const envoyer = async (): Promise<void> => {
    if (occupe || envoye) return;
    setOccupe(true);
    setErreur(null);
    try {
      await submitQuizzAnswer(sessionId, token, JSON.stringify(cases.map((c) => c.trim())));
      setEnvoye(true);
    } catch (e: unknown) {
      setErreur((e as Error).message);
    } finally {
      setOccupe(false);
    }
  };

  // Le temps s'achève sans validation : la grille part quand même.
  useEffect(() => {
    if (restant !== null && restant <= 1 && !envoye && !occupe && cases.some((c) => c.trim())) {
      void envoyer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restant]);

  const bonneLettre = (v: string): boolean =>
    v.trim() === '' ||
    v
      .trim()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/^(l'|l’|le |la |les |un |une |des )/i, '')
      .toUpperCase()
      .startsWith(lettre);

  return (
    <div className="space-y-3">
      <Card tone="lemon" size="md" className="text-center">
        <p className="font-mono text-xs uppercase tracking-wider">{t('jeux.bacLettre')}</p>
        <p className="font-display text-7xl leading-none my-1">{lettre}</p>
        <p className="font-mono text-xl font-bold tabular-nums">{restant ?? '—'}s</p>
      </Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void envoyer();
        }}
        className="space-y-2"
      >
        {categories.map((cat, i) => (
          <label key={cat} className="block">
            <span className="block text-sm font-medium mb-1">{cat}</span>
            <input
              type="text"
              value={cases[i] ?? ''}
              disabled={envoye || restant === 0}
              onChange={(e) => {
                const v = e.target.value;
                setCases((c) => c.map((x, k) => (k === i ? v : x)));
              }}
              autoComplete="off"
              maxLength={40}
              placeholder={`${lettre}…`}
              className={`w-full px-3 py-2 border-2 rounded text-lg bg-cream focus:bg-white ${
                bonneLettre(cases[i] ?? '') ? 'border-ink' : 'border-raspberry'
              }`}
            />
          </label>
        ))}
        <Button type="submit" size="lg" className="w-full" disabled={envoye || occupe || restant === 0}>
          {envoye ? t('jeux.bacEnvoye') : t('jeux.bacValider')}
        </Button>
      </form>
      {erreur && <p role="alert" className="text-raspberry text-sm text-center">{erreur}</p>}
    </div>
  );
}
