/**
 * routes/comptesApple.ts — feat/parc-comptes-apple
 *
 * Gestion du parc de comptes Apple Music partagés, réservé au PROPRIÉTAIRE.
 *
 * Thomas : « on enregistre les identifiants des comptes apple dans le système
 * pour que 6 parties puissent être faites simultanément ».
 *
 * CE QU'ON ENREGISTRE, ET CE QU'ON N'ENREGISTRE PAS
 * -------------------------------------------------
 * Apple ne délivre JAMAIS de jeton contre un e-mail + mot de passe : le Music
 * User Token ne s'obtient que par `music.authorize()`, c'est-à-dire une
 * connexion faite par une personne dans la fenêtre Apple. Il n'existe aucune
 * API à qui confier un mot de passe.
 *
 * Le parcours est donc : le propriétaire clique « ajouter un compte » dans le
 * back-office, la fenêtre Apple s'ouvre, il s'y connecte avec CE compte, et le
 * navigateur nous renvoie le jeton — que nous seul conservons. Aucun mot de
 * passe ne transite ni n'est stocké.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

import { requireWorkspace } from '../middleware/tenant.js';
import { requireOwner } from '../middleware/proprietaire.js';
import { etatDuParc } from '../lib/parcComptesApple.js';

const router: Router = Router();
router.use(requireAuth, requireWorkspace, requireOwner);

/** Liste du parc + combien de parties peuvent encore démarrer. */
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  const [comptes, etat] = await Promise.all([
    prisma.appleMusicAccount.findMany({
      orderBy: { created_at: 'asc' },
      select: {
        id: true,
        libelle: true,
        account_email: true,
        actif: true,
        expires_at: true,
        verifie_le: true,
        created_at: true,
        // JAMAIS le jeton : il ne ressort pas du serveur.
        sessions: {
          where: { status: { in: ['WAITING', 'PLAYING'] } },
          select: { id: true, name: true },
        },
      },
    }),
    etatDuParc(),
  ]);
  res.json({
    comptes: comptes.map((c) => ({
      id: c.id,
      libelle: c.libelle,
      account_email: c.account_email,
      actif: c.actif,
      expires_at: c.expires_at?.toISOString() ?? null,
      verifie_le: c.verifie_le?.toISOString() ?? null,
      created_at: c.created_at.toISOString(),
      occupe_par: c.sessions[0] ? { id: c.sessions[0].id, nom: c.sessions[0].name } : null,
    })),
    etat,
  });
});

const ajoutSchema = z.object({
  libelle: z.string().trim().min(1).max(80),
  account_email: z.string().trim().email().max(200).optional(),
  /** Obtenu dans le navigateur par music.authorize(). Jamais un mot de passe. */
  music_user_token: z.string().trim().min(10).max(8192),
  expires_at: z.string().datetime().optional(),
});

/** Ajoute un compte au parc, à partir d'un jeton obtenu dans la fenêtre Apple. */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = ajoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Body invalide', details: parsed.error.flatten() },
    });
    return;
  }
  const cree = await prisma.appleMusicAccount.create({
    data: {
      libelle: parsed.data.libelle,
      account_email: parsed.data.account_email ?? null,
      music_user_token: parsed.data.music_user_token,
      expires_at: parsed.data.expires_at ? new Date(parsed.data.expires_at) : null,
      verifie_le: new Date(),
    },
    select: { id: true, libelle: true, account_email: true, actif: true },
  });
  res.status(201).json({ compte: cree, etat: await etatDuParc() });
});

const majSchema = z.object({
  libelle: z.string().trim().min(1).max(80).optional(),
  actif: z.boolean().optional(),
  /** Re-signature : le jeton Apple a expiré, on en repose un neuf. */
  music_user_token: z.string().trim().min(10).max(8192).optional(),
});

router.patch('/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const parsed = majSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Body invalide' } });
    return;
  }
  const maj = await prisma.appleMusicAccount.updateMany({
    where: { id: req.params.id },
    data: {
      ...(parsed.data.libelle ? { libelle: parsed.data.libelle } : {}),
      ...(parsed.data.actif === undefined ? {} : { actif: parsed.data.actif }),
      ...(parsed.data.music_user_token
        ? { music_user_token: parsed.data.music_user_token, verifie_le: new Date() }
        : {}),
    },
  });
  if (maj.count === 0) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Compte introuvable' } });
    return;
  }
  res.json({ ok: true, etat: await etatDuParc() });
});

/** Retire un compte du parc. Une partie en cours dessus n'est pas coupée. */
router.delete('/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const enCours = await prisma.session.count({
    where: { apple_music_account_id: req.params.id, status: { in: ['WAITING', 'PLAYING'] } },
  });
  if (enCours > 0) {
    res.status(409).json({
      error: {
        code: 'COMPTE_OCCUPE',
        message: 'Ce compte fait tourner une partie en cours. Terminez-la avant de le retirer.',
      },
    });
    return;
  }
  await prisma.appleMusicAccount.deleteMany({ where: { id: req.params.id } });
  res.json({ ok: true, etat: await etatDuParc() });
});

export default router;
