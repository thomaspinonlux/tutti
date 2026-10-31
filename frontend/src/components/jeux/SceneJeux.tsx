/**
 * Scènes TV / console — feat/jeux-de-salon (fond sombre, comme le reste).
 *   <SceneEcrireVoter /> : Bluff et Réponse drôle (écriture → vote → résultat)
 *   <SceneBac />         : P'tit Bac (lettre + catégories → grilles de tous)
 */
import { useTranslation } from 'react-i18next';
import type { Socket } from 'socket.io-client';
import type { CurrentQuestionState, DetailsBac, DetailsVote } from '@tutti/shared';
import { useEcrireVoter, useSecondesRestantes } from '../../lib/jeuxDeSalon.js';

const CORAIL = '#FF5C4D';
const VERT = '#3FB47A';

export function SceneEcrireVoter({
  socket,
  sessionId,
  question,
  details,
  xl = false,
}: {
  socket: Socket | null;
  sessionId: string;
  question: CurrentQuestionState;
  details: DetailsVote | null;
  xl?: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  const bluff = question.type === 'BLUFF';
  const vue = useEcrireVoter(socket, sessionId, question.question_index);
  const finEcriture = new Date(question.started_at).getTime() + question.time_limit_sec * 1000;
  const revele = details !== null;
  const restant = useSecondesRestantes(revele ? null : vue.etape === 'vote' ? vue.finVote : finEcriture);
  const grand = xl ? 'text-6xl' : 'text-4xl';

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-6 text-white text-center min-h-0">
      <div className="flex items-center gap-6">
        <p className="font-mono text-sm uppercase tracking-[0.3em]" style={{ color: CORAIL }}>
          {bluff ? t('jeux.bluff') : t('jeux.drole')}
          {!revele && vue.etape === 'vote' ? ` · ${t('jeux.vote')}` : ''}
        </p>
        {restant !== null && (
          <p className={`font-display tabular-nums ${xl ? 'text-5xl' : 'text-3xl'}`} style={{ color: restant <= 5 ? CORAIL : 'white' }}>
            {restant}
          </p>
        )}
      </div>
      <h2 className={`font-display leading-tight max-w-6xl ${grand}`}>{question.text}</h2>

      {!revele && vue.etape === 'ecriture' && (
        <p className={`font-editorial italic text-white/70 ${xl ? 'text-3xl' : 'text-xl'}`}>
          {bluff ? t('jeux.tvEcrisBluff') : t('jeux.tvEcrisDrole')} · {t('jeux.tvOntEcrit', { n: vue.ecrits })}
        </p>
      )}

      {!revele && vue.etape === 'vote' && (
        <>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-6xl">
            {vue.choix.map((c) => (
              <li
                key={c.id}
                className={`rounded-2xl border-2 border-white/15 bg-white/[0.06] px-6 py-4 font-semibold ${xl ? 'text-3xl' : 'text-xl'}`}
              >
                {c.texte}
              </li>
            ))}
          </ul>
          <p className="font-mono text-white/60">{t('jeux.tvVotesRecus', { n: vue.votes })}</p>
        </>
      )}

      {revele && (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-6xl text-left">
          {details.choix.map((c) => (
            <li
              key={c.id}
              className={`rounded-2xl border-2 px-6 py-4 ${c.verite ? 'border-[#3FB47A] bg-[#3FB47A]/20' : 'border-white/15 bg-white/[0.05]'}`}
            >
              <p className={`font-semibold ${xl ? 'text-3xl' : 'text-xl'}`} style={c.verite ? { color: VERT } : undefined}>
                {c.verite ? '✓ ' : ''}
                {c.texte}
              </p>
              <p className="text-white/60 mt-1">
                {c.verite ? t('jeux.laVerite') : t('jeux.ecritPar', { noms: c.auteurs.join(', ') })}
              </p>
              <p className="text-white/80 mt-1">
                {c.votants.length === 0 ? t('jeux.aucunVote') : `🗳️ ${c.votants.join(', ')}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SceneBac({
  question,
  details,
  xl = false,
}: {
  question: CurrentQuestionState;
  details: DetailsBac | null;
  xl?: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  const fin = new Date(question.started_at).getTime() + question.time_limit_sec * 1000;
  const restant = useSecondesRestantes(details ? null : fin);

  if (!details) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-6 text-white text-center">
        <p className="font-mono text-sm uppercase tracking-[0.3em]" style={{ color: CORAIL }}>
          {t('jeux.bac')}
        </p>
        <p className={`font-display leading-none ${xl ? 'text-[12rem]' : 'text-8xl'}`}>{question.lettre ?? '?'}</p>
        <ul className="flex flex-wrap justify-center gap-3 max-w-5xl">
          {question.choices.map((c) => (
            <li key={c} className={`rounded-full border-2 border-white/20 px-5 py-2 ${xl ? 'text-2xl' : 'text-lg'}`}>
              {c}
            </li>
          ))}
        </ul>
        {restant !== null && (
          <p className={`font-display tabular-nums ${xl ? 'text-6xl' : 'text-4xl'}`} style={{ color: restant <= 10 ? CORAIL : 'white' }}>
            {restant}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col gap-4 text-white min-h-0">
      <p className={`font-display ${xl ? 'text-5xl' : 'text-3xl'}`}>
        {t('jeux.bac')} · <span style={{ color: CORAIL }}>{details.lettre}</span>
      </p>
      <div className="overflow-auto">
        <table className={`w-full border-collapse ${xl ? 'text-xl' : 'text-sm'}`}>
          <thead>
            <tr className="text-white/60 text-left">
              <th className="p-2">{t('jeux.joueur')}</th>
              {details.categories.map((c) => (
                <th key={c} className="p-2">
                  {c}
                </th>
              ))}
              <th className="p-2 text-right">{t('jeux.points')}</th>
            </tr>
          </thead>
          <tbody>
            {details.lignes.map((l) => (
              <tr key={l.participant_id} className="border-t border-white/10">
                <td className="p-2 font-semibold whitespace-nowrap">{l.pseudo}</td>
                {l.reponses.map((r, i) => (
                  <td key={i} className="p-2" style={{ color: r.points === 20 ? VERT : r.points === 10 ? '#F2C94C' : 'rgba(255,255,255,0.35)' }}>
                    {r.texte || '—'}
                  </td>
                ))}
                <td className="p-2 text-right font-mono font-bold">{l.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-white/50 text-sm">{t('jeux.bacBareme')}</p>
    </div>
  );
}
