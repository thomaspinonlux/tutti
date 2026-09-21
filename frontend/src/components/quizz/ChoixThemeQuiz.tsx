/**
 * <ChoixThemeQuiz /> — feat/quiz-comme-le-blind-test
 *
 * Le choix d'un thème de quiz, comme le choix d'une playlist au blind test :
 * même composant sur la console (animateur) et sur le téléphone qui a la
 * manette. On choisit un niveau, puis un thème : ses questions s'ajoutent à
 * la partie en cours (une « manche »). Les joueurs connectés restent.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MancheAjoutee, NiveauQuiz, ThemeQuiz } from '../../lib/sessions.js';

interface Props {
  charger: () => Promise<ThemeQuiz[]>;
  ajouter: (packId: string, niveau: NiveauQuiz) => Promise<MancheAjoutee>;
  onAjoute?: (manche: MancheAjoutee) => void;
  /** Fond sombre (console) ou clair (téléphone). */
  sombre?: boolean;
}

const NIVEAUX: NiveauQuiz[] = ['MIX', 'EASY', 'MEDIUM', 'EXPERT'];

export function ChoixThemeQuiz({ charger, ajouter, onAjoute, sombre = false }: Props): JSX.Element {
  const { t, i18n } = useTranslation();
  const [themes, setThemes] = useState<ThemeQuiz[] | null>(null);
  const [niveau, setNiveau] = useState<NiveauQuiz>('MIX');
  const [enCours, setEnCours] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ajoute, setAjoute] = useState<MancheAjoutee | null>(null);
  const enAnglais = i18n.language?.startsWith('en');

  useEffect(() => {
    let vivant = true;
    charger()
      .then((l) => vivant && setThemes(l))
      .catch((e: unknown) => vivant && setErreur((e as Error).message));
    return () => {
      vivant = false;
    };
    // `charger` change à chaque rendu du parent : on ne charge qu'une fois.
  }, []);

  const visibles = useMemo(
    () => (themes ?? []).filter((th) => (niveau === 'MIX' ? th.total : th.niveaux[niveau]) > 0),
    [themes, niveau],
  );

  const choisir = async (th: ThemeQuiz): Promise<void> => {
    if (enCours) return;
    setEnCours(th.id);
    setErreur(null);
    try {
      const manche = await ajouter(th.id, niveau);
      setAjoute(manche);
      onAjoute?.(manche);
    } catch (e: unknown) {
      setErreur((e as Error).message);
    } finally {
      setEnCours(null);
    }
  };

  const texte = sombre ? 'text-white' : 'text-ink';
  const doux = sombre ? 'text-white/50' : 'text-ink-soft';
  const carte = sombre
    ? 'border-white/10 bg-white/[0.04] hover:bg-white/[0.09]'
    : 'border-ink bg-cream hover:bg-cream-2';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('quizTheme.level')}>
        {NIVEAUX.map((n) => {
          const actif = n === niveau;
          return (
            <button
              key={n}
              type="button"
              aria-pressed={actif}
              onClick={() => setNiveau(n)}
              className={[
                'px-3 py-1.5 rounded-full text-sm font-medium border-2 transition',
                actif
                  ? 'border-[#FF5C4D] bg-[#FF5C4D] text-white'
                  : sombre
                    ? 'border-white/20 text-white/80'
                    : 'border-ink text-ink',
              ].join(' ')}
            >
              {t(`quizTheme.niveau.${n}`)}
            </button>
          );
        })}
      </div>

      {ajoute && (
        <p role="status" className="text-sm font-medium text-[#3FB47A]">
          ✓ {t('quizTheme.added', { theme: ajoute.theme, count: ajoute.nombre })}
        </p>
      )}
      {erreur && (
        <p role="alert" className="text-sm text-[#FF5C4D]">
          {erreur}
        </p>
      )}

      {themes === null && !erreur && <p className={`text-sm ${doux}`}>{t('common.loading')}</p>}

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[55vh] overflow-auto pr-1">
        {visibles.map((th) => {
          const nb = niveau === 'MIX' ? th.total : th.niveaux[niveau];
          return (
            <li key={th.id}>
              <button
                type="button"
                disabled={!!enCours}
                onClick={() => void choisir(th)}
                className={`w-full text-left rounded-xl border-2 px-3 py-2.5 transition disabled:opacity-50 ${carte}`}
              >
                <span className={`block font-semibold ${texte}`}>
                  {enCours === th.id ? '…' : enAnglais ? th.nom_en : th.nom_fr}
                </span>
                <span className={`block text-xs font-mono ${doux}`}>
                  {t('quizTheme.questions', { count: nb })}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
