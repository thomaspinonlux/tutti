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

const debitParIp = new Map<string, { fenetre: number; n: number }>();
const LIGNES_MAX_PAR_10S = 400;

function debitAutorise(ip: string, lignes: number): boolean {
  const fenetre = Math.floor(Date.now() / 10_000);
  const compteur = debitParIp.get(ip);
  const n = compteur && compteur.fenetre === fenetre ? compteur.n : 0;
  if (n >= LIGNES_MAX_PAR_10S) return false;
  debitParIp.set(ip, { fenetre, n: n + lignes });
  if (debitParIp.size > 500) debitParIp.clear();
  return true;
}

// ── POST /client-log/public — JOURNAL DES ÉCRANS SANS COMPTE (TV, joueurs) ──
// L'écran TV n'a pas de compte : ses lignes de diagnostic partaient vers la
// route authentifiée et étaient refusées en silence. Même corps, même
// traitement, débit plafonné (cf. plus bas), aucune donnée personnelle.
router.post('/client-log/public', (req: Request, res: Response): void => {
  if (req.get('x-tutti-diag') !== '1') {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Journal invalide' } });
    return;
  }
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Journal invalide' } });
    return;
  }
  if (!debitAutorise(req.ip ?? 'inconnue', 1)) {
    res.status(429).json({ error: { code: 'TROP_DE_LIGNES', message: 'Débit dépassé' } });
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

// ── POST /client-log/natif — JOURNAL DES GREFFONS NATIFS (iPad) ─────────────
// Les greffons Swift n'ont pas de jeton d'authentification sous la main, et
// leur journal doit partir MÊME quand le fil principal de l'app est bloqué.
// Adresse volontairement sans authentification : elle ne fait qu'écrire des
// lignes de diagnostic dans le journal serveur, avec un débit plafonné par
// adresse IP. Aucune donnée personnelle.
const ligneNativeSchema = z.object({
  t: z.number(),
  fil: z.string().max(20),
  source: z.string().max(40),
  etape: z.string().max(200),
  niveau: z.enum(['info', 'warn', 'error']).default('info'),
  details: z.record(z.string(), z.unknown()).optional(),
});
const corpsNatifSchema = z.object({
  appareil: z.string().max(60).optional(),
  systeme: z.string().max(30).optional(),
  lignes: z.array(ligneNativeSchema).max(200),
});

router.post('/client-log/natif', (req: Request, res: Response): void => {
  if (req.get('x-tutti-natif') !== '1') {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Journal invalide' } });
    return;
  }
  const parsed = corpsNatifSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Journal invalide' } });
    return;
  }
  if (!debitAutorise(req.ip ?? 'inconnue', parsed.data.lignes.length)) {
    res.status(429).json({ error: { code: 'TROP_DE_LIGNES', message: 'Débit dépassé' } });
    return;
  }

  const appareil = `${parsed.data.appareil ?? 'iPad'} iOS ${parsed.data.systeme ?? '?'}`;
  for (const l of parsed.data.lignes) {
    const details = l.details ? ` ${JSON.stringify(l.details).slice(0, 500)}` : '';
    const line = `[Natif:${appareil}] t+${l.t}ms [${l.fil}] [${l.source}] ${l.etape}${details}`;
    if (l.niveau === 'error') console.error(line);
    else if (l.niveau === 'warn') console.warn(line);
    else console.info(line);
  }
  res.json({ ok: true, recues: parsed.data.lignes.length });
});

export default router;
