/**
 * dessin.ts — feat/dessin-a-deviner
 *
 * Le jeu « Dessin à deviner » vit DANS le quiz : c'est un thème comme un
 * autre, dont les questions sont de type DRAWING. On garde donc tout ce que
 * le quiz sait déjà faire (QR code, joueurs, manette, manches, points,
 * podium) et ce module n'ajoute que ce qui est propre au dessin :
 *
 *   - le choix du dessinateur, à tour de rôle ;
 *   - le mot, envoyé AU SEUL dessinateur (jamais dans l'état public) ;
 *   - les traits, reçus du téléphone du dessinateur et rediffusés à la salle ;
 *   - les propositions : plusieurs essais par joueur, la bonne est comptée
 *     tout de suite, les mauvaises s'affichent sur la TV.
 *
 * État en mémoire, comme le quiz (V0 : un seul processus Railway).
 */
import type { Socket } from 'socket.io';
import type { EtatDessinPublic, TraitDessin } from '@tutti/shared';
import { prisma } from './prisma.js';
import {
  ajouterGestionnaireSocket,
  broadcastToSession,
  getIO,
  participantEstConnecte,
  participantRoomName,
  type SocketIdentity,
} from '../socket/index.js';
import { getActiveQuestion, trySubmitAnswer } from './gameStateQuizz.js';
import { comparerProposition, type MotADeviner } from './dessinComparaison.js';

export type { MotADeviner } from './dessinComparaison.js';

interface EtatDessin {
  questionIndex: number;
  dessinateurId: string;
  dessinateurPseudo: string;
  mot: MotADeviner;
  traits: TraitDessin[];
  nbPoints: number;
  trouves: Array<{ participant_id: string; pseudo: string }>;
  propositions: Array<{ pseudo: string; texte: string }>;
  dernierEssai: Map<string, number>;
  creeLe: number;
}

const etats = new Map<string /* session_id */, EtatDessin>();
/** Qui a déjà dessiné depuis le début du tour de table, par partie. */
const dejaDessine = new Map<string /* session_id */, Set<string>>();

// ── Limites (un téléphone ne doit pas pouvoir saturer le serveur) ─────────
const MAX_POINTS_PAR_ENVOI = 400;
const MAX_POINTS_TOTAL = 40_000;
const MAX_TRAITS = 2_000;
const DELAI_ENTRE_ESSAIS_MS = 600;
const MAX_PROPOSITIONS_GARDEES = 30;
const DUREE_DE_VIE_MS = 12 * 60 * 60 * 1000;
const COULEUR = /^#[0-9a-fA-F]{6}$/;

// Le mot (masque et comparaison) vit dans dessinComparaison.ts : fonctions
// pures, testées sans base ni socket.
export { masquerMot, comparerProposition } from './dessinComparaison.js';

// ── Le dessinateur ────────────────────────────────────────────────────────

/**
 * Le prochain dessinateur : chacun son tour, dans l'ordre d'arrivée. Seuls
 * les joueurs (un animateur qui voit les réponses ne joue pas) ; de
 * préférence ceux dont le téléphone est connecté. null s'il n'y a pas au
 * moins deux joueurs (il faut quelqu'un pour deviner).
 */
export async function choisirDessinateur(
  sessionId: string,
): Promise<{ id: string; pseudo: string } | null> {
  const joueurs = await prisma.participant.findMany({
    where: { session_id: sessionId, is_kicked: false, role: { not: 'ANIMATOR_FULL' } },
    orderBy: { joined_at: 'asc' },
    select: { id: true, pseudo: true },
  });
  if (joueurs.length < 2) return null;
  const connectes: typeof joueurs = [];
  for (const j of joueurs) {
    if (await participantEstConnecte(j.id)) connectes.push(j);
  }
  const candidats = connectes.length > 0 ? connectes : joueurs;
  let tour = dejaDessine.get(sessionId);
  if (!tour) {
    tour = new Set();
    dejaDessine.set(sessionId, tour);
  }
  let choisi = candidats.find((j) => !tour!.has(j.id));
  if (!choisi) {
    // Tout le monde est passé : nouveau tour de table.
    tour.clear();
    choisi = candidats[0]!;
  }
  tour.add(choisi.id);
  return choisi;
}

// ── Cycle d'une question ──────────────────────────────────────────────────

function purgerVieux(): void {
  const limite = Date.now() - DUREE_DE_VIE_MS;
  for (const [id, e] of etats) {
    if (e.creeLe < limite) {
      etats.delete(id);
      dejaDessine.delete(id);
    }
  }
}

