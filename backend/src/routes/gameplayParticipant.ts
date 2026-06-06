/**
 * Routes /api/sessions/:id/rounds/:roundId/* — côté joueur (Phase C voice-first).
 *
 *   POST /buzz          : ouvre une fenêtre micro pour le joueur (multi-buzz parallèle)
 *   POST /voice-answer  : upload audio, transcript Whisper, fuzzy match, score dégressif
 *
 * Auth : token participant dans le body (cohérent avec l'ancienne API). Pas
 * de Supabase auth (le joueur n'a pas de compte admin).
 *
 * Multi-buzz : plusieurs joueurs peuvent buzzer en parallèle, chacun a sa
 * fenêtre micro indépendante (10s par défaut, configurable via
 * Session.buzz_window_seconds).
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { ScoreEventType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { verifyParticipantToken } from '../lib/participantToken.js';
import { broadcastToSession } from '../socket/index.js';
import {
  closeBuzz,
  getActiveTrack,
  hasCorrectAnswer,
  registerCorrectAnswer,
  setPhase3,
  tryOpenBuzz,
} from '../lib/gameState.js';
import { computeAnswerScore } from '../lib/gameScoring.js';
import { transcribeAudio, WhisperError } from '../lib/whisper.js';
import { transcribeWithDeepgram, DeepgramError } from '../lib/deepgram.js';
import {
  transcribeWithAssemblyAI,
  AssemblyAIError,
  isAssemblyAIEnabled,
} from '../lib/assemblyai.js';
import { matchTranscript } from '../lib/voiceMatch.js';
import { matchAnswer } from '../lib/voiceMatching.js';
import { getCumulativeScores } from '../lib/scores.js';
import type { GameMode, Team } from '@tutti/shared';

const router: Router = Router({ mergeParams: true });

// Multer en mémoire — le buffer est petit (10-15s d'audio webm, ~500KB max).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB cap, généreux pour 15s
});

// Stockage des timers phase 2 → phase 3 par round_id.
const phase2Timers = new Map<string, NodeJS.Timeout>();

// feat/voice-cascade-l1-l2 — seuils cascade côté backend. Frontend les utilise
// pour décider escalade L1→L2, backend les utilise pour décider commit.
// Override via env Railway (VOICE_MATCH_THRESHOLD=80, VOICE_MATCH_GIVEUP_THRESHOLD=30).
const VOICE_MATCH_THRESHOLD = Number.parseInt(process.env.VOICE_MATCH_THRESHOLD ?? '80', 10);
const VOICE_MATCH_GIVEUP_THRESHOLD = Number.parseInt(
  process.env.VOICE_MATCH_GIVEUP_THRESHOLD ?? '30',
  10,
);

// ── Helper auth ──────────────────────────────────────────────────────────

function verifyParticipantOrFail(
  req: Request<{ id: string; roundId: string }>,
  res: Response,
  token: string,
): { participantId: string; sessionId: string } | null {
  let payload: { participant_id: string; session_id: string };
  try {
    payload = verifyParticipantToken(token);
  } catch {
    res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Token invalide' } });
    return null;
  }
  if (payload.session_id !== req.params.id) {
    res
      .status(403)
      .json({ error: { code: 'WRONG_SESSION', message: 'Token / session ne correspond pas' } });
    return null;
  }
  return { participantId: payload.participant_id, sessionId: payload.session_id };
}

// ── POST /buzz ────────────────────────────────────────────────────────────
// Multi-buzz parallèle : ouvre une fenêtre micro pour ce joueur précis.
// Les autres joueurs ne sont pas bloqués. Cooldown 1s par joueur (anti-tap).

const buzzSchema = z.object({ token: z.string() });

router.post(
  '/buzz',
  async (req: Request<{ id: string; roundId: string }>, res: Response): Promise<void> => {
    const parsed = buzzSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'token requis' } });
      return;
    }
    const auth = verifyParticipantOrFail(req, res, parsed.data.token);
    if (!auth) return;

    const participant = await prisma.participant.findUnique({
      where: { id: auth.participantId },
      select: { id: true, pseudo: true, is_kicked: true, session_id: true },
    });
    if (!participant || participant.is_kicked || participant.session_id !== req.params.id) {
      res
        .status(403)
        .json({ error: { code: 'PARTICIPANT_INVALID', message: 'Participant invalide' } });
      return;
    }

    // Récupère la fenêtre buzz configurée pour cette session (10s défaut, 15s détendu).
    const session = await prisma.session.findUnique({
      where: { id: req.params.id },
      select: { buzz_window_seconds: true },
    });
    const buzzWindowMs = (session?.buzz_window_seconds ?? 10) * 1000;

    // Si le joueur a déjà une bonne réponse pour ce track, on refuse — il a
    // déjà ses points, pas besoin de re-buzzer.
    if (hasCorrectAnswer(req.params.roundId, auth.participantId)) {
      console.info(
        `[Server][Buzz] Refused | session=${req.params.id} | playerId=${auth.participantId} | reason=ALREADY_ANSWERED`,
      );
      res.status(409).json({
        error: { code: 'ALREADY_ANSWERED', message: 'Tu as déjà trouvé ce morceau' },
      });
      return;
    }

    const result = tryOpenBuzz(req.params.roundId, auth.participantId, buzzWindowMs);
    if ('error' in result) {
      const codeMap: Record<typeof result.error, number> = {
        NO_TRACK: 404,
        PHASE_LOCKED: 409,
        COOLDOWN: 429,
        ALREADY_BUZZING: 409,
      };
      console.info(
        `[Server][Buzz] Refused | session=${req.params.id} | playerId=${auth.participantId} | reason=${result.error}`,
      );
      res.status(codeMap[result.error]).json({
        error: { code: result.error, message: 'Buzz refusé' },
      });
      return;
    }

    console.info(
      `[Server][Buzz] Accepted | session=${req.params.id} | playerId=${auth.participantId} | buzzed_at_ms=${result.buzz.buzzed_at_ms} | window=${buzzWindowMs}ms`,
    );

    // Broadcast multi-buzz : utile à l'iPad pour afficher "X joueurs en train
    // de chercher" et au tel des autres pour adapter leur UI éventuellement.
    broadcastToSession(req.params.id, 'buzz:received', {
      round_id: req.params.roundId,
      participant_id: auth.participantId,
      participant_pseudo: participant.pseudo,
      buzzed_at_ms: result.buzz.buzzed_at_ms,
      expires_at_ms: result.buzz.expires_at_ms,
    });

    res.json({
      ok: true,
      buzz_window_ms: buzzWindowMs,
      buzzed_at_ms: result.buzz.buzzed_at_ms,
      expires_at_ms: result.buzz.expires_at_ms,
    });
  },
);

// ── POST /voice-answer ───────────────────────────────────────────────────
// Upload de l'audio enregistré (multipart). Transcrit via Whisper, match
// fuzzy contre artiste+titre+aliases du track courant, calcule le score
// dégressif, persiste un ScoreEvent + log dans voice_transcripts.
//
// Body multipart :
//   - audio (file, requis) : webm/mp4 capturé par MediaRecorder côté tel
//   - token (texte, requis) : JWT participant

router.post(
  '/voice-answer',
  upload.single('audio'),
  async (req: Request<{ id: string; roundId: string }>, res: Response): Promise<void> => {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    if (!token) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'token requis' } });
      return;
    }
    const audioFile = (req as Request & { file?: Express.Multer.File }).file;
    if (!audioFile) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'audio requis' } });
      return;
    }

    const auth = verifyParticipantOrFail(req, res, token);
    if (!auth) return;

    const participant = await prisma.participant.findUnique({
      where: { id: auth.participantId },
      select: { id: true, pseudo: true, team_id: true, is_kicked: true, session_id: true },
    });
    if (!participant || participant.is_kicked || participant.session_id !== req.params.id) {
      res
        .status(403)
        .json({ error: { code: 'PARTICIPANT_INVALID', message: 'Participant invalide' } });
      return;
    }

    // Ferme le buzz côté gameState (on n'attend plus l'audio de ce joueur).
    closeBuzz(req.params.roundId, auth.participantId);

    const active = getActiveTrack(req.params.roundId);
    if (!active) {
      res.status(409).json({ error: { code: 'NO_TRACK', message: 'Pas de track en cours' } });
      return;
    }

    // Si le joueur a déjà trouvé ce track, on n'enregistre rien (re-buzz tardif).
    if (hasCorrectAnswer(req.params.roundId, auth.participantId)) {
      res.json({ matched: false, alreadyAnswered: true });
      return;
    }

    // Récup track + artiste pour le matching.
    const track = await prisma.track.findUnique({
      where: { id: active.track_id },
      include: { artist: true },
    });
    if (!track) {
      res.status(500).json({ error: { code: 'TRACK_LOST', message: 'Track introuvable' } });
      return;
    }

    // Récup langue de la session pour Whisper.
    const session = await prisma.session.findUnique({
      where: { id: req.params.id },
      select: { language: true },
    });
    const language = session?.language ?? 'fr';

    // Transcription Whisper.
    let transcript = '';
    try {
      const result = await transcribeAudio({
        audio: audioFile.buffer,
        filename: audioFile.originalname || 'buzz.webm',
        language,
      });
      transcript = result.text;
    } catch (err: unknown) {
      if (err instanceof WhisperError) {
        console.warn('[voice-answer] whisper error:', err.code, err.message);
        // En cas d'erreur Whisper, on log un transcript vide et on continue
        // — pas de score, pas de pénalité.
      } else {
        console.error('[voice-answer] unexpected error:', err);
      }
    }

    // Matching fuzzy.
    const matchResult = matchTranscript({
      transcript,
      artist: { canonical_name: track.artist.canonical_name, aliases: track.artist.aliases },
      track: { canonical_title: track.canonical_title, aliases: track.aliases },
    });

    // Log toutes les transcriptions (même les ratées) pour l'auto-apprentissage V1.1.
    await prisma.voiceTranscript
      .create({
        data: {
          session_id: req.params.id,
          participant_id: auth.participantId,
          track_id: track.id,
          transcript: transcript.slice(0, 1000),
          matched_artist: matchResult.matched_artist,
          matched_title: matchResult.matched_title,
          confidence: matchResult.confidence,
        },
      })
      .catch((err) => console.warn('[voice-answer] log error:', err));

    if (!matchResult.matched_artist) {
      // Pas de match → pas de score, pas de pénalité, le joueur peut rebuzzer.
      res.json({
        matched: false,
        transcript: matchResult.transcript_normalized,
      });
      return;
    }

    // L'artiste est trouvé : on enregistre la bonne réponse + on calcule le score.
    // Le scoring nécessite la position (1, 2, 3...), qu'on calcule provisoirement
    // pour passer à computeAnswerScore. On va recalculer avec le score réel
    // et persister.
    const tentativePosition = (active.correct_answers.length ?? 0) + 1;
    const tentativeScore = computeAnswerScore({
      matched_artist: true,
      matched_title: matchResult.matched_title,
      position: tentativePosition,
      answered_at_ms: Date.now() - active.started_at_ms,
    });

    const registered = registerCorrectAnswer(req.params.roundId, {
      participant_id: auth.participantId,
      pseudo: participant.pseudo,
      team_id: participant.team_id,
      matched_artist: true,
      matched_title: matchResult.matched_title,
      score: tentativeScore.total,
      score_position: tentativeScore.artist_base,
      score_title_bonus: tentativeScore.title_bonus,
      score_speed_bonus: tentativeScore.speed_bonus,
    });
    if (!registered) {
      // Race condition (phase 2 expirée pendant le traitement) : on log mais
      // on ne donne pas de points.
      res.json({
        matched: true,
        scored: false,
        reason: 'PHASE_2_EXPIRED',
        transcript: matchResult.transcript_normalized,
      });
      return;
    }

    // Persiste les ScoreEvent (un ARTIST_FOUND + éventuellement TITLE_BONUS + SPEED_BONUS).
    await persistScoreEvents({
      sessionId: req.params.id,
      sessionRoundId: req.params.roundId,
      participantId: participant.id,
      teamId: participant.team_id,
      trackIndex: active.track_index,
      breakdown: tentativeScore,
      matchedTitle: matchResult.matched_title,
      buzzTimeMs: registered.entry.answered_at_ms,
      transcriptPreview: matchResult.transcript_normalized.slice(0, 200),
    });

    // Compute la cumulative à inclure dans le broadcast — permet aux
    // téléphones joueurs d'afficher leur position dans le footer (myRank
    // dans le PhoneFooter de la maquette 07) sans avoir besoin d'un
    // endpoint REST master-only.
    const sessionForCumul = await prisma.session.findUnique({
      where: { id: req.params.id },
      select: {
        mode: true,
        teams_config: true,
        participants: {
          where: { is_kicked: false },
          select: { id: true, pseudo: true, team_id: true },
        },
      },
    });
    const cumulative = sessionForCumul
      ? await getCumulativeScores({
          sessionId: req.params.id,
          mode: sessionForCumul.mode as GameMode,
          teams: (sessionForCumul.teams_config as Team[] | null) ?? null,
          participants: sessionForCumul.participants,
        })
      : [];

    // Broadcast la bonne réponse à tous (l'iPad festif l'affiche en toast XL,
    // les téléphones autres adaptent leur UI + footer position).
    broadcastToSession(req.params.id, 'track:correct_answer', {
      round_id: req.params.roundId,
      track_index: active.track_index,
      participant_id: participant.id,
      pseudo: participant.pseudo,
      team_id: participant.team_id,
      position: registered.entry.position,
      answered_at_ms: registered.entry.answered_at_ms,
      matched_artist: true,
      matched_title: matchResult.matched_title,
      score: registered.entry.score,
      score_position: registered.entry.score_position,
      score_title_bonus: registered.entry.score_title_bonus,
      score_speed_bonus: registered.entry.score_speed_bonus,
      cumulative,
    });

    // Si c'est la 1ʳᵉ bonne réponse → on broadcast le passage en phase 2 +
    // on programme le passage en phase 3 dans 15s.
    if (registered.isFirst) {
      broadcastToSession(req.params.id, 'track:phase_changed', {
        round_id: req.params.roundId,
        phase: 'phase2',
        phase2_started_at: new Date().toISOString(),
        artist: track.artist.canonical_name,
        title: track.canonical_title,
      });
      schedulePhase3Transition(req.params.id, req.params.roundId);
    }

    res.json({
      matched: true,
      scored: true,
      transcript: matchResult.transcript_normalized,
      position: registered.entry.position,
      score: registered.entry.score,
      breakdown: tentativeScore,
    });
  },
);

// ── POST /text-answer ────────────────────────────────────────────────────
// Refonte #3 — saisie texte alternative au buzz vocal. Le joueur peut écrire
// la réponse au lieu de la prononcer. Même logique de matching + scoring +
// broadcast que /voice-answer, sans Whisper.
//
// Body JSON :
//   - token (string, requis) : JWT participant
//   - text  (string, requis) : réponse écrite (max 200 chars)

const textAnswerSchema = z.object({
  token: z.string().min(1),
  text: z.string().trim().min(1).max(200),
});

router.post(
  '/text-answer',
  async (req: Request<{ id: string; roundId: string }>, res: Response): Promise<void> => {
    const parsed = textAnswerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'token + text requis' } });
      return;
    }
    const { token, text } = parsed.data;

    const auth = verifyParticipantOrFail(req, res, token);
    if (!auth) return;

    const participant = await prisma.participant.findUnique({
      where: { id: auth.participantId },
      select: { id: true, pseudo: true, team_id: true, is_kicked: true, session_id: true },
    });
    if (!participant || participant.is_kicked || participant.session_id !== req.params.id) {
      res
        .status(403)
        .json({ error: { code: 'PARTICIPANT_INVALID', message: 'Participant invalide' } });
      return;
    }

    // Pas de closeBuzz (texte = pas de fenêtre micro ouverte).
    const active = getActiveTrack(req.params.roundId);
    if (!active) {
      res.status(409).json({ error: { code: 'NO_TRACK', message: 'Pas de track en cours' } });
      return;
    }

    if (hasCorrectAnswer(req.params.roundId, auth.participantId)) {
      res.json({ matched: false, alreadyAnswered: true });
      return;
    }

    const track = await prisma.track.findUnique({
      where: { id: active.track_id },
      include: { artist: true },
    });
    if (!track) {
      res.status(500).json({ error: { code: 'TRACK_LOST', message: 'Track introuvable' } });
      return;
    }

    // Matching fuzzy (même logique que voice-answer).
    const matchResult = matchTranscript({
      transcript: text,
      artist: { canonical_name: track.artist.canonical_name, aliases: track.artist.aliases },
      track: { canonical_title: track.canonical_title, aliases: track.aliases },
    });

    // Log dans voice_transcripts pour cohérence stats (source = "text").
    await prisma.voiceTranscript
      .create({
        data: {
          session_id: req.params.id,
          participant_id: auth.participantId,
          track_id: track.id,
          transcript: `[TEXT] ${text.slice(0, 980)}`,
          matched_artist: matchResult.matched_artist,
          matched_title: matchResult.matched_title,
          confidence: matchResult.confidence,
        },
      })
      .catch((err) => console.warn('[text-answer] log error:', err));

    if (!matchResult.matched_artist) {
      res.json({ matched: false });
      return;
    }

    const tentativePosition = (active.correct_answers.length ?? 0) + 1;
    const tentativeScore = computeAnswerScore({
      matched_artist: true,
      matched_title: matchResult.matched_title,
      position: tentativePosition,
      answered_at_ms: Date.now() - active.started_at_ms,
    });

    const registered = registerCorrectAnswer(req.params.roundId, {
      participant_id: auth.participantId,
      pseudo: participant.pseudo,
      team_id: participant.team_id,
      matched_artist: true,
      matched_title: matchResult.matched_title,
      score: tentativeScore.total,
      score_position: tentativeScore.artist_base,
      score_title_bonus: tentativeScore.title_bonus,
      score_speed_bonus: tentativeScore.speed_bonus,
    });
    if (!registered) {
      res.json({ matched: true, scored: false, reason: 'PHASE_2_EXPIRED' });
      return;
    }

    await persistScoreEvents({
      sessionId: req.params.id,
      sessionRoundId: req.params.roundId,
      participantId: participant.id,
      teamId: participant.team_id,
      trackIndex: active.track_index,
      breakdown: tentativeScore,
      matchedTitle: matchResult.matched_title,
      buzzTimeMs: registered.entry.answered_at_ms,
      transcriptPreview: `[TEXT] ${text.slice(0, 200)}`,
    });

    const sessionForCumul = await prisma.session.findUnique({
      where: { id: req.params.id },
      select: {
        mode: true,
        teams_config: true,
        participants: {
          where: { is_kicked: false },
          select: { id: true, pseudo: true, team_id: true },
        },
      },
    });
    const cumulative = sessionForCumul
      ? await getCumulativeScores({
          sessionId: req.params.id,
          mode: sessionForCumul.mode as GameMode,
          teams: (sessionForCumul.teams_config as Team[] | null) ?? null,
          participants: sessionForCumul.participants,
        })
      : [];

    broadcastToSession(req.params.id, 'track:correct_answer', {
      round_id: req.params.roundId,
      track_index: active.track_index,
      participant_id: participant.id,
      pseudo: participant.pseudo,
      team_id: participant.team_id,
      position: registered.entry.position,
      answered_at_ms: registered.entry.answered_at_ms,
      matched_artist: true,
      matched_title: matchResult.matched_title,
      score: registered.entry.score,
      score_position: registered.entry.score_position,
      score_title_bonus: registered.entry.score_title_bonus,
      score_speed_bonus: registered.entry.score_speed_bonus,
      cumulative,
    });

    if (registered.isFirst) {
      broadcastToSession(req.params.id, 'track:phase_changed', {
        round_id: req.params.roundId,
        phase: 'phase2',
        phase2_started_at: new Date().toISOString(),
        artist: track.artist.canonical_name,
        title: track.canonical_title,
      });
      schedulePhase3Transition(req.params.id, req.params.roundId);
    }

    res.json({
      matched: true,
      scored: true,
      position: registered.entry.position,
      score: registered.entry.score,
      breakdown: tentativeScore,
    });
  },
);

// ── Helpers internes ─────────────────────────────────────────────────────

interface PersistArgs {
  sessionId: string;
  sessionRoundId: string;
  participantId: string;
  teamId: string | null;
  trackIndex: number;
  breakdown: ReturnType<typeof computeAnswerScore>;
  matchedTitle: boolean;
  buzzTimeMs: number;
  transcriptPreview: string;
}

async function persistScoreEvents(args: PersistArgs): Promise<void> {
  const events: Promise<unknown>[] = [];
  if (args.breakdown.artist_base > 0) {
    events.push(
      prisma.scoreEvent.create({
        data: {
          session_id: args.sessionId,
          session_round_id: args.sessionRoundId,
          participant_id: args.participantId,
          team_id: args.teamId,
          round_index: args.trackIndex,
          type: ScoreEventType.ARTIST_FOUND,
          points: args.breakdown.artist_base,
          buzz_time_ms: args.buzzTimeMs,
          match_artist: true,
          match_title: args.matchedTitle,
          voice_transcript: args.transcriptPreview,
        },
      }),
    );
  }
  if (args.breakdown.title_bonus > 0) {
    events.push(
      prisma.scoreEvent.create({
        data: {
          session_id: args.sessionId,
          session_round_id: args.sessionRoundId,
          participant_id: args.participantId,
          team_id: args.teamId,
          round_index: args.trackIndex,
          type: ScoreEventType.TITLE_BONUS,
          points: args.breakdown.title_bonus,
          match_artist: true,
          match_title: true,
        },
      }),
    );
  }
  if (args.breakdown.speed_bonus > 0) {
    events.push(
      prisma.scoreEvent.create({
        data: {
          session_id: args.sessionId,
          session_round_id: args.sessionRoundId,
          participant_id: args.participantId,
          team_id: args.teamId,
          round_index: args.trackIndex,
          type: ScoreEventType.SPEED_BONUS,
          points: args.breakdown.speed_bonus,
          buzz_time_ms: args.buzzTimeMs,
          match_artist: true,
          match_title: args.matchedTitle,
        },
      }),
    );
  }
  await Promise.all(events);
}

/**
 * Programme le passage automatique en phase 3 après PHASE_2_DURATION_MS
 * (15s par défaut). Si le master skip ou give-answer entre temps, le timer
 * est annulé via clearActiveTrack ailleurs (le timer vérifie la phase
 * courante avant de transitionner).
 */
