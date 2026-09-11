/**
 * ClassementDuTitre — classement DU MORCEAU EN COURS, pas de la partie.
 *
 * Demande terrain : « les personnes aimeraient voir le classement sur le titre
 * même : qui a répondu en premier, et le classement bien clair sur le titre ».
 * Le panneau existant (DarkLeaderboard / LiveLeaderboard) montre le CUMUL de la
 * partie avec un petit "+N" sur le côté — illisible depuis une table.
 *
 * Ici : ordre d'arrivée (1ᵉʳ, 2ᵉ, 3ᵉ…), points gagnés SUR CE TITRE en gros, et
 * total général mis à jour en dessous. Aucun calcul serveur : tout vient déjà
 * de CorrectAnswerEntry.position / .score et de CumulativeScore.total_points.
 */

import type { CorrectAnswerEntry, CumulativeScore } from '@tutti/shared';
import { useMemo, type ReactNode } from 'react';
import { AutoScrollList } from '../screen/AutoScrollList.js';
import { useTranslation } from 'react-i18next';

export type VarianteClassement = 'sombre' | 'clair' | 'compact';

/**
 * fix/noms-longs-coupes — LA REGLE POUR UN NOM LONG : IL RETRECIT, PUIS IL
 * PASSE A LA LIGNE. JAMAIS COUPE.
 *
 * Partout sur la TV (classement, podium, classement du titre), les pseudos et
 * noms d equipe etaient en `truncate` : « Les Bretons du fond de la salle »
 * devenait « Les Bretons du fon… ». Depuis une table, impossible de savoir
 * qui est premier. Regle unique, appliquee a tous les ecrans :
 *   - jusqu a 14 caracteres : taille pleine ;
 *   - jusqu a 24 : un cran en dessous ;
 *   - au-dela : deux crans en dessous ;
 *   - et dans tous les cas, retour a la ligne autorise, 2 lignes maximum.
 * `grand` = taille pleine sur les ecrans ou le nom est l element principal.
 */
export function classesNom(
  nom: string,
  grand: 'podium' | 'liste' | 'colonne' | 'compact' = 'liste',
): string {
  const n = (nom ?? '').length;
  const tailles = {
    podium: n <= 14 ? 'text-4xl lg:text-5xl' : n <= 24 ? 'text-3xl lg:text-4xl' : 'text-2xl lg:text-3xl',
    liste: n <= 14 ? 'text-2xl lg:text-3xl' : n <= 24 ? 'text-xl lg:text-2xl' : 'text-lg lg:text-xl',
    // fix/noms-coupes-colonne-tv — la colonne droite de la TV fait 360 px :
    // en taille « liste », « Les Bretons du fond de la salle » tenait sur
    // deux lignes et finissait en « … » (capture du 11/09). Un cran plus
    // petit et trois lignes autorisees : le nom entier, toujours.
    colonne: n <= 14 ? 'text-xl' : n <= 24 ? 'text-lg' : 'text-base',
    compact: n <= 14 ? 'text-base' : n <= 24 ? 'text-sm' : 'text-xs',
  }[grand];
  return `${tailles} break-words ${grand === 'colonne' ? 'line-clamp-3' : 'line-clamp-2'} leading-tight`;
}

const CORAL = '#FF5C4D';

/** 1 → « 1ᵉʳ », 2 → « 2ᵉ »… (ordinal court, lisible de loin). */
export function ordinal(n: number, langue: string): string {
  if (langue.startsWith('fr')) return n === 1 ? '1ᵉʳ' : `${n}ᵉ`;
  const reste10 = n % 10;
  const reste100 = n % 100;
  if (reste10 === 1 && reste100 !== 11) return `${n}st`;
  if (reste10 === 2 && reste100 !== 12) return `${n}nd`;
  if (reste10 === 3 && reste100 !== 13) return `${n}rd`;
  return `${n}th`;
}

export interface LigneClassementTitre {
  cle: string;
  rang: number;
  pseudo: string;
  couleur: string | null;
  pointsTitre: number;
  totalGeneral: number | null;
  doubleReponse: boolean;
  secondes: number;
  estMoi: boolean;
}

/**
 * Construit les lignes à partir de l'état déjà diffusé.
 * `correctAnswers` est trié par le backend dans l'ordre d'arrivée, mais on
 * retrie sur `position` pour ne dépendre d'aucun ordre implicite.
 */
export function construireClassementTitre(
  correctAnswers: CorrectAnswerEntry[],
  cumulative: CumulativeScore[],
  moiParticipantId?: string | null,
): LigneClassementTitre[] {
  const totalPar = new Map<string, number>();
  for (const c of cumulative) totalPar.set(c.id, c.total_points);
  return [...correctAnswers]
    .sort((a, b) => a.position - b.position)
    .map((a) => {
      const couleurEquipe = cumulative.find((c) => c.id === (a.team_id ?? a.participant_id));
      return {
        cle: a.participant_id,
        rang: a.position,
        pseudo: a.pseudo,
        couleur: couleurEquipe?.color ?? null,
        pointsTitre: a.score,
        totalGeneral: totalPar.get(a.team_id ?? a.participant_id) ?? totalPar.get(a.participant_id) ?? null,
        doubleReponse: (a.score_title_bonus ?? 0) > 0,
        secondes: a.answered_at_ms / 1000,
        estMoi: !!moiParticipantId && a.participant_id === moiParticipantId,
      };
    });
}

/** Liste défilante sur TV, liste simple ailleurs. */
function Conteneur({ defilement, children }: { defilement: boolean; children: ReactNode }): JSX.Element {
  return defilement ? <AutoScrollList className="min-h-0 flex-1">{children}</AutoScrollList> : <>{children}</>;
}

