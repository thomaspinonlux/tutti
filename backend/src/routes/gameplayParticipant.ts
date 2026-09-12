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
  PHASE_2_DURATION_MS,
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
import { decouperArtiste } from '../lib/aliases.js';
import type { MatchTarget } from '../lib/voiceMatching.js';
import { matchAnswer, couvreAssezDuTitre } from '../lib/voiceMatching.js';
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

    // fix/deux-moteurs-deux-regles — MEME MOTEUR QUE LA CASCADE.
    // Cette route de secours (Whisper direct, quand la cascade est
    // injoignable) appelait encore matchTranscript : un troisieme verdict
    // possible pour la meme phrase. Elle passe par le moteur commun.
    const result = await runMatchAndCommit({
      expectedTrackId: (req.body as { track_id?: string } | undefined)?.track_id,
      sessionId: req.params.id,
      roundId: req.params.roundId,
      participantId: participant.id,
      participantPseudo: participant.pseudo,
      participantTeamId: participant.team_id,
      transcript,
      source: 'whisper-direct',
      level: 'L3',
      persistTranscript: true,
    });

    if ('error' in result) {
      res.status(result.status).json({ error: { code: result.error, message: result.error } });
      return;
    }
    if (result.reason === 'ALREADY_ANSWERED') {
      res.json({ matched: false, alreadyAnswered: true });
      return;
    }

    res.json({
      matched: result.matched,
      scored: result.scored,
      score: result.score,
      target: result.target,
      transcript: result.transcript_normalized,
      position: result.position,
      total_score: result.total_score,
      breakdown: result.breakdown,
      reason: result.reason,
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

    // fix/deux-moteurs-deux-regles — LE CLAVIER PASSE PAR LE MEME MOTEUR QUE LA VOIX.
    //
    // Jusqu ici cette route appelait matchTranscript (voiceMatch.ts, n-grammes
    // + similarite floue) pendant que la voix passait par matchAnswer
    // (voiceMatching.ts, Levenshtein + phonetique + regle des deux moities).
    // Deux moteurs, deux verdicts pour la meme phrase. Mesure sur la soiree du
    // 11/09 : onze reponses acceptees au clavier auraient ete refusees a
    // l oral — « phill colins », « uptwon girl », « keicha », « somebody i
    // used to lnow », et surtout « listen to my heart » pour *Listen to Your
    // Heart*. Le meme joueur etait accepte s il ecrivait, refuse s il parlait.
    //
    // Desormais une seule regle, un seul seuil, un seul journal — et le
    // classement du titre, le bonus double et les points de position se
    // calculent de la meme facon quel que soit le moyen de repondre.
    const result = await runMatchAndCommit({
      expectedTrackId: (req.body as { track_id?: string } | undefined)?.track_id,
      sessionId: req.params.id,
      roundId: req.params.roundId,
      participantId: participant.id,
      participantPseudo: participant.pseudo,
      participantTeamId: participant.team_id,
      transcript: text,
      source: 'clavier',
      level: 'L1',
      persistTranscript: true,
    });

    if ('error' in result) {
      res.status(result.status).json({ error: { code: result.error, message: result.error } });
      return;
    }
    if (result.reason === 'ALREADY_ANSWERED') {
      res.json({ matched: false, alreadyAnswered: true });
      return;
    }

    res.json({
      matched: result.matched,
      scored: result.scored,
      score: result.score,
      target: result.target,
      position: result.position,
      total_score: result.total_score,
      breakdown: result.breakdown,
      reason: result.reason,
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
  matchedArtist: boolean;
  matchedTitle: boolean;
  buzzTimeMs: number;
  transcriptPreview: string;
}

async function persistScoreEvents(args: PersistArgs): Promise<void> {
  const events: Promise<unknown>[] = [];
  // Points de position (artiste OU titre). Type ARTIST_FOUND conservé (enum DB),
  // mais les flags match_* reflètent la réalité (titre seul → match_artist=false).
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
          match_artist: args.matchedArtist,
          match_title: args.matchedTitle,
          voice_transcript: args.transcriptPreview,
        },
      }),
    );
  }
  // Bonus "double réponse" (artiste ET titre). Type TITLE_BONUS conservé (enum DB).
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
          match_artist: args.matchedArtist,
          match_title: args.matchedTitle,
        },
      }),
    );
  }
  await Promise.all(events);
}

