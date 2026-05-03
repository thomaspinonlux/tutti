/**
 * Routes /api/music/* — recherche et lecture de morceaux via le provider
 * actif de l'établissement courant.
 *
 *   GET /api/music/providers          : liste des providers + capabilities
 *   GET /api/music/search?q=xxx       : recherche dans le provider actif
 *   GET /api/music/track/:id          : récupération par ID provider
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { MusicProviderId } from '@tutti/shared';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireWorkspace } from '../middleware/tenant.js';
import { getProvider, LIST_PROVIDERS } from '../music/registry.js';
import type { ProviderContext } from '../music/types.js';

const router: Router = Router();

router.use(requireAuth, requireWorkspace);

// ───── GET /api/music/providers ───────────────────────────────────────────

router.get('/providers', (_req: Request, res: Response): void => {
  res.json({ providers: LIST_PROVIDERS });
});

// ───── GET /api/music/search?q=xxx ────────────────────────────────────────

const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  /**
   * Phase 3c — provider override pour la recherche. Sans ce paramètre on
   * utilise le provider actif du workspace. Permet à l'admin de forcer
   * youtube/spotify dans le TrackSearch sans changer la conf workspace.
   */
  provider: z.enum(['demo', 'spotify', 'youtube', 'deezer', 'apple_music']).optional(),
});

router.get('/search', async (req: Request, res: Response): Promise<void> => {
  const parsed = searchQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Paramètre `q` requis (1-120 chars)' },
    });
    return;
  }
  const { q, limit, provider: forcedProvider } = parsed.data;

  try {
    const provider = forcedProvider
      ? await resolveSpecificProvider(req.workspaceId!, forcedProvider)
      : await resolveActiveProvider(req.workspaceId!);
    const results = await provider.search(q, { limit });
    res.json({
      provider: provider.id,
      query: q,
      results,
    });
  } catch (err: unknown) {
    handleProviderError('GET /api/music/search', err, res);
  }
});

// ───── GET /api/music/track/:id ───────────────────────────────────────────

router.get('/track/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const id = req.params.id;
  if (!id) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'ID manquant' } });
    return;
  }

  try {
    const provider = await resolveActiveProvider(req.workspaceId!);
    const track = await provider.getTrack(id);
    if (!track) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Morceau introuvable' } });
      return;
    }
    res.json({ track });
  } catch (err: unknown) {
    handleProviderError('GET /api/music/track/:id', err, res);
  }
});

// ───── Helpers ────────────────────────────────────────────────────────────

/**
 * Résout le MusicProvider actif pour le workspace courant :
 *   1. Lit `establishment.active_provider`
 *   2. Charge les credentials du provider (si OAuth)
 *   3. Instancie via le registry
 */
async function resolveActiveProvider(workspaceId: string): Promise<ReturnType<typeof getProvider>> {
  const establishment = await prisma.establishment.findFirst({
    where: { workspace_id: workspaceId },
    orderBy: { created_at: 'asc' },
  });
  if (!establishment) {
    throw new ProviderError(404, 'NO_ESTABLISHMENT', 'Aucun établissement pour ce workspace');
  }

  const providerId = establishment.active_provider as MusicProviderId;
  const credentials = await prisma.musicProviderCredential.findFirst({
    where: { workspace_id: workspaceId, provider: providerId },
  });

  const ctx: ProviderContext = {
    workspaceId,
    credentials: credentials
      ? {
          access_token: credentials.access_token,
          refresh_token: credentials.refresh_token,
          expires_at: credentials.expires_at,
        }
      : null,
  };

  return getProvider(providerId, ctx);
}

/**
 * Résout un provider spécifique (override Phase 3c) — charge les credentials
 * du provider demandé si OAuth, sinon ctx vide.
 */
async function resolveSpecificProvider(
  workspaceId: string,
  providerId: MusicProviderId,
): Promise<ReturnType<typeof getProvider>> {
  const credentials = await prisma.musicProviderCredential.findFirst({
    where: { workspace_id: workspaceId, provider: providerId },
  });

  const ctx: ProviderContext = {
    workspaceId,
    credentials: credentials
      ? {
          access_token: credentials.access_token,
          refresh_token: credentials.refresh_token,
          expires_at: credentials.expires_at,
        }
      : null,
  };

  return getProvider(providerId, ctx);
}

class ProviderError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function handleProviderError(label: string, err: unknown, res: Response): void {
  if (err instanceof ProviderError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  console.error(`[${label}] error:`, err);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Erreur lors de la requête music' },
  });
}

export default router;