export function ClassementDuTitre({
  correctAnswers,
  cumulative,
  variante,
  moiParticipantId,
  maxLignes,
  defilement,
}: {
  correctAnswers: CorrectAnswerEntry[];
  cumulative: CumulativeScore[];
  variante: VarianteClassement;
  moiParticipantId?: string | null;
  maxLignes?: number;
  /**
   * feat/classements-defilants-tv — TV : TOUTES les lignes, et la liste
   * défile toute seule si elle déborde de la hauteur donnée par le parent
   * (personne ne peut faire défiler une TV). `maxLignes` est ignoré.
   */
  defilement?: boolean;
}): JSX.Element {
  const { t, i18n } = useTranslation();
  const lignes = useMemo(
    () => construireClassementTitre(correctAnswers, cumulative, moiParticipantId),
    [correctAnswers, cumulative, moiParticipantId],
  );
  const visibles = maxLignes && !defilement ? lignes.slice(0, maxLignes) : lignes;

  const sombre = variante === 'sombre';
  const compact = variante === 'compact';

  const cadre = sombre
    ? 'rounded-[20px] border border-white/10 bg-[#15151d]/85 backdrop-blur'
    : compact
      ? 'rounded-2xl border-2 border-ink bg-cream shadow-pop'
      : 'rounded-[20px] border border-ink/15 bg-white shadow-pop';

  const couleurTexte = sombre ? 'text-white' : 'text-ink';
  const couleurSecondaire = sombre ? 'text-white/55' : 'text-ink-2';

  return (
    <section
      className={`${cadre} ${compact ? 'p-3' : 'p-5'} animate-slide-up ${
        defilement ? 'flex min-h-0 flex-col overflow-hidden' : ''
      }`}
      aria-live="polite"
      aria-label={t('screen.trackRankingTitle')}
    >
      <div className={`mb-3 flex shrink-0 items-center gap-2.5 ${compact ? 'mb-2' : ''}`}>
        <span aria-hidden className={compact ? 'text-base' : 'text-xl'}>
          🎯
        </span>
        <p
          className={`font-mono font-bold uppercase tracking-[0.25em] ${couleurSecondaire} ${
            compact ? 'text-[10px]' : 'text-xs'
          }`}
        >
          {t('screen.trackRankingTitle')}
        </p>
      </div>

      {visibles.length === 0 ? (
        <p className={`py-6 text-center font-editorial italic ${couleurSecondaire} ${compact ? 'text-sm' : 'text-lg'}`}>
          {t('screen.trackRankingEmpty')}
        </p>
      ) : (
        <Conteneur defilement={!!defilement}>
        <ol className={`flex flex-col ${compact ? 'gap-1.5' : 'gap-2.5'}`}>
          {visibles.map((l) => {
            const premier = l.rang === 1;
            return (
              <li
                key={l.cle}
                className={`grid grid-cols-[auto_1fr_auto] items-center ${
                  compact ? 'gap-2 rounded-xl px-2.5 py-2' : 'gap-4 rounded-2xl px-4 py-3'
                }`}
                style={{
                  backgroundColor: premier
                    ? `${CORAL}22`
                    : l.estMoi
                      ? sombre
                        ? '#ffffff14'
                        : '#00000010'
                      : sombre
                        ? '#ffffff0a'
                        : '#00000008',
                  border: `1px solid ${premier ? `${CORAL}66` : sombre ? '#ffffff12' : '#00000014'}`,
                  boxShadow: premier && sombre ? `0 0 30px ${CORAL}22` : undefined,
                }}
              >
                {/* Rang — le gros chiffre demandé, lisible depuis la salle */}
                <span
                  className={`text-center font-display tabular-nums ${
                    compact ? 'w-9 text-xl' : sombre ? 'w-12 text-3xl' : 'w-16 text-4xl lg:text-5xl'
                  }`}
                  style={{ color: premier ? CORAL : sombre ? '#ffffff' : undefined }}
                >
                  {ordinal(l.rang, i18n.language)}
                </span>

                <div className="flex min-w-0 flex-col">
                  <div className="flex min-w-0 items-center gap-2">
                    {l.couleur && (
                      <span
                        aria-hidden
                        className="h-3 w-3 shrink-0 rounded-full ring-1 ring-white/30"
                        style={{ backgroundColor: l.couleur }}
                      />
                    )}
                    <span
                      className={`font-bold ${couleurTexte} ${classesNom(l.pseudo, compact ? 'compact' : sombre ? 'colonne' : 'liste')}`}
                    >
                      {l.pseudo}
                    </span>
                  </div>
                  <span
                    className={`font-editorial italic ${couleurSecondaire} ${compact ? 'text-[10px]' : 'text-sm'}`}
                  >
                    {l.doubleReponse
                      ? t('screen.finderArtistAndTitle', { seconds: l.secondes.toFixed(1) })
                      : t('screen.finderArtistOnly', { seconds: l.secondes.toFixed(1) })}
                  </span>
                </div>

                <div className="whitespace-nowrap text-right">
                  {/* Points gagnés SUR CE TITRE */}
                  <div
                    className={`font-mono font-bold tabular-nums ${
                      compact ? 'text-lg' : sombre ? 'text-2xl' : 'text-3xl lg:text-4xl'
                    }`}
                    style={{ color: CORAL }}
                  >
                    +{l.pointsTitre}
                  </div>
                  {/* Total général mis à jour */}
                  {l.totalGeneral !== null && (
                    <div
                      className={`font-mono tabular-nums ${couleurSecondaire} ${
                        compact ? 'text-[10px]' : 'text-sm'
                      }`}
                    >
                      {t('screen.trackRankingTotal', { total: l.totalGeneral })}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        </Conteneur>
      )}
    </section>
  );
}
