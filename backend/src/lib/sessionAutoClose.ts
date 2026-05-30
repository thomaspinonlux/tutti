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
 * Pas d'event Socket.IO émis — la session est déjà inactive, personne
 * n'écoute. Le prochain refresh du dashboard host verra le statut ENDED
 * et masquera le bandeau.
 *
 * Pas de dep node-cron — un simple setInterval suffit pour 1 job, même
 * pattern que `lib/youtubeRefresh.ts`.
 */

import { prisma } from './prisma.js';
import { SessionStatus } from '@prisma/client';

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

  const result = await prisma.session.updateMany({
    where: {
      status: { in: [SessionStatus.WAITING, SessionStatus.PLAYING] },
      updated_at: { lt: threshold },
    },
    data: {
      status: SessionStatus.ENDED,
      ended_at: new Date(),
    },
  });

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
