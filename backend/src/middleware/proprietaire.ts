/**
 * requireOwner — LE CLIENT NE TOUCHE NI AU CATALOGUE NI AU BACK-OFFICE.
 *
 * Demande de Thomas : « owner controle le back office et les playlists, host
 * devient client et tu lui enleves des droits ». Jusqu ici le role n etait
 * verifie NULLE PART : requireWorkspace se contentait de l appartenance et du
 * statut APPROVED, donc n importe quel membre pouvait creer une playlist,
 * modifier le catalogue officiel ou entrer dans l administration. Le role
 * existait dans la base sans rien commander.
 *
 * A poser APRES requireAuth + requireWorkspace, sur tout ce qui ECRIT du
 * contenu ou administre. Les routes de JEU (lancer une soiree, piloter une
 * manche, consulter les playlists officielles) restent ouvertes au client :
 * c est ce qu il achete.
 *
 * Les super-admins passent, comme partout ailleurs.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { prisma } from '../lib/prisma.js';
import { isSuperAdminEmail } from '../lib/superAdmin.js';

export const requireOwner: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (isSuperAdminEmail(req.userEmail)) {
    next();
    return;
  }
  if (!req.userId || !req.workspaceId) {
    res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Auth et workspace requis' },
    });
    return;
  }
  try {
    const membre = await prisma.workspaceMember.findFirst({
      where: { user_id: req.userId, workspace_id: req.workspaceId },
      select: { role: true },
    });
    if (membre?.role !== 'OWNER') {
      res.status(403).json({
        error: {
          code: 'RESERVE_AU_PROPRIETAIRE',
          message:
            'Cette action est reservee au proprietaire du compte. Ton acces permet de jouer avec les playlists, pas de les modifier.',
        },
      });
      return;
    }
    next();
  } catch (err: unknown) {
    console.error('[requireOwner] error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Erreur de droits' } });
  }
};