/** Ouvre le dessin d'une question et envoie le mot au seul dessinateur. */
export function demarrerDessin(
  sessionId: string,
  questionIndex: number,
  mot: MotADeviner,
  dessinateur: { id: string; pseudo: string },
): void {
  purgerVieux();
  etats.set(sessionId, {
    questionIndex,
    dessinateurId: dessinateur.id,
    dessinateurPseudo: dessinateur.pseudo,
    mot,
    traits: [],
    nbPoints: 0,
    trouves: [],
    propositions: [],
    dernierEssai: new Map(),
    creeLe: Date.now(),
  });
  envoyerMot(sessionId, dessinateur.id);
}

function envoyerMot(sessionId: string, participantId: string): void {
  const e = etats.get(sessionId);
  if (!e || e.dessinateurId !== participantId) return;
  try {
    getIO()
      .to(participantRoomName(participantId))
      .emit('dessin:mot', { question_index: e.questionIndex, mot: e.mot.answer_lang1 });
  } catch {
    /* socket pas prêt : le téléphone le redemandera */
  }
}

/** Une question qui n'est pas un dessin commence : on ferme le précédent. */
export function fermerDessin(sessionId: string): void {
  etats.delete(sessionId);
}

/** Le mot, pour le dessinateur seulement (reprise après rechargement). */
export function motPourDessinateur(
  sessionId: string,
  participantId: string,
): { question_index: number; mot: string } | null {
  const e = etats.get(sessionId);
  if (!e || e.dessinateurId !== participantId) return null;
  return { question_index: e.questionIndex, mot: e.mot.answer_lang1 };
}

/** Ce que tout le monde peut voir : traits, qui a trouvé, propositions. */
export function etatPublic(sessionId: string): EtatDessinPublic | null {
  const e = etats.get(sessionId);
  if (!e) return null;
  return {
    question_index: e.questionIndex,
    dessinateur: { participant_id: e.dessinateurId, pseudo: e.dessinateurPseudo },
    traits: e.traits,
    trouves: e.trouves,
    propositions: e.propositions,
  };
}

/** Pour le décompte des points à la révélation. */
export function bilanDessin(
  sessionId: string,
  questionIndex: number,
): { dessinateurId: string; dessinateurPseudo: string; trouves: number } | null {
  const e = etats.get(sessionId);
  if (!e || e.questionIndex !== questionIndex) return null;
  return { dessinateurId: e.dessinateurId, dessinateurPseudo: e.dessinateurPseudo, trouves: e.trouves.length };
}

/** Le dessin en cours accepte-t-il encore des traits ou des propositions ? */
function dessinOuvert(sessionId: string, questionIndex?: number): EtatDessin | null {
  const e = etats.get(sessionId);
  const q = getActiveQuestion(sessionId);
  if (!e || !q || q.question_type !== 'DRAWING') return null;
  if (q.question_index !== e.questionIndex || q.phase !== 'asking') return null;
  if (Date.now() - q.started_at_ms > q.time_limit_ms) return null;
  if (questionIndex !== undefined && questionIndex !== e.questionIndex) return null;
  return e;
}

// ── Les traits ────────────────────────────────────────────────────────────

interface EnvoiTrait {
  q?: unknown;
  i?: unknown;
  c?: unknown;
  w?: unknown;
  p?: unknown;
}

function coordonnees(p: unknown): number[] | null {
  if (!Array.isArray(p) || p.length === 0 || p.length % 2 !== 0 || p.length > MAX_POINTS_PAR_ENVOI * 2) {
    return null;
  }
  const out: number[] = [];
  for (const v of p) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    out.push(Math.max(0, Math.min(1000, Math.round(n))));
  }
  return out;
}

/**
 * Un morceau de trait venu du téléphone du dessinateur. `i` = numéro du
 * trait : égal au nombre de traits = nouveau trait (couleur et épaisseur
 * obligatoires), égal au dernier = suite du trait en cours. Tout le reste
 * est ignoré (envoi en retard, rejoué, ou d'un autre joueur).
 */
export function ajouterTrait(sessionId: string, participantId: string, envoi: EnvoiTrait): boolean {
  const q = typeof envoi.q === 'number' ? envoi.q : undefined;
  const e = dessinOuvert(sessionId, q);
  if (!e || e.dessinateurId !== participantId) return false;
  const pts = coordonnees(envoi.p);
  if (!pts) return false;
  if (e.nbPoints + pts.length / 2 > MAX_POINTS_TOTAL) return false;
  const i = Number(envoi.i);
  let trait: TraitDessin;
  if (i === e.traits.length) {
    if (e.traits.length >= MAX_TRAITS) return false;
    const c = typeof envoi.c === 'string' && COULEUR.test(envoi.c) ? envoi.c : null;
    const w = Number(envoi.w);
    if (!c || !Number.isFinite(w)) return false;
    trait = { c, w: Math.max(2, Math.min(60, Math.round(w))), p: [] };
    e.traits.push(trait);
  } else if (i === e.traits.length - 1 && i >= 0) {
    trait = e.traits[i]!;
  } else {
    return false;
  }
  trait.p.push(...pts);
  e.nbPoints += pts.length / 2;
  broadcastToSession(sessionId, 'dessin:trait', {
    q: e.questionIndex,
    i,
    c: trait.c,
    w: trait.w,
    p: pts,
  });
  return true;
}