function schedulePhase3Transition(sessionId: string, roundId: string): void {
  // Annule un timer précédent éventuel (paranoïa).
  const existing = phase2Timers.get(roundId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    phase2Timers.delete(roundId);
    const active = getActiveTrack(roundId);
    if (!active || active.phase !== 'phase2') return; // déjà passé en phase 3
    setPhase3(roundId);
    broadcastToSession(sessionId, 'track:phase_changed', {
      round_id: roundId,
      phase: 'phase3',
    });
  }, 15_000);
  phase2Timers.set(roundId, timer);
}

// ─────────────────────────────────────────────────────────────────────────────
// feat/voice-cascade-l1-l2 — Cascade voice routes
// ─────────────────────────────────────────────────────────────────────────────
//
// Architecture cascade côté backend :
//   - POST /voice-match-text  : niveau 1 (Web Speech transcript) — no audio,
//     instantané. Frontend décide escalade selon le score retourné (≥80 ok,
//     <30 abandon, 30-79 escalade L2).
//   - POST /voice-transcribe-deepgram : niveau 2 — multipart audio. Backend
//     transcrit via Deepgram Nova-3 + Keyterm Prompting (titre + artiste),
//     match fuzzy, fallback ultime sur Whisper si Deepgram timeout/erreur.
//
// Les 2 routes partagent `runMatchAndCommit()` qui calcule un score 0-100
// (matchAnswer), commit (score + broadcast) si ≥ VOICE_MATCH_THRESHOLD, sinon
// retourne le score brut pour permettre la décision côté frontend.
//
// Compat : /voice-answer (Whisper, /text-answer (texte saisi) restent en place
// pour ne pas casser les clients existants. Les nouvelles routes sont
// purement additives.

