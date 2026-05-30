/**
 * deepgram.ts — feat/voice-cascade-l1-l2
 *
 * Client Deepgram Nova-3 pour la reconnaissance vocale Tutti.
 *
 * Nova-3 + Keyterm Prompting : modèle multilingue (~300ms latence sur ~10s
 * audio, vs 2-5s pour Whisper). Le Keyterm Prompting boost la reconnaissance
 * sur les termes "musique" (titres + artistes) en passant ces termes au modèle
 * comme contexte. Améliore drastiquement le match "Laïk a préyeur" → "Like a
 * Prayer" via les keyterms ["Madonna", "Like a Prayer"].
 *
 * Endpoint : https://api.deepgram.com/v1/listen
 *
 * Auth : DEEPGRAM_API_KEY dans les env vars Railway.
 *
 * Fallback : si Deepgram échoue (réseau / quota / erreur), le caller décide
 * de basculer sur Whisper (cf. /voice-transcribe-deepgram qui chainera).
 */

const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen';
const DEEPGRAM_MODEL = process.env.DEEPGRAM_MODEL ?? 'nova-3';
const DEEPGRAM_TIMEOUT_MS = 8_000;

export class DeepgramError extends Error {
  constructor(
    public readonly code: 'CONFIG_MISSING' | 'API_ERROR' | 'INVALID_AUDIO' | 'TIMEOUT',
    message: string,
  ) {
    super(message);
    this.name = 'DeepgramError';
  }
}

export interface DeepgramTranscribeArgs {
  audio: Buffer;
  /** MIME audio (audio/webm, audio/mp4, audio/ogg…). */
  contentType: string;
  /**
   * Code langue Deepgram. Pour Nova-3 multilingue, "multi" couvre EN+FR
   * (+autres) sans avoir à choisir. Override possible via env DEEPGRAM_LANGUAGE.
   */
  language?: string;
  /**
   * Keyterms à passer au modèle (Keyterm Prompting). Boost la précision sur
   * ces termes spécifiques. Ex: [track.title, track.artist] → titre + nom de
   * l'artiste reconnus même avec accent fort.
   */
  keyterms?: string[];
}

export interface DeepgramTranscribeResult {
  text: string;
  /** Confidence Deepgram (0-1) — utile pour debug, pas pour la décision. */
  confidence: number;
}

/**
 * Construit l'URL Deepgram avec les query params (model, language, keyterms…).
 * Les keyterms sont passés en multiples `?keyterm=foo&keyterm=bar` (limite ~50
 * keyterms par requête, on en envoie 2 = titre + artiste).
 */
function buildUrl(args: { language: string; keyterms: string[] }): string {
  const params = new URLSearchParams();
  params.set('model', DEEPGRAM_MODEL);
  params.set('language', args.language);
  params.set('smart_format', 'true');
  // Punctuation false → réduit les artefacts qui perturbent le matching fuzzy.
  params.set('punctuate', 'false');
  for (const kt of args.keyterms) {
    if (kt && kt.length > 1) params.append('keyterm', kt);
  }
  return `${DEEPGRAM_URL}?${params.toString()}`;
}

/**
 * Transcrit un buffer audio via Deepgram Nova-3. Lève DeepgramError sur
 * échec (le caller fallback alors sur Whisper si pertinent).
 */
export async function transcribeWithDeepgram(
  args: DeepgramTranscribeArgs,
): Promise<DeepgramTranscribeResult> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new DeepgramError('CONFIG_MISSING', 'DEEPGRAM_API_KEY non défini côté serveur');
  }

  const language = args.language ?? process.env.DEEPGRAM_LANGUAGE ?? 'multi';
  const keyterms = (args.keyterms ?? []).slice(0, 50);
  const url = buildUrl({ language, keyterms });

  const sizeKb = Math.round((args.audio?.byteLength ?? 0) / 1024);
  const startMs = Date.now();
  console.info(
    `[Deepgram] ⏱  transcribe start | model=${DEEPGRAM_MODEL} | size=${sizeKb}KB | lang=${language} | keyterms=${JSON.stringify(keyterms)}`,
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEEPGRAM_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': args.contentType || 'audio/webm',
      },
      body: new Uint8Array(args.audio.buffer, args.audio.byteOffset, args.audio.byteLength),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new DeepgramError('TIMEOUT', `Deepgram timeout après ${DEEPGRAM_TIMEOUT_MS}ms`);
    }
    throw new DeepgramError(
      'API_ERROR',
      `Deepgram unreachable: ${err instanceof Error ? err.message : 'unknown'}`,
    );
  }
  clearTimeout(timeout);

  if (res.status === 400) {
    const text = await res.text().catch(() => '');
    throw new DeepgramError('INVALID_AUDIO', `Audio invalide: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new DeepgramError('API_ERROR', `Deepgram API ${res.status}: ${text.slice(0, 200)}`);
  }

  // Réponse Deepgram : { results: { channels: [{ alternatives: [{ transcript, confidence }] }] } }
  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new DeepgramError(
      'API_ERROR',
      `Deepgram JSON parse failed: ${err instanceof Error ? err.message : 'unknown'}`,
    );
  }
  const alt = (
    json as {
      results?: {
        channels?: Array<{
          alternatives?: Array<{ transcript?: string; confidence?: number }>;
        }>;
      };
    }
  )?.results?.channels?.[0]?.alternatives?.[0];

  const text = (alt?.transcript ?? '').trim();
  const confidence = typeof alt?.confidence === 'number' ? alt.confidence : 0;

  const elapsedMs = Date.now() - startMs;
  console.info(
    `[Deepgram] ✓ transcribe done | latency=${elapsedMs}ms | conf=${confidence.toFixed(2)} | text="${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`,
  );

  return { text, confidence };
}