export function effacerDessin(sessionId: string, participantId: string): boolean {
  const e = dessinOuvert(sessionId);
  if (!e || e.dessinateurId !== participantId) return false;
  e.traits = [];
  e.nbPoints = 0;
  broadcastToSession(sessionId, 'dessin:effacer', { q: e.questionIndex });
  return true;
}

export function annulerTrait(sessionId: string, participantId: string): boolean {
  const e = dessinOuvert(sessionId);
  if (!e || e.dessinateurId !== participantId || e.traits.length === 0) return false;
  const retire = e.traits.pop()!;
  e.nbPoints -= retire.p.length / 2;
  broadcastToSession(sessionId, 'dessin:annuler', { q: e.questionIndex, n: e.traits.length });
  return true;
}

// ── Les propositions ──────────────────────────────────────────────────────

export type ResultatProposition =
  | { statut: 'trouve'; rang: number; allAnswered: boolean }
  | { statut: 'proche' }
  | { statut: 'rate' }
  | { statut: 'refuse'; raison: 'PAS_DE_DESSIN' | 'DESSINATEUR' | 'DEJA_TROUVE' | 'TROP_VITE' };

export function proposer(
  sessionId: string,
  participantId: string,
  pseudo: string,
  texte: string,
): ResultatProposition {
  const e = dessinOuvert(sessionId);
  if (!e) return { statut: 'refuse', raison: 'PAS_DE_DESSIN' };
  if (participantId === e.dessinateurId) return { statut: 'refuse', raison: 'DESSINATEUR' };
  if (e.trouves.some((t) => t.participant_id === participantId)) {
    return { statut: 'refuse', raison: 'DEJA_TROUVE' };
  }
  const maintenant = Date.now();
  const avant = e.dernierEssai.get(participantId) ?? 0;
  if (maintenant - avant < DELAI_ENTRE_ESSAIS_MS) return { statut: 'refuse', raison: 'TROP_VITE' };
  e.dernierEssai.set(participantId, maintenant);

  const verdict = comparerProposition(e.mot, texte);
  if (verdict === 'oui') {
    // On enregistre le MOT (pas la phrase du joueur) : la révélation le
    // recompare et compte les points avec le bonus de vitesse habituel.
    const r = trySubmitAnswer(sessionId, participantId, e.mot.answer_lang1);
    if (!r.ok) return { statut: 'refuse', raison: 'PAS_DE_DESSIN' };
    e.trouves.push({ participant_id: participantId, pseudo });
    const rang = e.trouves.length;
    broadcastToSession(sessionId, 'dessin:trouve', {
      q: e.questionIndex,
      participant_id: participantId,
      pseudo,
      rang,
    });
    return { statut: 'trouve', rang, allAnswered: r.allAnswered };
  }
  if (verdict === 'proche') return { statut: 'proche' };

  const propre = texte.replace(/\s+/g, ' ').trim().slice(0, 40);
  if (propre) {
    e.propositions.push({ pseudo, texte: propre });
    if (e.propositions.length > MAX_PROPOSITIONS_GARDEES) e.propositions.shift();
    broadcastToSession(sessionId, 'dessin:proposition', { q: e.questionIndex, pseudo, texte: propre });
  }
  return { statut: 'rate' };
}

// ── Événements socket du téléphone du dessinateur ─────────────────────────

ajouterGestionnaireSocket((socket: Socket, identity: SocketIdentity) => {
  if (identity.kind !== 'participant') return;
  const { sessionId, participantId } = identity;
  socket.on('dessin:trait', (envoi: EnvoiTrait) => {
    try {
      ajouterTrait(sessionId, participantId, envoi ?? {});
    } catch (err) {
      console.error('[dessin] trait refusé :', err);
    }
  });
  socket.on('dessin:effacer', () => {
    try {
      effacerDessin(sessionId, participantId);
    } catch (err) {
      console.error('[dessin] effacement en échec :', err);
    }
  });
  socket.on('dessin:annuler', () => {
    try {
      annulerTrait(sessionId, participantId);
    } catch (err) {
      console.error('[dessin] annulation en échec :', err);
    }
  });
  // Le téléphone du dessinateur se reconnecte : il redemande son mot.
  socket.on('dessin:mon_mot', (_p: unknown, ack?: (r: unknown) => void) => {
    ack?.(motPourDessinateur(sessionId, participantId));
  });
});
