/**
 * parcComptesApple.ts — feat/parc-comptes-apple
 *
 * Thomas : « on enregistre les identifiants des comptes apple dans le système
 * pour que 6 parties puissent être faites simultanément ».
 *
 * UN ABONNEMENT APPLE MUSIC = UN FLUX. Deux soirées ne peuvent pas se partager
 * le même compte : la seconde couperait le son de la première. Ce module tient
 * le parc et en réserve un compte par session, puis le libère à la fin.
 *
 * Au-delà du nombre de comptes, on REFUSE le lancement avec un message clair,
 * plutôt que de laisser deux bars se voler la musique.
 *
 * RAPPEL — aucun mot de passe n'est stocké nulle part. Apple ne délivre de
 * Music User Token que par `music.authorize()`, donc par une connexion faite
 * par une personne dans la fenêtre Apple. Le parc conserve ce jeton.
 */
import { prisma } from './prisma.js';

export class ParcCompletError extends Error {
  readonly code = 'PARC_APPLE_COMPLET';
  constructor(
    readonly comptesTotal: number,
    readonly comptesOccupes: number,
    /** Refus parce que le dernier compte libre est gardé pour le propriétaire. */
    readonly gardePourProprietaire = false,
  ) {
    super(
      comptesTotal === 0
        ? "Aucun compte Apple Music n'est enregistré : ajoutez-en un depuis le back-office."
        : gardePourProprietaire
          ? 'Toutes les parties clientes possibles sont déjà en cours. Réessaie dans un moment.'
          : `Les ${comptesTotal} comptes Apple Music sont déjà utilisés par ${comptesOccupes} parties en cours.`,
    );
  }
}

/** Sessions qui immobilisent un compte : tout ce qui n'est pas terminé. */
const SESSIONS_VIVANTES = ['WAITING', 'PLAYING'] as const;

/**
 * Réserve un compte libre pour la session, ou renvoie celui déjà réservé.
 *
 * La réservation est faite dans une transaction SERIALIZABLE : deux salles qui
 * lancent à la même seconde ne peuvent pas se voir attribuer le même compte.
 */
export async function reserverCompteApple(
  sessionId: string,
  options: {
    /**
     * feat/reservation-de-creneaux — Thomas : « on garde un compte disponible
     * pour la brasserie ». Vrai pour une partie CLIENT : elle ne peut pas
     * prendre le DERNIER compte libre, qui reste au propriétaire.
     */
    garderUnPourLeProprietaire?: boolean;
  } = {},
): Promise<{
  id: string;
  libelle: string;
  music_user_token: string;
}> {
  return prisma.$transaction(
    async (tx) => {
      const session = await tx.session.findUnique({
        where: { id: sessionId },
        select: { apple_music_account_id: true },
      });
      // Déjà servie : on rend le même compte, sans en consommer un second.
      if (session?.apple_music_account_id) {
        const dejaLa = await tx.appleMusicAccount.findUnique({
          where: { id: session.apple_music_account_id },
          select: { id: true, libelle: true, music_user_token: true, actif: true },
        });
        if (dejaLa?.actif) return dejaLa;
      }

      const occupes = await tx.session.findMany({
        where: {
          status: { in: [...SESSIONS_VIVANTES] },
          apple_music_account_id: { not: null },
          id: { not: sessionId },
        },
        select: { apple_music_account_id: true },
      });
      const prisIds = occupes
        .map((s) => s.apple_music_account_id)
        .filter((v): v is string => v !== null);

      const libre = await tx.appleMusicAccount.findFirst({
        where: { actif: true, id: { notIn: prisIds } },
        orderBy: { created_at: 'asc' },
        select: { id: true, libelle: true, music_user_token: true },
      });
      if (!libre) {
        const total = await tx.appleMusicAccount.count({ where: { actif: true } });
        throw new ParcCompletError(total, prisIds.length);
      }
      if (options.garderUnPourLeProprietaire) {
        const libres = await tx.appleMusicAccount.count({ where: { actif: true, id: { notIn: prisIds } } });
        if (libres <= 1) {
          const total = await tx.appleMusicAccount.count({ where: { actif: true } });
          throw new ParcCompletError(total, prisIds.length, true);
        }
      }

      await tx.session.update({
        where: { id: sessionId },
        data: { apple_music_account_id: libre.id },
      });
      return libre;
    },
    { isolationLevel: 'Serializable' },
  );
}

/** Libère le compte d'une session terminée : il redevient disponible. */
export async function libererCompteApple(sessionId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, apple_music_account_id: { not: null } },
    data: { apple_music_account_id: null },
  });
}

/** Combien de parties peuvent encore démarrer maintenant. */
export async function etatDuParc(): Promise<{
  total: number;
  occupes: number;
  disponibles: number;
}> {
  const total = await prisma.appleMusicAccount.count({ where: { actif: true } });
  const occupes = await prisma.session.count({
    where: {
      status: { in: [...SESSIONS_VIVANTES] },
      apple_music_account_id: { not: null },
    },
  });
  return { total, occupes, disponibles: Math.max(0, total - occupes) };
}
