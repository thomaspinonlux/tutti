/**
 * /manette — fix/parcours-arcade
 *
 * La porte d'entrée des joueurs qui ne scannent pas le QR code : ils tapent le
 * code de 4 lettres affiché sur la TV. L'écran de jeu annonçait déjà
 * « tuttiparty.app/manette · CODE », mais cette adresse n'existait pas.
 *
 * Le code ne dit pas de quel jeu il s'agit : on le demande au serveur
 * (`jeu:trouver`), qui répond « manette » ou « course », et on envoie le
 * téléphone sur la bonne manette. C'est aussi la page où reviennent les
 * boutons « Quitter » et « Changer de code ».
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { connecterJeu } from '../../lib/socket.js';

type Reponse = { ok: boolean; type?: 'manette' | 'course'; erreur?: string };

const nettoyer = (v: string): string =>
  v
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4);

export function ManetteEntreePage(): JSX.Element {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [recherche, setRecherche] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const s = connecterJeu();
    socketRef.current = s;
    return () => {
      s.disconnect();
    };
  }, []);

  const chercher = (): void => {
    const s = socketRef.current;
    if (!s || code.length < 4 || recherche) return;
    setErreur(null);
    setRecherche(true);
    s.timeout(6000).emit('jeu:trouver', { code }, (err: Error | null, r?: Reponse) => {
      setRecherche(false);
      if (err) return setErreur('Pas de réponse. Vérifie ta connexion et réessaie.');
      if (r?.ok && r.type)
        return navigate(r.type === 'course' ? `/course/${code}` : `/manette/${code}`);
      setErreur(r?.erreur ?? 'Code inconnu — vérifie le code affiché sur la TV');
    });
  };

  return (
    <div className="min-h-screen bg-[#0E0D17] text-white flex flex-col items-center justify-center p-6 gap-4">
      <p className="font-display text-4xl">Manette</p>
      <p className="text-white/70 text-center">Tape le code affiché sur la TV.</p>
      <form
        className="w-full max-w-sm space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          chercher();
        }}
      >
        <input
          value={code}
          onChange={(e) => {
            setCode(nettoyer(e.target.value));
            setErreur(null);
          }}
          aria-label="Code de la partie"
          placeholder="CODE"
          maxLength={4}
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-xl px-4 py-3 text-center font-mono text-3xl tracking-[0.4em] text-black placeholder:text-black/30"
          autoFocus
        />
        <button
          type="submit"
          disabled={code.length < 4 || recherche}
          className="w-full rounded-xl bg-[#FF3366] py-3 text-xl font-bold disabled:opacity-40"
        >
          {recherche ? 'Recherche…' : 'Rejoindre'}
        </button>
      </form>
      <p role="alert" className="min-h-[1.5rem] text-center text-[#FF3366]">
        {erreur}
      </p>
      <Link to="/" className="text-white/60 underline underline-offset-4">
        Retour à l'accueil
      </Link>
    </div>
  );
}