interface CascadeMatchCommitArgs {
  sessionId: string;
  roundId: string;
  participantId: string;
  participantPseudo: string;
  participantTeamId: string | null;
  transcript: string;
  /** Provenance ("web-speech", "deepgram", "whisper-fallback", "assemblyai") — log + DB. */
  source: string;
  /** Trace technique (Deepgram OK / fallback Whisper) — log only. */
  level: 'L1' | 'L2' | 'L3' | 'L3-fallback';
  /** Si présent, persist dans voice_transcripts (sinon skip log). */
  persistTranscript?: boolean;
  /** feat/voice-cascade-l3-assemblyai — latence côté backend pour analytics. */
  latencyMs?: number;
}

interface CascadeMatchCommitResult {
  matched: boolean;
  scored: boolean;
  /** Score combiné 0-100 (lib/voiceMatching). */
  score: number;
  /** Cible matchée (title vs artist_title). */
  target: 'title' | 'artist_title' | null;
  /** Transcript normalisé pour la réponse / debug. */
  transcript_normalized: string;
  position?: number;
  total_score?: number;
  breakdown?: ReturnType<typeof computeAnswerScore>;
  reason?: string;
}

/**
 * Cœur de la cascade : reçoit un transcript déjà obtenu (Web Speech, Deepgram
 * ou Whisper), calcule le score, et commit (broadcast + persist ScoreEvent) si
 * ≥ VOICE_MATCH_THRESHOLD. Mutualisé entre /voice-match-text et /voice-transcribe-deepgram.
 *
 * Gère aussi les aliases (title.aliases, artist.aliases) en testant chaque
 * combinaison title/artist possible et gardant le meilleur score.
 */
