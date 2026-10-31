/**
 * jeuxDeSalon.ts — feat/jeux-de-salon (côté client)
 * Bluff et Réponse drôle : vote, état du jeu (reprise), choix du joueur.
 */
import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { ChoixVote, DebutVote } from '@tutti/shared';
import { api } from './api.js';

export interface EtatJeuVote {
  question_index: number;
  etape: 'ecriture' | 'vote' | 'fini';
  ecrits: number;
  votes: number;
  attendus: number;
  choix: ChoixVote[];
  fin_at: string | null;
}

export async function voterQuizz(sessionId: string, token: string, choixId: string): Promise<void> {
  await api(`/api/sessions/${encodeURIComponent(sessionId)}/quizz/vote`, {
    method: 'POST',
    body: { token, choix_id: choixId },
    anonymous: true,
  });
}

export async function lireEtatJeu(sessionId: string): Promise<EtatJeuVote | null> {
  const r = await api<{ jeu: EtatJeuVote | null }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/quizz/etat-jeu`,
    { anonymous: true },
  );
  return r.jeu;
}

export async function lireMesChoix(sessionId: string, token: string): Promise<string[]> {
  const r = await api<{ choix: string[] }>(`/api/sessions/${encodeURIComponent(sessionId)}/quizz/mes-choix`, {
    method: 'POST',
    body: { token },
    anonymous: true,
  });
  return r.choix;
}

export interface VueVote {
  etape: 'ecriture' | 'vote';
  choix: ChoixVote[];
  finVote: number | null;
  ecrits: number;
  votes: number;
}

/**
 * Suit l'étape d'une question Bluff / Réponse drôle : écriture (compteur
 * d'écrits), puis vote (choix + fin). Rattrape l'état au montage.
 */
export function useEcrireVoter(socket: Socket | null, sessionId: string | null, questionIndex: number | null): VueVote {
  const [vue, setVue] = useState<VueVote>({ etape: 'ecriture', choix: [], finVote: null, ecrits: 0, votes: 0 });
  const auteurs = useRef<Set<string>>(new Set());

  useEffect(() => {
    auteurs.current = new Set();
    setVue({ etape: 'ecriture', choix: [], finVote: null, ecrits: 0, votes: 0 });
    if (questionIndex === null || !sessionId) return;
    let vivant = true;
    lireEtatJeu(sessionId)
      .then((j) => {
        if (!vivant || !j || j.question_index !== questionIndex) return;
        setVue((v) => ({
          etape: j.etape === 'vote' ? 'vote' : v.etape,
          choix: j.choix.length > 0 ? j.choix : v.choix,
          finVote: j.fin_at ? new Date(j.fin_at).getTime() : v.finVote,
          ecrits: Math.max(v.ecrits, j.ecrits),
          votes: Math.max(v.votes, j.votes),
        }));
      })
      .catch(() => undefined);
    if (!socket) {
      return () => {
        vivant = false;
      };
    }
    const onVote = (m: DebutVote): void => {
      if (m.question_index !== questionIndex) return;
      setVue((v) => ({ ...v, etape: 'vote', choix: m.choix, finVote: new Date(m.fin_at).getTime() }));
    };
    // Un joueur peut corriger son texte : on compte les auteurs, pas les envois.
    const onEcrit = (m: { participant_id: string }): void => {
      auteurs.current.add(m.participant_id);
      const n = auteurs.current.size;
      setVue((v) => (v.etape === 'ecriture' ? { ...v, ecrits: Math.max(v.ecrits, n) } : v));
    };
    const onVoteRecu = (m: { question_index: number; votes: number }): void => {
      if (m.question_index !== questionIndex) return;
      setVue((v) => ({ ...v, votes: m.votes }));
    };
    socket.on('quizz:vote_start', onVote);
    socket.on('quizz:answer_submitted', onEcrit);
    socket.on('quizz:vote_recu', onVoteRecu);
    return () => {
      vivant = false;
      socket.off('quizz:vote_start', onVote);
      socket.off('quizz:answer_submitted', onEcrit);
      socket.off('quizz:vote_recu', onVoteRecu);
    };
  }, [socket, sessionId, questionIndex]);

  return vue;
}

/** Secondes restantes jusqu'à `fin` (ms), rafraîchi 4×/s. null si pas de fin. */
export function useSecondesRestantes(fin: number | null): number | null {
  const [maintenant, setMaintenant] = useState(Date.now());
  useEffect(() => {
    if (fin === null) return;
    const id = window.setInterval(() => setMaintenant(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [fin]);
  if (fin === null) return null;
  return Math.max(0, Math.ceil((fin - maintenant) / 1000));
}
