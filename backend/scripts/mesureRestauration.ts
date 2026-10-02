import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { prisma } from '../src/lib/prisma.js';

const slug = (v: string): string =>
  (v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]/g, '');
const sansSuffixe = (t: string): string => slug((t ?? '').replace(/\s*[([].*$/, ''));

async function main(): Promise<void> {
  const lignes = readFileSync('../Claude outputs/audit-playlists.csv', 'utf8')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .slice(1)
    .filter((l) => l.trim());
  const cibles = lignes
    .map((l) => l.split(';'))
    .filter((c) => c[0].startsWith('A RETIRER') || c[0].startsWith('A DECIDER'))
    .map((c) => ({ categorie: c[0], playlist: c[1], artiste: c[2], titre: c[3], annee: c[4] }));

  const pistes = await prisma.officialPlaylistTrack.findMany({
    select: { artist: true, title: true, apple_music_id: true, playlist_id: true },
  });
  const ailleurs = new Map<string, number>();
  for (const p of pistes) {
    if (!p.apple_music_id) continue;
    const k = `${slug(p.artist)}|${sansSuffixe(p.title)}`;
    ailleurs.set(k, (ailleurs.get(k) ?? 0) + 1);
  }

  const uniques = new Map<
    string,
    { artiste: string; titre: string; annee: string; categorie: string }
  >();
  for (const c of cibles) uniques.set(`${slug(c.artiste)}|${sansSuffixe(c.titre)}`, c);

  let recuperables = 0;
  const perdus: string[] = [];
  for (const [k, c] of uniques) {
    if (ailleurs.has(k)) recuperables++;
    else perdus.push(`${c.artiste} — ${c.titre} (${c.annee}) [${c.categorie.split(' (')[0]}]`);
  }
  console.log(`titres distincts concernés : ${uniques.size}`);
  console.log(`récupérables (présents ailleurs avec un apple_music_id) : ${recuperables}`);
  console.log(`sans source dans le catalogue : ${perdus.length}`);
  for (const p of perdus) console.log(`  ${p}`);
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