async function runMatchAndCommit(
  args: CascadeMatchCommitArgs,
): Promise<CascadeMatchCommitResult | { error: string; status: number }> {
  const active = getActiveTrack(args.roundId);
  if (!active) return { error: 'NO_TRACK', status: 409 };

  if (hasCorrectAnswer(args.roundId, args.participantId)) {
    return {
      matched: false,
      scored: false,
      score: 0,
      target: null,
      transcript_normalized: args.transcript,
      reason: 'ALREADY_ANSWERED',
    };
  }

  const track = await prisma.track.findUnique({
    where: { id: active.track_id },
    include: { artist: true },
  });
  if (!track) return { error: 'TRACK_LOST', status: 500 };

  // Combinaisons title + artist (canonical + aliases) — best score gagne.
  const titleCandidates = [track.canonical_title, ...(track.aliases ?? [])].filter(
    (s) => typeof s === 'string' && s.length > 0,
  );
  const artistCandidates = [track.artist.canonical_name, ...(track.artist.aliases ?? [])].filter(
    (s) => typeof s === 'string' && s.length > 0,
  );

  let best = { score: 0, target: 'title' as 'title' | 'artist_title' };
  for (const title of titleCandidates) {
    for (const artist of artistCandidates) {
      const r = matchAnswer(args.transcript, { title, artist });
      if (r.score > best.score) best = { score: r.score, target: r.target };
    }
  }

  // Log voice_transcript (optionnel — frontend peut en spammer plusieurs L1 par
  // tap, on persiste uniquement les "commits" intéressants).
  if (args.persistTranscript) {
    await prisma.voiceTranscript
      .create({
        data: {
          session_id: args.sessionId,
          participant_id: args.participantId,
          track_id: track.id,
          transcript: `[${args.source}] ${args.transcript.slice(0, 980)}`,
          matched_artist: best.score >= VOICE_MATCH_THRESHOLD,
          matched_title: best.score >= VOICE_MATCH_THRESHOLD && best.target === 'artist_title',
          confidence: best.score / 100,
          level: args.source,
          latency_ms: args.latencyMs,
        },
      })
      .catch((err) => console.warn('[voice-cascade] log error:', err));
  }

  console.info(
    `[Voice] ${args.level} ${args.source}: "${args.transcript.slice(0, 80)}" score=${best.score}% target=${best.target} threshold=${VOICE_MATCH_THRESHOLD}`,
  );

  if (best.score < VOICE_MATCH_THRESHOLD) {
    // Pas de commit — frontend décide quoi faire (escalade ou abandon).
    return {
      matched: false,
      scored: false,
      score: best.score,
      target: best.target,
      transcript_normalized: args.transcript,
    };
  }

  // Score ≥ threshold → commit (broadcast + ScoreEvent).
  const matchedTitle = best.target === 'artist_title';
  const tentativePosition = (active.correct_answers.length ?? 0) + 1;
  const tentativeScore = computeAnswerScore({
    matched_artist: true,
    matched_title: matchedTitle,
    position: tentativePosition,
    answered_at_ms: Date.now() - active.started_at_ms,
  });

  const registered = registerCorrectAnswer(args.roundId, {
    participant_id: args.participantId,
    pseudo: args.participantPseudo,
    team_id: args.participantTeamId,
    matched_artist: true,
    matched_title: matchedTitle,
    score: tentativeScore.total,
    score_position: tentativeScore.artist_base,
    score_title_bonus: tentativeScore.title_bonus,
    score_speed_bonus: tentativeScore.speed_bonus,
  });
  if (!registered) {
    return {
      matched: true,
      scored: false,
      score: best.score,
      target: best.target,
      transcript_normalized: args.transcript,
      reason: 'PHASE_2_EXPIRED',
    };
  }

  await persistScoreEvents({
    sessionId: args.sessionId,
    sessionRoundId: args.roundId,
    participantId: args.participantId,
    teamId: args.participantTeamId,
    trackIndex: active.track_index,
    breakdown: tentativeScore,
    matchedTitle,
    buzzTimeMs: registered.entry.answered_at_ms,
    transcriptPreview: `[${args.source}] ${args.transcript.slice(0, 200)}`,
  });

  // Compute cumulative pour broadcast (cf. /voice-answer existant).
  const sessionForCumul = await prisma.session.findUnique({
    where: { id: args.sessionId },
    select: {
      mode: true,
      teams_config: true,
      participants: {
        where: { is_kicked: false },
        select: { id: true, pseudo: true, team_id: true },
      },
    },
  });
  const cumulative = sessionForCumul
    ? await getCumulativeScores({
        sessionId: args.sessionId,
        mode: sessionForCumul.mode as GameMode,
        teams: (sessionForCumul.teams_config as Team[] | null) ?? null,
        participants: sessionForCumul.participants,
      })
    : [];

  broadcastToSession(args.sessionId, 'track:correct_answer', {
    round_id: args.roundId,
    track_index: active.track_index,
    participant_id: args.participantId,
    pseudo: args.participantPseudo,
    team_id: args.participantTeamId,
    position: registered.entry.position,
    answered_at_ms: registered.entry.answered_at_ms,
    matched_artist: true,
    matched_title: matchedTitle,
    score: registered.entry.score,
    score_position: registered.entry.score_position,
    score_title_bonus: registered.entry.score_title_bonus,
    score_speed_bonus: registered.entry.score_speed_bonus,
    cumulative,
  });

  if (registered.isFirst) {
    broadcastToSession(args.sessionId, 'track:phase_changed', {
      round_id: args.roundId,
      phase: 'phase2',
      phase2_started_at: new Date().toISOString(),
      artist: track.artist.canonical_name,
      title: track.canonical_title,
    });
    schedulePhase3Transition(args.sessionId, args.roundId);
  }

  return {
    matched: true,
    scored: true,
    score: best.score,
    target: best.target,
    transcript_normalized: args.transcript,
    position: registered.entry.position,
    total_score: registered.entry.score,
    breakdown: tentativeScore,
  };
}

