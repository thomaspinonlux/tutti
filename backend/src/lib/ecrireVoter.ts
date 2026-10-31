/**
 * ecrireVoter.ts — feat/jeux-de-salon
 *
 * Moteur commun à deux jeux du quiz, joués en deux temps :
 *
 *   BLUFF  (façon Fibbage) : une phrase à trou ; chacun invente un MENSONGE
 *          crédible, puis tout le monde vote pour ce qu'il croit être la
 *          VRAIE réponse, mélangée aux mensonges. On marque en trouvant la
 *          vérité, et pour chaque joueur piégé par son mensonge.
 *   FUNNY  (façon Quiplash) : une amorce ; chacun écrit la réponse la plus
 *          drôle, puis vote pour sa préférée. On marque par vote reçu.
 *
 * Étapes : « ecriture » (le chrono de la question) → « vote » (VOTE_SECONDES)
 * → révélation. Le passage d'une étape à l'autre est piloté par
 * gameplayQuizzCore.revealCurrentQuestion (chrono, « tout le monde a
 * répondu », ou bouton de l'animateur) : ce module ne programme rien.
 *
 * État en mémoire, comme le quiz.
 */
import type { ChoixVote, DetailsVote } from '@tutti/shared';
import { broadcastToSession } from '../socket/index.js';
import { comparerProposition, formeComparable, type MotADeviner } from './dessinComparaison.js';

export const VOTE_SECONDES = 25;
/** BLUFF : trouver la vérité. */
export const POINTS_VERITE = 100;
/** BLUFF : par joueur piégé. FUNNY : par vote reçu. */
export const POINTS_PAR_VOTE = 50;
/** FUNNY : tous les votants ont choisi la même réponse. */
export const BONUS_UNANIME = 100;

type TypeJeu = 'BLUFF' | 'FUNNY';

interface Choix {
  id: string;
  texte: string;
  verite: boolean;
  auteurs: string[]; // participant ids
}

interface EtatEV {
  questionIndex: number;
  type: TypeJeu;
  etape: 'ecriture' | 'vote' | 'fini';
  verite: MotADeviner | null;
  textes: Map<string, { pseudo: string; texte: string }>;
  pseudos: Map<string, string>;
  attendus: Set<string>;
  choix: Choix[];
  votes: Map<string, string>; // participant → choix id
  finVoteMs: number;
}

const etats = new Map<string, EtatEV>();