/**
 * Programme le passage automatique en phase 3 après PHASE_2_DURATION_MS (10 s).
 *
 * fix/reveal-timer-mismatch — avant, ce timer était codé en dur à 15 s alors
 * que le compte à rebours affiché (téléphones + TV) tombe à zéro à
 * PHASE_2_DURATION_MS (10 s), depuis le MÊME `phase2_started_at`. Résultat :
 * ~5 s de « blanc » entre la fin du compteur et la révélation. On utilise
 * désormais la constante → révélation synchronisée avec le compteur affiché.
 *
 * Si le master skip ou give-answer entre temps, le timer est annulé ailleurs
 * (le callback re-vérifie la phase courante avant de transitionner).
 */
function schedulePhase3Transition(sessionId: string, roundId: string): void {
  // Annule un timer précédent éventuel (paranoïa).
  const existing = phase2Timers.get(roundId);
  if (existing) clearTimeout(existing);

  // fix/buzzers-coupes-a-tort — ON MÉMORISE LE MORCEAU VISÉ.
  // Le minuteur de fin de phase 2 ne portait que l'identifiant de manche. S'il
  // se déclenchait après que l'animateur a enchaîné, il faisait basculer en
  // phase 3 le morceau qui venait de démarrer : buzzers coupés pour toute la
  // salle au bout de trois secondes. On vérifie désormais qu'on parle bien du
  // même morceau qu'à l'armement.
  const cible = getActiveTrack(roundId);
  const indexCible = cible?.track_index ?? -1;

  const timer = setTimeout(() => {
    phase2Timers.delete(roundId);
    const active = getActiveTrack(roundId);
    if (!active || active.phase !== 'phase2') return; // déjà passé en phase 3
    if (active.track_index !== indexCible) {
      console.info(
        `[phase2] minuteur périmé (visait le titre ${indexCible}, en cours : ${active.track_index}) — ignoré`,
      );
      return;
    }
    setPhase3(roundId);
    broadcastToSession(sessionId, 'track:phase_changed', {
      round_id: roundId,
      // fix/buzzers-coupes-a-tort — l'index part avec l'événement : les écrans
      // peuvent ainsi écarter un message qui ne concerne plus leur morceau.
      track_index: indexCible,
      phase: 'phase3',
    });
  }, PHASE_2_DURATION_MS);
  phase2Timers.set(roundId, timer);
}

/** Annule le minuteur de phase 2 d'une manche (fin de manche, enchaînement). */
export function cancelPhase2Timer(roundId: string): void {
  const existing = phase2Timers.get(roundId);
  if (existing) {
    clearTimeout(existing);
    phase2Timers.delete(roundId);
  }
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
  /**
   * feat/double-ecoute — autres transcriptions DU MEME ENREGISTREMENT (autre
   * langue de reconnaissance). Chaque moitie (artiste / titre) est prise au
   * meilleur score sur l ensemble des transcriptions : ce sont les memes
   * paroles, entendues deux fois.
   */
  transcriptsAlternatifs?: string[];
  /** Provenance ("web-speech", "deepgram", "whisper-fallback", "assemblyai") — log + DB. */
  source: string;
  /** Trace technique (Deepgram OK / fallback Whisper) — log only. */
  level: 'L1' | 'L2' | 'L3' | 'L3-fallback';
  /** Si présent, persist dans voice_transcripts (sinon skip log). */
  persistTranscript?: boolean;
  /** feat/voice-cascade-l3-assemblyai — latence côté backend pour analytics. */
  latencyMs?: number;
  /**
   * fix/reponse-comptee-sur-le-mauvais-titre — morceau visé par le joueur au
   * moment de son buzz. Si l'animateur a enchaîné pendant la transcription, la
   * réponse ne doit PAS être comparée au morceau suivant.
   */
  expectedTrackId?: string;
}

