/**
 * <BadgeAppleMusic /> — fix/premier-morceau-avant-la-partie
 *
 * Sur l'iPad, le tout premier « jouer » d'Apple Music peut figer l'app (soirée
 * du 30/10 : 3 fois de suite au premier morceau). Il part désormais à
 * l'ouverture, sur un silence. Ce badge dit à l'animateur où on en est :
 * prêt, en préparation, ou à relancer AVANT l'arrivée des joueurs.
 */
import type { EtatPrechauffage } from '../../lib/useAppleMusicPlayer.js';

export function BadgeAppleMusic({ etat }: { etat: EtatPrechauffage | null }): JSX.Element | null {
  if (etat === null || etat === 'indisponible') return null;
  const styles: Record<Exclude<EtatPrechauffage, 'indisponible'>, { classe: string; texte: string }> = {
    'en-cours': { classe: 'bg-cream text-ink border-hairline', texte: '🎵 Apple Music : préparation…' },
    pret: { classe: 'bg-basil text-cream border-basil', texte: '🎵 Apple Music prêt ✓' },
    echec: {
      classe: 'bg-raspberry text-cream border-raspberry',
      texte: '⚠️ Apple Music ne répond pas — ferme et relance l’app avant la partie',
    },
  };
  const s = styles[etat];
  return (
    <span
      role="status"
      className={`px-3 py-1.5 rounded-full border-2 text-sm font-medium whitespace-nowrap ${s.classe}`}
    >
      {s.texte}
    </span>
  );
}
