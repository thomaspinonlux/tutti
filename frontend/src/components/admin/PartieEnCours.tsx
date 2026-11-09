/**
 * <PartieEnCours /> — fix/partie-tuee-en-se-connectant (09/11)
 *
 * Thomas s'est connecté sur son Mac pendant qu'un quiz tournait au resto pour
 * le suivre de chez lui. En cliquant « Lancer le quiz », il a créé une
 * nouvelle partie — et le serveur termine la partie en cours quand on en crée
 * une autre (pour ne pas laisser de parties fantômes). La partie du resto a
 * été coupée sans un mot (journal du 09/11 : THOM-37MA terminée à 16:47:50,
 * à la seconde où THOM-K8E8 était créée).
 *
 * Désormais :
 *  - la partie en cours s'affiche en grand, avec un bouton pour ouvrir SA
 *    console (on la suit et la pilote depuis n'importe quel appareil) ;
 *  - créer une nouvelle partie demande une confirmation explicite qui dit
 *    que la partie en cours sera terminée.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentSession, type CurrentActiveSession } from '../../lib/sessions.js';

export function PartieEnCours({ className = '' }: { className?: string }): JSX.Element | null {
  const navigate = useNavigate();
  const [partie, setPartie] = useState<CurrentActiveSession | null>(null);
  useEffect(() => {
    let vivant = true;
    const lire = (): void => {
      void getCurrentSession()
        .then((s) => vivant && setPartie(s))
        .catch(() => undefined);
    };
    lire();
    const id = window.setInterval(lire, 15_000);
    return () => {
      vivant = false;
      window.clearInterval(id);
    };
  }, []);
  if (!partie) return null;
  const type = partie.game_type === 'QUIZZ' ? 'Quiz' : 'Blind test';
  const etat = partie.status === 'WAITING' ? 'en salle d’attente' : 'en cours';
  return (
    <div className={`rounded-2xl border-2 border-[#FF5C4D] bg-[#FF5C4D]/15 p-5 ${className}`}>
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#FF5C4D] mb-1">Partie en cours</p>
      <p className="font-display text-2xl mb-1">
        {type} {partie.short_code} — {etat}
      </p>
      <p className="text-sm mb-4">
        {partie.participants_count} joueur{partie.participants_count > 1 ? 's' : ''}. Ouvre sa console pour la
        suivre et la piloter depuis cet appareil.
      </p>
      <button
        type="button"
        onClick={() => navigate(`/host?session=${encodeURIComponent(partie.short_code)}`)}
        className="rounded-xl bg-[#FF5C4D] px-6 py-3 font-display text-lg text-white"
      >
        Ouvrir la console de cette partie
      </button>
    </div>
  );
}

/**
 * À appeler AVANT de créer une partie : si une partie tourne, on demande
 * confirmation (elle sera terminée). Rend true si on peut créer.
 */
export async function confirmerNouvellePartie(): Promise<boolean> {
  let partie: CurrentActiveSession | null = null;
  try {
    partie = await getCurrentSession();
  } catch {
    partie = null;
  }
  if (!partie) return true;
  const type = partie.game_type === 'QUIZZ' ? 'quiz' : 'blind test';
  return window.confirm(
    `Une partie est en cours : ${type} ${partie.short_code} (${partie.participants_count} joueur${
      partie.participants_count > 1 ? 's' : ''
    }).\n\nCréer une nouvelle partie va TERMINER cette partie pour tout le monde.\n\nPour la suivre depuis cet appareil, annule et clique sur « Ouvrir la console de cette partie ».\n\nTerminer la partie en cours et en créer une nouvelle ?`,
  );
}
