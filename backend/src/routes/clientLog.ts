/**
 * Routes /api/client-log — JOURNAL DISTANT DES APPAREILS.
 *
 * Pourquoi : quand la console iPad se fige, le serveur ne voit rien (la
 * demande n'est jamais partie) et l'iPad n'a pas de console lisible en
 * soirée. On perdait donc l'information la plus importante : QUELLE étape
 * s'exécutait au moment du blocage. Les appareils envoient désormais leurs
 * étapes clés et leurs erreurs ici ; elles apparaissent dans les logs Railway
 * sous le préfixe `[Appareil]`, horodatées côté serveur.
 *
 * Volume borné : messages courts, envoyés seulement aux étapes importantes et
 * sur erreur. Aucune donnée personnelle.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const bodySchema = z.object({
  tag: z.string().trim().min(1).max(40),
  level: z.enum(['info', 'warn', 'error']).default('info'),
  message: z.string().trim().min(1).max(600),
  meta: z.record(z.string(), z.unknown()).optional(),
  device: z.string().trim().max(60).optional(),
});

router.post('/client-log', requireAuth, (req: Request, res: Response): void => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Journal invalide' } });
    return;
  }
  const { tag, level, message, meta, device } = parsed.data;
  const metaText = meta ? ` ${JSON.stringify(meta).slice(0, 400)}` : '';
  const line = `[Appareil:${device ?? 'inconnu'}] [${tag}] ${message}${metaText}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
  res.json({ ok: true });
});

export default router;
