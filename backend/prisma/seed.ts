/**
 * Tutti — seed de développement.
 *
 * Usage : `pnpm --filter @tutti/backend exec prisma db seed`
 *
 * Crée :
 *   - 1 Workspace "Le Komptoir Démo"
 *   - 1 Establishment associé
 *   - 1 WorkspaceMember (OWNER) avec un user_id factice à remplacer plus tard
 *     par un vrai utilisateur Supabase Auth (étape 3).
 *
 * Idempotent : utilise upsert sur les clés naturelles.
 */

import { PrismaClient, Plan, Role } from '@prisma/client';

const prisma = new PrismaClient();

// User_id factice utilisé tant que l'étape 3 (Supabase Auth) n'est pas livrée.
// À remplacer par un vrai auth.users.id lors du premier signup.
const DEMO_OWNER_USER_ID = '00000000-0000-0000-0000-000000000001';

async function main(): Promise<void> {
  console.info('[seed] start');

  // Workspace : on cherche par nom (clé naturelle pour le seed).
  // En vrai production, le workspace_id sera unique par compte Stripe.
  const existingWorkspace = await prisma.workspace.findFirst({
    where: { name: 'Le Komptoir Démo' },
  });

  const workspace = existingWorkspace
    ? await prisma.workspace.update({
        where: { id: existingWorkspace.id },
        data: { plan: Plan.MONTHLY },
      })
    : await prisma.workspace.create({
        data: {
          name: 'Le Komptoir Démo',
          plan: Plan.MONTHLY,
        },
      });
  console.info(`[seed] workspace: ${workspace.id} (${workspace.name})`);

  // WorkspaceMember : owner du workspace
  await prisma.workspaceMember.upsert({
    where: {
      workspace_id_user_id: {
        workspace_id: workspace.id,
        user_id: DEMO_OWNER_USER_ID,
      },
    },
    create: {
      workspace_id: workspace.id,
      user_id: DEMO_OWNER_USER_ID,
      role: Role.OWNER,
    },
    update: { role: Role.OWNER },
  });
  console.info(`[seed] workspace_member: owner ${DEMO_OWNER_USER_ID}`);

  // Establishment : cherche un existant pour ce workspace, sinon crée
  const existingEstablishment = await prisma.establishment.findFirst({
    where: { workspace_id: workspace.id },
  });

  const establishment = existingEstablishment
    ? await prisma.establishment.update({
        where: { id: existingEstablishment.id },
        data: {
          branding_color: '#ee6c2a',
          default_language: 'fr',
          active_provider: 'demo',
        },
      })
    : await prisma.establishment.create({
        data: {
          workspace_id: workspace.id,
          name: 'Le Komptoir',
          branding_color: '#ee6c2a',
          default_language: 'fr',
          active_provider: 'demo',
        },
      });
  console.info(`[seed] establishment: ${establishment.id} (${establishment.name})`);

  console.info('[seed] done ✅');
}

main()
  .catch((err: unknown) => {
    console.error('[seed] failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
