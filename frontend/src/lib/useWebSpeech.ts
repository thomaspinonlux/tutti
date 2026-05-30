/**
 * useWebSpeech — feat/voice-cascade-l1-l2 (PR 3/4)
 *
 * Hook React qui encapsule l'API Web Speech (SpeechRecognition /
 * webkitSpeechRecognition). Niveau 1 de la cascade voix : reconnaissance
 * instantanée côté navigateur (Chrome, Edge, Safari iOS 14.5+, Safari macOS),
 * 0ms côté réseau, parfait pour intercepter les réponses qui matchent du
 * premier coup ("Like a Prayer" exact).
 *
 * Si l'API n'est pas dispo (Firefox), `supported` = false → le caller skip
 * direct vers le niveau 2 (Deepgram).
 *
 * Modèle d'usage :
 *   const ws = useWebSpeech({ lang: 'fr-FR' });
 *   ws.start();                  // démarre l'écoute en parallèle du MediaRecorder
 *   // ... user parle ...
 *   const result = await ws.stop(); // { transcript, supported, error?, elapsedMs }
 *
 * Important : on capture le PREMIER transcript final-or-interim arrivé. On ne
 * tente pas de stitch plusieurs résultats ni de continuous recognition au-delà
 * du buzz, c'est volontaire (un buzz = une phrase courte ≤10s).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Type minimal pour les Web Speech API events — pas de declaration shipped
 * dans lib.dom.d.ts par défaut.
 */
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionErrorEventLike {
  error: string;
  message?: string;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionCtor {
  new (): SpeechRecognitionLike;
}

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseWebSpeechOptions {
  /** ex. 'fr-FR', 'en-US'. Si non passé : navigator.language ou 'en-US'. */
  lang?: string;
}

export interface WebSpeechResult {
  /** Texte final reconnu (peut être vide si rien capté). */
  transcript: string;
  /** Vrai si l'API a été dispo et a démarré. */
  supported: boolean;
  /** Code d'erreur SpeechRecognition (no-speech, network, not-allowed…). */
  error?: string;
  /** Latence start→stop côté hook (ms). */
  elapsedMs: number;
}

export interface UseWebSpeechApi {
  /** Disponibilité de l'API dans ce navigateur (false sur Firefox). */
  supported: boolean;
  /** Démarre l'écoute. No-op si déjà running ou non supporté. */
  start: () => void;
  /**
   * Stoppe l'écoute. Résout dès que onend (ou onerror) déclenche.
   * Retourne le transcript collecté + métadonnées.
   */
  stop: () => Promise<WebSpeechResult>;
  /** Annule sans collecter (équivalent abort). */
  cancel: () => void;
  /** État (utile pour overlay UI). */
  listening: boolean;
}

/**
 * Hook React Web Speech. Pas d'auto-start — le caller décide quand start() et
 * stop(). Cf. PlayPage handleBuzz pour l'orchestration cascade.
 */
export function useWebSpeech(opts: UseWebSpeechOptions = {}): UseWebSpeechApi {
  const Ctor = getSpeechRecognitionCtor();
  const supported = Ctor !== null;
  const [listening, setListening] = useState(false);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef<string>('');
  const errorRef = useRef<string | undefined>(undefined);
  const startedAtRef = useRef<number>(0);
  // Promise qui se résout au prochain onend/onerror — utilisée par stop().
  const endResolverRef = useRef<((r: WebSpeechResult) => void) | null>(null);

  // Cleanup global au démontage (évite recognition fantôme si user navigue).
  useEffect(() => {
    return () => {
      try {
        recRef.current?.abort();
      } catch {
        /* noop */
      }
    };
  }, []);

  const start = useCallback((): void => {
    if (!Ctor) return;
    if (recRef.current) return; // déjà running
    transcriptRef.current = '';
    errorRef.current = undefined;
    startedAtRef.current = performance.now();

    const rec = new Ctor();
    rec.lang = opts.lang ?? (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
    rec.interimResults = true; // récup les hypothèses intermédiaires
    rec.continuous = false; // un buzz = une phrase
    rec.maxAlternatives = 1;

    rec.onresult = (event): void => {
      // Concatène les transcripts finals + le dernier interim si pas de final.
      let finalText = '';
      let interimText = '';
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i]!;
        const t = r[0]?.transcript ?? '';
        if (r.isFinal) finalText += t + ' ';
        else interimText = t;
      }
      transcriptRef.current = (finalText || interimText).trim();
    };
    rec.onerror = (event): void => {
      errorRef.current = event.error;
      // "no-speech" / "aborted" sont normaux (silence, cancel) — ne pas log
      // bruyamment.
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        console.warn('[WebSpeech] error:', event.error, event.message);
      }
    };
    rec.onend = (): void => {
      setListening(false);
      recRef.current = null;
      const resolver = endResolverRef.current;
      endResolverRef.current = null;
      if (resolver) {
        resolver({
          transcript: transcriptRef.current,
          supported: true,
          error: errorRef.current,
          elapsedMs: Math.round(performance.now() - startedAtRef.current),
        });
      }
    };

    try {
      rec.start();
      recRef.current = rec;
      setListening(true);
    } catch (err) {
      console.warn('[WebSpeech] start failed:', err);
      // start() peut throw si déjà actif côté navigateur (Safari) — on ignore.
    }
  }, [Ctor, opts.lang]);

  const stop = useCallback((): Promise<WebSpeechResult> => {
    if (!supported) {
      return Promise.resolve({
        transcript: '',
        supported: false,
        elapsedMs: 0,
      });
    }
    if (!recRef.current) {
      // Pas en cours d'écoute → résout tout de suite avec ce qu'on a (rien).
      return Promise.resolve({
        transcript: transcriptRef.current,
        supported: true,
        error: errorRef.current,
        elapsedMs: Math.round(performance.now() - startedAtRef.current),
      });
    }
    return new Promise<WebSpeechResult>((resolve) => {
      endResolverRef.current = resolve;
      try {
        recRef.current?.stop();
      } catch (err) {
        // Si stop throw, on force-resolve avec ce qu'on a.
        console.warn('[WebSpeech] stop failed:', err);
        resolve({
          transcript: transcriptRef.current,
          supported: true,
          error: 'stop-failed',
          elapsedMs: Math.round(performance.now() - startedAtRef.current),
        });
      }
    });
  }, [supported]);

  const cancel = useCallback((): void => {
    endResolverRef.current = null;
    try {
      recRef.current?.abort();
    } catch {
      /* noop */
    }
    recRef.current = null;
    setListening(false);
  }, []);

  return { supported, start, stop, cancel, listening };
}
