/**
 * useExtraitQuiz — feat/blind-test-simple
 *
 * Joue sur la console l'extrait audio d'une question du blind test simple
 * (30 s publiés par le catalogue Apple, lisibles sans compte).
 *
 * - L'extrait part quand la question arrive, suit la pause du chrono, et
 *   s'arrête à la question suivante, au changement de thème ou à la fin.
 * - Il continue après la révélation de la réponse, jusqu'à sa fin : couper la
 *   musique au moment où l'on donne le titre tombe à plat.
 * - `enLecture` reste vrai tant qu'il joue : la musique d'attente du quiz se
 *   tait pendant ce temps (cf. HostPage, quizMediaEnCours).
 * - Un navigateur peut refuser de lancer un son sans geste (console pilotée
 *   depuis le téléphone, page jamais touchée) : `bloque` passe à vrai et la
 *   console affiche un bouton qui appelle `lancer()`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CurrentQuestionState } from '@tutti/shared';
import { remoteLog } from './remoteLog.js';

/** Une question dont le son est un fichier (et non un extrait YouTube). */
export function aUnExtrait(q: CurrentQuestionState | null | undefined): q is CurrentQuestionState {
  return !!q && q.media_type === 'AUDIO' && !!q.media_url && !q.media_youtube_id;
}

interface Resultat {
  enLecture: boolean;
  bloque: boolean;
  lancer: () => void;
}

export function useExtraitQuiz(question: CurrentQuestionState | null, actif: boolean): Resultat {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [enLecture, setEnLecture] = useState(false);
  const [bloque, setBloque] = useState(false);

  const extrait = actif && aUnExtrait(question) ? question : null;
  const cle = extrait ? extrait.question_id : null;
  const url = extrait ? extrait.media_url : null;
  const enPause = !!extrait?.en_pause;
  const revele = extrait?.phase === 'revealed';
  const enPauseRef = useRef(enPause);
  enPauseRef.current = enPause;

  useEffect(() => {
    if (!cle || !url) return;
    const audio = new Audio(url);
    audio.preload = 'auto';
    audioRef.current = audio;
    setBloque(false);

    const surLecture = (): void => setEnLecture(true);
    const surArret = (): void => setEnLecture(false);
    const surErreur = (): void => {
      setEnLecture(false);
      remoteLog('extrait', 'extrait illisible', { question: cle, code: audio.error?.code ?? null }, 'error');
    };
    audio.addEventListener('playing', surLecture);
    audio.addEventListener('pause', surArret);
    audio.addEventListener('ended', surArret);
    audio.addEventListener('error', surErreur);

    if (!enPauseRef.current) {
      audio.play().catch((err: unknown) => {
        // NotAllowedError : le navigateur attend un geste. Tout autre refus
        // (réseau, format) est signalé par l'événement `error`.
        if ((err as Error)?.name === 'NotAllowedError') setBloque(true);
      });
    }

    return () => {
      audio.removeEventListener('playing', surLecture);
      audio.removeEventListener('pause', surArret);
      audio.removeEventListener('ended', surArret);
      audio.removeEventListener('error', surErreur);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      audioRef.current = null;
      setEnLecture(false);
      setBloque(false);
    };
  }, [cle, url]);

  // Pause du chrono : l'extrait s'arrête et reprend avec lui. Une fois la
  // réponse révélée, il n'y a plus de chrono : on laisse l'extrait finir.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || revele) return;
    if (enPause) audio.pause();
    else if (audio.paused && !audio.ended && audio.currentTime > 0) audio.play().catch(() => undefined);
  }, [enPause, revele]);

  const lancer = useCallback((): void => {
    const audio = audioRef.current;
    if (!audio) return;
    audio
      .play()
      .then(() => setBloque(false))
      .catch(() => undefined);
  }, []);

  return { enLecture, bloque, lancer };
}
