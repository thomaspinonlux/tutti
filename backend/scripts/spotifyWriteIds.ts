/**
 * Écrit les spotify_id sur OfficialPlaylistTrack depuis le CSV du sweep.
 * ROBUSTE + reprise : gère un run précédent partiel (rollback complet).
 * GARDE-FOUS :
 *   - auto-ok UNIQUEMENT
 *   - only-null : updateMany WHERE spotify_id IS NULL → ne touche jamais un existant
 *   - réversible : rollback JSON = TOUS les ids dont la valeur finale == notre match
 *     (couvre partiel + ce run). Rollback = scripts/spotifyWriteRollback.ts <fichier>.
 * Match CSV→DB par (playlist_id depuis slug) + youtube_id. Idempotent.
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const CSV = '/Users/thomaspinon/Documents/Claude Code/tutti/spotify-match-dryrun.v2.csv';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const ROLLBACK = `/Users/thomaspinon/Documents/Claude Code/tutti/spotify-write-rollback-${STAMP}.json`;

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const lines = readFileSync(CSV, 'utf8')
    .split('\n')
    .slice(1)
    .filter((l) => l.trim());
  const autoOk = lines
    .map(parseCsvLine)
    .map((c) => ({
      playlist: c[1] ?? '',
      youtube_id: c[4] ?? '',
      spotify_id: c[7] ?? '',
      flag: c[9] ?? '',
    }))
    .filter((r) => r.flag === 'auto-ok' && r.spotify_id && r.youtube_id);

  const pls = await prisma.officialPlaylist.findMany({ select: { id: true, slug: true } });
  const idBySlug = new Map(pls.map((p) => [p.slug, p.id]));
  const playlistIds = [
    ...new Set(autoOk.map((r) => idBySlug.get(r.playlist)).filter(Boolean)),
  ] as string[];

  // TOUS les tracks de ces playlists (pas de filtre null) → état courant exact.
  const tracks = await prisma.officialPlaylistTrack.findMany({
    where: { playlist_id: { in: playlistIds } },
    select: { id: true, playlist_id: true, youtube_id: true, spotify_id: true },
  });
  const byKey = new Map<string, { id: string; spotify_id: string | null }>();
  for (const t of tracks)
    byKey.set(`${t.playlist_id}|${t.youtube_id}`, { id: t.id, spotify_id: t.spotify_id });

  // Candidats {id, target, current} dédupliqués par track id.
  const cands: Array<{ id: string; target: string; current: string | null }> = [];
  const seen = new Set<string>();
  for (const r of autoOk) {
    const plid = idBySlug.get(r.playlist);
    if (!plid) continue;
    const t = byKey.get(`${plid}|${r.youtube_id}`);
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    cands.push({ id: t.id, target: r.spotify_id, current: t.spotify_id });
  }

  const toWrite = cands.filter((c) => c.current === null);
  const alreadyOurs = cands.filter((c) => c.current !== null && c.current === c.target);
  const foreign = cands.filter((c) => c.current !== null && c.current !== c.target);

  console.log(`auto-ok CSV : ${autoOk.length}  |  candidats matchés : ${cands.length}`);
  console.log(`déjà écrits (run précédent partiel) : ${alreadyOurs.length}`);
  console.log(`à écrire maintenant (NULL) : ${toWrite.length}`);
  console.log(`ignorés (valeur étrangère existante, jamais touchés) : ${foreign.length}`);
  console.log('--- échantillon 15 à écrire (track_id ← spotify_id) ---');
  toWrite.slice(0, 15).forEach((w) => console.log(`  ${w.id}  ←  ${w.target}`));
  console.log('--- écriture directe (only-null) ---');

  let written = 0;
  for (const w of toWrite) {
    const res = await prisma.officialPlaylistTrack.updateMany({
      where: { id: w.id, spotify_id: null },
      data: { spotify_id: w.target },
    });
    written += res.count;
    if (written % 200 === 0) console.log(`  … ${written} écrits`);
  }

  // Rollback = TOUT ce qui nous appartient (déjà-ours partiel + ce qu'on vient d'écrire).
  const rollbackPairs = cands.filter((c) => c.current === null || c.current === c.target);
  writeFileSync(
    ROLLBACK,
    JSON.stringify(
      {
        written_at: new Date().toISOString(),
        total_ours: rollbackPairs.length,
        written_this_run: written,
        ids: rollbackPairs.map((c) => c.id),
        pairs: rollbackPairs.map((c) => ({ id: c.id, spotify_id: c.target })),
      },
      null,
      2,
    ),
  );

  console.log('');
  console.log(`✅ ÉCRIT ce run : ${written}  |  TOTAL nous appartenant : ${rollbackPairs.length}`);
  console.log(`📄 ROLLBACK : ${ROLLBACK}`);
  console.log(`   undo = pnpm exec tsx scripts/spotifyWriteRollback.ts "${ROLLBACK}"`);
  await prisma.$disconnect();
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
