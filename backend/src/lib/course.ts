/**
 * course.ts — feat/course-test
 *
 * Premier jeu « téléphone-manette » en TEST : une course de voitures.
 *   - la TV ouvre un salon (code de 4 lettres) et fait tourner la course ;
 *   - chaque téléphone rejoint le salon et envoie ses commandes (gauche,
 *     droite) ; le serveur les RELAIE à la TV, il ne calcule rien.
 * Le serveur ne garde que le strict minimum (qui est dans quel salon), en
 * mémoire. Aucun lien avec les parties de blind test / quiz.
 */
import type { Socket } from 'socket.io';
import { ajouterGestionnaireSocket, getIO, type SocketIdentity } from '../socket/index.js';

const LETTRES = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_JOUEURS = 8;
const COULEURS = ['#FF5C4D', '#2F80ED', '#3FB47A', '#F2C94C', '#9B51E0', '#F2994A', '#56CCF2', '#EB5757'];

interface Joueur {
  id: string; // socket id
  pseudo: string;
  couleur: string;
}
interface Salon {
  code: string;
  tv: string; // socket id de la TV
  joueurs: Map<string, Joueur>;
  creeLe: number;
}

const salons = new Map<string, Salon>();
const salle = (code: string): string => `course:${code}`;

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

function listeJoueurs(s: Salon): Joueur[] {
  return [...s.joueurs.values()];
}

ajouterGestionnaireSocket((socket: Socket, identity: SocketIdentity) => {
  if (identity.kind !== 'jeu') return;
  let monSalon: string | null = null;
  let jeSuisTv = false;

  // ── La TV ouvre un salon ────────────────────────────────────────────────
  socket.on('course:ouvrir', (_p: unknown, ack?: (r: unknown) => void) => {
    purger();
    const code = nouveauCode();
    salons.set(code, { code, tv: socket.id, joueurs: new Map(), creeLe: Date.now() });
    monSalon = code;
    jeSuisTv = true;
    void socket.join(salle(code));
    ack?.({ ok: true, code });
  });

  // ── Un téléphone rejoint ────────────────────────────────────────────────
  socket.on('course:rejoindre', (p: { code?: string; pseudo?: string }, ack?: (r: unknown) => void) => {
    const code = String(p?.code ?? '').toUpperCase().slice(0, 6);
    const s = salons.get(code);
    if (!s) return ack?.({ ok: false, erreur: 'Salon introuvable — vérifie le code sur la TV' });
    if (s.joueurs.size >= MAX_JOUEURS && !s.joueurs.has(socket.id)) {
      return ack?.({ ok: false, erreur: `Course complète (${MAX_JOUEURS} joueurs)` });
    }
    const pris = new Set(listeJoueurs(s).map((j) => j.couleur));
    const couleur = COULEURS.find((c) => !pris.has(c)) ?? COULEURS[0]!;
    const pseudo = String(p?.pseudo ?? '').replace(/\s+/g, ' ').trim().slice(0, 16) || 'Pilote';
    const j: Joueur = { id: socket.id, pseudo, couleur };
    s.joueurs.set(socket.id, j);
    monSalon = code;
    void socket.join(salle(code));
    getIO().to(s.tv).emit('course:joueur', j);
    ack?.({ ok: true, joueur: j });
  });

  // ── Commandes du téléphone → TV (relais pur, pertes acceptées) ─────────
  socket.on('course:cmd', (c: { g?: unknown; d?: unknown }) => {
    if (!monSalon || jeSuisTv) return;
    const s = salons.get(monSalon);
    if (!s || !s.joueurs.has(socket.id)) return;
    getIO()
      .to(s.tv)
      .volatile.emit('course:cmd', { id: socket.id, g: c?.g === true, d: c?.d === true });
  });

  // ── Un pilote demande le départ (ou la revanche) ────────────────────────
  socket.on('course:lancer', () => {
    if (!monSalon || jeSuisTv) return;
    const s = salons.get(monSalon);
    if (s?.joueurs.has(socket.id)) getIO().to(s.tv).emit('course:lancer');
  });

  // ── La TV renvoie l'état aux téléphones (rang, tour, départ, fin) ───────
  socket.on('course:etat', (e: unknown) => {
    if (!monSalon || !jeSuisTv) return;
    socket.to(salle(monSalon)).volatile.emit('course:etat', e);
  });

  socket.on('disconnect', () => {
    if (!monSalon) return;
    const s = salons.get(monSalon);
    if (!s) return;
    if (jeSuisTv) {
      socket.to(salle(monSalon)).emit('course:fermee');
      salons.delete(monSalon);
      return;
    }
    s.joueurs.delete(socket.id);
    getIO().to(s.tv).emit('course:depart', { id: socket.id });
  });
});

/** Pour les tests : nombre de salons ouverts. */
export function nombreDeSalons(): number {
  return salons.size;
}
