/**
 * creneauClient.ts — feat/reservation-de-creneaux
 *
 * UNE SEULE GARDE, POUR TOUTES LES PORTES D'ENTRÉE D'UNE PARTIE.
 *
 * Un CLIENT ne peut ouvrir une partie que pendant son créneau payé ou offert.
 * La garde vivait dans POST /api/sessions (blind test) ; or le quiz se lance
 * par une autre porte (POST /api/library/quiz-packs/:id/launch), qui ne la
 * passait pas : réserver n'aurait servi à rien pour qui choisit le quiz.
 * Les deux portes appellent désormais cette fonction.
 */
import { prisma } from './prisma.js';
import { isSuperAdminEmail } from './superAdmin.js';
import { STATUTS_JOUABLES } from './reservations.js';
import { lireReglages } from './reservationsCommun.js';

export interface RefusCreneau {
  status: 403;
  code: 'AUCUN_CRENEAU';
  message: string;
}

/**
 * null si l'utilisateur peut ouvrir une partie maintenant, sinon le refus à
 * renvoyer tel quel. Le propriétaire et les super-admins passent toujours.
 */
export async function refusHorsCreneau(
  userId: string | undefined,
  userEmail: string | undefined,
  workspaceId: string,
): Promise<RefusCreneau | null> {
  if (!userId || isSuperAdminEmail(userEmail)) return null;
  const membre = await prisma.workspaceMember.findFirst({
    where: { user_id: userId },
    orderBy: { created_at: 'asc' },
    select: { role: true },
  });
  if (membre?.role !== 'CLIENT') return null;

  const reglages = await lireReglages();
  const maintenant = new Date();
  const ouverture = new Date(maintenant.getTime() + reglages.ouverture_avant_minutes * 60_000);
  const creneau = await prisma.reservation.findFirst({
    where: {
      workspace_id: workspaceId,
      statut: { in: [...STATUTS_JOUABLES] },
      debut: { lte: ouverture },
      fin: { gte: maintenant },
    },
    select: { id: true },
  });
  if (creneau) return null;
  return {
    status: 403,
    code: 'AUCUN_CRENEAU',
    message:
      "Aucun créneau réservé en ce moment. Réserve une partie depuis l'espace Réservation — tu pourras l'ouvrir " +
      `${reglages.ouverture_avant_minutes} min avant le début.`,
  };
}
