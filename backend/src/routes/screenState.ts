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
import { computeScreenState } from '../lib/screenState.js';
import { requireAuth } from '../middleware/auth.js';
import { requireWorkspace } from '../middleware/tenant.js';

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

export default router;
