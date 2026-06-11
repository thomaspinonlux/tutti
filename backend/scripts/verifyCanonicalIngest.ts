/**
 * scripts/verifyCanonicalIngest.ts — feat/canonical-song-catalog (VÉRIF)
 *
 * Trois cas de la spec, contre la vraie DB :
 *   (a) hit connu sous un AUTRE videoId que le catalogue → match par
 *       titre+artiste normalisés → copie gratuite (matchedBy=normalized_key,
 *       aliases non vides, 0 appel Claude)
 *   (b) chanson nouvelle d'un artiste connu → création song + génération
 *       TITRE seul (artiste réutilisé)
 *   (c) totalement inédit → génération titre + artiste, catalogue enrichi
 *
 * Cleanup : supprime les songs/tracks de test créées ((b) et (c)).
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { ingestTrackAliases, songKey } from '../src/lib/songCatalog.js';

config();
const prisma = new PrismaClient();

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.info('[Verify] ════ (a) hit connu, AUTRE videoId ════');
  // Take That — Back for Good est au catalogue (90s). videoId bidon ≠ catalogue.
  const known = await prisma.song.findFirst({
    where: { title_aliases: { isEmpty: false } },
    select: { canonical_title: true, artist: { select: { canonical_name: true } } },
    orderBy: { created_at: 'asc' },
  });
  if (!known) {
    console.error(
      '[Verify] (a) aucun song avec aliases en DB — run migrate:canonical-songs d’abord',
    );
    process.exitCode = 1;
    return;
  }
  const a = await ingestTrackAliases({
    title: known.canonical_title,
    artist: known.artist.canonical_name,
    videoId: 'FAKE_VIDEO_A12', // jamais vu — doit fallback sur la clé
  });
  const aOk = a.matchedBy === 'normalized_key' && a.titleAliases.length > 0;
  console.info(
    `  "${known.artist.canonical_name} — ${known.canonical_title}" | matchedBy=${a.matchedBy} | titleAliases=${a.titleAliases.length} | artistAliases=${a.artistAliases.length} → ${aOk ? '✓ PASS (copie gratuite)' : '✗ FAIL'}`,
  );

  console.info('[Verify] ════ (b) chanson nouvelle, artiste connu ════');
  const knownArtist = await prisma.artist.findFirst({
    where: { aliases: { isEmpty: false } },
    select: { canonical_name: true, aliases: true },
  });
  if (!knownArtist) {
    console.error('[Verify] (b) aucun artiste avec aliases');
    process.exitCode = 1;
    return;
  }
  const bTitle = `Tutti Test Song B ${Date.now() % 100000}`;
  const b = await ingestTrackAliases({ title: bTitle, artist: knownArtist.canonical_name });
  const bArtistReused = b.artistAliases.length === knownArtist.aliases.length;
  console.info(
    `  "${knownArtist.canonical_name} — ${bTitle}" | matchedBy=${b.matchedBy} | artistAliases réutilisés=${bArtistReused} → ${b.matchedBy === 'created' && bArtistReused ? '✓ PASS (artiste réutilisé, titre seul en génération async)' : '✗ FAIL'}`,
  );
  await sleep(8000); // attendre le job async titre
  const bSong = await prisma.song.findUnique({
    where: { normalized_key: songKey(knownArtist.canonical_name, bTitle) },
    select: { id: true, title_aliases: true },
  });
  console.info(
    `  job async (b) : title_aliases=${bSong?.title_aliases.length ?? 0} → ${bSong && bSong.title_aliases.length > 0 ? '✓ PASS (titre généré, artiste pas regénéré)' : '✗ FAIL (génération async pas aboutie ?)'}`,
  );

  console.info('[Verify] ════ (c) totalement inédit ════');
  const cArtist = `Tutti Test Artist ${Date.now() % 100000}`;
  const cTitle = 'Chanson Imaginaire De Test';
  const c = await ingestTrackAliases({ title: cTitle, artist: cArtist });
  console.info(`  created song=${c.songId.slice(0, 8)} | matchedBy=${c.matchedBy}`);
  await sleep(10000);
  const cSong = await prisma.song.findUnique({
    where: { normalized_key: songKey(cArtist, cTitle) },
    select: { id: true, title_aliases: true, artist: { select: { id: true, aliases: true } } },
  });
  const cOk = (cSong?.title_aliases.length ?? 0) > 0 && (cSong?.artist.aliases.length ?? 0) > 0;
  console.info(
    `  job async (c) : title_aliases=${cSong?.title_aliases.length ?? 0} artist_aliases=${cSong?.artist.aliases.length ?? 0} → ${cOk ? '✓ PASS (titre + artiste générés, catalogue enrichi)' : '✗ FAIL'}`,
  );

  // ── Cleanup test data ────────────────────────────────────────────────────
  if (bSong) await prisma.song.delete({ where: { id: bSong.id } }).catch(() => undefined);
  if (cSong) {
    await prisma.song.delete({ where: { id: cSong.id } }).catch(() => undefined);
    await prisma.artist.delete({ where: { id: cSong.artist.id } }).catch(() => undefined);
  }
  console.info('[Verify] cleanup test data done');
}

main()
  .catch((err) => {
    console.error('[Verify] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
