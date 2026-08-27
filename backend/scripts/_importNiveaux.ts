/**
 * Réimport niveaux + francophone depuis tutti-catalogue-niveaux-rempli.csv.
 * Sémantique bulk-apply : clé = track_id (= Song.id). Applique level (N1→1,
 * N2→2, N3→3) + is_francophone (oui→true, non→false) + tags_reviewed=true.
 * NE TOUCHE À RIEN D'AUTRE (themes / is_international / work_* intacts).
 * Rollback JSON. DRY par défaut, APPLY=1 pour écrire.
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '../src/lib/prisma.js';

const DRY = process.env.APPLY !== '1';
const ROOT = join(process.cwd(), '..');
const CSV = join(process.cwd(), 'data', 'tutti-catalogue-niveaux-rempli.csv');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Row {
  id: string;
  level: 1 | 2 | 3;
  is_francophone: boolean;
}

async function main(): Promise<void> {
  const lines = readFileSync(CSV, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  const bad: string[] = [];
  const rows: Row[] = [];
  // track_id = 1er champ (uuid, pas de virgule) ; niveau + francophone = 2 DERNIERS
  // champs (artist/title au milieu peuvent contenir des virgules quotées).
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    const id = c[0].trim();
    const niveau = (c[c.length - 2] ?? '').trim().toUpperCase();
    const franco = (c[c.length - 1] ?? '').trim().toLowerCase();
    const level = niveau === 'N1' ? 1 : niveau === 'N2' ? 2 : niveau === 'N3' ? 3 : null;
    const is_francophone = franco === 'oui' ? true : franco === 'non' ? false : null;
    if (!UUID.test(id) || level === null || is_francophone === null) {
      bad.push(line);
      continue;
    }
    rows.push({ id, level: level as 1 | 2 | 3, is_francophone });
  }
  console.log(`CSV: ${rows.length} lignes valides, ${bad.length} rejetées.`);
  if (bad.length) bad.slice(0, 5).forEach((b) => console.log('  ✗', b.slice(0, 80)));

  // État courant (rollback + skip no-op).
  const ids = rows.map((r) => r.id);
  const current = new Map(
    (
      await prisma.song.findMany({
        where: { id: { in: ids } },
        select: { id: true, level: true, is_francophone: true, tags_reviewed: true },
      })
    ).map((s) => [s.id, s]),
  );
  const missing = rows.filter((r) => !current.has(r.id));
  console.log(`Songs introuvables (id absent en DB) : ${missing.length}`);

  const rollback: {
    id: string;
    level: number | null;
    is_francophone: boolean;
    tags_reviewed: boolean;
  }[] = [];
  const updates = rows.filter((r) => current.has(r.id));
  for (const r of updates) {
    const cur = current.get(r.id)!;
    rollback.push({
      id: r.id,
      level: cur.level,
      is_francophone: cur.is_francophone,
      tags_reviewed: cur.tags_reviewed,
    });
  }

  if (!DRY) {
    for (let i = 0; i < updates.length; i += 200) {
      const chunk = updates.slice(i, i + 200);
      await prisma.$transaction(
        chunk.map((r) =>
          prisma.song.update({
            where: { id: r.id },
            data: { level: r.level, is_francophone: r.is_francophone, tags_reviewed: true },
          }),
        ),
      );
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(
      join(ROOT, `catalogue-niveaux-reimport-rollback-${stamp}.json`),
      JSON.stringify(rollback, null, 2),
    );
    console.log(
      `\n✅ ${updates.length} songs mises à jour. Rollback → catalogue-niveaux-reimport-rollback-${stamp}.json`,
    );
  } else {
    console.log(`\nDRY — ${updates.length} songs seraient mises à jour (set APPLY=1).`);
  }

  // Distribution finale (source de vérité = DB).
  const byLevel = await prisma.song.groupBy({ by: ['level'], _count: { _all: true } });
  const byFranco = await prisma.song.groupBy({ by: ['is_francophone'], _count: { _all: true } });
  console.log('\n── Répartition finale (tout le catalogue Song) ──');
  console.log('Niveau :');
  for (const g of byLevel.sort((a, b) => (a.level ?? 9) - (b.level ?? 9)))
    console.log(`  ${g.level === null ? '(aucun)' : 'N' + g.level} : ${g._count._all}`);
  console.log('Francophone :');
  for (const g of byFranco) console.log(`  ${g.is_francophone ? 'oui' : 'non'} : ${g._count._all}`);

  await prisma.$disconnect();
}
void main();
