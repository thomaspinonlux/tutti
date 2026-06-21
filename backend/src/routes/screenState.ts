/**
 * Routes /api/workspace/screen-state — endpoint déterministe écran TV.
 *
 *   GET /api/workspace/screen-state              (auth host, workspace inféré)
 *   GET /api/workspace/screen-state/:workspaceId (public, workspaceId param URL)
 *
 * Calcule l'état screen courant à la demande depuis la DB. Aucun cache,
 * aucun in-memory state. Cache-Control: no-store pour empêcher tout cache
 * navigateur ou CDN.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { computeScreenState } from '../lib/screenState.js';
import { setFocusedPlaylist } from '../lib/playlistSelectionStore.js';
import { setQrOverlay } from '../lib/qrOverlayStore.js';
import { setAudioTarget, setTvAudioArmed, setTvSpotifyReady } from '../lib/tvAudioTargetStore.js';
import { requireAuth } from '../middleware/auth.js';
import { requireWorkspace } from '../middleware/tenant.js';
import { prisma } from '../lib/prisma.js';
import { broadcastToSession } from '../socket/index.js';

const router: Router = Router();

// ── GET /screen-state (auth host) ─────────────────────────────────────────

router.get(
  '/screen-state',
  requireAuth,
  requireWorkspace,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const state = await computeScreenState(req.workspaceId!);
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.json(state);
    } catch (err: unknown) {
      console.error('[GET /api/workspace/screen-state] error:', err);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur compute state' } });
    }
  },
);

// ── GET /screen-state/:workspaceId (public, cross-browser TV) ─────────────
// Exposé public sans auth pour permettre à un écran TV (ex: iPad bar) ouvert
// dans un browser sans cookies admin de lire l'état du workspace via param URL.
// Pas de données sensibles : pseudo + score + cover/title (révélés en phase 3),
// pas de tokens, pas d'emails.

router.get(
  '/screen-state/:workspaceId',
  async (req: Request<{ workspaceId: string }>, res: Response): Promise<void> => {
    try {
      const state = await computeScreenState(req.params.workspaceId);
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.json(state);
    } catch (err: unknown) {
      console.error('[GET /api/workspace/screen-state/:id] error:', err);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur compute state' } });
    }
  },
);

// ── POST /screen-state/focused-playlist (host) ────────────────────────────
// feat/tv-playlist-selection-sync — host POSTe l'id de la playlist
// actuellement centrée dans le carrousel de sélection. TV poll voit
// PLAYLIST_SELECTION au prochain tick (+ broadcast spectator pour re-poll
// immédiat). Body `{ playlist_id: null }` pour sortir de la sélection.

const focusBodySchema = z.object({
  playlist_id: z.string().uuid().nullable(),
  // feat/tv-grid-mirror — position de scroll VERTICALE de la grille host
  // (ratio 0..1), throttle ~100ms côté host. La TV l'applique à sa propre grille.
  scroll_ratio: z.number().min(0).max(1).optional(),
  // feat/tv-h-scroll — position de scroll HORIZONTALE par carrousel de catégorie
  // { catSlug: ratio 0..1 }. La TV applique chaque ratio au carrousel matchant.
  h_ratios: z.record(z.string(), z.number().min(0).max(1)).optional(),
  // feat/host-tv-level-mirror — clé du thème ouvert (étape NIVEAU) ; null/absent
  // = étape THÈMES. La TV mirrore l'étape niveau quand non-null.
  selected_theme_key: z.string().max(120).nullable().optional(),
});

router.post(
  '/screen-state/focused-playlist',
  requireAuth,
  requireWorkspace,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = focusBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Body invalide' },
      });
      return;
    }
    const workspaceId = req.workspaceId!;
    setFocusedPlaylist(
      workspaceId,
      parsed.data.playlist_id,
      parsed.data.scroll_ratio ?? 0,
      parsed.data.h_ratios,
      parsed.data.selected_theme_key ?? null,
    );

    // Broadcast aux spectators TV pour re-poll immédiat (< 100ms).
    // Best-effort : si pas de session active, no-op.
    try {
      const session = await prisma.session.findFirst({
        where: {
          establishment: { workspace_id: workspaceId },
          status: { in: ['WAITING', 'PLAYING'] },
        },
        select: { id: true },
        orderBy: { updated_at: 'desc' },
      });
      if (session) {
        broadcastToSession(session.id, 'screen-state:focus-changed', {
          playlist_id: parsed.data.playlist_id,
        });
      }
    } catch (err: unknown) {
      console.warn('[POST /screen-state/focused-playlist] broadcast failed:', err);
    }
    res.json({ ok: true });
  },
);

// ── POST /screen-state/qr-overlay (host) ──────────────────────────────────
// feat/tv-join-qr-codes — l'animateur (pendant la PARTIE ou la sélection)
// toggle l'affichage du QR de rejoindre EN GRAND sur la TV. Flag in-memory
// INDÉPENDANT du focus/scroll (vaut pendant PLAYING aussi), lu par la TV via
// screen-state. Réutilise le canal screen-state : même broadcast `focus-changed`
// pour le re-poll immédiat de la TV.

const qrOverlayBodySchema = z.object({
  enabled: z.boolean(),
});

router.post(
  '/screen-state/qr-overlay',
  requireAuth,
  requireWorkspace,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = qrOverlayBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Body invalide' } });
      return;
    }
    const workspaceId = req.workspaceId!;
    setQrOverlay(workspaceId, parsed.data.enabled);

    // Re-poll TV immédiat (best-effort) via le canal screen-state existant.
    try {
      const session = await prisma.session.findFirst({
        where: {
          establishment: { workspace_id: workspaceId },
          status: { in: ['WAITING', 'PLAYING'] },
        },
        select: { id: true },
        orderBy: { updated_at: 'desc' },
      });
      if (session) {
        broadcastToSession(session.id, 'screen-state:focus-changed', {
          qr_overlay: parsed.data.enabled,
        });
      }
    } catch (err: unknown) {
      console.warn('[POST /screen-state/qr-overlay] broadcast failed:', err);
    }
    res.json({ ok: true });
  },
);

// ── POST /screen-state/audio-target (host) ────────────────────────────────
// feat/tv-audio-output — l'animateur toggle "sortir le son sur l'écran TV".
// Flag in-memory par workspace (cf. tvAudioTargetStore). Re-poll TV immédiat
// via broadcast socket (canal existant screen-state:focus-changed).

const audioTargetBodySchema = z.object({
  audio_target: z.enum(['host', 'tv']),
});

router.post(
  '/screen-state/audio-target',
  requireAuth,
  requireWorkspace,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = audioTargetBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Body invalide' } });
      return;
    }
    const workspaceId = req.workspaceId!;
    setAudioTarget(workspaceId, parsed.data.audio_target);

    try {
      const session = await prisma.session.findFirst({
        where: {
          establishment: { workspace_id: workspaceId },
          status: { in: ['WAITING', 'PLAYING'] },
        },
        select: { id: true },
        orderBy: { updated_at: 'desc' },
      });
      if (session) {
        broadcastToSession(session.id, 'screen-state:focus-changed', {
          audio_target: parsed.data.audio_target,
        });
      }
    } catch (err: unknown) {
      console.warn('[POST /screen-state/audio-target] broadcast failed:', err);
    }
    res.json({ ok: true });
  },
);

// ── POST /screen-state/:workspaceId/audio-target (public, TV self-serve) ──
// feat/tv-audio-self-serve — la TV elle-même prend le son (ou le rend au host)
// d'UN clic, sans toucher la tablette animateur. PUBLIQUE + scoped par
// :workspaceId (comme tv-audio-armed/tv-spotify-ready), PAS la route host-auth.
// Même store in-memory (setAudioTarget). Re-poll host/TV immédiat via broadcast.
// "Lecture seule" préservée : ne route QUE l'audio, aucun contrôle de jeu.

router.post(
  '/screen-state/:workspaceId/audio-target',
  async (req: Request<{ workspaceId: string }>, res: Response): Promise<void> => {
    const parsed = audioTargetBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Body invalide' } });
      return;
    }
    const workspaceId = req.params.workspaceId;
    setAudioTarget(workspaceId, parsed.data.audio_target);

    try {
      const session = await prisma.session.findFirst({
        where: {
          establishment: { workspace_id: workspaceId },
          status: { in: ['WAITING', 'PLAYING'] },
        },
        select: { id: true },
        orderBy: { updated_at: 'desc' },
      });
      if (session) {
        broadcastToSession(session.id, 'screen-state:focus-changed', {
          audio_target: parsed.data.audio_target,
        });
      }
    } catch (err: unknown) {
      console.warn('[POST /screen-state/:id/audio-target] broadcast failed:', err);
    }
    res.json({ ok: true });
  },
);

// ── POST /screen-state/:workspaceId/tv-audio-armed (public, TV) ───────────
// feat/tv-audio-output — la TV signale que l'utilisateur a cliqué "Activer le
// son sur cet écran" (gesture d'unlock autoplay). Heartbeat : re-POSTé toutes
// les 30s tant que la TV est ouverte (TTL 60s côté store → si la TV se
// déconnecte, on retombe sur le host = jamais de silence).

const tvFlagBodySchema = z.object({
  value: z.boolean(),
});

router.post(
  '/screen-state/:workspaceId/tv-audio-armed',
  async (req: Request<{ workspaceId: string }>, res: Response): Promise<void> => {
    const parsed = tvFlagBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Body invalide' } });
      return;
    }
    const workspaceId = req.params.workspaceId;
    setTvAudioArmed(workspaceId, parsed.data.value);

    try {
      const session = await prisma.session.findFirst({
        where: {
          establishment: { workspace_id: workspaceId },
          status: { in: ['WAITING', 'PLAYING'] },
        },
        select: { id: true },
        orderBy: { updated_at: 'desc' },
      });
      if (session) {
        broadcastToSession(session.id, 'screen-state:focus-changed', {
          tv_audio_armed: parsed.data.value,
        });
      }
    } catch (err: unknown) {
      console.warn('[POST /screen-state/tv-audio-armed] broadcast failed:', err);
    }
    res.json({ ok: true });
  },
);

// ── POST /screen-state/:workspaceId/tv-spotify-ready (public, TV) ─────────
// feat/tv-audio-output — la TV signale que son Spotify Web Playback SDK est
// connecté+ready. Sans ça, les tracks Spotify restent sur le host (résolution
// du sink côté client). Heartbeat 30s comme tv-audio-armed.

router.post(
  '/screen-state/:workspaceId/tv-spotify-ready',
  async (req: Request<{ workspaceId: string }>, res: Response): Promise<void> => {
    const parsed = tvFlagBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Body invalide' } });
      return;
    }
    const workspaceId = req.params.workspaceId;
    setTvSpotifyReady(workspaceId, parsed.data.value);

    try {
      const session = await prisma.session.findFirst({
        where: {
          establishment: { workspace_id: workspaceId },
          status: { in: ['WAITING', 'PLAYING'] },
        },
        select: { id: true },
        orderBy: { updated_at: 'desc' },
      });
      if (session) {
        broadcastToSession(session.id, 'screen-state:focus-changed', {
          tv_spotify_ready: parsed.data.value,
        });
      }
    } catch (err: unknown) {
      console.warn('[POST /screen-state/tv-spotify-ready] broadcast failed:', err);
    }
    res.json({ ok: true });
  },
);

export default router;
