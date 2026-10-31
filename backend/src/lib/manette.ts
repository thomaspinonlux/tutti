/**
 * manette.ts — feat/jeux-manette
 *
 * Relais générique des jeux « téléphone-manette » (en TEST, cachés) :
 * serpents, sumo, réflexe, pong. Même principe que la course :
 *   - la TV ouvre un salon (code de 4 lettres) pour UN jeu et calcule tout ;
 *   - chaque téléphone rejoint le salon et envoie ses commandes ;
 *   - le serveur RELAIE, il ne calcule rien.
 * Tout est en mémoire. Aucun lien avec les parties de blind test / quiz.
 */
import type { Socket } from 'socket.io';
import { ajouterGestionnaireSocket, getIO, type SocketIdentity } from '../socket/index.js';

export const JEUX = ['serpents', 'sumo', 'reflexe', 'pong'] as const;
export type JeuManette = (typeof JEUX)[number];

const LETTRES = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_JOUEURS: Record<JeuManette, number> = { serpents: 8, sumo: 8, reflexe: 12, pong: 4 };
const COULEURS = [
  '#FF5C4D', '#2F80ED', '#3FB47A', '#F2C94C', '#9B51E0', '#F2994A',
  '#56CCF2', '#EB5757', '#6FCF97', '#BB6BD9', '#F2F2F2', '#219653',
];

interface Joueur {
  id: string; // socket id
  pseudo: string;
  couleur: string;
}
interface Salon {
  code: string;
  jeu: JeuManette;
  tv: string;
  joueurs: Map<string, Joueur>;
  creeLe: number;
}

const salons = new Map<string, Salon>();
const salle = (code: string): string => `manette:${code}`;

function nouveauCode(): string {
  for (let essai = 0; essai < 50; essai++) {
    const c = Array.from({ length: 4 }, () => LETTRES[Math.floor(Math.random() * LETTRES.length)]).join('');
    if (!salons.has(c)) return c;
  }
  return String(Date.now()).slice(-4);
}

function purger(): void {
  const limite = Date.now() - 6 * 60 * 60 * 1000;
  for (const [c, s] of salons) if (s.creeLe < limite) salons.delete(c);
}

const borne = (v: unknown, min: number, max: number): number | undefined => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  return n === undefined ? undefined : Math.min(max, Math.max(min, n));
};

/** Ne garde que des champs connus et bornés (un téléphone ne peut rien injecter d'autre). */
export function nettoyerCmd(c: unknown): { g: boolean; d: boolean; x?: number; y?: number } {
  const o = (c ?? {}) as Record<string, unknown>;
  const r: { g: boolean; d: boolean; x?: number; y?: number } = { g: o.g === true, d: o.d === true };
  const x = borne(o.x, -1, 1);
  const y = borne(o.y, -1, 1);
  if (x !== undefined) r.x = x;
  if (y !== undefined) r.y = y;
  return r;
}

export function nettoyerAction(a: unknown): { type: string; manche?: number; ms?: number } | null {
  const o = (a ?? {}) as Record<string, unknown>;
  const type = typeof o.type === 'string' ? o.type.replace(/[^a-z]/g, '').slice(0, 10) : '';
  if (!type) return null;
  const r: { type: string; manche?: number; ms?: number } = { type };
  const manche = borne(o.manche, 0, 1000);
  const ms = borne(o.ms, 0, 60_000);
  if (manche !== undefined) r.manche = Math.round(manche);
  if (ms !== undefined) r.ms = Math.round(ms);
  return r;
}

ajouterGestionnaireSocket((socket: Socket, identity: SocketIdentity) => {
  if (identity.kind !== 'jeu') return;
  let monSalon: string | null = null;
  let jeSuisTv = false;
  // Anti-rafale : 40 actions par seconde au plus.
  let fenetre = 0;
  let compte = 0;

  socket.on('manette:ouvrir', (p: { jeu?: string }, ack?: (r: unknown) => void) => {
    const jeu = JEUX.find((j) => j === p?.jeu);
    if (!jeu) return ack?.({ ok: false, erreur: 'Jeu inconnu' });
    purger();
    const code = nouveauCode();
    salons.set(code, { code, jeu, tv: socket.id, joueurs: new Map(), creeLe: Date.now() });
    monSalon = code;
    jeSuisTv = true;
    void socket.join(salle(code));
    ack?.({ ok: true, code });
  });

  socket.on('manette:rejoindre', (p: { code?: string; pseudo?: string }, ack?: (r: unknown) => void) => {
    const code = String(p?.code ?? '').toUpperCase().slice(0, 6);
    const s = salons.get(code);
    if (!s) return ack?.({ ok: false, erreur: 'Salon introuvable — vérifie le code sur la TV' });
    const max = MAX_JOUEURS[s.jeu];
    if (s.joueurs.size >= max && !s.joueurs.has(socket.id)) {
      return ack?.({ ok: false, erreur: `Partie complète (${max} joueurs)` });
    }
    const pris = new Set([...s.joueurs.values()].map((j) => j.couleur));
    const couleur = COULEURS.find((c) => !pris.has(c)) ?? COULEURS[0]!;
    const pseudo = String(p?.pseudo ?? '').replace(/\s+/g, ' ').trim().slice(0, 16) || 'Joueur';
    const j: Joueur = { id: socket.id, pseudo, couleur };
    s.joueurs.set(socket.id, j);
    monSalon = code;
    void socket.join(salle(code));
    getIO().to(s.tv).emit('manette:joueur', j);
    ack?.({ ok: true, joueur: j, jeu: s.jeu });
  });

  // Commandes continues (joystick, position) : pertes acceptées.
  socket.on('manette:cmd', (c: unknown) => {
    if (!monSalon || jeSuisTv) return;
    const s = salons.get(monSalon);
    if (!s || !s.joueurs.has(socket.id)) return;
    getIO().to(s.tv).volatile.emit('manette:cmd', { id: socket.id, ...nettoyerCmd(c) });
  });

  // Actions ponctuelles (virage, tape, dash) : livrées à coup sûr.
  socket.on('manette:action', (a: unknown) => {
    if (!monSalon || jeSuisTv) return;
    const s = salons.get(monSalon);
    if (!s || !s.joueurs.has(socket.id)) return;
    const t = Date.now();
    if (t - fenetre > 1000) {
      fenetre = t;
      compte = 0;
    }
    if (++compte > 40) return;
    const propre = nettoyerAction(a);
    if (propre) getIO().to(s.tv).emit('manette:action', { id: socket.id, ...propre });
  });

  socket.on('manette:lancer', () => {
    if (!monSalon || jeSuisTv) return;
    const s = salons.get(monSalon);
    if (s?.joueurs.has(socket.id)) getIO().to(s.tv).emit('manette:lancer');
  });

  // État de la TV → téléphones (la TV en règle elle-même la fréquence).
  socket.on('manette:etat', (e: unknown) => {
    if (!monSalon || !jeSuisTv) return;
    socket.to(salle(monSalon)).emit('manette:etat', e);
  });

  socket.on('disconnect', () => {
    if (!monSalon) return;
    const s = salons.get(monSalon);
    if (!s) return;
    if (jeSuisTv) {
      socket.to(salle(monSalon)).emit('manette:fermee');
      salons.delete(monSalon);
      return;
    }
    s.joueurs.delete(socket.id);
    getIO().to(s.tv).emit('manette:depart', { id: socket.id });
  });
});

/** Pour les tests : nombre de salons ouverts. */
export function nombreDeSalonsManette(): number {
  return salons.size;
}
