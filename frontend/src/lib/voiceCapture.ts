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

// Optim Whisper — 500ms de silence après speech = "fini de parler" → cut.
// Avant : 1.5s (trop long, casse l'UX rapidité). Hystérésis maintenue
// via SPEECH_RMS_THRESHOLD pour ne pas couper sur micro-pause au milieu
// d'une phrase.
const SILENCE_DURATION_MS_DEFAULT = 500;
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
  /**
   * fix/ios-voice-cascade-mic-and-buzz-refused — stream persistant fourni par
   * `useMicStream` (PlayPage). Si fourni, voiceCapture NE STOPPERA PAS les
   * tracks à `stop()`/`cancel()` (le hook s'en charge au unmount global).
   * Évite le popup système iOS à chaque buzz + le stream mort au morceau 2.
   * Si omis, comportement legacy (création + arrêt du stream à chaque buzz).
   */
  stream?: MediaStream;
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
 * Détecte le meilleur MIME type audio supporté. iOS Safari préfère mp4
 * (AAC dans MP4 container — natif), Chrome/Firefox/Edge préfèrent webm Opus
 * (mieux supporté côté Deepgram + meilleur compression).
 *
 * fix/ios-voice-cascade-mic-and-buzz-refused — détection iOS pour reorder.
 * Sur iOS, tenter webm en premier fallback presque toujours sur "(default)"
 * = un mp4 sans header explicite → Deepgram peut le rejeter en 400. En
 * forçant la préférence mp4 on garantit un mimeType valide.
 */
function pickAudioMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const isiOS =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && (navigator.maxTouchPoints ?? 0) > 1);
  const candidates = isiOS
    ? ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
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
  // 1) Stream : si fourni par useMicStream → persistant (NE PAS stopper après
  // chaque buzz, sinon popup iOS au prochain morceau). Sinon legacy : crée
  // un stream local et le stoppe au cleanup.
  const ownsStream = opts.stream === undefined;
  const stream =
    opts.stream ??
    (await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 16_000,
      },
    }));

  // 1b) Healthcheck du stream fourni : track doit être 'live'. Si mort
  // (iOS background trop long), throw → caller reinit via useMicStream.
  if (!ownsStream) {
    const track = stream.getAudioTracks()[0];
    if (!track || track.readyState !== 'live') {
      throw new Error('MIC_STREAM_DEAD');
    }
  }

  // 2) Démarre le MediaRecorder pour capturer l'audio brut.
  const mimeType = pickAudioMime();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  // Source de vérité pour le blob.type + filename → ce que le browser a
  // réellement choisi (peut différer de notre pick si fallback navigateur).
  const effectiveMime = recorder.mimeType || mimeType || 'audio/webm';
  console.info(
    `[Voice] MediaRecorder created | requestedMime=${mimeType || '(default)'} | effectiveMime=${effectiveMime} | state=${recorder.state} | ownsStream=${ownsStream}`,
  );
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

  // fix/vad-bar-bruyant — VAD ADAPTATIF. Les seuils ABSOLUS (0.01/0.02)
  // échouent dans un bar : le bruit ambiant dépasse le seuil de silence en
  // permanence → la coupure ne se déclenchait jamais et les joueurs devaient
  // appuyer sur Envoyer. Correctif en 3 volets :
  //  1. Calibration du PLANCHER DE BRUIT sur les 400 premières ms (médiane des
  //     RMS avant que le joueur parle) → seuils relatifs au lieu d'absolus :
  //     parole = nettement AU-DESSUS du bruit, silence = retour PRÈS du bruit.
  //  2. Cap dur : 4 s de parole suffisent pour titre+artiste → coupe et envoie.
  //  3. Cap sans parole : rien détecté en 5 s → coupe (au lieu d'attendre 10 s).
  const startedAtMs = performance.now();
  const CALIBRATION_MS = 400;
  const SPEECH_HARD_CAP_MS = 4_000;
  const NO_SPEECH_CAP_MS = 5_000;
  const noiseSamples: number[] = [];
  let noiseFloor: number | null = null;
  let speechStartedAt: number | null = null;

  const intervalId = window.setInterval(() => {
    analyser.getFloatTimeDomainData(buffer);
    const rms = computeRms(buffer);
    opts.onLevel?.(rms);
    const now = performance.now();

    // Phase de calibration : on échantillonne le bruit ambiant.
    if (noiseFloor === null) {
      noiseSamples.push(rms);
      if (now - startedAtMs >= CALIBRATION_MS) {
        const sorted = [...noiseSamples].sort((a, b) => a - b);
        noiseFloor = sorted[Math.floor(sorted.length / 2)] ?? 0;
        console.info(`[Voice] VAD noise floor calibré: ${noiseFloor.toFixed(4)}`);
      }
      return;
    }

    const speechThr = Math.max(SPEECH_RMS_THRESHOLD, noiseFloor * 2.2);
    const silenceThr = Math.max(SILENCE_RMS_THRESHOLD, noiseFloor * 1.4);

    if (!silenceFired && rms >= speechThr) {
      if (!hasDetectedSpeech) {
        hasDetectedSpeech = true;
        speechStartedAt = now;
      }
      silenceStartedAt = null;
      opts.onSpeech?.(rms);
    } else if (rms < silenceThr && hasDetectedSpeech && !silenceFired) {
      if (silenceStartedAt === null) {
        silenceStartedAt = now;
      } else if (now - silenceStartedAt >= silenceDurationMs) {
        silenceFired = true;
        console.info('[Voice] VAD silence (adaptatif) → cut');
        opts.onSilence?.();
      }
    }

    // Caps durs — indépendants des seuils (le bruit ne peut pas les bloquer).
    if (!silenceFired && hasDetectedSpeech && speechStartedAt !== null
        && now - speechStartedAt >= SPEECH_HARD_CAP_MS) {
      silenceFired = true;
      console.info('[Voice] VAD cap 4s de parole → cut + envoi auto');
      opts.onSilence?.();
      return;
    }
    if (!silenceFired && !hasDetectedSpeech && now - startedAtMs >= NO_SPEECH_CAP_MS) {
      silenceFired = true;
      console.info('[Voice] VAD cap 5s sans parole détectée → cut');
      opts.onSilence?.();
    }
  }, ANALYSER_INTERVAL_MS);

  // 4) Auto-cut à maxDurationMs (le caller doit appeler stop() pour récup
  // le blob ; ce timer est juste un garde-fou si le caller oublie).
  let autoTimer: number | null = window.setTimeout(() => {
    autoTimer = null;
    if (recorder.state !== 'inactive') recorder.stop();
  }, opts.maxDurationMs);

  // 5) Cleanup commun. NE STOPPE PAS les tracks si le stream est partagé
  // (cf. useMicStream qui owns le lifecycle). Stoppe sinon (mode legacy).
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
    if (ownsStream) {
      stream.getTracks().forEach((t) => t.stop());
    }
  };

  return {
    mimeType: effectiveMime,
    stop: async () => {
      return new Promise<Blob>((resolve) => {
        if (recorder.state === 'inactive') {
          cleanup();
          resolve(new Blob(chunks, { type: effectiveMime }));
          return;
        }
        recorder.onstop = (): void => {
          cleanup();
          const blob = new Blob(chunks, { type: effectiveMime });
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

/**
 * Refonte #3 — saisie texte alternative au buzz vocal.
 * Même logique de matching côté backend (matchTranscript), mais sans Whisper.
 */
export async function submitTextAnswer(args: {
  apiUrl: string;
  sessionId: string;
  roundId: string;
  token: string;
  text: string;
}): Promise<VoiceAnswerResult> {
  const url = `${args.apiUrl}/api/sessions/${encodeURIComponent(args.sessionId)}/rounds/${encodeURIComponent(args.roundId)}/text-answer`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: args.token, text: args.text }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`text-answer ${res.status}: ${text.slice(0, 200)}`);
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
