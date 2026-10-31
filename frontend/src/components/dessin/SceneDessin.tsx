/**
 * <SceneDessin /> — feat/dessin-a-deviner
 *
 * Ce que voit la salle pendant un dessin : la toile en direct, qui dessine,
 * le mot masqué (nombre de lettres), qui a déjà trouvé et les propositions
 * qui défilent. Utilisée par la TV (/screen) et la console de l'animateur.
 * Fond sombre (TV et console sont sur fond nuit).
 */
import { useTranslation } from 'react-i18next';
import type { Socket } from 'socket.io-client';
import type { CurrentQuestionState } from '@tutti/shared';
import { useDessin } from '../../lib/dessin.js';
import { ToileDessin } from './ToileDessin.js';

const CORAIL = '#FF5C4D';
const VERT = '#3FB47A';

interface Props {
  socket: Socket | null;
  sessionId: string;
  question: CurrentQuestionState;
  /** Le mot, une fois révélé. */
  revealAnswer: string | null;
  /** Secondes restantes (null une fois révélé). */
  restant: number | null;
  /** L'animateur voit le mot pendant le dessin (console uniquement). */
  motAnimateur?: string | null;
  /** Grand format (TV). */
  xl?: boolean;
}

export function SceneDessin({
  socket,
  sessionId,
  question,
  revealAnswer,
  restant,
  motAnimateur = null,
  xl = false,
}: Props): JSX.Element {
  const { t } = useTranslation();
  const dessin = useDessin(socket, sessionId, question.question_index);
  const indice = question.indice ?? '';
  const revele = revealAnswer !== null;

  return (
    <div className="w-full h-full flex flex-col lg:flex-row gap-6 text-white min-h-0">
      <div className="flex-1 min-w-0 flex flex-col items-center justify-center gap-4">
        <div className={xl ? 'w-full max-w-[min(100%,calc((100vh-14rem)*4/3))]' : 'w-full max-w-3xl'}>
          <ToileDessin traits={dessin.traits} version={dessin.version} />
        </div>
        {revele ? (
          <p className={`font-display ${xl ? 'text-6xl' : 'text-4xl'}`} style={{ color: VERT }}>
            {revealAnswer}
          </p>
        ) : (
          <p
            className={`font-mono font-bold tracking-[0.35em] ${xl ? 'text-5xl' : 'text-3xl'}`}
            aria-label={t('dessin.nbLettres', { n: indice.replace(/[^_]/g, '').length })}
          >
            {indice.replace(/ /g, '  ')}
          </p>
        )}
        {motAnimateur && !revele && (
          <p className="font-mono text-sm text-white/60">
            {t('dessin.motAnimateur')} <span className="text-white font-bold">{motAnimateur}</span>
          </p>
        )}
      </div>

      <aside className={`lg:w-80 shrink-0 flex flex-col gap-4 min-h-0 ${xl ? 'text-2xl' : 'text-base'}`}>
        <div className="rounded-2xl bg-white/[0.06] border border-white/10 p-4">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-white/50">{t('dessin.dessinateur')}</p>
          <p className={`font-display ${xl ? 'text-4xl' : 'text-2xl'} truncate`}>
            ✏️ {question.dessinateur?.pseudo ?? '—'}
          </p>
          {restant !== null && !revele && (
            <p
              className={`font-display tabular-nums ${xl ? 'text-6xl' : 'text-4xl'}`}
              style={{ color: restant <= 10 ? CORAIL : 'white' }}
            >
              {restant}
            </p>
          )}
        </div>

        <div className="rounded-2xl bg-white/[0.06] border border-white/10 p-4">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-white/50 mb-2">
            {t('dessin.ontTrouve', { n: dessin.trouves.length })}
          </p>
          {dessin.trouves.length === 0 ? (
            <p className="text-white/40 italic">{t('dessin.personnePourLinstant')}</p>
          ) : (
            <ol className="space-y-1">
              {dessin.trouves.map((tr, i) => (
                <li key={tr.participant_id} className="flex gap-2 items-baseline">
                  <span className="font-mono text-white/50 w-6">{i + 1}.</span>
                  <span className="font-semibold truncate" style={{ color: VERT }}>
                    {tr.pseudo}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="rounded-2xl bg-white/[0.06] border border-white/10 p-4 flex-1 min-h-0 overflow-hidden">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-white/50 mb-2">{t('dessin.propositions')}</p>
          <ul className="space-y-1">
            {dessin.propositions
              .slice(-8)
              .reverse()
              .map((p, i) => (
                <li key={`${dessin.propositions.length - i}`} className="truncate">
                  <span className="text-white/50">{p.pseudo} :</span> <span>{p.texte}</span>
                </li>
              ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
