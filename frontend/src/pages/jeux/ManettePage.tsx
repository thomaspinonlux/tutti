/**
 * /manette/:code — feat/jeux-manette (test, caché)
 * Le téléphone-manette commun aux jeux serpents, sumo, réflexe et pong.
 * Le salon dit au téléphone à quel jeu il joue ; la manette s'adapte.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { connecterJeu } from '../../lib/socket.js';
import type { EtatManette, JeuManette } from '../../lib/jeux/salonManette.js';

const CLE_PSEUDO = 'tutti.manette.pseudo';
const NOMS: Record<JeuManette, string> = {
  serpents: '🐍 Serpents lumineux',
  sumo: '🥋 Sumo',
  reflexe: '⚡ Réflexe',
  pong: '🏓 Pong',
};

const lirePseudo = (): string => {
  try {
    return localStorage.getItem(CLE_PSEUDO) ?? localStorage.getItem('tutti.course.pseudo') ?? '';
  } catch {
    return '';
  }
};

interface Moi {
  id: string;
  pseudo: string;
  couleur: string;
}

export function ManettePage(): JSX.Element {
  const { code = '' } = useParams();
  const [pseudo, setPseudo] = useState(lirePseudo);
  const [moi, setMoi] = useState<Moi | null>(null);
  const [jeu, setJeu] = useState<JeuManette | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [etat, setEtat] = useState<EtatManette | null>(null);
  const [fermee, setFermee] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const pseudoRef = useRef<string | null>(null);

  const rejoindre = (p: string): void => {
    setErreur(null);
    socketRef.current?.emit(
      'manette:rejoindre',
      { code, pseudo: p },
      (r: { ok: boolean; erreur?: string; joueur?: Moi; jeu?: JeuManette }) => {
        if (r?.ok && r.joueur && r.jeu) {
          setMoi(r.joueur);
          setJeu(r.jeu);
          pseudoRef.current = p;
          try {
            localStorage.setItem(CLE_PSEUDO, p);
          } catch {
            /* rien */
          }
        } else setErreur(r?.erreur ?? 'Impossible de rejoindre');
      },
    );
  };
  const rejoindreRef = useRef(rejoindre);
  rejoindreRef.current = rejoindre;

  useEffect(() => {
    const s = connecterJeu();
    socketRef.current = s;
    s.on('manette:etat', (e: EtatManette) => setEtat(e));
    s.on('manette:fermee', () => setFermee(true));
    // Reconnexion : on reprend une place avec le même pseudo.
    s.on('connect', () => {
      if (pseudoRef.current) rejoindreRef.current(pseudoRef.current);
    });
    return () => {
      s.disconnect();
    };
  }, []);

  // Écran allumé pendant la partie (si le téléphone l'accepte).
  useEffect(() => {
    if (!moi) return;
    let verrou: { release: () => Promise<void> } | null = null;
    const nav = navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock
      ?.request('screen')
      .then((v) => {
        verrou = v;
      })
      .catch(() => undefined);
    return () => {
      void verrou?.release().catch(() => undefined);
    };
  }, [moi]);

  const emettre = useCallback((ev: string, data?: unknown, volatil = false): void => {
    const s = socketRef.current;
    if (!s) return;
    if (volatil) s.volatile.emit(ev, data);
    else s.emit(ev, data);
  }, []);

  if (fermee) {
    return (
      <div className="min-h-screen bg-[#0B0B0F] text-white flex items-center justify-center p-6 text-center">
        <p className="text-2xl">La TV a fermé la partie. Scanne le nouveau QR code.</p>
      </div>
    );
  }

  if (!moi || !jeu) {
    return (
      <div className="min-h-screen bg-[#0B0B0F] text-white flex flex-col items-center justify-center p-6 gap-4">
        <p className="font-display text-4xl">🎮 Manette</p>
        <p className="text-white/60">Salon {code.toUpperCase()}</p>
        <form
          className="w-full max-w-sm space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (pseudo.trim()) rejoindre(pseudo.trim());
          }}
        >
          <input
            value={pseudo}
            onChange={(e) => setPseudo(e.target.value)}
            maxLength={16}
            placeholder="Ton pseudo"
            className="w-full rounded-xl px-4 py-3 text-xl text-black"
            autoFocus
          />
          <button type="submit" disabled={!pseudo.trim()} className="w-full rounded-xl bg-[#FF5C4D] py-3 text-xl font-bold disabled:opacity-40">
            Jouer
          </button>
        </form>
        {erreur && <p className="text-[#FF5C4D]">{erreur}</p>}
      </div>
    );
  }

  const enJeu = etat?.phase === 'jeu' || etat?.phase === 'compte';
  const perso = etat?.perso?.[moi.id];
  const statut = perso ?? (etat?.phase === 'jeu' ? 'Tu joueras à la prochaine partie' : etat?.texte || 'En attente du départ');

  return (
    <div className="h-[100dvh] bg-[#0B0B0F] text-white flex flex-col p-3 gap-3 select-none" style={{ touchAction: 'none' }}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-xl truncate" style={{ color: moi.couleur }}>
          ● {moi.pseudo}
        </p>
        <p className="text-white/50 text-sm shrink-0">{NOMS[jeu]}</p>
      </div>
      <p className="font-mono text-lg text-center min-h-[1.75rem]">{etat?.phase === 'compte' ? 'Prêt…' : statut}</p>
      {!enJeu && jeu !== 'reflexe' && (
        <button type="button" onClick={() => emettre('manette:lancer')} className="rounded-xl bg-[#FF5C4D] py-3 text-xl font-bold">
          {etat?.phase === 'manche' ? 'Manche suivante ▶' : etat?.phase === 'fini' ? 'Rejouer ↻' : 'Lancer la partie ▶'}
        </button>
      )}
      {jeu === 'reflexe' && etat?.phase !== 'jeu' && (
        <button type="button" onClick={() => emettre('manette:lancer')} className="rounded-xl bg-[#FF5C4D] py-3 text-xl font-bold">
          {etat?.phase === 'fini' ? 'Rejouer ↻' : 'Lancer la partie ▶'}
        </button>
      )}
      <div className="flex-1 flex min-h-0">
        {jeu === 'serpents' && <ManetteVirages emettre={emettre} />}
        {jeu === 'sumo' && <ManetteJoystick emettre={emettre} />}
        {jeu === 'pong' && <ManetteGlissiere emettre={emettre} couleur={moi.couleur} />}
        {jeu === 'reflexe' && <ManetteReflexe emettre={emettre} etat={etat} />}
      </div>
    </div>
  );
}

