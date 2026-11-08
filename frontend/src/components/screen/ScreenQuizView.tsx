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
import type { Socket } from 'socket.io-client';
import { SceneDessin } from '../dessin/SceneDessin.js';
import { SceneBac, SceneEcrireVoter } from '../jeux/SceneJeux.js';
import type { CumulativeScore, DetailsBac, DetailsVote } from '@tutti/shared';
import { getSessionSnapshot } from '../../lib/sessions.js';
import { JoinQrCorner } from '../host/JoinQrCorner.js';
import { tempsRestantMs } from '../../lib/quizPause.js';

export interface QuizTvReveal {
  reveal: { answer: string };
  results: Array<{ participant_id: string; pseudo: string; is_correct: boolean; score?: number; submitted?: string }>;
  /** feat/jeux-de-salon — détail des votes ou des grilles. */
  details?: DetailsVote | DetailsBac | null;
}

interface Props {
  /** feat/dessin-a-deviner — socket spectateur, pour les traits du dessin. */
  socket?: Socket | null;
  sessionId?: string;
  joinCode: string;
  question: CurrentQuestionState | null;
  reveal: QuizTvReveal | null;
  finDeManche: boolean;
}

const LETTRES = ['A', 'B', 'C', 'D', 'E', 'F'];
const CORAIL = '#FF5C4D';


