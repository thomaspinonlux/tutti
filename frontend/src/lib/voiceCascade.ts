/**
 * voiceCascade.ts — feat/voice-cascade-l1-l2 (PR 3/4)
 *
 * Wrappers HTTP pour la cascade voix backend (PR 3/4). Symétrique à
 * voiceCapture.ts (qui ne touche pas à ces nouveaux endpoints — conservé en
 * fallback ultime / compat).
 *
 * Endpoints visés :
 *   - POST /api/sessions/:id/rounds/:roundId/voice-match-text
 *       Niveau 1 : transcript Web Speech → match côté backend → score 0-100.
 *       Pas d'audio uploadé. Latence réseau ≈ 50-150ms LAN.
 *   - POST /api/sessions/:id/rounds/:roundId/voice-transcribe-deepgram
 *       Niveau 2 : upload audio multipart. Backend appelle Deepgram Nova-3
 *       avec Keyterm Prompting (titre + artiste). Fallback Whisper en cas
 *       d'erreur Deepgram (transparent côté client, signalé via `level`).
 */

export interface CascadeMatchResponse {
  /** Niveau cascade qui a produit ce résultat. */
  level: 'L1' | 'L2' | 'L3' | 'L3-fallback';
  /** Vrai si score ≥ threshold (backend a commit). */
  matched: boolean;
  /** Vrai si ScoreEvent persisté (sinon : phase 2 expirée, déjà répondu, etc.). */
  scored: boolean;
  /** Score combiné 0-100 (lib/voiceMatching). */
  score: number;
  /** "title" ou "artist_title" (combo). */
  target: 'title' | 'artist_title' | null;
  /** Transcript renvoyé par le backend (web-speech normalisé ou Deepgram brut). */
  transcript: string;
  /** Seuil utilisé côté backend (≥ → commit). */
  threshold: number;
  /** Seuil d'abandon — sous ce score, frontend skip L2 (économie réseau). */
  give_up_threshold: number;
  /** Position 1ʳᵉ / 2ᵉ / 3ᵉ buzz si scored. */
  position?: number;
  /** Total points calculés (artist + title bonus + speed bonus). */
  total_score?: number;
  breakdown?: {
    artist_base: number;
    title_bonus: number;
    speed_bonus: number;
    total: number;
  };
  /** Raison du non-commit ("ALREADY_ANSWERED", "PHASE_2_EXPIRED"…). */
  reason?: string;
  /** Latence backend (ms) — exposé pour L3 AssemblyAI. */
  latency_ms?: number;
}

/** Erreur typée quand AssemblyAI est désactivé côté backend (503 propre). */
export class AssemblyAIDisabledError extends Error {
  constructor() {
    super('ASSEMBLYAI_DISABLED');
    this.name = 'AssemblyAIDisabledError';
  }
}

interface CommonArgs {
  apiUrl: string;
  sessionId: string;
  roundId: string;
  token: string;
}

/**
 * POST /voice-match-text — niveau 1 cascade. Envoie un transcript Web Speech
 * au backend. Backend score + (si ≥ threshold) commit + broadcast.
 *
 * Retourne le score brut pour permettre la décision côté frontend (escalade
 * L2 si 30 ≤ score < 80, abandon si score < 30).
 */
export async function postVoiceMatchText(
  args: CommonArgs & { transcript: string; source?: string },
): Promise<CascadeMatchResponse> {
  const url = `${args.apiUrl}/api/sessions/${encodeURIComponent(args.sessionId)}/rounds/${encodeURIComponent(args.roundId)}/voice-match-text`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: args.token,
      transcript: args.transcript,
      source: args.source ?? 'web-speech',
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`voice-match-text ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as CascadeMatchResponse;
}

/**
 * POST /voice-transcribe-deepgram — niveau 2 cascade. Upload du blob audio
 * (Opus/webm, capturé via MediaRecorder). Backend appelle Deepgram puis
 * Whisper en fallback si Deepgram échoue. Score + commit/broadcast.
 */
export async function postVoiceTranscribeDeepgram(
  args: CommonArgs & { audio: Blob; filename?: string },
): Promise<CascadeMatchResponse> {
  const form = new FormData();
  form.append('audio', args.audio, args.filename ?? 'buzz.webm');
  form.append('token', args.token);

  const url = `${args.apiUrl}/api/sessions/${encodeURIComponent(args.sessionId)}/rounds/${encodeURIComponent(args.roundId)}/voice-transcribe-deepgram`;
  const res = await fetch(url, { method: 'POST', body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`voice-transcribe-deepgram ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as CascadeMatchResponse;
}

/**
 * POST /voice-transcribe-assemblyai — niveau 3 cascade (PR 4/4). Upload audio
 * vers AssemblyAI Universal-2 + word_boost (titre + artiste). Latence
 * 600-1500ms, attaquée uniquement quand L1 + L2 ont échoué.
 *
 * Comportement spécifique :
 *   - HTTP 503 ASSEMBLYAI_DISABLED → throw `AssemblyAIDisabledError` (le
 *     frontend conclut "rejeté" sans afficher d'erreur visuelle, c'est juste
 *     une feature flag off).
 *   - HTTP 503 ASSEMBLYAI_FAILED   → throw Error (échec réseau réel — peut
 *     être loggé en dur côté frontend).
 *   - HTTP 200                     → CascadeMatchResponse normal avec
 *     `level: 'L3'`.
 */
export async function postVoiceTranscribeAssemblyAI(
  args: CommonArgs & { audio: Blob; filename?: string },
): Promise<CascadeMatchResponse> {
  const form = new FormData();
  form.append('audio', args.audio, args.filename ?? 'buzz.webm');
  form.append('token', args.token);

  const url = `${args.apiUrl}/api/sessions/${encodeURIComponent(args.sessionId)}/rounds/${encodeURIComponent(args.roundId)}/voice-transcribe-assemblyai`;
  const res = await fetch(url, { method: 'POST', body: form });
  if (res.status === 503) {
    const body = await res.text().catch(() => '');
    if (body.includes('ASSEMBLYAI_DISABLED')) {
      throw new AssemblyAIDisabledError();
    }
    throw new Error(`voice-transcribe-assemblyai 503: ${body.slice(0, 200)}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`voice-transcribe-assemblyai ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as CascadeMatchResponse;
}
