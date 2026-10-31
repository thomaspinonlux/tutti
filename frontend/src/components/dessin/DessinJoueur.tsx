/**
 * <DessinJoueur /> — feat/dessin-a-deviner
 *
 * Le téléphone d'un joueur pendant un dessin :
 *   - s'il est le dessinateur : le mot et la planche à dessin ;
 *   - sinon : le dessin en petit, le mot masqué, et un champ pour proposer
 *     autant de fois qu'il veut jusqu'à trouver.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Socket } from 'socket.io-client';
import type { CurrentQuestionState } from '@tutti/shared';
import { submitQuizzAnswer } from '../../lib/sessions.js';
import { lireMonMot, useDessin } from '../../lib/dessin.js';
import { Button, Card } from '../ui/index.js';
import { PlancheDessinateur } from './PlancheDessinateur.js';
import { ToileDessin } from './ToileDessin.js';

interface Props {
  socket: Socket | null;
  sessionId: string;
  participantId: string;
  token: string;
  question: CurrentQuestionState;
}

function useRestant(question: CurrentQuestionState): number | null {
  const [maintenant, setMaintenant] = useState(Date.now());
  const actif = question.phase === 'asking';
  useEffect(() => {
    if (!actif) return;
    const id = window.setInterval(() => setMaintenant(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [actif]);
  if (!actif) return null;
  const fin = new Date(question.started_at).getTime() + question.time_limit_sec * 1000;
  return Math.max(0, Math.ceil((fin - maintenant) / 1000));
}

export function DessinJoueur({ socket, sessionId, participantId, token, question }: Props): JSX.Element {
  const restant = useRestant(question);
  const jeDessine = question.dessinateur?.participant_id === participantId;
  if (jeDessine) {
    return (
      <Dessinateur
        socket={socket}
        sessionId={sessionId}
        token={token}
        question={question}
        restant={restant}
      />
    );
  }
  return (
    <Devineur
      socket={socket}
      sessionId={sessionId}
      participantId={participantId}
      token={token}
      question={question}
      restant={restant}
    />
  );
}

function Dessinateur({
  socket,
  sessionId,
  token,
  question,
  restant,
}: {
  socket: Socket | null;
  sessionId: string;
  token: string;
  question: CurrentQuestionState;
  restant: number | null;
}): JSX.Element {
  const [mot, setMot] = useState<string | null>(null);
  const index = question.question_index;

  useEffect(() => {
    setMot(null);
    let vivant = true;
    const onMot = (m: { question_index: number; mot: string }): void => {
      if (m.question_index === index) setMot(m.mot);
    };
    socket?.on('dessin:mot', onMot);
    // Le mot a pu partir avant que la page écoute (ou la page a été
    // rechargée) : on le redemande.
    const relire = (): void => {
      lireMonMot(sessionId, token)
        .then((r) => {
          if (vivant && r && r.question_index === index) setMot(r.mot);
        })
        .catch(() => undefined);
    };
    const id = window.setTimeout(relire, 400);
    return () => {
      vivant = false;
      window.clearTimeout(id);
      socket?.off('dessin:mot', onMot);
    };
  }, [socket, sessionId, token, index]);

  return (
    <PlancheDessinateur
      socket={socket}
      sessionId={sessionId}
      questionIndex={index}
      mot={mot}
      restant={restant}
      actif={question.phase === 'asking' && restant !== 0}
    />
  );
}

function Devineur({
  socket,
  sessionId,
  participantId,
  token,
  question,
  restant,
}: {
  socket: Socket | null;
  sessionId: string;
  participantId: string;
  token: string;
  question: CurrentQuestionState;
  restant: number | null;
}): JSX.Element {
  const { t } = useTranslation();
  const dessin = useDessin(socket, sessionId, question.question_index);
  const [texte, setTexte] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [retour, setRetour] = useState<{ ton: 'ok' | 'chaud' | 'non' | 'erreur'; msg: string } | null>(null);
  const [trouveRang, setTrouveRang] = useState<number | null>(null);
  const [essais, setEssais] = useState<string[]>([]);

  useEffect(() => {
    setTexte('');
    setRetour(null);
    setTrouveRang(null);
    setEssais([]);
  }, [question.question_index]);

  // Déjà trouvé avant un rechargement de la page.
  const dejaTrouve = dessin.trouves.findIndex((x) => x.participant_id === participantId);
  const rang = trouveRang ?? (dejaTrouve >= 0 ? dejaTrouve + 1 : null);
  const ouvert = question.phase === 'asking' && restant !== 0 && rang === null;

  const envoyer = async (): Promise<void> => {
    const valeur = texte.trim();
    if (!valeur || occupe || !ouvert) return;
    setOccupe(true);
    try {
      const r = await submitQuizzAnswer(sessionId, token, valeur);
      if (r.dessin === 'trouve') {
        setTrouveRang(r.rang ?? 1);
        setRetour({ ton: 'ok', msg: t('dessin.bravo') });
      } else if (r.dessin === 'proche') {
        setRetour({ ton: 'chaud', msg: t('dessin.proche') });
      } else {
        setRetour({ ton: 'non', msg: t('dessin.pasCa') });
        setEssais((e) => [valeur, ...e].slice(0, 5));
        setTexte('');
      }
    } catch (e: unknown) {
      setRetour({ ton: 'erreur', msg: (e as Error).message });
    } finally {
      setOccupe(false);
    }
  };

  const couleurRetour =
    retour?.ton === 'ok'
      ? 'text-basil'
      : retour?.ton === 'chaud'
        ? 'text-spritz'
        : 'text-raspberry';

  return (
    <div className="space-y-3">
      <Card tone="cream" size="sm">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="font-medium truncate">
            ✏️ {t('dessin.dessinePar', { pseudo: question.dessinateur?.pseudo ?? '—' })}
          </p>
          {restant !== null && (
            <span className="font-mono text-2xl font-bold tabular-nums">{restant}s</span>
          )}
        </div>
        <ToileDessin traits={dessin.traits} version={dessin.version} />
        <p className="font-mono text-xl font-bold tracking-[0.2em] text-center mt-2 break-words">
          {(question.indice ?? '').replace(/ /g, '\u2003')}
        </p>
      </Card>

      {rang !== null ? (
        <Card tone="basil" size="md" className="text-center">
          <p className="font-display text-3xl">🎉 {t('dessin.trouve')}</p>
          <p className="font-mono text-xs uppercase tracking-wider mt-1">{t('dessin.rang', { n: rang })}</p>
        </Card>
      ) : (
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
            disabled={!ouvert}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={t('dessin.placeholder')}
            maxLength={60}
            className="w-full px-4 py-3 border-2 border-ink rounded text-lg font-medium bg-cream focus:bg-white"
          />
          <Button type="submit" disabled={!ouvert || occupe || !texte.trim()} size="lg" className="w-full">
            {t('dessin.proposer')}
          </Button>
        </form>
      )}

      {retour && rang === null && (
        <p role="status" className={`text-center font-semibold ${couleurRetour}`}>
          {retour.msg}
        </p>
      )}
      {essais.length > 0 && rang === null && (
        <p className="text-center text-sm text-ink-soft">
          {t('dessin.tesEssais')} {essais.join(' · ')}
        </p>
      )}
    </div>
  );
}
