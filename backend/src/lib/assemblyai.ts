/**
 * assemblyai.ts — feat/voice-cascade-l3-assemblyai
 *
 * Client AssemblyAI Universal-2 pour le 3e niveau de la cascade voix Tutti.
 *
 * Pourquoi un 3ᵉ niveau :
 *   - L1 (Web Speech, 0ms) couvre ~60% des cas — réponses parfaites
 *   - L2 (Deepgram Nova-3 + Keyterm, 300ms) couvre ~30% des cas
 *     supplémentaires — accents modérés, audio propre
 *   - L3 (AssemblyAI Universal-2 + word_boost, ~600-1500ms) attaque les
 *     ~10% restants — accents très prononcés, audio bruité, voix d'enfants…
 *
 * Universal-2 = modèle ASR multilingue d'AssemblyAI optimisé précision,
 * supporte word_boost (équivalent Keyterm Prompting Deepgram) avec
 * boost_param "high" pour forcer le modèle à privilégier les termes
 * "titre + artiste" du morceau attendu.
 *
 * REST flow (pas de SDK pour éviter +1 dep) :
 *   1. POST /v2/upload (raw audio bytes) → { upload_url }
 *   2. POST /v2/transcript { audio_url, word_boost, boost_param, language_code }
 *      → { id, status: 'queued' }
 *   3. GET /v2/transcript/:id en polling (500ms) jusqu'à
 *      status === 'completed' OU 'error'
 *
 * Latence typique pour ~10s d'audio : 600-1500ms (chemin chaud Universal-2).
 *
 * Auth : ASSEMBLYAI_API_KEY (env Railway). Feature flag :
 *   ENABLE_ASSEMBLYAI_FALLBACK=true requis — sinon le route /voice-transcribe-
 *   assemblyai retourne 503 pour permettre une désactivation rapide sans
 *   redeploy si le coût ou la latence ne valent pas le coup.
 */

const ASSEMBLYAI_BASE = 'https://api.assemblyai.com/v2';
const UPLOAD_URL = `${ASSEMBLYAI_BASE}/upload`;
const TRANSCRIPT_URL = `${ASSEMBLYAI_BASE}/transcript`;

/** Timeout total (upload + transcript + polling). */
const TOTAL_TIMEOUT_MS = 10_000;
/** Délai entre 2 polls de status. */
const POLL_INTERVAL_MS = 500;

export class AssemblyAIError extends Error {
  constructor(
    public readonly code: 'CONFIG_MISSING' | 'API_ERROR' | 'TIMEOUT' | 'TRANSCRIPT_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'AssemblyAIError';
  }
}

export interface AssemblyAITranscribeArgs {
  audio: Buffer;
  /** MIME audio (audio/webm, audio/mp4, audio/ogg…). */
  contentType: string;
  /**
   * Mots / phrases à booster (word_boost). Limit ~2500 mots, on en passe 2
   * (titre + artiste). Boost paramétré "high" côté AssemblyAI.
   */
  keywords: string[];
  /** ISO-639-1 — 'fr', 'en'. Si non passé : laisse AssemblyAI auto-détecter. */
  language?: string;
}

export interface AssemblyAITranscribeResult {
  text: string;
  /** Confidence AssemblyAI (0-1). */
  confidence: number;
  /** Latence totale upload→transcript (ms). */
  latency_ms: number;
}

/**
 * Transcrit un buffer audio via AssemblyAI Universal-2 avec word_boost.
 * Lève AssemblyAIError sur échec.
 *
 * Pas de retry automatique — le caller (route /voice-transcribe-assemblyai)
 * peut décider de retry x1 si nécessaire.
 */