// ── POST /voice-match-text — niveau 1 cascade (Web Speech transcript) ────
//
// Body JSON :
//   - token (string, requis)
//   - transcript (string, requis, max 500 chars)
//   - source (string, optionnel) — par défaut "web-speech"
//
// Réponse :
//   - matched (bool) : true si commit (≥ VOICE_MATCH_THRESHOLD)
//   - scored (bool) : true si points enregistrés
//   - score (number 0-100)
//   - transcript_normalized (string)
//   - level ('L1') + threshold + give_up_threshold pour debug frontend

const matchTextSchema = z.object({
  token: z.string().min(1),
  transcript: z.string().trim().min(1).max(500),
  source: z.string().optional(),
});

router.post(
  '/voice-match-text',
  async (req: Request<{ id: string; roundId: string }>, res: Response): Promise<void> => {
    const parsed = matchTextSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: { code: 'VALIDATION_ERROR', message: 'token + transcript requis' } });
      return;
    }
    const { token, transcript, source } = parsed.data;

    const auth = verifyParticipantOrFail(req, res, token);
    if (!auth) return;

    const participant = await prisma.participant.findUnique({
      where: { id: auth.participantId },
      select: { id: true, pseudo: true, team_id: true, is_kicked: true, session_id: true },
    });
    if (!participant || participant.is_kicked || participant.session_id !== req.params.id) {
      res
        .status(403)
        .json({ error: { code: 'PARTICIPANT_INVALID', message: 'Participant invalide' } });
      return;
    }

    const result = await runMatchAndCommit({
      sessionId: req.params.id,
      roundId: req.params.roundId,
      participantId: participant.id,
      participantPseudo: participant.pseudo,
      participantTeamId: participant.team_id,
      transcript,
      source: source ?? 'web-speech',
      level: 'L1',
      // L1 ne persiste un transcript que si matched (sinon spam DB).
      persistTranscript: false,
    });

    if ('error' in result) {
      res.status(result.status).json({ error: { code: result.error, message: result.error } });
      return;
    }

    // Close buzz only if scored (sinon le joueur peut encore escalader L2 et
    // tenter de récupérer son buzz).
    if (result.scored) {
      closeBuzz(req.params.roundId, auth.participantId);
    }

    res.json({
      level: 'L1' as const,
      matched: result.matched,
      scored: result.scored,
      score: result.score,
      target: result.target,
      transcript: result.transcript_normalized,
      threshold: VOICE_MATCH_THRESHOLD,
      give_up_threshold: VOICE_MATCH_GIVEUP_THRESHOLD,
      position: result.position,
      total_score: result.total_score,
      breakdown: result.breakdown,
      reason: result.reason,
    });
  },
);