interface CascadeMatchCommitResult {
  matched: boolean;
  scored: boolean;
  /** Score combiné 0-100 (lib/voiceMatching). */
  score: number;
  /** Cible matchée (title vs artist_title). */
  target: MatchTarget | null;
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
/**
 * feat/titre-partiel — LES AUTRES TITRES DE LA MANCHE, POUR NE PAS ACCEPTER UN
 * BOUT DE TITRE AMBIGU.
 *
 * Un fragment n est accepte que s il ne designe QUE le morceau en cours. Si le
 * meme bout de phrase vaut aussi un autre titre de la manche, le joueur n a pas
 * prouve qu il connaissait celui-la. Les titres d une manche ne bougent plus
 * une fois la manche lancee : on les lit une fois.
 */
interface TitreDeManche {
  trackId: string;
  titre: string;
  artiste: string;
}
const titresParManche = new Map<string, TitreDeManche[]>();

/**
 * On ne garde que les huit dernieres manches : une soiree en compte huit, et le
 * serveur tourne des semaines sans redemarrer.
 */
function limiterLeCache(): void {
  while (titresParManche.size > 8) {
    const plusAncienne = titresParManche.keys().next().value;
    if (plusAncienne === undefined) break;
    titresParManche.delete(plusAncienne);
  }
}

async function titresDeLaManche(roundId: string, sauf: string): Promise<TitreDeManche[]> {
  let tous = titresParManche.get(roundId);
  if (!tous) {
    const round = await prisma.sessionRound.findUnique({
      where: { id: roundId },
      select: { selected_track_ids: true },
    });
    const ids = (round?.selected_track_ids ?? []).filter((id) => typeof id === 'string');
    const tracks = ids.length
      ? await prisma.track.findMany({
          where: { id: { in: ids } },
          select: { id: true, canonical_title: true, artist: { select: { canonical_name: true } } },
        })
      : [];
    tous = tracks.map((t) => ({
      trackId: t.id,
      titre: t.canonical_title,
      artiste: t.artist.canonical_name,
    }));
    titresParManche.set(roundId, tous);
    limiterLeCache();
  }
  return tous.filter((t) => t.trackId !== sauf);
}

async function runMatchAndCommit(
  args: CascadeMatchCommitArgs,
): Promise<CascadeMatchCommitResult | { error: string; status: number }> {
  const active = getActiveTrack(args.roundId);
  if (!active) return { error: 'NO_TRACK', status: 409 };

  // fix/reponse-comptee-sur-le-mauvais-titre — LA RÉPONSE DOIT VISER LE BON
  // MORCEAU. La transcription peut prendre plusieurs secondes ; si l'animateur
  // enchaîne pendant ce temps, l'ancienne réponse était comparée au NOUVEAU
  // morceau — elle consommait le buzz du joueur, et sur une ressemblance
  // phonétique elle lui donnait même les points du titre suivant.
  if (args.expectedTrackId && args.expectedTrackId !== active.track_id) {
    console.info(
      `[voix] réponse périmée (visait ${args.expectedTrackId}, en cours ${active.track_id}) — ignorée`,
    );
    return {
      matched: false,
      scored: false,
      score: 0,
      target: null,
      transcript_normalized: args.transcript,
      reason: 'MORCEAU_DEPASSE',
    };
  }

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

  // fix/points-sans-rien-dire — GARDE EN AMONT.
  // Une transcription vide ne doit jamais être évaluée : elle vient soit d'un
  // joueur qui n'a rien dit, soit d'une panne de reconnaissance. Dans les deux
  // cas, aucun point.
  const transcriptions = [args.transcript, ...(args.transcriptsAlternatifs ?? [])]
    .map((t) => (typeof t === 'string' ? t.trim() : ''))
    .filter((t) => t !== '');
  if (transcriptions.length === 0) {
    return {
      matched: false,
      scored: false,
      score: 0,
      target: null,
      transcript_normalized: '',
      reason: 'AUCUNE_PAROLE',
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
  // fix/featuring-nom-non-reconnu — « Sam Smith » sur « Disclosure feat. Sam
  // Smith » valait 54% : le nom dit etait compare au duo ENTIER. Nommer un des
  // deux artistes est pourtant une bonne reponse. decouperArtiste ajoute chaque
  // partie (feat., &, x, vs, avec…) comme candidat a part entiere.
  const artistCandidates = Array.from(
    new Set(
      [track.artist.canonical_name, ...(track.artist.aliases ?? [])]
        .filter((s): s is string => typeof s === 'string' && s.length > 0)
        .flatMap((nom) => [nom, ...decouperArtiste(nom)]),
    ),
  ).filter((s) => s.length > 0);

  // fix/les-deux-moities-sur-tous-les-alias — LA DECISION SE PREND SUR
  // L ENSEMBLE DES ALIAS, PAS SUR UNE SEULE PAIRE.
  //
  // On gardait la paire (titre, artiste) au meilleur score et sa cible. A
  // egalite de score, la premiere paire rencontree l emportait : pour « Kali
  // Uchis Cry about it! », la paire (titre, « Kali Uchis & Ravyn Lenae »)
  // donnait titre=100/artiste=faible -> cible 'title', et la paire (titre,
  // « Kali Uchis ») donnait titre=100/artiste=90 -> cible 'artist_title'.
  // Meme score 100, la premiere gagnait : bonus double perdu selon l ORDRE
  // des alias en base. Mesure sur 1 953 titres : 8 a 11 % des reponses
  // completes retombaient en « titre seul ».
  //
  // La question du jeu est « a-t-il dit l artiste ? a-t-il dit le titre ? ».
  // On prend donc le meilleur score de chaque moitie sur TOUTES les paires,
  // puis on decide. Independant de l ordre des alias, et de l ordre des mots.
  let meilleurTitre = 0;
  let meilleurArtiste = 0;
  let meilleurCombo = 0;
  // feat/double-ecoute — Test du 11/09 09:52, Sia « Chandelier », six buzz
  // d une syllabe : Deepgram (langue « multi ») a rendu « Ja. », « Hier. »,
  // « Ja. », « » — deux fois « Sia. » seulement. Un mot court et isole est
  // devine dans la mauvaise langue. Le meme enregistrement est desormais
  // aussi transcrit dans la langue de la soiree ; chaque moitie prend son
  // meilleur score sur l ensemble des transcriptions.
  for (const transcript of transcriptions) {
    for (const title of titleCandidates) {
      for (const artist of artistCandidates) {
        const r = matchAnswer(transcript, { title, artist }, VOICE_MATCH_THRESHOLD);
        if (r.scores.title_combined > meilleurTitre) meilleurTitre = r.scores.title_combined;
        if (r.scores.artist_combined > meilleurArtiste) meilleurArtiste = r.scores.artist_combined;
        if (r.scores.artist_title_combined > meilleurCombo) meilleurCombo = r.scores.artist_title_combined;
      }
    }
  }
  // feat/titre-partiel — « LA MOITIE DU TITRE SUFFIT » (voir fragmentDuTitre).
  //
  // Le 11/09, six reponses justes ont ete refusees parce que le joueur n avait
  // dit qu une partie du titre : « Morena » pour *Baila Morena*, « Of the
  // Tiger » pour *Eye of the Tiger*. On rattrape ce cas — mais la mesure
  // (2 718 essais) montre que la regle seule accepte 1 214 reponses FAUSSES
  // pour 68 justes recuperees. La garde ci-dessous est donc obligatoire : on
  // refuse le fragment des qu il designe aussi un AUTRE morceau de la manche
  // (« Over the » vaut *Somewhere Over the Rainbow* comme *All Over the
  // World* — dans le doute, le joueur n a pas prouve qu il connaissait le
  // morceau). L artiste doit en plus etre bon : le titre partiel ne se suffit
  // jamais a lui-meme.
  let titreParFragment = false;
  if (meilleurTitre < VOICE_MATCH_THRESHOLD && meilleurArtiste >= VOICE_MATCH_THRESHOLD) {
    // Le titre OFFICIEL seulement : les alias contiennent souvent le nom de
    // l artiste, et un bout d alias donnerait le titre a qui n a dit que le
    // chanteur.
    const assez = transcriptions.some((tr) =>
      couvreAssezDuTitre(tr, track.canonical_title, track.artist.canonical_name),
    );
    if (assez) {
      const autres = await titresDeLaManche(args.roundId, track.id);
      const ambigu = transcriptions.some((tr) =>
        autres.some(({ titre, artiste }) => couvreAssezDuTitre(tr, titre, artiste)),
      );
      if (ambigu) {
        console.info(
          `[Voix] titre partiel refuse (ambigu dans la manche) : "${transcriptions[0]?.slice(0, 60)}"`,
        );
      } else {
        titreParFragment = true;
        console.info(
          `[Voix] titre partiel accepte : "${transcriptions[0]?.slice(0, 60)}" -> "${track.canonical_title}"`,
        );
      }
    }
  }

  const titrePasse = meilleurTitre >= VOICE_MATCH_THRESHOLD || titreParFragment;
  const artistePasse = meilleurArtiste >= VOICE_MATCH_THRESHOLD;
  let best: { score: number; target: MatchTarget };
  if (artistePasse && titrePasse) {
    best = { score: Math.max(meilleurTitre, meilleurArtiste, VOICE_MATCH_THRESHOLD), target: 'artist_title' };
  } else if (artistePasse) {
    best = { score: meilleurArtiste, target: 'artist' };
  } else if (titrePasse) {
    best = { score: meilleurTitre, target: 'title' };
  } else {
    // Aucune moitie ne passe seule : repechage par le combo (reponse complete
    // mais mal transcrite), sinon le meilleur des scores pour le journal.
    best =
      meilleurCombo >= meilleurTitre && meilleurCombo >= meilleurArtiste
        ? { score: meilleurCombo, target: 'artist_title' }
        : meilleurArtiste > meilleurTitre
          ? { score: meilleurArtiste, target: 'artist' }
          : { score: meilleurTitre, target: 'title' };
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
          transcript: `[${args.source}] ${transcriptions.join(' | ').slice(0, 980)}`,
          // fix/artiste-seul-jamais-reconnu — les trois cibles sont distinctes :
          // 'title' → titre seul, 'artist' → artiste seul, 'artist_title' → les
          // deux. Auparavant matched_title etait vrai des que QUELQUE CHOSE
          // matchait, meme quand seul l artiste avait ete reconnu — et l artiste
          // seul ne pouvait de toute facon jamais matcher.
          matched_artist:
            best.score >= VOICE_MATCH_THRESHOLD &&
            (best.target === 'artist' || best.target === 'artist_title'),
          matched_title:
            best.score >= VOICE_MATCH_THRESHOLD &&
            (best.target === 'title' || best.target === 'artist_title'),
          confidence: best.score / 100,
          level: args.source,
          latency_ms: args.latencyMs,
        },
      })
      .catch((err) => console.warn('[voice-cascade] log error:', err));
  }

