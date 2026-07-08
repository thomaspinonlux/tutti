/**
 * Routes /api/sessions/:id/master/* — pilotage de la session par le joueur
 * désigné master (mode B "Sans animateur"). Utile aussi en mode A pour
 * éventuellement déléguer un sous-pouvoir, mais le pilotage principal mode A
 * reste sur l'iPad/Mac via les routes host.
 *
 *   POST /next-track      : avance au morceau suivant (depuis cooldown)
 *   POST /skip-track      : avance au morceau suivant (depuis listening/buzzed,
 *                            cancel buzz éventuel sans score)
 *   POST /reveal          : "Réponse" — révèle artist+titre, 0 point
 *   POST /pause           : flip is_paused = true, broadcast session:paused
 *   POST /resume          : flip is_paused = false, broadcast session:resumed
 *   POST /end-round       : termine le round PLAYING
 *   POST /end-session     : termine toute la session (avec podium)
 *   POST /pick-round      : crée + démarre + lance le 1ᵉʳ track d'une playlist
 *                            (combine create-round + start-round + play-track)
 *   POST /adjust-points   : ajuste les points d'un participant (silencieux,
 *                            pas de broadcast public — seul le score se met
 *                            à jour, transparent pour les joueurs)
 *
 * Auth : middleware requireMasterParticipant (token participant + is_master).
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Prisma, RoundStatus, ScoreEventType } from '@prisma/client';
import type { GameMode, Team } from '@tutti/shared';
import { prisma } from '../lib/prisma.js';
import { requireMasterParticipant } from '../middleware/master.js';
import { broadcastToSession } from '../socket/index.js';
import { clearActiveTrack, getActiveTrack, restartActiveTrack } from '../lib/gameState.js';
import {
  clearActiveQuestion,
  getActiveQuestion,
  setActiveQuestion,
} from '../lib/gameStateQuizz.js';
import { getCumulativeScores } from '../lib/scores.js';
import {
  advanceToNextOrEndRound,
  buildAndBroadcastTrack,
  DEFAULT_SESSION_SIZE,
  endRoundInternal,
  findRoundForSession,
  getEffectiveRoundTrackCount,
  pickRandomTrackIdsForRound,
  restartCurrentTrackAndBroadcast,
  revealCurrentTrack,
  trackStateForRole,
} from '../lib/gameplayCore.js';
import {
  buildAndBroadcastQuestion,
  clearAutoReveal,
  findQuestionAtIndex,
  revealCurrentQuestion,
  scheduleAutoReveal,
} from '../lib/gameplayQuizzCore.js';
import type { QuestionType } from '@tutti/shared';
import {
  listVisiblePlaylistsForWorkspace,
  getVisiblePlaylistDetailForWorkspace,
} from '../lib/officialLibraryQueries.js';
import {
  launchOfficialPlaylistForSession,
  NoPlayableTrackError,
} from '../lib/officialPlaylistLaunch.js';
import { setFocusedPlaylist } from '../lib/playlistSelectionStore.js';

const router: Router = Router({ mergeParams: true });

// Toutes les routes sont protégées par le middleware master.
router.use(requireMasterParticipant);

// ── Schemas ───────────────────────────────────────────────────────────────

const roundIdSchema = z.object({ token: z.string(), round_id: z.string().uuid() });
const pickRoundSchema = z.object({ token: z.string(), playlist_id: z.string().uuid() });
const adjustPointsSchema = z.object({
  token: z.string(),
  target_participant_id: z.string().uuid(),
  delta: z.number().int().min(-1000).max(1000),
  reason: z.string().max(200).optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────

const PLAYLIST_LIGHT = {
  id: true,
  name: true,
  level: true,
  _count: { select: { playlist_tracks: true } },
} as const;

function enrichRound<
  R extends {
    selected_track_ids?: string[] | null;
    playlist: { id: string; name: string; level: string; _count: { playlist_tracks: number } };
  },
>(round: R) {
  return {
    ...round,
    playlist: {
      id: round.playlist.id,
      name: round.playlist.name,
      level: round.playlist.level,
      tracks_count: getEffectiveRoundTrackCount(round),
    },
  };
}

// ── POST /scores ──────────────────────────────────────────────────────────
// Renvoie la cumulative de la session pour que le master puisse voir les
// totaux courants quand il ouvre le panneau d'ajustement de points.

router.post('/scores', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const session = await prisma.session.findUnique({
    where: { id: req.params.id },
    include: { participants: { where: { is_kicked: false } } },
  });
  if (!session) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
    return;
  }
  const teams = (session.teams_config as Team[] | null) ?? null;
  const cumulative = await getCumulativeScores({
    sessionId: session.id,
    mode: session.mode as GameMode,
    teams,
    participants: session.participants.map((p) => ({
      id: p.id,
      pseudo: p.pseudo,
      team_id: p.team_id,
    })),
  });
  res.json({ cumulative });
});

// ── POST /playlists ───────────────────────────────────────────────────────
// Renvoie la liste des playlists publiables disponibles pour l'établissement
// de la session (pour que le master puisse choisir la manche suivante depuis
// son tel). Pas en GET car l'auth master se fait via token dans le body.

router.post('/playlists', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const session = await prisma.session.findUnique({
    where: { id: req.params.id },
    select: { establishment_id: true },
  });
  if (!session) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
    return;
  }
  const playlists = await prisma.playlist.findMany({
    where: {
      establishment_id: session.establishment_id,
      is_published: true,
    },
    orderBy: { updated_at: 'desc' },
    select: {
      id: true,
      name: true,
      description: true,
      cover_url: true,
      level: true,
      language: true,
      is_express: true,
      is_official_tutti: true,
      _count: { select: { playlist_tracks: true } },
    },
  });
  res.json({
    playlists: playlists.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      cover_url: p.cover_url,
      level: p.level,
      language: p.language,
      is_express: p.is_express,
      is_official_tutti: p.is_official_tutti,
      tracks_count: p._count.playlist_tracks,
    })),
  });
});

// ── POST /library/playlists ───────────────────────────────────────────────
// feat/animator-full-control — le master (animateur désigné) parcourt la
// bibliothèque OFFICIELLE Tutti (comme le host), depuis son tel. Auth = master
// participant (pas de userId/workspaceId) → on dérive le workspace depuis
// l'établissement de la session, et on réutilise listVisiblePlaylistsForWorkspace
// pour le calcul premium/visibilité. Sortie = même LibraryPlaylistSummary[]
// que la route host GET /api/library/playlists.

const libraryListSchema = z.object({
  token: z.string(),
  provider: z.enum(['youtube', 'spotify']).optional(),
});

router.post(
  '/library/playlists',
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const parsed = libraryListSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Body invalide' } });
      return;
    }
    const session = await prisma.session.findUnique({
      where: { id: req.params.id },
      select: { establishment_id: true },
    });
    if (!session) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
      return;
    }
    const establishment = await prisma.establishment.findUnique({
      where: { id: session.establishment_id },
      select: { workspace_id: true },
    });
    if (!establishment) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Établissement introuvable' } });
      return;
    }
    // provider n'est pas un filtre serveur : la LibraryPlaylistSummary porte
    // déjà spotify_count/youtube_count/difficulty_counts, le frontend filtre.
    const playlists = await listVisiblePlaylistsForWorkspace(establishment.workspace_id, {});
    res.json({ playlists });
  },
);

// ── POST /library/playlists/:playlistId/launch ────────────────────────────
// feat/animator-full-control — le master lance une playlist officielle dans la
// session (clone official → Playlist user + SessionRound). Réutilise EXACTEMENT
// la logique host (launchOfficialPlaylistForSession). Auth master → workspace
// dérivé de l'établissement, visibilité via getVisiblePlaylistDetailForWorkspace.
// Réponse { round, state } alignée sur POST /pick-round (le frontend traite les
// deux identiquement). state est null ici (round créé PENDING, pas encore lancé).

const libraryLaunchSchema = z.object({
  token: z.string(),
  preferProvider: z.enum(['youtube', 'spotify']).default('youtube'),
  difficulty: z.enum(['EASY', 'MEDIUM', 'EXPERT']).optional(),
});

router.post(
  '/library/playlists/:playlistId/launch',
  async (req: Request<{ id: string; playlistId: string }>, res: Response): Promise<void> => {
    const parsed = libraryLaunchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Body invalide' } });
      return;
    }
    const session = await prisma.session.findUnique({
      where: { id: req.params.id },
      select: { establishment_id: true, status: true },
    });
    if (!session) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
      return;
    }
    if (session.status === 'ENDED') {
      res.status(409).json({ error: { code: 'INVALID_STATUS', message: 'Session terminée' } });
      return;
    }
    const establishment = await prisma.establishment.findUnique({
      where: { id: session.establishment_id },
      select: { workspace_id: true },
    });
    if (!establishment) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Établissement introuvable' } });
      return;
    }
    const detail = await getVisiblePlaylistDetailForWorkspace(
      establishment.workspace_id,
      req.params.playlistId,
    );
    if (!detail) {
      res
        .status(403)
        .json({ error: { code: 'FORBIDDEN', message: 'Playlist introuvable ou inaccessible' } });
      return;
    }

    try {
      // 1) Clone official → Playlist + SessionRound PENDING (broadcast round:created).
      const result = await launchOfficialPlaylistForSession(
        detail,
        req.params.id,
        session.establishment_id,
        { preferProvider: parsed.data.preferProvider, difficulty: parsed.data.difficulty },
      );
      const roundId = result.round.id;

      // 2) Démarre RÉELLEMENT la manche (comme /pick-round : le master lance pour
      //    JOUER, pas juste préparer). WAITING → PLAYING.
      if (session.status === 'WAITING') {
        const updated = await prisma.session.update({
          where: { id: req.params.id },
          data: { status: 'PLAYING', started_at: new Date() },
        });
        broadcastToSession(req.params.id, 'session:started', { session: updated });
      }

      // 3) Termine les autres rounds PLAYING (le nouveau est PENDING → non touché).
      const otherPlaying = await prisma.sessionRound.findMany({
        where: { session_id: req.params.id, status: 'PLAYING' },
        select: { id: true },
      });
      for (const r of otherPlaying) clearActiveTrack(r.id);
      await prisma.sessionRound.updateMany({
        where: { session_id: req.params.id, status: 'PLAYING' },
        data: { status: 'ENDED', ended_at: new Date() },
      });

      // 4) Démarre le round (PENDING → PLAYING) + broadcast round:started.
      const started = await prisma.sessionRound.update({
        where: { id: roundId },
        data: { status: 'PLAYING' as RoundStatus, started_at: new Date() },
        include: { playlist: { select: PLAYLIST_LIGHT } },
      });
      const enrichedStarted = enrichRound(started);
      broadcastToSession(req.params.id, 'round:started', { round: enrichedStarted });

      // 5) Lance le 1ᵉʳ track (broadcast track:start) → la CONSOLE joue le son.
      const fullRound = await findRoundForSession(roundId, req.params.id);
      if (!fullRound) {
        res
          .status(500)
          .json({ error: { code: 'INTERNAL_ERROR', message: 'Round créé introuvable' } });
        return;
      }
      const state = await buildAndBroadcastTrack(req.params.id, fullRound, 0);
      // ANTI-TRICHE — un master ANIMATOR_PLAYING ne reçoit pas la réponse en HTTP.
      res.json({
        round: enrichedStarted,
        state: state ? trackStateForRole(state, req.master!.role) : null,
      });
    } catch (err: unknown) {
      if (err instanceof NoPlayableTrackError) {
        res.status(400).json({ error: { code: err.code, message: err.message } });
        return;
      }
      console.error('[POST master/library/launch] error:', err);
      res
        .status(500)
        .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur lancement de la manche' } });
    }
  },
);

// ── POST /screen/focus ─────────────────────────────────────────────────────
// feat/animator-tv-library — quand l'animateur parcourt la bibliothèque sur son
// tel, on alimente le MÊME store que le host (setFocusedPlaylist) → la TV
// (/screen) passe en PLAYLIST_SELECTION et affiche la grille catalogue +
// surligne la playlist focus. playlist_id=null → sort de la sélection.
const screenFocusSchema = z.object({
  token: z.string(),
  playlist_id: z.string().uuid().nullable(),
});

router.post('/screen/focus', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const parsed = screenFocusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Body invalide' } });
    return;
  }
  const session = await prisma.session.findUnique({
    where: { id: req.params.id },
    select: { establishment_id: true },
  });
  if (!session) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
    return;
  }
  const establishment = await prisma.establishment.findUnique({
    where: { id: session.establishment_id },
    select: { workspace_id: true },
  });
  if (!establishment) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Établissement introuvable' } });
    return;
  }
  setFocusedPlaylist(establishment.workspace_id, parsed.data.playlist_id, 0, undefined, null);
  broadcastToSession(req.params.id, 'screen-state:focus-changed', {
    playlist_id: parsed.data.playlist_id,
  });
  res.json({ ok: true });
});

// ── POST /next-track ──────────────────────────────────────────────────────

router.post('/next-track', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const parsed = roundIdSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'round_id requis' } });
    return;
  }
  const round = await findRoundForSession(parsed.data.round_id, req.params.id);
  if (!round) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Round introuvable' } });
    return;
  }
  const result = await advanceToNextOrEndRound(req.params.id, round);
  // ANTI-TRICHE — caviarde le nouveau state pour un master ANIMATOR_PLAYING.
  res.json(
    result.ended ? result : { ...result, state: trackStateForRole(result.state, req.master!.role) },
  );
});

// ── POST /skip-track ──────────────────────────────────────────────────────
// Master a appuyé sur "Sauter" (mauvaise piste glissée dans la playlist).
// Différence avec /next-track : on broadcast track:phase_changed → phase3-skipped
// AVANT d'avancer, pour que les clients puissent stopper la lecture audio
// proprement (au lieu de juste enchainer sur le suivant).

router.post('/skip-track', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const parsed = roundIdSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'round_id requis' } });
    return;
  }
  const round = await findRoundForSession(parsed.data.round_id, req.params.id);
  if (!round) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Round introuvable' } });
    return;
  }
  // Marque la phase phase3-skipped pour que les clients sachent ne pas
  // afficher de reveal. Puis avance.
  broadcastToSession(req.params.id, 'track:phase_changed', {
    round_id: parsed.data.round_id,
    phase: 'phase3-skipped',
  });
  const result = await advanceToNextOrEndRound(req.params.id, round);
  // ANTI-TRICHE — caviarde le nouveau state pour un master ANIMATOR_PLAYING.
  res.json(
    result.ended ? result : { ...result, state: trackStateForRole(result.state, req.master!.role) },
  );
});

// ── POST /give-answer ─────────────────────────────────────────────────────
// "Donner la réponse" master : personne n'a trouvé pendant la phase 1, on
// révèle artist+titre, 0 point, on passe en phase3-revealed (la musique
// continue à jouer jusqu'à ce que master clique "Suivant"). Alias historique
// /reveal préservé temporairement pour rétrocompat. Broadcast track:revealed.

const giveAnswerHandler = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const parsed = roundIdSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'round_id requis' } });
    return;
  }
  const reveal = await revealCurrentTrack(req.params.id, parsed.data.round_id);
  if (!reveal) {
    res.status(409).json({
      error: {
        code: 'INVALID_PHASE',
        message: 'Le morceau ne peut être révélé que pendant les phases 1 ou 2',
      },
    });
    return;
  }
  res.json({ reveal });
};

router.post('/give-answer', giveAnswerHandler);
// Alias rétrocompat — supprimable après mise à jour du frontend (commit 5).
router.post('/reveal', giveAnswerHandler);

// ── POST /pause ───────────────────────────────────────────────────────────

router.post('/pause', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const session = await prisma.session.update({
      where: { id: req.params.id },
      data: { is_paused: true },
    });
    broadcastToSession(req.params.id, 'session:paused', {
      session_id: session.id,
      requested_by: req.master!.pseudo,
    });
    res.json({ ok: true });
  } catch (err: unknown) {
    console.error('[POST master/pause] error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur pause' } });
  }
});

// ── POST /resume ──────────────────────────────────────────────────────────

router.post('/resume', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const session = await prisma.session.update({
      where: { id: req.params.id },
      data: { is_paused: false },
    });
    broadcastToSession(req.params.id, 'session:resumed', { session_id: session.id });
    res.json({ ok: true });
  } catch (err: unknown) {
    console.error('[POST master/resume] error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur reprise' } });
  }
});

// ── POST /seek ────────────────────────────────────────────────────────────
// feat/sans-animateur — la télécommande (master) demande un seek (avance/recul
// ±10s → position absolue). On NE touche PAS started_at (ancre buzz/scoring) :
// on broadcast track:seek, et la CONSOLE applique sur SON lecteur (seule à émettre
// du son). La télécommande n'émet aucun son.
router.post('/seek', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const positionMs = Number((req.body as { position_ms?: unknown } | undefined)?.position_ms);
  if (!Number.isFinite(positionMs) || positionMs < 0) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'position_ms invalide' } });
    return;
  }
  broadcastToSession(req.params.id, 'track:seek', {
    session_id: req.params.id,
    position_ms: Math.round(positionMs),
  });
  res.json({ ok: true });
});

// ── POST /set-volume ────────────────────────────────────────────────────────
// feat/master-volume — la manette animateur règle le VOLUME de lecture (0..1).
// On broadcast track:volume et la CONSOLE applique sur SON lecteur (Spotify SDK
// setVolume / YouTube setVolume). La télécommande n'émet aucun son : comme le
// seek, c'est une commande sans état serveur (pas de persistance en base).
router.post('/set-volume', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const volume = Number((req.body as { volume?: unknown } | undefined)?.volume);
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
    res
      .status(400)
      .json({ error: { code: 'VALIDATION_ERROR', message: 'volume invalide (attendu 0..1)' } });
    return;
  }
  broadcastToSession(req.params.id, 'track:volume', {
    session_id: req.params.id,
    volume,
  });
  res.json({ ok: true });
});

// ── POST /restart-track ──────────────────────────────────────────────────
// "Recommencer le morceau" : broadcast track:restart aux clients pour qu'ils
// relancent l'audio Spotify à position_ms=0. Ne change pas la phase ni le
// timer côté serveur (V1 simple). Le master assume que l'erreur est rare.

router.post(
  '/restart-track',
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const parsed = roundIdSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'round_id requis' } });
      return;
    }
    const round = await findRoundForSession(parsed.data.round_id, req.params.id);
    if (!round) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Round introuvable' } });
      return;
    }
    // Reset gameState + re-broadcast track:start (cf. gameplay.ts).
    restartActiveTrack(parsed.data.round_id);
    const state = await restartCurrentTrackAndBroadcast(req.params.id, round);
    // ANTI-TRICHE — caviarde pour un master ANIMATOR_PLAYING.
    res.json({ ok: true, state: state ? trackStateForRole(state, req.master!.role) : null });
  },
);

// ── POST /end-round ───────────────────────────────────────────────────────

router.post('/end-round', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const parsed = roundIdSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'round_id requis' } });
    return;
  }
  try {
    const round = await endRoundInternal(req.params.id, parsed.data.round_id);
    res.json({ round });
  } catch (err: unknown) {
    console.error('[POST master/end-round] error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur fin round' } });
  }
});

// ── POST /end-session ─────────────────────────────────────────────────────

router.post('/end-session', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const own = await prisma.session.findUnique({
    where: { id: req.params.id },
    include: {
      participants: { where: { is_kicked: false } },
    },
  });
  if (!own) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
    return;
  }
  if (own.status === 'ENDED') {
    res.status(409).json({ error: { code: 'INVALID_STATUS', message: 'Session déjà terminée' } });
    return;
  }
  try {
    // Termine d'abord le round courant éventuel (cleanup gameState aussi)
    const playingRounds = await prisma.sessionRound.findMany({
      where: { session_id: req.params.id, status: 'PLAYING' },
      select: { id: true },
    });
    for (const r of playingRounds) clearActiveTrack(r.id);
    await prisma.sessionRound.updateMany({
      where: { session_id: req.params.id, status: 'PLAYING' },
      data: { status: 'ENDED', ended_at: new Date() },
    });

    const session = await prisma.session.update({
      where: { id: req.params.id },
      data: { status: 'ENDED', ended_at: new Date() },
    });

    const teams = (own.teams_config as Team[] | null) ?? null;
    const cumulative = await getCumulativeScores({
      sessionId: session.id,
      mode: session.mode as GameMode,
      teams,
      participants: own.participants.map((p) => ({
        id: p.id,
        pseudo: p.pseudo,
        team_id: p.team_id,
      })),
    });
    broadcastToSession(session.id, 'session:ended', { session, cumulative });
    res.json({ session, cumulative });
  } catch (err: unknown) {
    console.error('[POST master/end-session] error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur fin session' } });
  }
});

// ── POST /pick-round ──────────────────────────────────────────────────────
// Combine create-round + start-round + play-track en 1 seul appel pour le
// master (qui est sur tel, donc on évite 3 round-trips).

router.post('/pick-round', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const parsed = pickRoundSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'playlist_id requis' } });
    return;
  }
  // Vérif tenant playlist via l'établissement de la session.
  const session = await prisma.session.findUnique({
    where: { id: req.params.id },
    select: { establishment_id: true, status: true },
  });
  if (!session) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
    return;
  }
  if (session.status === 'ENDED') {
    res.status(409).json({ error: { code: 'INVALID_STATUS', message: 'Session terminée' } });
    return;
  }
  const playlist = await prisma.playlist.findFirst({
    where: { id: parsed.data.playlist_id, establishment_id: session.establishment_id },
    include: { _count: { select: { playlist_tracks: true } } },
  });
  if (!playlist) {
    res.status(404).json({
      error: { code: 'PLAYLIST_NOT_FOUND', message: 'Playlist introuvable pour cet établissement' },
    });
    return;
  }
  if (playlist._count.playlist_tracks === 0) {
    res.status(400).json({ error: { code: 'EMPTY_PLAYLIST', message: 'Playlist vide' } });
    return;
  }

  try {
    // 1) Si la session est en WAITING, la passer en PLAYING d'abord.
    if (session.status === 'WAITING') {
      const updated = await prisma.session.update({
        where: { id: req.params.id },
        data: { status: 'PLAYING', started_at: new Date() },
      });
      broadcastToSession(req.params.id, 'session:started', { session: updated });
    }

    // 2) Termine les autres rounds PLAYING (au cas où).
    const playingRounds = await prisma.sessionRound.findMany({
      where: { session_id: req.params.id, status: 'PLAYING' },
      select: { id: true },
    });
    for (const r of playingRounds) clearActiveTrack(r.id);
    await prisma.sessionRound.updateMany({
      where: { session_id: req.params.id, status: 'PLAYING' },
      data: { status: 'ENDED', ended_at: new Date() },
    });

    // 3) Crée le nouveau round à la position suivante.
    //    fix/session-pick-respect-default-size — random pick depuis le pool.
    //    Avant ce fix, ce path créait des rounds avec selected_track_ids
    //    vide → gameplayCore fallback sur full playlist → 80 tracks joués
    //    au lieu des 15 attendus pour les playlists enrichies.
    const sessionSize = playlist.default_session_size ?? DEFAULT_SESSION_SIZE;
    const pick = await pickRandomTrackIdsForRound(
      req.params.id,
      parsed.data.playlist_id,
      sessionSize,
    );
    if (pick.eligibleSize === 0) {
      res.status(409).json({
        error: {
          code: 'EXHAUSTED_POOL',
          message:
            'Plus aucun morceau disponible dans cette playlist pour cette session (déjà tous joués)',
        },
      });
      return;
    }
    console.info(
      `[POST /pick-round] session=${req.params.id} playlist=${parsed.data.playlist_id} | pool=${pick.poolSize} played=${pick.playedSize} eligible=${pick.eligibleSize} session_size=${sessionSize} → selected=${pick.selectedTrackIds.length}`,
    );

    const lastRound = await prisma.sessionRound.findFirst({
      where: { session_id: req.params.id },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const created = await prisma.sessionRound.create({
      data: {
        session_id: req.params.id,
        playlist_id: parsed.data.playlist_id,
        position: (lastRound?.position ?? 0) + 1,
        status: 'PENDING',
        selected_track_ids: pick.selectedTrackIds,
      },
      include: { playlist: { select: PLAYLIST_LIGHT } },
    });
    const enrichedCreated = enrichRound(created);
    broadcastToSession(req.params.id, 'round:created', { round: enrichedCreated });

    // 4) Démarre le round (PENDING → PLAYING).
    const started = await prisma.sessionRound.update({
      where: { id: created.id },
      data: { status: 'PLAYING' as RoundStatus, started_at: new Date() },
      include: { playlist: { select: PLAYLIST_LIGHT } },
    });
    const enrichedStarted = enrichRound(started);
    broadcastToSession(req.params.id, 'round:started', { round: enrichedStarted });

    // 5) Lance le 1ᵉʳ track. On a besoin du round avec tracks pour ça.
    const fullRound = await findRoundForSession(created.id, req.params.id);
    if (!fullRound) {
      res
        .status(500)
        .json({ error: { code: 'INTERNAL_ERROR', message: 'Round créé introuvable' } });
      return;
    }
    const state = await buildAndBroadcastTrack(req.params.id, fullRound, 0);
    res.json({ round: enrichedStarted, state });
  } catch (err: unknown) {
    console.error('[POST master/pick-round] error:', err);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Erreur lancement de la manche' },
    });
  }
});

// ── POST /adjust-points ───────────────────────────────────────────────────
// Crée un ScoreEvent type MANUAL_ADJUSTMENT. Pas de broadcast public (pas de
// notif), seul l'invalidation des scores est diffusée pour que les clients
// rafraîchissent silencieusement leur cumulative.

router.post(
  '/adjust-points',
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const parsed = adjustPointsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Body invalide',
          details: parsed.error.flatten(),
        },
      });
      return;
    }
    const target = await prisma.participant.findUnique({
      where: { id: parsed.data.target_participant_id },
      select: { id: true, session_id: true, team_id: true, is_kicked: true },
    });
    if (!target || target.is_kicked || target.session_id !== req.params.id) {
      res
        .status(404)
        .json({ error: { code: 'TARGET_INVALID', message: 'Participant cible invalide' } });
      return;
    }

    // Cherche le round PLAYING pour rattacher l'event (sinon le plus récent).
    const round = await prisma.sessionRound.findFirst({
      where: { session_id: req.params.id },
      orderBy: { position: 'desc' },
      select: { id: true },
    });
    const active = round ? getActiveTrack(round.id) : null;

    try {
      await prisma.scoreEvent.create({
        data: {
          session_id: req.params.id,
          session_round_id: round?.id ?? null,
          participant_id: target.id,
          team_id: target.team_id,
          round_index: active?.track_index ?? -1,
          type: ScoreEventType.MANUAL_ADJUSTMENT,
          points: parsed.data.delta,
          match_artist: false,
          match_title: false,
          // Cf. brief : pas de notif publique. is_public=false rend l'event
          // exclus des feeds publics éventuels (la cumulative agrège tout).
          is_public: false,
          reason: parsed.data.reason ?? `master:${req.master!.pseudo}`,
        } as Prisma.ScoreEventUncheckedCreateInput,
      });
      // Signal silencieux : les clients rafraîchissent leur cumulative.
      broadcastToSession(req.params.id, 'scores:invalidated', {});
      res.json({ ok: true });
    } catch (err: unknown) {
      console.error('[POST master/adjust-points] error:', err);
      res
        .status(500)
        .json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur ajustement points' } });
    }
  },
);

// ═══ Tutti Quizz — routes master ═══════════════════════════════════════════
// Le master tel pilote la partie quizz mode B :
//   POST /master/quizz/play-question   : démarre la 1ère question (index=0)
//   POST /master/quizz/next-question   : avance à la suivante (auto-end)
//   POST /master/quizz/reveal-question : reveal anticipé

const playQuestionMasterSchema = z.object({
  token: z.string(),
  question_index: z.number().int().min(0).optional(),
});

router.post(
  '/quizz/play-question',
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const parsed = playQuestionMasterSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Body invalide' } });
      return;
    }
    let session = await prisma.session.findUnique({
      where: { id: req.params.id },
      include: { participants: { where: { is_kicked: false }, select: { id: true } } },
    });
    if (!session) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
      return;
    }
    if (session.game_type !== 'QUIZZ' || !session.question_set_id) {
      res.status(409).json({ error: { code: 'NOT_QUIZZ', message: 'Session non quizz' } });
      return;
    }
    const questionSetId = session.question_set_id;
    // Si la session est encore en WAITING, le master la démarre.
    if (session.status === 'WAITING') {
      const updated = await prisma.session.update({
        where: { id: req.params.id },
        data: { status: 'PLAYING', started_at: new Date() },
      });
      broadcastToSession(req.params.id, 'session:started', { session: updated });
    }
    const set = await prisma.questionSet.findUnique({
      where: { id: questionSetId },
      select: { is_bilingual: true },
    });
    const idx = parsed.data.question_index ?? 0;
    const question = await findQuestionAtIndex(questionSetId, idx);
    if (!question || !set) {
      res.status(404).json({ error: { code: 'NO_QUESTION', message: 'Question introuvable' } });
      return;
    }
    const state = buildAndBroadcastQuestion(req.params.id, question, set.is_bilingual);
    setActiveQuestion(req.params.id, {
      question_index: question.position,
      question_id: question.id,
      question_type: question.type as QuestionType,
      time_limit_ms: question.time_limit_sec * 1000,
      points: question.points,
      expected_participants: session.participants.map((p) => p.id),
    });
    scheduleAutoReveal(req.params.id, question.time_limit_sec * 1000, () => {
      void revealCurrentQuestion(req.params.id);
    });
    res.json({ state });
  },
);

const tokenSchema = z.object({ token: z.string() });

router.post(
  '/quizz/next-question',
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const parsed = tokenSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Body invalide' } });
      return;
    }
    const session = await prisma.session.findUnique({
      where: { id: req.params.id },
      include: { participants: { where: { is_kicked: false } } },
    });
    if (!session) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
      return;
    }
    if (session.game_type !== 'QUIZZ' || !session.question_set_id) {
      res.status(409).json({ error: { code: 'NOT_QUIZZ', message: 'Session non quizz' } });
      return;
    }
    const active = getActiveQuestion(req.params.id);
    const nextIndex = active ? active.question_index + 1 : 0;
    const set = await prisma.questionSet.findUnique({
      where: { id: session.question_set_id },
      select: { is_bilingual: true, _count: { select: { questions: true } } },
    });
    if (!set) {
      res.status(404).json({ error: { code: 'NO_SET', message: 'Pack introuvable' } });
      return;
    }
    if (nextIndex >= set._count.questions) {
      clearActiveQuestion(req.params.id);
      clearAutoReveal(req.params.id);
      const updated = await prisma.session.update({
        where: { id: req.params.id },
        data: { status: 'ENDED', ended_at: new Date() },
      });
      const teams = (updated.teams_config as Team[] | null) ?? null;
      const cumulative = await getCumulativeScores({
        sessionId: updated.id,
        mode: updated.mode as GameMode,
        teams,
        participants: session.participants.map((p) => ({
          id: p.id,
          pseudo: p.pseudo,
          team_id: p.team_id,
        })),
      });
      broadcastToSession(req.params.id, 'session:ended', { session: updated, cumulative });
      res.json({ ended: true, session: updated, cumulative });
      return;
    }
    const question = await findQuestionAtIndex(session.question_set_id, nextIndex);
    if (!question) {
      res.status(404).json({ error: { code: 'NO_QUESTION', message: 'Question introuvable' } });
      return;
    }
    const state = buildAndBroadcastQuestion(req.params.id, question, set.is_bilingual);
    setActiveQuestion(req.params.id, {
      question_index: question.position,
      question_id: question.id,
      question_type: question.type as QuestionType,
      time_limit_ms: question.time_limit_sec * 1000,
      points: question.points,
      expected_participants: session.participants.map((p) => p.id),
    });
    scheduleAutoReveal(req.params.id, question.time_limit_sec * 1000, () => {
      void revealCurrentQuestion(req.params.id);
    });
    res.json({ state });
  },
);

router.post(
  '/quizz/reveal-question',
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const parsed = tokenSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Body invalide' } });
      return;
    }
    await revealCurrentQuestion(req.params.id);
    res.json({ ok: true });
  },
);

export default router;
