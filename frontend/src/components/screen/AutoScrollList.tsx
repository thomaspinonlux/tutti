/**
 * AutoScrollList — liste qui défile toute seule quand elle déborde.
 *
 * Pour les écrans SANS souris ni doigt (la TV de la salle) : personne ne peut
 * dérouler un menu. Quand le contenu dépasse la hauteur disponible, la liste
 * descend lentement jusqu'en bas, marque un arrêt, puis remonte — chacun
 * finit par voir son nom et son score. Quand rien ne dépasse, aucune
 * animation.
 *
 * feat/classements-defilants-tv — extrait de ScreenPage (podium d'entracte)
 * pour servir aussi pendant le jeu : classement du titre et classement
 * général de TvScreenView. Demande de Thomas : « si beaucoup de joueurs, le
 * classement de la manche et de la partie doivent défiler, sur la TV, pour
 * qu'ils puissent voir leur score ».
 */
import { useEffect, useRef, type ReactNode } from 'react';

export function AutoScrollList({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    let dir = 1;
    let pause = 90; // frames d'arrêt en haut/bas (~1.5s)
    let acc = 0;
    // fix/tv-qui-saccade-sur-le-podium — ON NE MESURE PLUS À CHAQUE IMAGE.
    // Lire la hauteur de contenu force le navigateur à recalculer toute la
    // mise en page ; c'était fait soixante fois par seconde, et DEUX listes
    // sont affichées en même temps sur le podium — soit cent vingt recalculs
    // par seconde pendant tout l'entracte, sur un boîtier TV modeste. La
    // hauteur ne change qu'au changement de contenu : on la relit dix fois par
    // seconde, ce qui est déjà généreux, et on ne s'anime pas du tout quand
    // rien ne dépasse.
    let max = el.scrollHeight - el.clientHeight;
    let prochaineMesure = 0;
    const step = (): void => {
      const maintenant = performance.now();
      if (maintenant >= prochaineMesure) {
        prochaineMesure = maintenant + 100;
        max = el.scrollHeight - el.clientHeight;
      }
      if (max > 2) {
        if (pause > 0) {
          pause -= 1;
        } else {
          acc += dir * 0.6;
          if (acc >= max) {
            acc = max;
            dir = -1;
            pause = 90;
          } else if (acc <= 0) {
            acc = 0;
            dir = 1;
            pause = 90;
          }
          el.scrollTop = acc;
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div ref={ref} className={`overflow-hidden ${className ?? ''}`}>
      {children}
    </div>
  );
}