type Emettre = (ev: string, data?: unknown, volatil?: boolean) => void;

/** Serpents : deux grandes zones, chaque appui = un quart de tour. */
function ManetteVirages({ emettre }: { emettre: Emettre }): JSX.Element {
  const [flash, setFlash] = useState<'g' | 'd' | null>(null);
  const appui = (cote: 'g' | 'd') => (e: React.PointerEvent): void => {
    e.preventDefault();
    emettre('manette:action', { type: cote });
    setFlash(cote);
    window.setTimeout(() => setFlash((f) => (f === cote ? null : f)), 120);
  };
  const zone = (actif: boolean): string =>
    `flex-1 flex items-center justify-center text-7xl rounded-3xl transition-colors ${actif ? 'bg-white/35' : 'bg-white/10'}`;
  return (
    <div className="flex-1 flex gap-3">
      <div className={zone(flash === 'g')} onPointerDown={appui('g')}>↰</div>
      <div className={zone(flash === 'd')} onPointerDown={appui('d')}>↱</div>
    </div>
  );
}

/** Sumo : joystick (pouce gauche) + bouton DASH. */
function ManetteJoystick({ emettre }: { emettre: Emettre }): JSX.Element {
  const zoneRef = useRef<HTMLDivElement>(null);
  const vecteur = useRef({ x: 0, y: 0 });
  const doigt = useRef<number | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [recharge, setRecharge] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => emettre('manette:cmd', vecteur.current, true), 60);
    return () => window.clearInterval(id);
  }, [emettre]);

  const maj = (e: React.PointerEvent): void => {
    const z = zoneRef.current?.getBoundingClientRect();
    if (!z) return;
    const r = Math.min(z.width, z.height) / 2;
    let x = (e.clientX - (z.left + z.width / 2)) / r;
    let y = (e.clientY - (z.top + z.height / 2)) / r;
    const n = Math.hypot(x, y);
    if (n > 1) {
      x /= n;
      y /= n;
    }
    vecteur.current = { x, y };
    setPos({ x, y });
  };
  const relache = (e: React.PointerEvent): void => {
    if (doigt.current !== e.pointerId) return;
    doigt.current = null;
    vecteur.current = { x: 0, y: 0 };
    setPos({ x: 0, y: 0 });
    emettre('manette:cmd', vecteur.current);
  };

  return (
    <div className="flex-1 flex flex-col gap-3 min-h-0">
      <div
        ref={zoneRef}
        className="flex-1 relative rounded-3xl bg-white/10 flex items-center justify-center"
        onPointerDown={(e) => {
          e.preventDefault();
          doigt.current = e.pointerId;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          maj(e);
        }}
        onPointerMove={(e) => {
          if (doigt.current === e.pointerId) maj(e);
        }}
        onPointerUp={relache}
        onPointerCancel={relache}
      >
        <div className="absolute rounded-full border-4 border-white/25" style={{ width: '70%', aspectRatio: '1 / 1', maxHeight: '90%' }} />
        <div
          className="absolute rounded-full bg-white/80 h-20 w-20 pointer-events-none"
          style={{ transform: `translate(${pos.x * 35}vmin, ${pos.y * 35}vmin)`, maxWidth: '30%' }}
        />
      </div>
      <button
        type="button"
        onPointerDown={(e) => {
          e.preventDefault();
          emettre('manette:action', { type: 'dash' });
          setRecharge(true);
          window.setTimeout(() => setRecharge(false), 2500);
        }}
        className={`rounded-3xl py-8 text-4xl font-black ${recharge ? 'bg-white/10 text-white/40' : 'bg-[#FF5C4D]'}`}
      >
        DASH 💨
      </button>
    </div>
  );
}

