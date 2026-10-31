/**
 * /course/:code — feat/course-test
 * Le téléphone devient volant : deux grandes zones ◀ ▶ (on peut appuyer des
 * deux pouces), accélération automatique, les deux en même temps = frein.
 */
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { connecterJeu } from '../../lib/socket.js';

interface Etat {
  phase: 'attente' | 'compte' | 'course' | 'fini';
  tours: number;
  voitures: Array<{ id: string; rang: number; tour: number; fini: boolean }>;
}

const CLE_PSEUDO = 'tutti.course.pseudo';

export function CourseManettePage(): JSX.Element {
  const { code = '' } = useParams();
  const [pseudo, setPseudo] = useState<string>(() => {
    try {
      return localStorage.getItem(CLE_PSEUDO) ?? '';
    } catch {
      return '';
    }
  });
  const [moi, setMoi] = useState<{ id: string; couleur: string; pseudo: string } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [etat, setEtat] = useState<Etat | null>(null);
  const [fermee, setFermee] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const cmd = useRef({ g: false, d: false });
  const pointeurs = useRef(new Map<number, 'g' | 'd'>());
  const [appui, setAppui] = useState({ g: false, d: false });

  useEffect(() => {
    const s = connecterJeu();
    socketRef.current = s;
    s.on('course:etat', (e: Etat) => setEtat(e));
    s.on('course:fermee', () => setFermee(true));
    // Reconnexion : on reprend sa place avec le même pseudo.
    s.on('connect', () => {
      const p = (() => {
        try {
          return localStorage.getItem(CLE_PSEUDO);
        } catch {
          return null;
        }
      })();
      if (p && moiRef.current) rejoindre(p);
    });
    const id = window.setInterval(() => {
      s.volatile.emit('course:cmd', cmd.current);
    }, 150);
    return () => {
      window.clearInterval(id);
      s.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const moiRef = useRef(moi);
  moiRef.current = moi;

  const rejoindre = (p: string): void => {
    setErreur(null);
    socketRef.current?.emit(
      'course:rejoindre',
      { code, pseudo: p },
      (r: { ok: boolean; erreur?: string; joueur?: { id: string; couleur: string; pseudo: string } }) => {
        if (r?.ok && r.joueur) {
          setMoi(r.joueur);
          try {
            localStorage.setItem(CLE_PSEUDO, p);
          } catch {
            /* rien */
          }
        } else setErreur(r?.erreur ?? 'Impossible de rejoindre');
      },
    );
  };

  const majCmd = (): void => {
    const vals = [...pointeurs.current.values()];
    const n = { g: vals.includes('g'), d: vals.includes('d') };
    if (n.g !== cmd.current.g || n.d !== cmd.current.d) {
      cmd.current = n;
      setAppui(n);
      socketRef.current?.emit('course:cmd', n);
    }
  };
  const bas = (cote: 'g' | 'd') => (e: React.PointerEvent): void => {
    e.preventDefault();
    pointeurs.current.set(e.pointerId, cote);
    majCmd();
  };
  const haut = (e: React.PointerEvent): void => {
    pointeurs.current.delete(e.pointerId);
    majCmd();
  };

  if (fermee) {
    return (
      <div className="min-h-screen bg-[#0B0B0F] text-white flex items-center justify-center p-6 text-center">
        <p className="text-2xl">La TV a fermé la course. Scanne le nouveau QR code.</p>
      </div>
    );
  }

  if (!moi) {
    return (
      <div className="min-h-screen bg-[#0B0B0F] text-white flex flex-col items-center justify-center p-6 gap-4">
        <p className="font-display text-4xl">🏎️ Course</p>
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
            placeholder="Ton nom de pilote"
            className="w-full rounded-xl px-4 py-3 text-xl text-black"
            autoFocus
          />
          <button type="submit" disabled={!pseudo.trim()} className="w-full rounded-xl bg-[#FF5C4D] py-3 text-xl font-bold disabled:opacity-40">
            Prendre le volant
          </button>
        </form>
        {erreur && <p className="text-[#FF5C4D]">{erreur}</p>}
      </div>
    );
  }

  const mien = etat?.voitures.find((v) => v.id === moi.id);
  const zone = (actif: boolean): string =>
    `flex-1 flex items-center justify-center text-7xl select-none rounded-3xl transition-colors ${actif ? 'bg-white/30' : 'bg-white/10'}`;

  return (
    <div className="h-[100dvh] bg-[#0B0B0F] text-white flex flex-col p-3 gap-3 select-none" style={{ touchAction: 'none' }}>
      <div className="flex items-center justify-between">
        <p className="font-semibold text-xl" style={{ color: moi.couleur }}>
          ● {moi.pseudo}
        </p>
        <p className="font-mono text-lg">
          {etat?.phase === 'course' && mien
            ? `${mien.fini ? '🏁' : `Tour ${mien.tour}/${etat.tours}`} · ${mien.rang}${mien.rang === 1 ? 'er' : 'e'}`
            : etat?.phase === 'compte'
              ? 'Prêt…'
              : etat?.phase === 'fini' && mien
                ? `Arrivée : ${mien.rang}${mien.rang === 1 ? 'er' : 'e'}`
                : 'En attente du départ'}
        </p>
      </div>
      {(etat?.phase === 'attente' || etat?.phase === 'fini' || !etat) && (
        <button
          type="button"
          onClick={() => socketRef.current?.emit('course:lancer')}
          className="rounded-xl bg-[#FF5C4D] py-3 text-xl font-bold"
        >
          {etat?.phase === 'fini' ? 'Rejouer ↻' : 'Lancer la course ▶'}
        </button>
      )}
      <div className="flex-1 flex gap-3">
        <div className={zone(appui.g)} onPointerDown={bas('g')} onPointerUp={haut} onPointerCancel={haut} onPointerLeave={haut}>
          ◀
        </div>
        <div className={zone(appui.d)} onPointerDown={bas('d')} onPointerUp={haut} onPointerCancel={haut} onPointerLeave={haut}>
          ▶
        </div>
      </div>
      <p className="text-center text-white/50 text-sm">Les deux en même temps = frein. Ça accélère tout seul.</p>
    </div>
  );
}
