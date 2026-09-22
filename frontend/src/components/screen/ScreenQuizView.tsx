/**
 * <ScreenQuizView /> — feat/quiz-comme-le-blind-test
 *
 * L'écran TV pendant un quiz : la question, les choix, le temps qui reste,
 * puis la bonne réponse et qui l'a trouvée. Alimenté par les événements
 * socket du quiz (la TV n'avait aucune vue quiz : elle restait sur le lobby).
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CurrentQuestionState } from '@tutti/shared';
import { QRCode } from '../host/QRCode.js';
import { getShareableOrigin } from '../../lib/platform.js';

export interface QuizTvReveal {
  reveal: { answer: string };
  results: Array<{ participant_id: string; pseudo: string; is_correct: boolean }>;
}

interface Props {
  joinCode: string;
  question: CurrentQuestionState | null;
  reveal: QuizTvReveal | null;
  finDeManche: boolean;
}

const LETTRES = ['A', 'B', 'C', 'D', 'E', 'F'];
const CORAIL = '#FF5C4D';


export function ScreenQuizView({ joinCode, question, reveal, finDeManche }: Props): JSX.Element {
  const { t } = useTranslation();
  const vrai = t('quizTheme.tvTrue');
  const faux = t('quizTheme.tvFalse');
  const afficherReponse = (q: CurrentQuestionState | null, brut: string): string =>
    q?.type === 'TRUE_FALSE' ? (brut === 'true' ? vrai : brut === 'false' ? faux : brut) : brut;
  const [maintenant, setMaintenant] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setMaintenant(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const playUrl = `${getShareableOrigin()}/play?session=${joinCode}`;
  const fond =
    'min-h-screen bg-gradient-to-b from-[#0B0B0F] to-[#14141C] text-white flex flex-col items-center justify-center p-10 relative';

  if (finDeManche || !question) {
    return (
      <div className={fond}>
        <p className="font-mono text-lg uppercase tracking-[0.3em] mb-4" style={{ color: CORAIL }}>
          Quiz
        </p>
        <h1 className="font-display text-7xl mb-10 text-center">
          {finDeManche ? t('quizTheme.blockEnded') : t('quizTheme.tvNext')}
        </h1>
        <div className="rounded-2xl bg-white p-4">
          <QRCode value={playUrl} size={220} />
        </div>
        <p className="mt-4 font-mono text-3xl font-bold tracking-[0.2em]">{joinCode}</p>
      </div>
    );
  }

  const fin = new Date(question.started_at).getTime() + question.time_limit_sec * 1000;
  const restant = Math.max(0, Math.ceil((fin - maintenant) / 1000));
  const revele = !!reveal;
  const bonne = reveal ? afficherReponse(question, reveal.reveal.answer) : null;
  const choix =
    question.type === 'TRUE_FALSE' ? [vrai, faux] : question.type === 'MCQ' ? question.choices : [];
  const gagnants = reveal?.results.filter((r) => r.is_correct) ?? [];

  return (
    <div className={fond}>
      <div className="absolute top-6 left-8 right-8 flex items-center justify-between">
        <p className="font-mono text-lg uppercase tracking-[0.25em] text-white/60">
          {question.category ?? 'Quiz'} · {t('quizTheme.tvQuestion', { n: question.question_index + 1 })}
        </p>
        {!revele && (
          <p className="font-display text-6xl tabular-nums" style={{ color: restant <= 5 ? CORAIL : 'white' }}>
            {restant}
          </p>
        )}
      </div>

      <h1 className="font-display text-6xl leading-tight text-center max-w-6xl mb-12">{question.text}</h1>

      {choix.length > 0 ? (
        <ul className="grid grid-cols-2 gap-5 w-full max-w-6xl">
          {choix.map((c, i) => {
            const estBonne = revele && bonne === c;
            return (
              <li
                key={i}
                className={[
                  'rounded-2xl border-2 px-6 py-5 text-3xl font-semibold flex items-center gap-4 transition',
                  estBonne
                    ? 'border-[#3FB47A] bg-[#3FB47A]/25'
                    : revele
                      ? 'border-white/10 bg-white/[0.03] text-white/40'
                      : 'border-white/15 bg-white/[0.06]',
                ].join(' ')}
              >
                {question.type === 'MCQ' && (
                  <span className="font-mono text-2xl" style={{ color: CORAIL }}>
                    {LETTRES[i]}
                  </span>
                )}
                <span>{c}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        !revele && <p className="font-editorial italic text-3xl text-white/60">{t('quizTheme.tvAnswerOnPhone')}</p>
      )}

      {revele && (
        <div className="mt-10 text-center">
          {choix.length === 0 && (
            <p className="font-display text-5xl mb-4" style={{ color: '#3FB47A' }}>
              {bonne}
            </p>
          )}
          <p className="font-mono text-xl text-white/70">
            {gagnants.length === 0
              ? t('quizTheme.tvNobody')
              : t('quizTheme.tvFoundBy', {
                  names: `${gagnants
                    .slice(0, 8)
                    .map((g) => g.pseudo)
                    .join(', ')}${gagnants.length > 8 ? ` +${gagnants.length - 8}` : ''}`,
                })}
          </p>
        </div>
      )}
    </div>
  );
}
