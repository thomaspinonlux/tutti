/**
 * P1 fix pass (RÉSUMABLE) — re-résout les mismatch de p1-audit.tsv et remplace
 * le youtube_id SEULEMENT quand un candidat validé (artiste+titre) ≠ id courant.
 * Applique en DB IMMÉDIATEMENT + append rollback à chaque update → un cutoff
 * laisse un état cohérent et un re-run continue (skip des ids déjà remplacés).
 *
 *   DRY (défaut) : n'écrit rien.  APPLY=1 : applique en DB.
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '../src/lib/prisma.js';
import { resolveStrict, classifyVideo } from './_p1lib.js';

const DRY = process.env.APPLY !== '1';
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity;
const THROTTLE = 1200;
const ROOT = join(process.cwd(), '..');
const ROLLBACK = join(ROOT, 'p1-fixall-rollback.json');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Row {
  ytId: string;
  ytTitle: string;
  artist: string;
  title: string;
  verdict: string;
}

async function main(): Promise<void> {
  const tsv = readFileSync(join(ROOT, 'p1-audit.tsv'), 'utf8').trim().split('\n');
  let rows: Row[] = tsv
    .slice(1)
    .map((l) => l.split('\t'))
    .filter((c) => c[5] === 'title_mismatch' || c[5] === 'artist_mismatch')
    .map((c) => ({ ytId: c[0], ytTitle: c[1], artist: c[3], title: c[4], verdict: c[5] }));
  if (Number.isFinite(LIMIT)) rows = rows.slice(0, LIMIT);

  const rollback: { id: string; from: string; to: string }[] = existsSync(ROLLBACK)
    ? JSON.parse(readFileSync(ROLLBACK, 'utf8'))
    : [];
  console.log(
    `${rows.length} mismatched ids (DRY=${DRY}). Rollback déjà: ${rollback.length} tracks.\n`,
  );

  let applied = 0;
  let skipped = 0;
  const unresolved: Row[] = [];
  let consecFail = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    // Résumabilité : si plus AUCUN track ne porte l'ancien id → déjà corrigé/absent.
    const stillThere = await prisma.officialPlaylistTrack.count({ where: { youtube_id: r.ytId } });
    if (stillThere === 0) {
      skipped += 1;
      continue;
    }

    const cand = await resolveStrict(r.artist, r.title);
    await sleep(THROTTLE + ((i * 37) % 400));

    if (!cand) {
      consecFail += 1;
      unresolved.push(r);
      if (consecFail >= 12) {
        console.log(
          `\n⚠️  ${consecFail} échecs consécutifs — throttle/ban probable. STOP (reprenable).`,
        );
        break;
      }
      continue;
    }
    consecFail = 0;
    const v = classifyVideo(r.artist, r.title, cand.title, cand.channel);
    if (!v.correct || cand.id === r.ytId) {
      unresolved.push(r);
      continue;
    }

    if (i < 40 || i % 20 === 0)
      console.log(
        `  ✔ ${r.artist} - ${r.title}\n     ${r.ytId} → ${cand.id} ("${cand.title.slice(0, 42)}")`,
      );

    if (!DRY) {
      const affected = await prisma.officialPlaylistTrack.findMany({
        where: { youtube_id: r.ytId },
        select: { id: true },
      });
      for (const t of affected) rollback.push({ id: t.id, from: r.ytId, to: cand.id });
      await prisma.officialPlaylistTrack.updateMany({
        where: { youtube_id: r.ytId },
        data: {
          youtube_id: cand.id,
          is_playable: true,
          playability_reason: null,
          playability_checked_at: null,
        },
      });
      writeFileSync(ROLLBACK, JSON.stringify(rollback, null, 2)); // append incrémental
    }
    applied += 1;
    if (i % 25 === 0)
      console.log(`  …${i}/${rows.length} (applied ${applied}, skipped ${skipped})`);
  }

  writeFileSync(
    join(ROOT, 'p1-unresolved.tsv'),
    [
      'ytId\tartist\ttitle\tyt_title\tverdict',
      ...unresolved.map((r) => `${r.ytId}\t${r.artist}\t${r.title}\t${r.ytTitle}\t${r.verdict}`),
    ].join('\n'),
  );
  console.log(
    `\nDone. applied=${applied} skipped(already)=${skipped} unresolved=${unresolved.length}`,
  );
  console.log(
    DRY
      ? 'DRY — set APPLY=1.'
      : `Rollback → p1-fixall-rollback.json (${rollback.length} tracks) ; unresolved → p1-unresolved.tsv`,
  );
  await prisma.$disconnect();
}
void main();
