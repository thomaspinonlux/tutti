/**
 * dessin.ts — feat/dessin-a-deviner (côté client)
 *
 * Le dessin en cours : traits, qui a trouvé, propositions. Alimenté par le
 * socket de la partie (TV spectatrice, console, téléphones) et rattrapé par
 * GET /quizz/dessin quand la page est (re)chargée en plein dessin.
 */
import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { EtatDessinPublic, TraitDessin } from '@tutti/shared';
import { api } from './api.js';

export interface EtatDessinVue {
  traits: TraitDessin[];
  trouves: Array<{ participant_id: string; pseudo: string }>;
  propositions: Array<{ pseudo: string; texte: string }>;
  /** Incrémenté à chaque changement : sert à redessiner la toile. */
  version: number;
}

const VIDE: EtatDessinVue = { traits: [], trouves: [], propositions: [], version: 0 };

export async function lireDessin(sessionId: string): Promise<EtatDessinPublic | null> {
  const r = await api<{ dessin: EtatDessinPublic | null }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/quizz/dessin`,
    { anonymous: true },
  );
  return r.dessin;
}

export async function lireMonMot(
  sessionId: string,
  token: string,
): Promise<{ question_index: number; mot: string } | null> {
  const r = await api<{ mot: { question_index: number; mot: string } | null }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/quizz/dessin/mot`,
    { method: 'POST', body: { token }, anonymous: true },
  );
  return r.mot;
}

/**
 * Suit le dessin de la question `questionIndex` (null = pas de dessin en
 * cours : l'état est vidé). Les événements d'une autre question sont ignorés.
 */
export function useDessin(
  socket: Socket | null,
  sessionId: string | null,
  questionIndex: number | null,
): EtatDessinVue {
  const [etat, setEtat] = useState<EtatDessinVue>(VIDE);
  const ref = useRef<EtatDessinVue>(VIDE);

  useEffect(() => {
    ref.current = { ...VIDE };
    setEtat(ref.current);
    if (questionIndex === null || !sessionId) return;

    let vivant = true;
    const publier = (): void => {
      ref.current = { ...ref.current, version: ref.current.version + 1 };
      if (vivant) setEtat(ref.current);
    };

    // Rattrapage : la page arrive en plein dessin.
    lireDessin(sessionId)
      .then((d) => {
        if (!vivant || !d || d.question_index !== questionIndex) return;
        // Les traits reçus par socket pendant la requête sont plus récents :
        // on ne remplace que si on n'a encore rien.
        if (ref.current.traits.length === 0) {
          ref.current = {
            traits: d.traits.map((t) => ({ ...t, p: [...t.p] })),
            trouves: d.trouves,
            propositions: d.propositions,
            version: ref.current.version,
          };
          publier();
        }
      })
      .catch(() => {
        /* le socket suffira */
      });

    if (!socket) {
      return () => {
        vivant = false;
      };
    }

    const onTrait = (m: { q: number; i: number; c: string; w: number; p: number[] }): void => {
      if (m.q !== questionIndex) return;
      const traits = ref.current.traits;
      if (m.i === traits.length) traits.push({ c: m.c, w: m.w, p: [...m.p] });
      else if (m.i === traits.length - 1) traits[m.i]!.p.push(...m.p);
      else return;
      publier();
    };
    const onEffacer = (m: { q: number }): void => {
      if (m.q !== questionIndex) return;
      ref.current.traits = [];
      publier();
    };
    const onAnnuler = (m: { q: number; n: number }): void => {
      if (m.q !== questionIndex) return;
      ref.current.traits = ref.current.traits.slice(0, m.n);
      publier();
    };
    const onTrouve = (m: { q: number; participant_id: string; pseudo: string }): void => {
      if (m.q !== questionIndex) return;
      if (ref.current.trouves.some((t) => t.participant_id === m.participant_id)) return;
      ref.current.trouves = [...ref.current.trouves, { participant_id: m.participant_id, pseudo: m.pseudo }];
      publier();
    };
    const onProposition = (m: { q: number; pseudo: string; texte: string }): void => {
      if (m.q !== questionIndex) return;
      ref.current.propositions = [...ref.current.propositions, { pseudo: m.pseudo, texte: m.texte }].slice(-30);
      publier();
    };

    socket.on('dessin:trait', onTrait);
    socket.on('dessin:effacer', onEffacer);
    socket.on('dessin:annuler', onAnnuler);
    socket.on('dessin:trouve', onTrouve);
    socket.on('dessin:proposition', onProposition);
    return () => {
      vivant = false;
      socket.off('dessin:trait', onTrait);
      socket.off('dessin:effacer', onEffacer);
      socket.off('dessin:annuler', onAnnuler);
      socket.off('dessin:trouve', onTrouve);
      socket.off('dessin:proposition', onProposition);
    };
  }, [socket, sessionId, questionIndex]);

  return etat;
}

/** Palette du dessinateur : lisible sur fond blanc, sur TV comme sur téléphone. */
export const COULEURS_DESSIN = [
  '#1D1813',
  '#FF5C4D',
  '#F2A20C',
  '#F7D046',
  '#3FB47A',
  '#2F80ED',
  '#8E44AD',
  '#8B5A2B',
  '#FF8FB1',
  '#FFFFFF',
] as const;

/** Épaisseurs proposées (millièmes de la largeur). Le blanc sert de gomme. */
export const EPAISSEURS_DESSIN = [6, 14, 30] as const;
