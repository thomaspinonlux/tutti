/**
 * salonManette.ts — feat/jeux-manette
 * Côté TV : ouvre un salon pour un jeu, tient la liste des joueurs et
 * remonte les commandes / actions des téléphones (relais backend manette.ts).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { connecterJeu } from '../socket.js';

export type JeuManette = 'serpents' | 'sumo' | 'reflexe' | 'pong' | 'kart' | 'sprint' | 'ski' | 'tamponneuses' | 'moto';

export interface JoueurSalon {
  id: string;
  pseudo: string;
  couleur: string;
}
export interface CmdManette {
  id: string;
  g: boolean;
  d: boolean;
  x?: number;
  y?: number;
}
export interface ActionManette {
  id: string;
  type: string;
  manche?: number;
  ms?: number;
}

/** État envoyé aux téléphones (forme commune à tous les jeux). */
export interface EtatManette {
  /** 'attente' | 'compte' | 'jeu' | 'manche' | 'fini' — le téléphone affiche « Lancer » hors 'compte' / 'jeu'. */
  phase: string;
  texte?: string;
  perso?: Record<string, string>;
  reflexe?: { etape: string; manche: number };
}

interface Gestionnaires {
  cmd?: (m: CmdManette) => void;
  action?: (m: ActionManette) => void;
  lancer?: () => void;
  depart?: (id: string) => void;
}

export function useSalonTv(jeu: JeuManette, g: Gestionnaires) {
  const [code, setCode] = useState<string | null>(null);
  const [joueurs, setJoueurs] = useState<JoueurSalon[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const gRef = useRef(g);
  gRef.current = g;
  const joueursRef = useRef(joueurs);
  joueursRef.current = joueurs;

  useEffect(() => {
    const s = connecterJeu();
    socketRef.current = s;
    s.on('connect', () => {
      s.emit('manette:ouvrir', { jeu }, (r: { ok: boolean; code?: string }) => {
        if (r?.ok && r.code) {
          setCode(r.code);
          setJoueurs([]);
        }
      });
    });
    s.on('manette:joueur', (j: JoueurSalon) => setJoueurs((l) => [...l.filter((x) => x.id !== j.id), j]));
    s.on('manette:depart', (m: { id: string }) => {
      setJoueurs((l) => l.filter((x) => x.id !== m.id));
      gRef.current.depart?.(m.id);
    });
    s.on('manette:cmd', (m: CmdManette) => gRef.current.cmd?.(m));
    s.on('manette:action', (m: ActionManette) => gRef.current.action?.(m));
    s.on('manette:lancer', () => gRef.current.lancer?.());
    return () => {
      s.disconnect();
    };
  }, [jeu]);

  const envoyerEtat = useCallback((e: EtatManette) => {
    socketRef.current?.emit('manette:etat', e);
  }, []);

  return { code, joueurs, joueursRef, envoyerEtat };
}

/** Boucle d'animation : fn(dt en s, t en ms). */
export function useBoucle(fn: (dt: number, t: number) => void): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let id = 0;
    let avant = performance.now();
    const tour = (t: number): void => {
      const dt = Math.min(0.05, (t - avant) / 1000);
      avant = t;
      try {
        fnRef.current(dt, t);
      } catch (err) {
        console.error('[jeux] boucle en échec :', err);
      }
      id = requestAnimationFrame(tour);
    };
    id = requestAnimationFrame(tour);
    return () => cancelAnimationFrame(id);
  }, []);
}