export async function transcribeWithAssemblyAI(
  args: AssemblyAITranscribeArgs,
): Promise<AssemblyAITranscribeResult> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    throw new AssemblyAIError('CONFIG_MISSING', 'ASSEMBLYAI_API_KEY non défini côté serveur');
  }

  const startMs = Date.now();
  const sizeKb = Math.round((args.audio?.byteLength ?? 0) / 1024);
  console.info(
    `[AssemblyAI] ⏱  transcribe start | size=${sizeKb}KB | lang=${args.language ?? 'auto'} | word_boost=${JSON.stringify(args.keywords)}`,
  );

  // Garde-fou : abort global après TOTAL_TIMEOUT_MS (upload + transcript +
  // polling cumulés). AssemblyAI peut être lent en heure de pointe.
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS);

  try {
    // ── 1. Upload audio brut ──────────────────────────────────────────
    const uploadRes = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/octet-stream',
      },
      body: new Uint8Array(args.audio.buffer, args.audio.byteOffset, args.audio.byteLength),
      signal: controller.signal,
    });
    if (!uploadRes.ok) {
      const t = await uploadRes.text().catch(() => '');
      throw new AssemblyAIError('API_ERROR', `Upload ${uploadRes.status}: ${t.slice(0, 200)}`);
    }
    const uploadJson = (await uploadRes.json()) as { upload_url?: string };
    if (!uploadJson.upload_url) {
      throw new AssemblyAIError('API_ERROR', 'Upload response missing upload_url');
    }
    const uploadElapsed = Date.now() - startMs;
    console.info(`[AssemblyAI] upload done | elapsed=${uploadElapsed}ms`);

    // ── 2. Create transcript request ──────────────────────────────────
    // speech_model "best" = Universal-2 (qualité max, latence raisonnable).
    // Ne pas confondre avec "nano" (rapide mais moins précis).
    const body: Record<string, unknown> = {
      audio_url: uploadJson.upload_url,
      speech_model: 'best',
      word_boost: (args.keywords ?? []).slice(0, 50).filter((k) => k.length > 1),
      boost_param: 'high',
      punctuate: false,
      format_text: false,
    };
    if (args.language) body.language_code = args.language;

    const createRes = await fetch(TRANSCRIPT_URL, {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!createRes.ok) {
      const t = await createRes.text().catch(() => '');
      throw new AssemblyAIError(
        'API_ERROR',
        `Transcript create ${createRes.status}: ${t.slice(0, 200)}`,
      );
    }
    const createJson = (await createRes.json()) as {
      id?: string;
      status?: string;
      error?: string;
    };
    if (!createJson.id) {
      throw new AssemblyAIError('API_ERROR', 'Transcript create missing id');
    }

    // ── 3. Poll transcript status until completed/error ───────────────
    const transcriptId = createJson.id;
    const pollUrl = `${TRANSCRIPT_URL}/${encodeURIComponent(transcriptId)}`;
    let attempt = 0;
    while (true) {
      attempt += 1;
      // Petit delay AVANT le premier poll — donne le temps à AssemblyAI de
      // commencer le job (sinon on a juste "queued" en boucle).
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const pollRes = await fetch(pollUrl, {
        method: 'GET',
        headers: { Authorization: apiKey },
        signal: controller.signal,
      });
      if (!pollRes.ok) {
        const t = await pollRes.text().catch(() => '');
        throw new AssemblyAIError(
          'API_ERROR',
          `Transcript poll ${pollRes.status}: ${t.slice(0, 200)}`,
        );
      }
      const pollJson = (await pollRes.json()) as {
        status?: string;
        text?: string;
        confidence?: number;
        error?: string;
      };

      if (pollJson.status === 'completed') {
        const text = (pollJson.text ?? '').trim();
        const confidence = typeof pollJson.confidence === 'number' ? pollJson.confidence : 0;
        const totalLatency = Date.now() - startMs;
        console.info(
          `[AssemblyAI] ✓ transcribe done | attempt=${attempt} | latency=${totalLatency}ms | conf=${confidence.toFixed(2)} | text="${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`,
        );
        return { text, confidence, latency_ms: totalLatency };
      }
      if (pollJson.status === 'error') {
        throw new AssemblyAIError(
          'TRANSCRIPT_FAILED',
          `AssemblyAI transcript error: ${pollJson.error?.slice(0, 200) ?? 'unknown'}`,
        );
      }
      // Status queued / processing → continue polling jusqu'au timeout global.
    }
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new AssemblyAIError('TIMEOUT', `AssemblyAI timeout après ${TOTAL_TIMEOUT_MS}ms`);
    }
    if (err instanceof AssemblyAIError) throw err;
    throw new AssemblyAIError(
      'API_ERROR',
      `AssemblyAI unreachable: ${err instanceof Error ? err.message : 'unknown'}`,
    );
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/** True si le fallback L3 est activé via env (compte aussi config dispo). */
export function isAssemblyAIEnabled(): boolean {
  const flag = process.env.ENABLE_ASSEMBLYAI_FALLBACK;
  if (flag !== 'true' && flag !== '1') return false;
  return Boolean(process.env.ASSEMBLYAI_API_KEY);
}
