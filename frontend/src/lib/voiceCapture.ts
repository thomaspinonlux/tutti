/**
 * voiceCapture — capture audio côté tel pour Tutti voice-first.
 *
 * API minimale :
 *   const cap = await startVoiceCapture({ maxDurationMs: 10000, onSilence: () => cap.stop() });
 *   // ... user parle ...
 *   const blob = await cap.stop();  // retourne le blob audio webm/mp4
 *
 * Stratégie :
 *   - MediaRecorder pour l'enregistrement (compat iOS Safari : audio/mp4
 *     fallback si webm pas supporté).
 *   - VAD léger fait maison via Web Audio API AnalyserNode + RMS — détecte
 *     les périodes de silence pour permettre un cut early "le joueur a fini".
 *     Pas de lib externe (vad-web pèse 2MB lazy + ONNX runtime, overkill V1).
 *   - Auto-cut à maxDurationMs même si silence pas détecté.
 *
 * Compat :
 *   - iOS Safari 14.5+ : MediaRecorder OK, format audio/mp4 préféré.
 *   - Chrome Android : audio/webm classique
 *   - Firefox : audio/webm OK
 */

const SILENCE_DURATION_MS_DEFAULT = 1500; // 1.5s de silence = "fini de parler"
const SILENCE_RMS_THRESHOLD = 0.01; // seuil sous lequel c'est du silence
const SPEECH_RMS_THRESHOLD = 0.02; // seuil au-dessus = speech (hystérésis)
const ANALYSER_INTERVAL_MS = 100; // sample RMS toutes les 100ms

export interface VoiceCaptureOptions {
  /** Durée max d'enregistrement (ms). Auto-stop à l'expiration. */
  maxDurationMs: number;
  /**
   * Callback déclenché quand un silence prolongé est détecté pendant qu'on
   * a déjà capturé du speech. Le caller peut décider de stop() pour cut early.
   * Pas appelé tant que le joueur n'a rien dit (pour éviter cut trop tôt).
   */
  onSilence?: () => void;
  /** Callback à chaque pic de voix détecté (utile pour waveform visuelle). */
  onSpeech?: (rms: number) => void;
  /** Callback périodique avec le RMS courant (waveform live). */
  onLevel?: (rms: number) => void;
  /** Durée du silence considéré comme "fini de parler" (ms, défaut 1500). */
  silenceDurationMs?: number;
}

export interface VoiceCapture {
  /** MIME type du blob qui sera retourné. */
  mimeType: string;
  /** Stoppe l'enregistrement et retourne le blob. */
  stop: () => Promise<Blob>;
  /** Arrête tout sans retourner de blob (cancel). */
  cancel: () => void;
}

/**
 * Détecte le meilleur MIME type audio supporté. iOS Safari préfère mp4,
 * Chrome/Firefox webm.
 */
function pickAudioMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return ''; // navigateur choisira un défaut
}

/**
 * Calcule le RMS (root mean square) d'un buffer audio. Indicateur de
 * volume "perçu" — bonne approximation pour détecter speech vs silence.
 */
function computeRms(buffer: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const s = buffer[i] ?? 0;
    sum += s * s;
  }
  return Math.sqrt(sum / buffer.length);
}

/**
 * Démarre l'enregistrement audio + VAD amplitude. Retourne immédiatement
 * un handle qu'on peut .stop() ou .cancel().
 *
 * Demande l'accès micro si pas encore donné. Si refus, throw.
 */
export async function startVoiceCapture(opts: VoiceCaptureOptions): Promise<VoiceCapture> {
  // 1) Demande / récupère le stream micro.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  // 2) Démarre le MediaRecorder pour capturer l'audio brut.
  const mimeType = pickAudioMime();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e): void => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  recorder.start();

  // 3) Pipeline VAD amplitude via Web Audio API.
  // AudioContext fonctionne aussi sur iOS Safari (avec préfixe webkit).
  const audioCtx = new (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  )();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const buffer = new Float32Array(analyser.fftSize);

  const silenceDurationMs = opts.silenceDurationMs ?? SILENCE_DURATION_MS_DEFAULT;
  let hasDetectedSpeech = false;
  let silenceStartedAt: number | null = null;
  let silenceFired = false;

  const intervalId = window.setInterval(() => {
    analyser.getFloatTimeDomainData(buffer);
    const rms = computeRms(buffer);
    opts.onLevel?.(rms);

    if (rms >= SPEECH_RMS_THRESHOLD) {
      // Speech détecté
      if (!hasDetectedSpeech) hasDetectedSpeech = true;
      silenceStartedAt = null;
      opts.onSpeech?.(rms);
      return;
    }
    if (rms < SILENCE_RMS_THRESHOLD && hasDetectedSpeech && !silenceFired) {
      // Silence : on démarre le compteur si pas déjà fait
      const now = performance.now();
      if (silenceStartedAt === null) {
        silenceStartedAt = now;
      } else if (now - silenceStartedAt >= silenceDurationMs) {
        silenceFired = true;
        opts.onSilence?.();
      }
    }
  }, ANALYSER_INTERVAL_MS);

  // 4) Auto-cut à maxDurationMs (le caller doit appeler stop() pour récup
  // le blob ; ce timer est juste un garde-fou si le caller oublie).
  let autoTimer: number | null = window.setTimeout(() => {
    autoTimer = null;
    if (recorder.state !== 'inactive') recorder.stop();
  }, opts.maxDurationMs);

  // 5) Cleanup commun.
  const cleanup = (): void => {
    if (autoTimer !== null) {
      window.clearTimeout(autoTimer);
      autoTimer = null;
    }
    window.clearInterval(intervalId);
    try {
      source.disconnect();
      analyser.disconnect();
      void audioCtx.close();
    } catch {
      /* noop */
    }
    stream.getTracks().forEach((t) => t.stop());
  };

  return {
    mimeType: mimeType || 'audio/webm',
    stop: async () => {
      return new Promise<Blob>((resolve) => {
        if (recorder.state === 'inactive') {
          cleanup();
          resolve(new Blob(chunks, { type: mimeType || 'audio/webm' }));
          return;
        }
        recorder.onstop = (): void => {
          cleanup();
          const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
          resolve(blob);
        };
        recorder.stop();
      });
    },
    cancel: () => {
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        /* noop */
      }
      cleanup();
    },
  };
}

/**
 * Helper qui upload un blob audio à l'endpoint /voice-answer du backend.
 * Multipart : `audio` + `token`.
 */
export async function uploadVoiceAnswer(args: {
  apiUrl: string;
  sessionId: string;
  roundId: string;
  token: string;
  audio: Blob;
  filename?: string;
}): Promise<VoiceAnswerResult> {
  const form = new FormData();
  form.append('audio', args.audio, args.filename ?? 'buzz.webm');
  form.append('token', args.token);

  const url = `${args.apiUrl}/api/sessions/${encodeURIComponent(args.sessionId)}/rounds/${encodeURIComponent(args.roundId)}/voice-answer`;
  const res = await fetch(url, { method: 'POST', body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`voice-answer ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as VoiceAnswerResult;
}

export interface VoiceAnswerResult {
  matched: boolean;
  scored?: boolean;
  alreadyAnswered?: boolean;
  reason?: string;
  transcript?: string;
  position?: number;
  score?: number;
  breakdown?: {
    artist_base: number;
    title_bonus: number;
    speed_bonus: number;
    total: number;
  };
}
