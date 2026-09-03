/**
 * Client Whisper (OpenAI API) pour la reconnaissance vocale Tutti.
 *
 * Coût : ~$0.006/min, soit $0.0015 par buzz de 15s. Négligeable à notre
 * échelle (50 sessions × 30 buzzes/session × $0.0015 = ~$2.25/mois).
 *
 * Endpoint : https://api.openai.com/v1/audio/transcriptions
 *
 * Auth : OPENAI_API_KEY dans les env vars Railway.
 */

const OPENAI_TRANSCRIPTION_URL = 'https://api.openai.com/v1/audio/transcriptions';
// Optim — gpt-4o-mini-transcribe : modèle plus rapide que whisper-1
// (~50% latence en moins selon OpenAI sur de courts extraits). Précision
// équivalente sur des phrases courtes type "celine dion my heart will go on".
// Override possible via env WHISPER_MODEL pour fallback whisper-1 si besoin.
const WHISPER_MODEL = process.env.WHISPER_MODEL ?? 'gpt-4o-mini-transcribe';

export class WhisperError extends Error {
  constructor(
    public readonly code:
      | 'CONFIG_MISSING'
      | 'API_ERROR'
      | 'INVALID_AUDIO'
      | 'RATE_LIMITED'
      | 'TIMEOUT',
    message: string,
  ) {
    super(message);
    this.name = 'WhisperError';
  }
}

export interface TranscribeArgs {
  audio: Blob | Buffer;
  /** Nom de fichier (ex. "buzz.webm"), influe sur la détection MIME côté API. */
  filename?: string;
  /** Code langue ISO-639-1 (ex. "fr", "en"). Améliore vitesse + précision. */
  language?: string;
}

export interface TranscribeResult {
  text: string;
}

/**
 * Transcrit un blob audio en texte via Whisper API. Lève une WhisperError
 * en cas d'échec (la route appelante choisit comment réagir : score 0,
 * fallback boutons, etc.).
 */
export async function transcribeAudio(args: TranscribeArgs): Promise<TranscribeResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new WhisperError('CONFIG_MISSING', 'OPENAI_API_KEY non défini côté serveur');
  }

  const filename = args.filename ?? 'buzz.webm';

  // Construit le multipart/form-data manuellement pour pouvoir streamer
  // le Buffer (Node) ou le Blob (Bun/edge).
  const form = new FormData();
  // Si on reçoit un Buffer (Node), on le convertit en Blob.
  const audioBlob =
    args.audio instanceof Blob
      ? args.audio
      : new Blob(
          [new Uint8Array(args.audio.buffer, args.audio.byteOffset, args.audio.byteLength)],
          {
            type: filename.endsWith('.mp4') ? 'audio/mp4' : 'audio/webm',
          },
        );
  form.append('file', audioBlob, filename);
  form.append('model', WHISPER_MODEL);
  if (args.language) form.append('language', args.language);
  // response_format text = retourne le transcript brut sans timestamps.
  form.append('response_format', 'text');

  // Logs timing pour mesurer la latence Whisper côté backend.
  const audioSizeKb = Math.round((audioBlob.size ?? 0) / 1024);
  const startMs = Date.now();
  console.info(
    `[Whisper] ⏱  transcribe start | model=${WHISPER_MODEL} | size=${audioSizeKb}KB | lang=${args.language ?? 'auto'}`,
  );

  // fix/requete-sans-fin — DÉLAI MAXIMAL DE 8 SECONDES.
  // Sans lui, cet appel pouvait rester ouvert plusieurs minutes : le téléphone
  // du joueur restait bloqué sur « analyse », son buzz n'était pas refermé, et
  // le serveur retenait le fichier audio en mémoire. Les deux autres services
  // de transcription étaient déjà bornés (8 s et 10 s), celui-ci ne l'était pas.
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), 8000);
  let res: Response;
  try {
    res = await fetch(OPENAI_TRANSCRIPTION_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controleur.signal,
    });
  } catch (err) {
    throw new WhisperError(
      'TIMEOUT',
      `Whisper injoignable : ${err instanceof Error ? err.message : 'inconnu'}`,
    );
  }
  // fix/reponse-qui-traine — LE DÉLAI DE GARDE COUVRE AUSSI LA LECTURE.
  // Il était désarmé dès l'arrivée des en-têtes : un service qui répond puis
  // laisse traîner le corps échappait complètement à la limite de 8 secondes,
  // et le téléphone du joueur restait sur « analyse ».

  if (res.status === 429) {
    clearTimeout(minuteur);
    throw new WhisperError('RATE_LIMITED', 'Whisper API rate limit atteint');
  }
  if (res.status === 400) {
    const detail = await res.text().catch(() => '');
    clearTimeout(minuteur);
    throw new WhisperError('INVALID_AUDIO', `Audio invalide: ${detail.slice(0, 200)}`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    clearTimeout(minuteur);
    throw new WhisperError('API_ERROR', `Whisper API ${res.status}: ${detail.slice(0, 200)}`);
  }

  let text: string;
  try {
    text = (await res.text()).trim();
  } finally {
    clearTimeout(minuteur);
  }
  const elapsedMs = Date.now() - startMs;
  console.info(
    `[Whisper] ✓ transcribe done | latency=${elapsedMs}ms | text="${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`,
  );
  return { text };
}