function melanger<T>(t: T[]): T[] {
  const a = [...t];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const propre = (t: string): string => t.replace(/\s+/g, ' ').trim().slice(0, 80);

export function demarrerEcriture(
  sessionId: string,
  questionIndex: number,
  type: TypeJeu,
  verite: MotADeviner | null,
  attendus: string[],
): void {
  etats.set(sessionId, {
    questionIndex,
    type,
    etape: 'ecriture',
    verite,
    textes: new Map(),
    pseudos: new Map(),
    attendus: new Set(attendus),
    choix: [],
    votes: new Map(),
    finVoteMs: 0,
  });
}

export function fermerEcrireVoter(sessionId: string): void {
  etats.delete(sessionId);
}

export function etapeEcrireVoter(sessionId: string): 'ecriture' | 'vote' | 'fini' | null {
  return etats.get(sessionId)?.etape ?? null;
}

export type ResultatEcriture =
  | { statut: 'ok'; tousOntEcrit: boolean }
  | { statut: 'refuse'; raison: 'PAS_EN_ECRITURE' | 'VIDE' | 'C_EST_LA_VERITE' };

/** Le texte d'un joueur (il peut le corriger tant que le vote n'a pas commencé). */
export function ecrire(sessionId: string, participantId: string, pseudo: string, texte: string): ResultatEcriture {
  const e = etats.get(sessionId);
  if (!e || e.etape !== 'ecriture') return { statut: 'refuse', raison: 'PAS_EN_ECRITURE' };
  const t = propre(texte);
  if (!t) return { statut: 'refuse', raison: 'VIDE' };
  // Au bluff, écrire la vraie réponse ne compte pas : il faut mentir.
  if (e.type === 'BLUFF' && e.verite && comparerProposition(e.verite, t) === 'oui') {
    return { statut: 'refuse', raison: 'C_EST_LA_VERITE' };
  }
  e.textes.set(participantId, { pseudo, texte: t });
  e.pseudos.set(participantId, pseudo);
  e.attendus.add(participantId);
  const tousOntEcrit = [...e.attendus].every((p) => e.textes.has(p));
  return { statut: 'ok', tousOntEcrit };
}

/**
 * Fin de l'écriture : on construit les choix et on ouvre le vote.
 * Renvoie false si un vote n'a pas de sens (moins de 2 choix) : l'appelant
 * passe alors directement à la révélation.
 */
export function passerAuVote(sessionId: string): boolean {
  const e = etats.get(sessionId);
  if (!e || e.etape !== 'ecriture') return false;
  const choix: Choix[] = [];
  // Deux mensonges identiques ne font qu'un choix (leurs auteurs le partagent).
  for (const [pid, { texte }] of e.textes) {
    const cle = formeComparable(texte).join(' ');
    const existant = choix.find((c) => formeComparable(c.texte).join(' ') === cle);
    if (existant) existant.auteurs.push(pid);
    else choix.push({ id: '', texte, verite: false, auteurs: [pid] });
  }
  if (e.type === 'BLUFF' && e.verite) {
    choix.push({ id: '', texte: e.verite.answer_lang1, verite: true, auteurs: [] });
  }
  const melange = melanger(choix).map((c, i) => ({ ...c, id: `c${i + 1}` }));
  e.choix = melange;
  if (melange.length < 2) {
    e.etape = 'fini';
    return false;
  }
  e.etape = 'vote';
  e.finVoteMs = Date.now() + VOTE_SECONDES * 1000;
  const publics: ChoixVote[] = melange.map((c) => ({ id: c.id, texte: c.texte }));
  broadcastToSession(sessionId, 'quizz:vote_start', {
    question_index: e.questionIndex,
    choix: publics,
    fin_at: new Date(e.finVoteMs).toISOString(),
  });
  return true;
}

export type ResultatVote =
  | { statut: 'ok'; tousOntVote: boolean }
  | { statut: 'refuse'; raison: 'PAS_EN_VOTE' | 'CHOIX_INCONNU' | 'SON_PROPRE_CHOIX' | 'DEJA_VOTE' };

export function voter(sessionId: string, participantId: string, pseudo: string, choixId: string): ResultatVote {
  const e = etats.get(sessionId);
  if (!e || e.etape !== 'vote' || Date.now() > e.finVoteMs + 1500) return { statut: 'refuse', raison: 'PAS_EN_VOTE' };
  const c = e.choix.find((x) => x.id === choixId);
  if (!c) return { statut: 'refuse', raison: 'CHOIX_INCONNU' };
  if (c.auteurs.includes(participantId)) return { statut: 'refuse', raison: 'SON_PROPRE_CHOIX' };
  if (e.votes.has(participantId)) return { statut: 'refuse', raison: 'DEJA_VOTE' };
  e.votes.set(participantId, choixId);
  e.pseudos.set(participantId, pseudo);
  e.attendus.add(participantId);
  broadcastToSession(sessionId, 'quizz:vote_recu', {
    question_index: e.questionIndex,
    votes: e.votes.size,
    attendus: e.attendus.size,
  });
  // Un joueur dont le seul choix possible serait le sien ne bloque pas la fin.
  const peutVoter = (p: string): boolean => e.choix.some((x) => !x.auteurs.includes(p));
  const tousOntVote = [...e.attendus].filter(peutVoter).every((p) => e.votes.has(p));
  return { statut: 'ok', tousOntVote };
}

export interface BilanEcrireVoter {
  scores: Map<string, { score: number; trouve: boolean; texte: string }>;
  details: DetailsVote;
}

/** Points de chacun et détail public (qui a écrit quoi, qui a voté quoi). */
export function bilanEcrireVoter(sessionId: string, questionIndex: number): BilanEcrireVoter | null {
  const e = etats.get(sessionId);
  if (!e || e.questionIndex !== questionIndex) return null;
  e.etape = 'fini';
  const scores = new Map<string, { score: number; trouve: boolean; texte: string }>();
  const ajouter = (pid: string, pts: number, trouve = false): void => {
    const s = scores.get(pid) ?? { score: 0, trouve: false, texte: e.textes.get(pid)?.texte ?? '' };
    s.score += pts;
    s.trouve = s.trouve || trouve;
    scores.set(pid, s);
  };
  for (const pid of e.textes.keys()) ajouter(pid, 0);

  const votesPar = new Map<string, string[]>(); // choix → votants
  for (const [pid, cid] of e.votes) {
    votesPar.set(cid, [...(votesPar.get(cid) ?? []), pid]);
    ajouter(pid, 0);
  }
  for (const c of e.choix) {
    const votants = votesPar.get(c.id) ?? [];
    if (e.type === 'BLUFF') {
      if (c.verite) for (const v of votants) ajouter(v, POINTS_VERITE, true);
      else for (const a of c.auteurs) ajouter(a, POINTS_PAR_VOTE * votants.length, votants.length > 0);
    } else {
      for (const a of c.auteurs) ajouter(a, POINTS_PAR_VOTE * votants.length, votants.length > 0);
    }
  }
  if (e.type === 'FUNNY' && e.votes.size >= 2) {
    const gagnant = e.choix.find((c) => (votesPar.get(c.id)?.length ?? 0) === e.votes.size);
    if (gagnant) for (const a of gagnant.auteurs) ajouter(a, BONUS_UNANIME);
  }

  const nom = (pid: string): string => e.pseudos.get(pid) ?? e.textes.get(pid)?.pseudo ?? '?';
  const details: DetailsVote = {
    kind: 'vote',
    choix: e.choix.map((c) => ({
      id: c.id,
      texte: c.texte,
      verite: c.verite,
      auteurs: c.auteurs.map(nom),
      votants: (votesPar.get(c.id) ?? []).map(nom),
    })),
  };
  return { scores, details };
}

/** Pour un écran (re)chargé en plein jeu. */
export function etatPublicEcrireVoter(sessionId: string): {
  question_index: number;
  etape: 'ecriture' | 'vote' | 'fini';
  ecrits: number;
  votes: number;
  attendus: number;
  choix: ChoixVote[];
  fin_at: string | null;
} | null {
  const e = etats.get(sessionId);
  if (!e) return null;
  return {
    question_index: e.questionIndex,
    etape: e.etape,
    ecrits: e.textes.size,
    votes: e.votes.size,
    attendus: e.attendus.size,
    choix: e.etape === 'ecriture' ? [] : e.choix.map((c) => ({ id: c.id, texte: c.texte })),
    fin_at: e.finVoteMs ? new Date(e.finVoteMs).toISOString() : null,
  };
}

/** Le choix écrit par ce joueur (son téléphone le grise pendant le vote). */
export function mesChoix(sessionId: string, participantId: string): string[] {
  const e = etats.get(sessionId);
  if (!e) return [];
  return e.choix.filter((c) => c.auteurs.includes(participantId)).map((c) => c.id);
}