/** Pong : glissière verticale, la position du doigt = la raquette. */
function ManetteGlissiere({ emettre, couleur }: { emettre: Emettre; couleur: string }): JSX.Element {
  const zoneRef = useRef<HTMLDivElement>(null);
  const y = useRef(0);
  const doigt = useRef<number | null>(null);
  const [aff, setAff] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => emettre('manette:cmd', { y: y.current }, true), 50);
    return () => window.clearInterval(id);
  }, [emettre]);

  const maj = (e: React.PointerEvent): void => {
    const z = zoneRef.current?.getBoundingClientRect();
    if (!z) return;
    const v = Math.max(-1, Math.min(1, ((e.clientY - z.top) / z.height) * 2 - 1));
    y.current = v;
    setAff(v);
  };

  return (
    <div
      ref={zoneRef}
      className="flex-1 relative rounded-3xl bg-white/10"
      onPointerDown={(e) => {
        e.preventDefault();
        doigt.current = e.pointerId;
        (e.target as Element).setPointerCapture?.(e.pointerId);
        maj(e);
      }}
      onPointerMove={(e) => {
        if (doigt.current === e.pointerId) maj(e);
      }}
      onPointerUp={() => {
        doigt.current = null;
      }}
      onPointerCancel={() => {
        doigt.current = null;
      }}
    >
      <div
        className="absolute left-1/2 w-1/3 h-[18%] -translate-x-1/2 -translate-y-1/2 rounded-xl pointer-events-none"
        style={{ top: `${((aff + 1) / 2) * 100}%`, background: couleur }}
      />
      <p className="absolute bottom-3 inset-x-0 text-center text-white/40 text-sm pointer-events-none">Glisse le doigt de haut en bas</p>
    </div>
  );
}

/** Réflexe : tout l'écran. Le temps est mesuré ici, du vert au doigt. */
function ManetteReflexe({ emettre, etat }: { emettre: Emettre; etat: EtatManette | null }): JSX.Element {
  const r = etat?.phase === 'jeu' ? etat.reflexe : undefined;
  const manche = r?.manche ?? 0;
  const etape = r?.etape ?? '';
  const vertDepuis = useRef<{ manche: number; t: number } | null>(null);
  const [joue, setJoue] = useState<{ manche: number; texte: string } | null>(null);

  // Le chrono démarre quand le vert s'affiche sur CE téléphone.
  useEffect(() => {
    if (etape === 'go' && vertDepuis.current?.manche !== manche) {
      vertDepuis.current = { manche, t: performance.now() };
      try {
        navigator.vibrate?.(40);
      } catch {
        /* rien */
      }
    }
  }, [etape, manche]);

  const dejaJoue = joue?.manche === manche;
  const tape = (e: React.PointerEvent): void => {
    e.preventDefault();
    if (!r || dejaJoue) return;
    if (etape === 'go' && vertDepuis.current?.manche === manche) {
      const ms = Math.round(performance.now() - vertDepuis.current.t);
      emettre('manette:action', { type: 'tap', manche, ms });
      setJoue({ manche, texte: `${ms} ms` });
    } else if (etape === 'pret' || etape === 'piege') {
      emettre('manette:action', { type: 'faux', manche });
      setJoue({ manche, texte: 'Faux départ !' });
    }
  };

  const fond = !r
    ? 'bg-white/10'
    : etape === 'go'
      ? 'bg-[#1fae5b]'
      : etape === 'piege'
        ? 'bg-[#f2994a]'
        : etape === 'pret'
          ? 'bg-[#b3261e]'
          : 'bg-white/10';
  const texte = !r
    ? 'En attente'
    : dejaJoue
      ? joue!.texte
      : etape === 'go'
        ? 'TAPE !'
        : etape === 'piege'
          ? 'PIÈGE — ne tape pas'
          : etape === 'pret'
            ? 'Attends le vert…'
            : `Manche ${manche}`;

  return (
    <div className={`flex-1 rounded-3xl flex items-center justify-center text-center p-4 ${fond}`} onPointerDown={tape}>
      <p className="font-display text-5xl">{texte}</p>
    </div>
  );
}