export function ScreenQuizView({
  socket = null,
  sessionId,
  joinCode,
  question,
  reveal,
  finDeManche,
}: Props): JSX.Element {
  const { t } = useTranslation();
  const vrai = t('quizTheme.tvTrue');
  const faux = t('quizTheme.tvFalse');
  const afficherReponse = (q: CurrentQuestionState | null, brut: string): string => {
    if (q?.type === 'TRUE_FALSE') return brut === 'true' ? vrai : brut === 'false' ? faux : brut;
    // fix/juste-prix-tv — l'estimation arrivait en JSON brut sur la TV.
    if (q?.type === 'ESTIMATION') {
      try {
        const m = JSON.parse(brut) as { target: number; unit?: string };
        return `${m.target.toLocaleString(undefined, { maximumFractionDigits: 3 })}${m.unit ? ` ${m.unit}` : ''}`;
      } catch {
        return brut;
      }
    }
    return brut;
  };
  // fix/quiz-classement-tv — le classement du quiz sur la TV, relu à chaque
  // révélation et entre deux questions (la TV n'en montrait aucun).
  const [classement, setClassement] = useState<CumulativeScore[]>([]);
  const cleClassement = `${question?.question_index ?? 'x'}-${reveal ? 'r' : 'q'}-${finDeManche ? 'f' : ''}`;
  useEffect(() => {
    if (question && !reveal && !finDeManche) return;
    let vivant = true;
    void getSessionSnapshot(joinCode)
      .then((r) => {
        if (vivant) setClassement(r.cumulative.filter((c) => c.total_points > 0).slice(0, 5));
      })
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleClassement, joinCode]);
  const blocClassement =
    classement.length > 0 ? (
      <div className="mt-8 w-full max-w-xl">
        <p className="font-mono text-sm uppercase tracking-[0.3em] text-white/50 mb-3 text-center">
          {t('hostQuizz.leaderboard')}
        </p>
        <ol className="space-y-2">
          {classement.map((c, i) => (
            <li
              key={c.id}
              className="flex items-center gap-4 rounded-xl bg-white/[0.06] border border-white/10 px-5 py-2 text-2xl"
            >
              <span className="font-mono w-8 text-white/60">{i + 1}.</span>
              <span className="flex-1 truncate font-semibold">{c.label}</span>
              <span className="font-mono font-bold tabular-nums">{c.total_points}</span>
            </li>
          ))}
        </ol>
      </div>
    ) : null;
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
        {blocClassement}
      </div>
    );
  }

  // feat/quiz-pause — chrono figé pendant la pause.
  const restant = Math.ceil(tempsRestantMs(question, maintenant) / 1000);
  const revele = !!reveal;
  const bonne = reveal ? afficherReponse(question, reveal.reveal.answer) : null;
  const choix =
    question.type === 'TRUE_FALSE' ? [vrai, faux] : question.type === 'MCQ' ? question.choices : [];
  const gagnants = reveal?.results.filter((r) => r.is_correct) ?? [];

  // feat/jeux-de-salon — Bluff / Réponse drôle / P'tit Bac.
  if ((question.type === 'BLUFF' || question.type === 'FUNNY') && sessionId) {
    const d = reveal?.details;
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#0B0B0F] to-[#14141C] text-white flex flex-col p-10">
        <SceneEcrireVoter
          socket={socket}
          sessionId={sessionId}
          question={question}
          details={d && d.kind === 'vote' ? d : null}
          xl
        />
      </div>
    );
  }
  if (question.type === 'PETIT_BAC') {
    const d = reveal?.details;
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#0B0B0F] to-[#14141C] text-white flex flex-col p-10">
        <SceneBac question={question} details={d && d.kind === 'bac' ? d : null} xl />
      </div>
    );
  }

  // feat/dessin-a-deviner — la TV montre le dessin en direct.
  if (question.type === 'DRAWING' && sessionId) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#0B0B0F] to-[#14141C] text-white flex flex-col p-8 gap-4">
        <p className="font-mono text-lg uppercase tracking-[0.25em] text-white/60">
          {question.category ?? t('dessin.titre')} ·{' '}
          {question.numero_manche && question.total_manche
            ? t('hostQuizz.questionSur', { n: question.numero_manche, total: question.total_manche })
            : t('quizTheme.tvQuestion', { n: question.question_index + 1 })}
        </p>
        <div className="flex-1 min-h-0">
          <SceneDessin
            socket={socket}
            sessionId={sessionId}
            question={question}
            revealAnswer={reveal ? reveal.reveal.answer : null}
            restant={revele ? null : restant}
            xl
          />
        </div>
      </div>
    );
  }

  return (
    <div className={fond}>
      <div className="absolute top-6 left-8 right-8 flex items-center justify-between">
        <p className="font-mono text-lg uppercase tracking-[0.25em] text-white/60">
          {question.category ?? 'Quiz'} ·{' '}
          {question.numero_manche && question.total_manche
            ? t('hostQuizz.questionSur', { n: question.numero_manche, total: question.total_manche })
            : t('quizTheme.tvQuestion', { n: question.question_index + 1 })}
        </p>
        {!revele && (
          <p className="font-display text-6xl tabular-nums" style={{ color: restant <= 5 ? CORAIL : 'white' }}>
            {question.en_pause ? `⏸ ${restant}` : restant}
          </p>
        )}
      </div>

      {question.en_pause && !revele && (
        <p className="mb-6 rounded-full border-2 border-[#e8c547] px-6 py-2 font-display text-3xl text-[#e8c547]">
          {t('hostQuizz.enPause')}
        </p>
      )}
      {/* fix/quiz-qr-en-jeu — on peut rejoindre la partie en cours. */}
      <JoinQrCorner joinCode={joinCode} size={110} className="absolute bottom-6 right-8" />
      <h1
        className={`font-display leading-tight text-center max-w-6xl mb-10 whitespace-pre-line [overflow-wrap:anywhere] ${
          question.text.length > 110 ? 'text-4xl lg:text-5xl' : 'text-5xl lg:text-6xl'
        }`}
      >
        {question.text}
      </h1>

      {choix.length > 0 ? (
        // fix/tv-quiz-mise-en-page — Thomas, 08/11 : écran TV en portrait,
        // réponses longues (noms de fichiers) qui débordaient les unes sur les
        // autres. Une colonne en portrait ou si une réponse est longue, et
        // coupure des mots trop longs à l'intérieur de leur case.
        <ul
          className={`grid gap-4 w-full max-w-6xl ${
            choix.some((c) => c.length > 28) ? 'grid-cols-1' : 'grid-cols-1 landscape:grid-cols-2'
          }`}
        >
          {choix.map((c, i) => {
            const estBonne = revele && bonne === c;
            return (
              <li
                key={i}
                className={[
                  `rounded-2xl border-2 px-6 py-4 font-semibold flex items-center gap-4 transition min-w-0 ${
                    choix.some((x) => x.length > 28) ? 'text-2xl' : 'text-3xl'
                  }`,
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
                <span className="min-w-0 [overflow-wrap:anywhere]">{c}</span>
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
          {question.type === 'ESTIMATION' && reveal && reveal.results.length > 0 ? (
            <ol className="font-mono text-2xl text-white/80 space-y-1">
              {/* fix/juste-prix-tv — les plus proches, avec leur estimation. */}
              {[...reveal.results]
                .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
                .slice(0, 3)
                .map((r, i) => (
                  <li key={r.participant_id}>
                    {['🥇', '🥈', '🥉'][i]} {r.pseudo} : {r.submitted ?? '—'}
                    {question.estimation_unit ? ` ${question.estimation_unit}` : ''}
                  </li>
                ))}
            </ol>
          ) : (
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
          )}
          <div className="flex justify-center">{blocClassement}</div>
        </div>
      )}
    </div>
  );
}
