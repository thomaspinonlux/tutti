/**
 * SortieManette.tsx — fix/parcours-arcade
 *
 * Les sorties du téléphone-manette. Avant, une fois le QR code scanné, le
 * joueur n'avait plus aucun bouton pour partir, changer de code ou rejoindre
 * une autre partie : il devait fermer l'onglet.
 *
 *   - <BoutonQuitter />     dans l'en-tête de la manette ;
 *   - <LienChangerCode />   sous le formulaire du pseudo ;
 *   - <PartieFermee />      quand la TV a quitté le jeu.
 * Tous ramènent à /manette, la page où l'on tape un code.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icone } from '../../components/ui/Icone.js';

/**
 * Hors partie : un appui suffit. Pendant une partie le bouton est à portée de
 * pouce : le premier appui demande « Quitter ? », le second confirme (trois
 * secondes), pour ne pas sortir un joueur en pleine course par accident.
 */
export function BoutonQuitter({ enJeu }: { enJeu: boolean }): JSX.Element {
  const navigate = useNavigate();
  const [arme, setArme] = useState(false);

  useEffect(() => {
    if (!arme) return;
    const id = window.setTimeout(() => setArme(false), 3000);
    return () => window.clearTimeout(id);
  }, [arme]);

  return (
    <button
      type="button"
      onClick={() => {
        if (enJeu && !arme) setArme(true);
        else navigate('/manette');
      }}
      className={`shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-semibold ${
        arme ? 'border-[#FF3366] bg-[#FF3366] text-white' : 'border-white/25 text-white/80'
      }`}
    >
      <Icone nom="sortie" />
      {arme ? 'Quitter ?' : 'Quitter'}
    </button>
  );
}

export function LienChangerCode(): JSX.Element {
  return (
    <Link to="/manette" className="text-white/70 underline underline-offset-4">
      Changer de code
    </Link>
  );
}

export function PartieFermee({ texte }: { texte: string }): JSX.Element {
  return (
    <div className="min-h-screen bg-[#0E0D17] text-white flex flex-col items-center justify-center p-6 gap-6 text-center">
      <p className="text-2xl">{texte}</p>
      <Link to="/manette" className="rounded-xl bg-[#FF3366] px-6 py-3 text-xl font-bold">
        Entrer un nouveau code
      </Link>
    </div>
  );
}
