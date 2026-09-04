/**
 * sessionAutoClose.ts — fix/restrict-banners-to-host-pages
 *
 * Cron horaire qui ferme automatiquement les sessions zombies — celles
 * qui restent en `WAITING` ou `PLAYING` sans aucune activité depuis plus
 * de SESSION_INACTIVITY_TIMEOUT_MS (par défaut 2h).
 *
 * Justification métier :
 *   - Une session abandonnée traîne dans le dashboard host et déclenche
 *     le ResumeSessionBanner ("Partie en cours KOMP-XXXX · inactive depuis
 *     30 min · Reprendre →"). Au bout d'un certain temps c'est juste du
 *     bruit visuel et fonctionnellement inutile.
 *   - Les sessions zombies peuvent aussi bloquer la TV (cf. findRepresentativeSession
 *     qui ordonne par updated_at desc — une session WAITING orpheline
 *     peut s'incruster si jamais touchée).
 *
 * Critère d'inactivité :
 *   `updated_at < (now - SESSION_INACTIVITY_TIMEOUT_MS)` ET
 *   `status IN ('WAITING', 'PLAYING')`.
 *
 * Effet :
 *   `status = 'ENDED'`, `ended_at = now()` (cohérent avec POST /:id/end).
 *   `updated_at` est bumpé automatiquement par Prisma.
 *
 * fix/lobby-ferme-avant-lancement — une session en salle d'attente
 * (`WAITING`) ne compte NI manche NI point : les deux garde-fous ci-dessous
 * ne la protégeaient pas. Un lobby ouvert tôt (les joueurs scannent le QR
 * pendant que la salle se remplit) était fermé au bout de 2h, sans un mot,
 * et le clic « Lancer » échouait en 409 INVALID_STATUS. Comptent désormais
 * aussi comme activité : une inscription de joueur (participants.joined_at)
 * et une proposition de playlist (playlist_proposals.created_at).
 *
 * Un event `session:auto_closed` est émis pour que la console l'apprenne
 * tout de suite, au lieu de le découvrir au moment de lancer.
 *
 * Pas de dep node-cron — un simple setInterval suffit pour 1 job, même
 * pattern que `lib/youtubeRefresh.ts`.
 */

import { prisma } from './prisma.js';
import { SessionStatus } from '@prisma/client';
import { clearActiveTrack } from './gameState.js';
import { clearActiveQuestion } from './gameStateQuizz.js';
import { clearAutoReveal } from './gameplayQuizzCore.js';
import { cancelPhase2Timer } from '../routes/gameplayParticipant.js';
import { broadcastToSession } from '../socket/index.js';

/** Sessions inactives depuis plus de ça sont auto-fermées. Override via env. */
const INACTIVITY_TIMEOUT_MS = Number.parseInt(
  process.env.SESSION_INACTIVITY_TIMEOUT_MS ?? `${2 * 60 * 60 * 1000}`, // 2h
  10,
);

/** Tick toutes les 1h. Override via env (utile en dev pour test rapide). */
const CRON_INTERVAL_MS = Number.parseInt(
  process.env.SESSION_AUTO_CLOSE_INTERVAL_MS ?? `${60 * 60 * 1000}`,
  10,
);

let cronTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Exécute une passe d'auto-close. Idempotent (relances multiples OK).
 * Retourne le nombre de sessions fermées (pour logs / debug).
 */
