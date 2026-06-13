/**
 * Routes /api/tv/* — feat/tv-join-code-multidevice
 *
 *   GET /api/tv/:code   (public, sans auth)
 *
 * Résout un code de salon court (5 chars) vers la session active + son
 * workspace, pour qu'un 2e device rejoigne en mode "Écran TV". Un code mort
 * (session ENDED / inexistante) renvoie 404 → ne rejoint aucune partie.
 *
 * Pas de données sensibles exposées : workspaceId (déjà public via
 * /api/workspace/screen-state/:id), short_code joueur, nom de session.
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { normalizeTvCode } from '../lib/tvCode.js';

const router: Router = Router();

router.get('/:code', async (req: Request<{ code: string }>, res: Response): Promise<void> => {
  const code = normalizeTvCode(req.params.code);
  if (code.length < 4) {
    res.status(400).json({ error: { code: 'INVALID_CODE', message: 'Code invalide' } });
    return;
  }
  try {
    const session = await prisma.session.findFirst({
      where: { tv_code: code, status: { in: ['WAITING', 'PLAYING'] } },
      select: {
        id: true,
        short_code: true,
        name: true,
        establishment: { select: { workspace_id: true } },
      },
    });
    if (!session) {
      res.status(404).json({
        error: { code: 'CODE_NOT_FOUND', message: 'Aucune partie active pour ce code' },
      });
      return;
    }
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.json({
      workspace_id: session.establishment.workspace_id,
      join_code: session.short_code,
      session_name: session.name,
    });
  } catch (err: unknown) {
    console.error('[GET /api/tv/:code] error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur résolution code' } });
  }
});

export default router;