// ── POST /voice-transcribe-deepgram — niveau 2 cascade (audio) ───────────
//
// Body multipart :
//   - audio (file, requis) : Blob Opus/webm capturé côté tel
//   - token (texte, requis) : JWT participant
//   - language (texte, optionnel) : "fr" | "en" | "multi" (défaut "multi")
//
// Backend :
//   1. Récupère track + artiste (pour Keyterm Prompting Deepgram)
//   2. Tente Deepgram Nova-3 avec keyterms=[title, artist]
//   3. Si Deepgram échoue (timeout/erreur réseau) → fallback Whisper (lent
//      mais robuste). On signale le fallback via level='L3-fallback' pour les
//      logs.
//   4. Score + commit via runMatchAndCommit
//
// Réponse identique à /voice-match-text + level='L2' ou 'L3-fallback'.

router.post(
  '/voice-transcribe-deepgram',
  upload.single('audio'),
  async (req: Request<{ id: string; roundId: string }>, res: Response): Promise<void> => {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    if (!token) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'token requis' } });
      return;
    }
    const audioFile = (req as Request & { file?: Express.Multer.File }).file;
    if (!audioFile) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'audio requis' } });
      return;
    }

    const auth = verifyParticipantOrFail(req, res, token);
    if (!auth) return;

    const participant = await prisma.participant.findUnique({
      where: { id: auth.participantId },
      select: { id: true, pseudo: true, team_id: true, is_kicked: true, session_id: true },
    });
    if (!participant || participant.is_kicked || participant.session_id !== req.params.id) {
      res
        .status(403)
        .json({ error: { code: 'PARTICIPANT_INVALID', message: 'Participant invalide' } });
      return;
    }

    // Toujours close le buzz (joueur a uploadé son audio, on n'attend plus).
    closeBuzz(req.params.roundId, auth.participantId);

    // Récup track pour Keyterm Prompting.
    const active = getActiveTrack(req.params.roundId);
    if (!active) {
      res.status(409).json({ error: { code: 'NO_TRACK', message: 'Pas de track en cours' } });
      return;
    }
    const track = await prisma.track.findUnique({
      where: { id: active.track_id },
      include: { artist: true },
    });
    if (!track) {
      res.status(500).json({ error: { code: 'TRACK_LOST', message: 'Track introuvable' } });
      return;
    }

    const session = await prisma.session.findUnique({
      where: { id: req.params.id },
      select: { language: true },
    });
    const sessionLang = session?.language ?? 'fr';
    // Deepgram "multi" Nova-3 couvre FR+EN. Fallback FR si env force.
    const dgLang = process.env.DEEPGRAM_LANGUAGE ?? 'multi';

    const keyterms = [track.canonical_title, track.artist.canonical_name].filter(
      (s): s is string => typeof s === 'string' && s.length > 0,
    );

    // fix/ios-voice-cascade-mic-and-buzz-refused — log explicite du codec reçu
    // pour diagnostiquer iOS audio/mp4 vs Chrome audio/webm en cas de match raté.
    console.info(
      `[Server][Voice L2] Deepgram call | session=${req.params.id} | playerId=${auth.participantId} | trackTitle="${track.canonical_title}" | trackArtist="${track.artist.canonical_name}" | mime=${audioFile.mimetype || '(none)'} | size=${Math.round(audioFile.buffer.byteLength / 1024)}KB`,
    );

    let transcript = '';
    let level: 'L2' | 'L3-fallback' = 'L2';
    let source = 'deepgram';

    // Tente Deepgram (Nova-3).
    try {
      const dgRes = await transcribeWithDeepgram({
        audio: audioFile.buffer,
        contentType: audioFile.mimetype || 'audio/webm',
        language: dgLang,
        keyterms,
      });
      transcript = dgRes.text;
    } catch (err: unknown) {
      if (err instanceof DeepgramError) {
        console.warn('[voice-cascade] Deepgram error → Whisper fallback:', err.code, err.message);
      } else {
        console.error('[voice-cascade] Deepgram unexpected → Whisper fallback:', err);
      }
      // Fallback Whisper (lent mais fiable).
      level = 'L3-fallback';
      source = 'whisper-fallback';
      try {
        const w = await transcribeAudio({
          audio: audioFile.buffer,
          filename: audioFile.originalname || 'buzz.webm',
          language: sessionLang,
        });
        transcript = w.text;
      } catch (err2: unknown) {
        if (err2 instanceof WhisperError) {
          console.warn('[voice-cascade] Whisper fallback error:', err2.code, err2.message);
        } else {
          console.error('[voice-cascade] Whisper unexpected error:', err2);
        }
        // Pire cas : aucun transcript → on continue avec '' (score = 0).
      }
    }

    const result = await runMatchAndCommit({
      sessionId: req.params.id,
      roundId: req.params.roundId,
      participantId: participant.id,
      participantPseudo: participant.pseudo,
      participantTeamId: participant.team_id,
      transcript,
      source,
      level,
      // L2 toujours persiste (un upload audio = événement significatif).
      persistTranscript: true,
    });

    if ('error' in result) {
      res.status(result.status).json({ error: { code: result.error, message: result.error } });
      return;
    }

    res.json({
      level,
      matched: result.matched,
      scored: result.scored,
      score: result.score,
      target: result.target,
      transcript: result.transcript_normalized,
      threshold: VOICE_MATCH_THRESHOLD,
      give_up_threshold: VOICE_MATCH_GIVEUP_THRESHOLD,
      position: result.position,
      total_score: result.total_score,
      breakdown: result.breakdown,
      reason: result.reason,
    });
  },
);

