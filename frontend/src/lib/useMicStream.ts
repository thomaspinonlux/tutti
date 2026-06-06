/**
 * useMicStream — fix/ios-voice-cascade-mic-and-buzz-refused
 *
 * Hook React qui détient UN SEUL MediaStream micro pour toute la durée de vie
 * de PlayPage. Résout 2 bugs prod iPhone Safari (test PO réel) :
 *
 *   Bug #1 : popup système iOS "tuttiparty.app souhaite accéder au micro" qui
 *            réapparaît à chaque morceau. Cause : ancien voiceCapture.ts
 *            appelait getUserMedia() + stream.getTracks().forEach(t=>t.stop())
 *            à chaque buzz → iOS recompose la permission au prochain
 *            getUserMedia().
 *   Bug #3 : aucun audio capturé sur le morceau 2+. Cause : stream stoppé après
 *            morceau 1 → MediaRecorder créé sur un stream mort renvoie 0 chunks.
 *
 * Solution : un seul getUserMedia() au mount, le stream est conservé en ref
 * jusqu'au unmount. Healthcheck `isLive()` vérifie que les tracks sont encore
 * `readyState === 'live'` avant chaque buzz (sur iOS, mise en background
 * prolongée peut tuer le stream → on réinit en transparence).
 *
 * Le mimeType est calculé une fois et exposé pour que voiceCapture choisisse
 * le bon nom de fichier (buzz.mp4 sur iOS, buzz.webm ailleurs).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const SUPPORTED_MIME_TYPES = [
  // iOS Safari produit AAC dans un container MP4. Deepgram Nova-3 accepte.
  'audio/mp4',
  // Chrome/Firefox/Edge — Opus dans WebM, format de référence Deepgram.
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
];

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  // Sur iOS Safari, on PRÉFÈRE audio/mp4 (natif). Sur les autres browsers, on
  // tente d'abord opus/webm (meilleur compression + latence Deepgram).
  const isiOS = detectIos();
  const ordered = isiOS
    ? SUPPORTED_MIME_TYPES
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  for (const mt of ordered) {
    if (MediaRecorder.isTypeSupported(mt)) return mt;
  }
  return '';
}

/** Détecte iPhone/iPad/iPod + iPadOS 13+ qui ment via UA Macintosh + touch. */
function detectIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  const isMacUA = /Macintosh/.test(ua);
  const hasTouch = typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1;
  return isMacUA && hasTouch;
}

export type MicPermitted = 'pending' | 'granted' | 'denied';

export interface MicStreamApi {
  /** État de la permission micro côté navigateur. */
  permitted: MicPermitted;
  /** Dernier message d'erreur getUserMedia() ou cleanup. */
  error: string | null;
  /** mimeType détecté pour MediaRecorder (audio/mp4 sur iOS, opus ailleurs). */
  mimeType: string;
  /** true si l'OS expose iOS (utile pour skip L1 Web Speech notamment). */
  isiOS: boolean;
  /** Healthcheck synchrone — false si le stream a été tué (rare, iOS background). */
  isLive: () => boolean;
  /** Retourne le stream persistant. null si pas encore prêt ou refusé. */
  getStream: () => MediaStream | null;
  /** Force un re-init (après "Autoriser le micro" CTA, ou stream mort). */
  reinit: () => Promise<void>;
}

const DEFAULT_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
    sampleRate: 16_000,
  },
};

export function useMicStream(): MicStreamApi {
  const [permitted, setPermitted] = useState<MicPermitted>('pending');
  const [error, setError] = useState<string | null>(null);
  const [mimeType] = useState<string>(() => pickMimeType());
  const [isiOS] = useState<boolean>(() => detectIos());

  const streamRef = useRef<MediaStream | null>(null);
  // Garde-fou React StrictMode : 2 mounts en dev → 2 getUserMedia. On garde
  // un seul init en concurrence via cette promise.
  const initPromiseRef = useRef<Promise<void> | null>(null);

  const stopStream = useCallback((): void => {
    const s = streamRef.current;
    if (!s) return;
    try {
      s.getTracks().forEach((t) => t.stop());
    } catch {
      /* noop */
    }
    streamRef.current = null;
  }, []);

  const initOnce = useCallback(async (): Promise<void> => {
    if (initPromiseRef.current) return initPromiseRef.current;
    initPromiseRef.current = (async (): Promise<void> => {
      try {
        console.info('[Voice] useMicStream getUserMedia() called');
        const s = await navigator.mediaDevices.getUserMedia(DEFAULT_CONSTRAINTS);
        const labels = s.getTracks().map((t) => t.label || '(no-label)');
        const settings = s.getAudioTracks()[0]?.getSettings?.() ?? {};
        console.info(
          `[Voice] useMicStream granted | tracks=${JSON.stringify(labels)} | sampleRate=${settings.sampleRate ?? '?'} | mimeType=${mimeType || '(default)'}`,
        );
        streamRef.current = s;
        setPermitted('granted');
        setError(null);
      } catch (err) {
        const name = (err as { name?: string })?.name ?? 'Error';
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Voice] useMicStream getUserMedia FAILED | name=${name} | message=${msg}`);
        setPermitted('denied');
        setError(`${name}: ${msg}`);
      } finally {
        initPromiseRef.current = null;
      }
    })();
    return initPromiseRef.current;
  }, [mimeType]);

  // Init au mount unique.
  useEffect(() => {
    void initOnce();
    return () => {
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isLive = useCallback((): boolean => {
    const s = streamRef.current;
    if (!s) return false;
    const tracks = s.getAudioTracks();
    if (tracks.length === 0) return false;
    return tracks.every((t) => t.readyState === 'live' && t.enabled);
  }, []);

  const getStream = useCallback((): MediaStream | null => {
    return streamRef.current;
  }, []);

  const reinit = useCallback(async (): Promise<void> => {
    stopStream();
    setPermitted('pending');
    setError(null);
    await initOnce();
  }, [initOnce, stopStream]);

  return {
    permitted,
    error,
    mimeType: mimeType || 'audio/webm',
    isiOS,
    isLive,
    getStream,
    reinit,
  };
}
