/**
 * Verification script — fix/session-pick-respect-default-size
 *
 * Two checks :
 *   1. pickRandomTrackIdsForRound returns 15 from a 80-track pool, randomly
 *      varied across runs.
 *   2. buildAndBroadcastTrack auto-clamps a legacy round (empty
 *      selected_track_ids) to default_session_size + persists.
 */
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import {
  buildAndBroadcastTrack,
  findRoundForSession,
  pickRandomTrackIdsForRound,
  DEFAULT_SESSION_SIZE,
} from '../src/lib/gameplayCore.js';

config();
const prisma = new PrismaClient();

const WORKSPACE_PLAYLIST_ID = 'e161554f-d269-4808-ae34-bbf10e21c40c';
const FAKE_SESSION_ID = '00000000-0000-0000-0000-000000000001';

async function checkPickHelper(): Promise<void> {
  const pl = await prisma.playlist.findUnique({
    where: { id: WORKSPACE_PLAYLIST_ID },
    select: { default_session_size: true, name: true },
  });
  if (!pl) {
    console.error('Playlist introuvable');
    return;
  }
  const sessionSize = pl.default_session_size ?? DEFAULT_SESSION_SIZE;
  console.info(`[Check 1] Helper pickRandomTrackIdsForRound — "${pl.name}"`);
  const sets: string[][] = [];
  for (let i = 1; i <= 2; i++) {
    const r = await pickRandomTrackIdsForRound(FAKE_SESSION_ID, WORKSPACE_PLAYLIST_ID, sessionSize);
    sets.push(r.selectedTrackIds);
    console.info(
      `  Run #${i}: pool=${r.poolSize} eligible=${r.eligibleSize} sessionSize=${sessionSize} → selected=${r.selectedTrackIds.length} | first=${r.selectedTrackIds[0]?.slice(0, 8)} last=${r.selectedTrackIds[r.selectedTrackIds.length - 1]?.slice(0, 8)}`,
    );
  }
  const overlap = sets[0]!.filter((id) => sets[1]!.includes(id)).length;
  console.info(`  Overlap between runs: ${overlap}/15 (lower = more random)`);
}

async function checkAutoClampDefenseInDepth(): Promise<void> {
  console.info('\n[Check 2] Auto-clamp defense-in-depth (buildAndBroadcastTrack)');

  // Find an existing PENDING session for this playlist's workspace, or
  // create a synthetic round on an ENDED session for non-destructive test.
  // We pick an ENDED session to avoid disrupting any active play.
  const playlist = await prisma.playlist.findUnique({
    where: { id: WORKSPACE_PLAYLIST_ID },
    select: { establishment_id: true },
  });
  if (!playlist) {
    console.error('  Playlist introuvable');
    return;
  }
  const endedSession = await prisma.session.findFirst({
    where: { establishment_id: playlist.establishment_id, status: 'ENDED' },
    select: { id: true },
    orderBy: { created_at: 'desc' },
  });
  if (!endedSession) {
    console.warn('  Aucune session ENDED trouvée — skip');
    return;
  }

  // Create a synthetic round WITH empty selected_track_ids on the ended session
  const synthRound = await prisma.sessionRound.create({
    data: {
      session_id: endedSession.id,
      playlist_id: WORKSPACE_PLAYLIST_ID,
      position: 999,
      status: 'PENDING',
      current_track_index: 0,
      selected_track_ids: [],
    },
    select: { id: true },
  });
  console.info(`  Synthetic round created: ${synthRound.id} with selected=[]`);

  try {
    const round = await findRoundForSession(synthRound.id, endedSession.id);
    if (!round) throw new Error('Round not found after create');
    const beforeN = round.selected_track_ids.length;
    console.info(`  Before buildAndBroadcastTrack: selected_track_ids.length=${beforeN}`);

    await buildAndBroadcastTrack(endedSession.id, round, 0);

    const after = await prisma.sessionRound.findUnique({
      where: { id: synthRound.id },
      select: { selected_track_ids: true },
    });
    const afterN = after?.selected_track_ids.length ?? 0;
    console.info(`  After buildAndBroadcastTrack: selected_track_ids.length=${afterN}`);
    if (afterN === DEFAULT_SESSION_SIZE) {
      console.info(`  ✓ AUTO-CLAMP WORKS: length clamped from 0 to ${DEFAULT_SESSION_SIZE}`);
    } else {
      console.error(`  ✗ AUTO-CLAMP FAILED: expected ${DEFAULT_SESSION_SIZE}, got ${afterN}`);
    }
  } finally {
    await prisma.sessionRound.delete({ where: { id: synthRound.id } }).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  await checkPickHelper();
  await checkAutoClampDefenseInDepth();
}

main()
  .catch((err) => {
    console.error('[Repro] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
