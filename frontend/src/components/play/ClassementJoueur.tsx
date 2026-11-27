/**
 * <ClassementJoueur /> — feat/classement-sur-le-telephone
 *
 * Thomas, 25/11 : « est-ce qu'ils ont un bouton qui leur permet de voir le
 * classement de la manche et le classement général sur leur téléphone ? Si ce
 * n'est pas le cas, ça serait bien qu'ils l'aient. » — le téléphone ne
 * montrait que « 3 / 12 joueurs » ; les classements n'étaient que sur la TV,
 * que les joueurs de la terrasse ne voient pas.
 *
 * Un bouton « Classement » ouvre une fenêtre avec deux onglets : la manche
 * (en cours, sinon la dernière terminée) et le général. Au quiz, qui n'a pas
 * de manches à points, seul le général s'affiche. La ligne du joueur (ou de
 * son équipe) est mise en avant. Les chiffres viennent du serveur — le même
 * calcul que la TV — et se rafraîchissent tant que la fenêtre est ouverte.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getClassementJoueur, type ClassementJoueur as Donnees } from '../../lib/sessions.js';
import { Icone, Rang } from '../ui/Icone.js';

const CORAIL = '#FF3366';
const RAFRAICHIR_MS = 8000;

interface Ligne {
  id: string;
  label: string;
  points: number;
  couleur: string | null;
}

export function ClassementJoueur({
  shortCode,
  token,
}: {
  shortCode: string;
  token: string;
}): JSX.Element {
  const { t } = useTranslation();
  const [ouvert, setOuvert] = useState(false);
  const [donnees, setDonnees] = useState<Donnees | null>(null);
  const [erreur, setErreur] = useState(false);
  const [onglet, setOnglet] = useState<'manche' | 'general' | null>(null);

  const charger = useCallback((): void => {
    getClassementJoueur(shortCode, token)
      .then((d) => {
        setDonnees(d);
        setErreur(false);
      })
      .catch(() => setErreur(true));
  }, [shortCode, token]);

  useEffect(() => {
    if (!ouvert) return;
    charger();
    const id = window.setInterval(charger, RAFRAICHIR_MS);
    return () => window.clearInterval(id);
  }, [ouvert, charger]);

  // Onglet d'arrivée : la manche si elle se joue, sinon le général.
  const actif: 'manche' | 'general' = !donnees?.manche
    ? 'general'
    : (onglet ?? (donnees.manche.en_cours ? 'manche' : 'general'));

  const lignes: Ligne[] = !donnees
    ? []
    : actif === 'manche' && donnees.manche
      ? donnees.manche.classement.map((l) => ({
          id: l.id,
          label: l.label,
          points: l.points,
          // En équipes, la manche se lit par équipe (26/11) : même pastille de
          // couleur que dans le général.
          couleur: donnees.general.find((g) => g.id === l.id)?.color ?? null,
        }))
      : donnees.general.map((l) => ({
          id: l.id,
          label: l.label,
          points: l.total_points,
          couleur: l.color,
        }));
  const joueursManche = actif === 'manche' ? (donnees?.manche?.joueurs ?? []) : [];
  const estMonEquipe = (id: string): boolean =>
    !!donnees && donnees.mode === 'TEAMS' && id === donnees.moi.team_id;
  const estMoi = (id: string): boolean =>
    !!donnees && (id === donnees.moi.participant_id || estMonEquipe(id));

  // À l'ouverture et au changement d'onglet, on amène la ligne du joueur à
  // l'écran (30 joueurs : elle peut être loin). Pas à chaque rafraîchissement,
  // pour ne pas arracher la liste des doigts de celui qui la fait défiler.
  const maLigne = useRef<HTMLLIElement | null>(null);
  const charge = donnees !== null;
  useEffect(() => {
    if (ouvert && charge) maLigne.current?.scrollIntoView({ block: 'center' });
  }, [ouvert, charge, actif]);

  const caseOnglet = (choisi: boolean): string =>
    `min-h-[44px] flex-1 rounded-xl border px-3 text-sm font-bold transition-colors ${
      choisi ? 'text-[#0E0D17]' : 'border-white/15 text-white/75'
    }`;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOnglet(null);
          setOuvert(true);
        }}
        className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-white/20 px-4 text-sm font-semibold text-white/85 transition-colors active:bg-white/10"
      >
        <Icone nom="trophee" />
        {t('play.classement')}
      </button>

      {ouvert && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="classement-titre"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3"
          onClick={() => setOuvert(false)}
        >
          <div
            className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-md flex-col rounded-[20px] border border-white/[0.07] bg-[#181628] text-left text-white shadow-[0_18px_50px_rgba(0,0,0,0.5)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-4 pt-3">
              <h2 id="classement-titre" className="font-display text-2xl">
                {t('play.classement')}
              </h2>
              <button
                type="button"
                onClick={() => setOuvert(false)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/20 px-4 text-sm font-semibold"
              >
                <Icone nom="croix" />
                {t('common.close')}
              </button>
            </div>

            {donnees?.manche && (
              <div className="flex gap-2 px-4 pt-3" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={actif === 'manche'}
                  onClick={() => setOnglet('manche')}
                  className={caseOnglet(actif === 'manche')}
                  style={
                    actif === 'manche'
                      ? { backgroundColor: CORAIL, borderColor: CORAIL }
                      : undefined
                  }
                >
                  {t('play.classementManche', { n: donnees.manche.position })}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={actif === 'general'}
                  onClick={() => setOnglet('general')}
                  className={caseOnglet(actif === 'general')}
                  style={
                    actif === 'general'
                      ? { backgroundColor: CORAIL, borderColor: CORAIL }
                      : undefined
                  }
                >
                  {t('play.classementGeneral')}
                </button>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {!donnees && !erreur && (
                <p className="py-6 text-center text-white/60">{t('common.loading')}</p>
              )}
              {!donnees && erreur && (
                <div className="py-6 text-center">
                  <p role="alert" className="mb-3 text-white/80">
                    {t('play.classementErreur')}
                  </p>
                  <button
                    type="button"
                    onClick={charger}
                    className="min-h-[44px] rounded-xl border border-white/25 px-5 text-sm font-bold"
                  >
                    {t('play.classementReessayer')}
                  </button>
                </div>
              )}
              {donnees && lignes.length === 0 && (
                <p className="py-6 text-center text-white/60">{t('play.classementVide')}</p>
              )}
              {donnees && lignes.length > 0 && (
                <ol className="space-y-1.5">
                  {lignes.map((l, i) => (
                    <li
                      key={l.id}
                      ref={estMoi(l.id) ? maLigne : undefined}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
                        estMoi(l.id) ? 'bg-white/[0.08]' : 'border-white/[0.07]'
                      }`}
                      style={estMoi(l.id) ? { borderColor: CORAIL } : undefined}
                    >
                      <Rang rang={i + 1} className="h-7 w-7 shrink-0 text-sm" />
                      {l.couleur && (
                        <span
                          className="h-3 w-3 shrink-0 rounded-full"
                          style={{ backgroundColor: l.couleur }}
                          aria-hidden
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate font-semibold">
                        {l.label}
                        {estMoi(l.id) && (
                          <span
                            className="ml-2 font-mono text-[11px] uppercase tracking-wider"
                            style={{ color: CORAIL }}
                          >
                            {estMonEquipe(l.id)
                              ? t('play.classementMonEquipe')
                              : t('play.classementMoi')}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 font-mono text-base font-bold tabular-nums">
                        {l.points}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {/* En équipes : les joueurs de la manche, sous les équipes. */}
              {donnees && joueursManche.length > 0 && (
                <>
                  <p className="mb-2 mt-5 font-mono text-[11px] uppercase tracking-[0.22em] text-white/55">
                    {t('host.intermission.parJoueur')}
                  </p>
                  <ol className="space-y-1.5">
                    {joueursManche.map((j, i) => {
                      const moi = j.id === donnees.moi.participant_id;
                      return (
                        <li
                          key={j.id}
                          className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
                            moi ? 'bg-white/[0.08]' : 'border-white/[0.07]'
                          }`}
                          style={moi ? { borderColor: CORAIL } : undefined}
                        >
                          <span className="w-7 shrink-0 text-center font-mono text-sm text-white/55">
                            {i + 1}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold">
                              {j.label}
                              {moi && (
                                <span
                                  className="ml-2 font-mono text-[11px] uppercase tracking-wider"
                                  style={{ color: CORAIL }}
                                >
                                  {t('play.classementMoi')}
                                </span>
                              )}
                            </span>
                            {j.equipe && (
                              <span className="block truncate font-mono text-[11px] uppercase tracking-wider text-white/50">
                                {j.equipe}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 font-mono text-base font-bold tabular-nums">
                            {j.points}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