  console.info(
    `[Voice] ${args.level} ${args.source}: ${transcriptions.map((t) => `"${t.slice(0, 80)}"`).join(' | ')} score=${best.score}% target=${best.target} threshold=${VOICE_MATCH_THRESHOLD}`,
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
  // fix/artiste-seul-jamais-reconnu — `matchedTitle` etait cable a `true` : un
  // joueur qui n avait reconnu que l artiste se voyait attribuer le titre, et
  // reciproquement l artiste seul ne pouvait pas etre reconnu du tout. Les deux
  // drapeaux suivent desormais la cible reellement matchee, conformement a la
  // regle de gameScoring : artiste OU titre -> points de position, les deux ->
  // bonus double.
  const matchedArtist = best.target === 'artist' || best.target === 'artist_title';
  const matchedTitle = best.target === 'title' || best.target === 'artist_title';
  const tentativePosition = (active.correct_answers.length ?? 0) + 1;
  const tentativeScore = computeAnswerScore({
    matched_artist: matchedArtist,
    matched_title: matchedTitle,
    position: tentativePosition,
    answered_at_ms: Date.now() - active.started_at_ms,
  });

  const registered = registerCorrectAnswer(args.roundId, {
    participant_id: args.participantId,
    pseudo: args.participantPseudo,
    team_id: args.participantTeamId,
    matched_artist: matchedArtist,
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
    matchedArtist,
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
    // ANTI-TRICHE — pas d'artist/title dans le broadcast public (cf. supra).
    broadcastToSession(args.sessionId, 'track:phase_changed', {
      round_id: args.roundId,
      phase: 'phase2',
      phase2_started_at: new Date().toISOString(),
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

/**
 * POST /voice-cancel — le joueur abandonne son enregistrement.
 *
 * fix/rebuzz-refuse — sans cet appel, l'annulation laissait sa fenêtre de buzz
 * ouverte jusqu'à expiration : il ne pouvait pas retenter tout de suite.
 */
router.post(
  '/voice-cancel',
  async (req: Request<{ id: string; roundId: string }>, res: Response): Promise<void> => {
    const token = (req.body as { token?: string } | undefined)?.token;
    if (!token) {
      res.status(401).json({ error: { code: 'NO_TOKEN', message: 'Jeton manquant' } });
      return;
    }
    const auth = verifyParticipantOrFail(req, res, token);
    if (!auth) return;
    closeBuzz(req.params.roundId, auth.participantId);
    res.json({ ok: true });
  },
);

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
      expectedTrackId: (req.body as { track_id?: string } | undefined)?.track_id,
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

    // fix/rebuzz-refuse — ON REFERME LE BUZZ DANS TOUS LES CAS.
    // Il n'était refermé que si le joueur marquait. Quand la reconnaissance
    // échouait, le frontend renonçait sans escalader : la fenêtre de buzz
    // restait ouverte jusqu'à expiration (10 s) et toute nouvelle tentative
    // était refusée avec « tu es déjà en train de buzzer » — précisément au
    // moment où le joueur veut retenter.
    closeBuzz(req.params.roundId, auth.participantId);

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

    // fix/telephone-bloque-sur-enregistrement-vide — ON N ENVOIE PLUS DU VIDE
    // AUX TROIS SERVICES.
    //
    // Soiree du 10/09 : plusieurs buzz d un meme joueur arrivent a size=0KB
    // (iPhone, audio/mp4 — le micro n a rien capture). Ce vide partait quand
    // meme a Deepgram (« corrupt or unsupported data »), puis a Whisper
    // (« invalid_request_error »), puis a AssemblyAI (« Upload 422 »). Trois
    // echecs en cascade, chacun avec son delai reseau, et pendant ce temps le
    // telephone attendait une reponse qui n arrivait jamais : c est le
    // « telephone bloque » signale en salle.
    //
    // Un enregistrement exploitable pese quelques kilo-octets (les buzz reels
    // de la soiree font 6 a 33 Ko). En dessous de 1 Ko il n y a pas de parole :
    // on repond immediatement, le joueur peut rebuzzer tout de suite.
    const TAILLE_MINIMALE_OCTETS = 1024;
    if (audioFile.buffer.byteLength < TAILLE_MINIMALE_OCTETS) {
      console.warn(
        `[Server][Voice L2] enregistrement vide ignore | playerId=${auth.participantId} | size=${audioFile.buffer.byteLength}o | mime=${audioFile.mimetype || '(none)'}`,
      );
      res.json({
        matched: false,
        scored: false,
        score: 0,
        target: null,
        transcript: '',
        level: 'L2',
        source: 'deepgram',
        reason: 'AUCUNE_PAROLE',
        transcriptionIndisponible: false,
      });
      return;
    }

    let transcript = '';
    /** feat/double-ecoute — transcription du meme audio dans la langue de la soiree. */
    let transcriptLangueSoiree = '';
    let level: 'L2' | 'L3-fallback' = 'L2';
    let source = 'deepgram';
    /**
     * fix/panne-invisible — vrai si AUCUN service de transcription n'a répondu.
     * Sans ce drapeau, une coupure donnait un score de 0, indistinguable d'une
     * mauvaise réponse : toute la salle voyait « Pas reconnu » et cherchait un
     * problème de micro. On le renvoie au joueur pour qu'il sache quoi faire.
     */
    let transcriptionIndisponible = false;

    // Tente Deepgram (Nova-3).
    try {
      // feat/double-ecoute — DEUX ECOUTES EN PARALLELE, MEME AUDIO.
      // « multi » (FR+EN melanges, pour les titres anglais) ET la langue de la
      // soiree. Sur un mot court et isole (« Sia »), « multi » devinait une
      // autre langue (« Ja. », « Hier. ») ; la seconde ecoute donne une
      // deuxieme chance sans attendre (appels simultanes, ~0,4 s). La
      // seconde ecoute ne fait jamais echouer la premiere.
      const ecouteMulti = transcribeWithDeepgram({
        audio: audioFile.buffer,
        contentType: audioFile.mimetype || 'audio/webm',
        language: dgLang,
        keyterms,
      });
      const ecouteSoiree =
        sessionLang && sessionLang !== dgLang
          ? transcribeWithDeepgram({
              audio: audioFile.buffer,
              contentType: audioFile.mimetype || 'audio/webm',
              language: sessionLang,
              keyterms,
            }).catch((err: unknown) => {
              console.warn(
                `[voice-cascade] Deepgram (${sessionLang}) en echec — on garde l ecoute « ${dgLang} » seule :`,
                err instanceof Error ? err.message : err,
              );
              return null;
            })
          : Promise.resolve(null);
      const [dgRes, dgSoiree] = await Promise.all([ecouteMulti, ecouteSoiree]);
      transcript = dgRes.text;
      transcriptLangueSoiree = dgSoiree?.text ?? '';
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
        // fix/panne-invisible — ON RETIENT QUE C'EST UNE PANNE.
        // Auparavant, une coupure des services de transcription donnait un
        // score de 0, exactement comme une mauvaise réponse : toute la salle
        // voyait « Pas reconnu » et cherchait un problème de micro pendant
        // vingt minutes. On distingue désormais les deux cas.
        transcriptionIndisponible = true;
      }
    }

    const result = await runMatchAndCommit({
      expectedTrackId: (req.body as { track_id?: string } | undefined)?.track_id,
      sessionId: req.params.id,
      roundId: req.params.roundId,
      participantId: participant.id,
      participantPseudo: participant.pseudo,
      participantTeamId: participant.team_id,
      transcript,
      transcriptsAlternatifs: transcriptLangueSoiree ? [transcriptLangueSoiree] : [],
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
      // fix/panne-invisible — le joueur doit savoir si c'est SA réponse qui
      // n'allait pas, ou si la reconnaissance était en panne.
      reason: transcriptionIndisponible ? 'RECONNAISSANCE_INDISPONIBLE' : result.reason,
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

    // fix/ios-voice-cascade-mic-and-buzz-refused — log explicite L3 call avec
    // codec reçu + size, symétrique à L2. Aide à diagnostiquer iOS L2 fail →
    // L3 escalation chain.
    console.info(
      `[Server][Voice L3] AssemblyAI call | session=${req.params.id} | playerId=${auth.participantId} | trackTitle="${track.canonical_title}" | trackArtist="${track.artist.canonical_name}" | mime=${audioFile.mimetype || '(none)'} | size=${Math.round(audioFile.buffer.byteLength / 1024)}KB | lang=${aaLang}`,
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
      expectedTrackId: (req.body as { track_id?: string } | undefined)?.track_id,
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
