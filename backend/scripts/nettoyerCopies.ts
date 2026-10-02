/**
 * nettoyerCopies.ts — répercute sur les copies des espaces de travail le
 * nettoyage appliqué au catalogue officiel.
 *
 * Périmètre volontairement limité aux lignes de l'audit (audit-playlists.csv) :
 * pour chacune, si la piste n'est plus dans la playlist officielle du même nom,
 * c'est qu'elle a été retirée (ou déplacée) — on la retire alors des copies.
 * Les copies désynchronisées pour d'autres raisons ne sont pas touchées.
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { prisma } from '../src/lib/prisma.js';

const ECRIRE = process.argv.includes('--ecrire');
const CSV = '../Claude outputs/audit-playlists.csv';

const slug = (v: string): string =>
  (v ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]/g, '');
const sansSuffixe = (t: string): string => slug((t ?? '').replace(/\s*[([].*$/, ''));

function lireAudit(): Array<{
  categorie: string;
  playlist: string;
  artiste: string;
  titre: string;
  detail: string;
}> {
  const lignes = readFileSync(CSV, 'utf8').replace(/^﻿/, '').split(/\r?\n/).slice(1);
  const out = [];
  for (const l of lignes) {
    if (!l.trim()) continue;
    const c = l.split(';');
    out.push({ categorie: c[0], playlist: c[1], artiste: c[2], titre: c[3], detail: c[5] ?? '' });
  }
  return out;
}

async function main(): Promise<void> {
  const audit = lireAudit();

  const officielles = await prisma.officialPlaylist.findMany({
    select: { id: true, name_fr: true },
  });
  const nomParId = new Map(officielles.map((p) => [p.id, p.name_fr]));
  const pistesOff = await prisma.officialPlaylistTrack.findMany({
    select: { playlist_id: true, artist: true, title: true },
  });
  const presentOfficiel = new Set<string>();
  for (const p of pistesOff) {
    const nom = nomParId.get(p.playlist_id);
    if (nom) presentOfficiel.add(`${nom}|${slug(p.artist)}|${sansSuffixe(p.title)}`);
  }

  // Ce que le nettoyage a effectivement enlevé de chaque playlist officielle.
  const enleve = new Set<string>();
  const parCategorie = new Map<string, number>();
  for (const a of audit) {
    const cle = `${a.playlist}|${slug(a.artiste)}|${sansSuffixe(a.titre)}`;
    if (presentOfficiel.has(cle)) continue;
    enleve.add(cle);
    const c = a.categorie.split(' (')[0];
    parCategorie.set(c, (parCategorie.get(c) ?? 0) + 1);
  }
  console.log(`lignes d'audit : ${audit.length}`);
  console.log(`clés enlevées du catalogue officiel : ${enleve.size}`);
  for (const [c, n] of parCategorie) console.log(`  ${n}\t${c}`);

  const liens = await prisma.playlistTrack.findMany({
    where: { playlist: { is_official_tutti: true } },
    select: {
      id: true,
      playlist: { select: { name: true } },
      track: { select: { canonical_title: true, artist: { select: { canonical_name: true } } } },
    },
  });

  const orphelines = liens.filter((l) =>
    enleve.has(
      `${l.playlist.name}|${slug(l.track.artist.canonical_name)}|${sansSuffixe(l.track.canonical_title)}`,
    ),
  );
  console.log(`lignes de copies à retirer : ${orphelines.length} (sur ${liens.length})`);

  const fichier = '../Claude outputs/nettoyage-copies-reprise-2026-10-02.json';
  writeFileSync(
    fichier,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        lignes: orphelines.map((o) => ({
          id: o.id,
          playlist: o.playlist.name,
          artiste: o.track.artist.canonical_name,
          titre: o.track.canonical_title,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`fichier de reprise : ${fichier}`);

  if (!ECRIRE) {
    console.log('aperçu seulement — relancer avec --ecrire');
    await prisma.$disconnect();
    return;
  }
  const ids = orphelines.map((o) => o.id);
  for (let i = 0; i < ids.length; i += 200) {
    await prisma.playlistTrack.deleteMany({ where: { id: { in: ids.slice(i, i + 200) } } });
  }
  console.log(`supprimées des copies : ${ids.length}`);
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
