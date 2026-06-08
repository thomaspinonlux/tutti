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
    setFocusedPlaylist(workspaceId, parsed.data.playlist_id);

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

export default router;