// ── POST /voice-transcribe-assemblyai — niveau 3 cascade (AssemblyAI) ────
//
// 3ᵉ filet de sécurité : utilisé QUAND L1 (Web Speech) ET L2 (Deepgram) ont
// retourné un score insuffisant. AssemblyAI Universal-2 + word_boost a une
// précision supérieure sur les accents très prononcés / l'audio bruité au
// prix d'une latence plus haute (600-1500ms).
//
// Feature flag : `ENABLE_ASSEMBLYAI_FALLBACK=true` + `ASSEMBLYAI_API_KEY` set.
// Sans flag → 503 propre, le frontend skip L3 et conclut "rejeté".
//
// Body multipart :
//   - audio (file, requis) : Blob Opus/webm capturé par MediaRecorder
//   - token (texte, requis) : JWT participant
//
// Réponse JSON :
//   - level: 'L3'
//   - matched, scored, score (0-100), transcript, threshold, give_up_threshold
//   - latency_ms (côté AssemblyAI upload+transcript+poll)

router.post(
  '/voice-transcribe-assemblyai',
  upload.single('audio'),
  async (req: Request<{ id: string; roundId: string }>, res: Response): Promise<void> => {
    // ── Feature gate : si désactivé, 503 propre ──────────────────────
    if (!isAssemblyAIEnabled()) {
      res
        .status(503)
        .json({ error: { code: 'ASSEMBLYAI_DISABLED', message: 'AssemblyAI fallback désactivé' } });
      return;
    }

    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    if (!token) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'token requis' } });
      return;
    }
    const audioFile = (req as Request & { file?: Express.Multer.File }).file;
    if (!audioFile) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'audio requis' } });
      return;
    }

    const auth = verifyParticipantOrFail(req, res, token);
    if (!auth) return;

    const participant = await prisma.participant.findUnique({
      where: { id: auth.participantId },
      select: { id: true, pseudo: true, team_id: true, is_kicked: true, session_id: true },
    });
    if (!participant || participant.is_kicked || participant.session_id !== req.params.id) {
      res
        .status(403)
        .json({ error: { code: 'PARTICIPANT_INVALID', message: 'Participant invalide' } });
      return;
    }

    closeBuzz(req.params.roundId, auth.participantId);

    const active = getActiveTrack(req.params.roundId);
    if (!active) {
      res.status(409).json({ error: { code: 'NO_TRACK', message: 'Pas de track en cours' } });
      return;
    }
    const track = await prisma.track.findUnique({
      where: { id: active.track_id },
      include: { artist: true },
    });
    if (!track) {
      res.status(500).json({ error: { code: 'TRACK_LOST', message: 'Track introuvable' } });
      return;
    }

    const session = await prisma.session.findUnique({
      where: { id: req.params.id },
      select: { language: true },
    });
    const sessionLang = session?.language ?? 'fr';
    // AssemblyAI accepte 'fr'/'en' standard. On évite 'multi' (pas supporté côté Universal-2).
    const aaLang = sessionLang === 'fr' ? 'fr' : 'en';

    const keywords = [track.canonical_title, track.artist.canonical_name].filter(
      (s): s is string => typeof s === 'string' && s.length > 0,
    );

    // ── Transcription ────────────────────────────────────────────────
    let transcript = '';
    let latency_ms = 0;
    try {
      const aaRes = await transcribeWithAssemblyAI({
        audio: audioFile.buffer,
        contentType: audioFile.mimetype || 'audio/webm',
        language: aaLang,
        keywords,
      });
      transcript = aaRes.text;
      latency_ms = aaRes.latency_ms;
    } catch (err: unknown) {
      if (err instanceof AssemblyAIError) {
        console.warn('[voice-cascade] AssemblyAI error:', err.code, err.message);
      } else {
        console.error('[voice-cascade] AssemblyAI unexpected error:', err);
      }
      // Pas de fallback ici — c'est déjà le dernier niveau. Frontend sera
      // notifié via 503 et conclura "rejeté".
      res
        .status(503)
        .json({ error: { code: 'ASSEMBLYAI_FAILED', message: 'AssemblyAI échec — niveau final' } });
      return;
    }

    const result = await runMatchAndCommit({
      sessionId: req.params.id,
      roundId: req.params.roundId,
      participantId: participant.id,
      participantPseudo: participant.pseudo,
      participantTeamId: participant.team_id,
      transcript,
      source: 'assemblyai',
      level: 'L3',
      persistTranscript: true,
      latencyMs: latency_ms,
    });

    if ('error' in result) {
      res.status(result.status).json({ error: { code: result.error, message: result.error } });
      return;
    }

    res.json({
      level: 'L3' as const,
      matched: result.matched,
      scored: result.scored,
      score: result.score,
      target: result.target,
      transcript: result.transcript_normalized,
      threshold: VOICE_MATCH_THRESHOLD,
      give_up_threshold: VOICE_MATCH_GIVEUP_THRESHOLD,
      position: result.position,
      total_score: result.total_score,
      breakdown: result.breakdown,
      reason: result.reason,
      latency_ms,
    });
  },
);

export default router;