export async function runSessionAutoClose(
  source: 'cron' | 'manual' = 'cron',
): Promise<{ closed: number }> {
  const threshold = new Date(Date.now() - INACTIVITY_TIMEOUT_MS);
  const start = Date.now();
  console.info(
    `[Cron][SessionAutoClose] start | source=${source} | threshold=${threshold.toISOString()} (older = close)`,
  );

  // fix/soiree-coupee-en-plein-jeu — L'INACTIVITÉ SE MESURE SUR LE JEU RÉEL.
  //
  // On ne regardait que `updated_at` de la session. Or jouer un morceau touche
  // la manche, buzzer touche les scores, un joueur qui arrive touche les
  // participants — jamais la ligne de session. Une soirée de plus de deux
  // heures sans une seule pause était donc marquée « terminée » EN PLEIN JEU,
  // sans le moindre avertissement : la console continuait comme si de rien
  // n'était jusqu'au premier refus, et la TV repassait à l'écran d'accueil.
  //
  // On exclut désormais toute session ayant une manche récente ou un point
  // marqué récemment.
  // fix/manche-fantome-en-memoire — on note quelles soirées vont être closes
  // pour purger leur état mémoire juste après (buzz, minuteurs, questions).
  const aFermer = await prisma.session.findMany({
    where: {
      status: { in: [SessionStatus.WAITING, SessionStatus.PLAYING] },
      updated_at: { lt: threshold },
      rounds: {
        none: { OR: [{ started_at: { gte: threshold } }, { ended_at: { gte: threshold } }] },
      },
      score_events: { none: { created_at: { gte: threshold } } },
      // fix/lobby-ferme-avant-lancement — un lobby vivant n'est pas inactif.
      participants: { none: { joined_at: { gte: threshold } } },
      playlist_proposals: { none: { created_at: { gte: threshold } } },
    },
    select: {
      id: true,
      status: true,
      rounds: { where: { status: 'PLAYING' }, select: { id: true } },
    },
  });

  const result = await prisma.session.updateMany({
    where: {
      status: { in: [SessionStatus.WAITING, SessionStatus.PLAYING] },
      updated_at: { lt: threshold },
      rounds: {
        none: { OR: [{ started_at: { gte: threshold } }, { ended_at: { gte: threshold } }] },
      },
      score_events: { none: { created_at: { gte: threshold } } },
      // fix/lobby-ferme-avant-lancement — un lobby vivant n'est pas inactif.
      participants: { none: { joined_at: { gte: threshold } } },
      playlist_proposals: { none: { created_at: { gte: threshold } } },
    },
    data: {
      status: SessionStatus.ENDED,
      ended_at: new Date(),
    },
  });

  // fix/manche-fantome-en-memoire — purge de l'état mémoire des soirées closes.
  for (const soiree of aFermer) {
    for (const manche of soiree.rounds) {
      clearActiveTrack(manche.id);
      cancelPhase2Timer(manche.id);
    }
    clearAutoReveal(soiree.id);
    clearActiveQuestion(soiree.id);
    // fix/lobby-ferme-avant-lancement — prévenir tout de suite les écrans
    // encore ouverts plutôt que de les laisser afficher un QR mort.
    try {
      broadcastToSession(soiree.id, 'session:auto_closed', {
        sessionId: soiree.id,
        raison: 'inactivite',
        inactiviteMinutes: Math.round(INACTIVITY_TIMEOUT_MS / 60_000),
        avaitDemarre: soiree.status === SessionStatus.PLAYING,
      });
    } catch (err) {
      console.error('[Cron][SessionAutoClose] broadcast error:', err);
    }
  }

  const elapsedMs = Date.now() - start;
  console.info(`[Cron][SessionAutoClose] done | closed=${result.count} | elapsed=${elapsedMs}ms`);
  return { closed: result.count };
}

/**
 * Démarre le cron : 1ʳᵉ exécution immédiate (catch-up au boot), puis tick
 * toutes les CRON_INTERVAL_MS. No-op si déjà démarré.
 */
export function startSessionAutoCloseCron(): void {
  if (cronTimer) {
    console.warn('[Cron][SessionAutoClose] already running, skip');
    return;
  }
  console.info(
    `[Cron][SessionAutoClose] scheduled every ${CRON_INTERVAL_MS / 1000 / 60}min | timeout=${INACTIVITY_TIMEOUT_MS / 1000 / 60}min`,
  );
  // Catch-up immédiat — ferme tout ce qui traîne au boot.
  setTimeout(() => {
    void runSessionAutoClose('cron').catch((err) => {
      console.error('[Cron][SessionAutoClose] initial tick error:', err);
    });
  }, 5_000);
  cronTimer = setInterval(() => {
    void runSessionAutoClose('cron').catch((err) => {
      console.error('[Cron][SessionAutoClose] tick error:', err);
    });
  }, CRON_INTERVAL_MS);
}

export function stopSessionAutoCloseCron(): void {
  if (cronTimer) {
    clearInterval(cronTimer);
    cronTimer = null;
    console.info('[Cron][SessionAutoClose] stopped');
  }
}
