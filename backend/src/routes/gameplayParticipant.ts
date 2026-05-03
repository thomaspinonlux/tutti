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
import { matchTranscript } from '../lib/voiceMatch.js';
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
      res.status(codeMap[result.error]).json({
        error: { code: result.error, message: 'Buzz refusé' },
      });
      return;
    }

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

export default router;
