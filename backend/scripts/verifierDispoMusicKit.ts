// Verifie que chaque apple_music_id jouable du catalogue existe dans la boutique FR
// via l'API Apple Music (la meme que MusicKit sur l'iPad). Lecture seule par defaut.
// --ecrire : marque is_playable=false (apple_id_absent_store_fr) les absents.
import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { getAppleDeveloperToken } from '../src/lib/appleDeveloperToken.js';
config();
const prisma = new PrismaClient();
const ecrire = process.argv.includes('--ecrire');
const tok = getAppleDeveloperToken().token;
const lignes: { apple_music_id: string; title: string; artist: string; slug: string }[] = await prisma.$queryRawUnsafe(
  `select t.apple_music_id, t.title, t.artist, p.slug from official_playlist_tracks t join official_playlists p on p.id=t.playlist_id where t.is_playable and t.apple_music_id is not null and t.apple_music_id <> ''`);
const ids = [...new Set(lignes.map((l) => l.apple_music_id))];
const trouves = new Set<string>();
let erreurs = 0;
for (let i = 0; i < ids.length; i += 300) {
  const lot = ids.slice(i, i + 300);
  let ok = false;
  for (let essai = 0; essai < 3 && !ok; essai++) {
    const r = await fetch(`https://api.music.apple.com/v1/catalog/fr/songs?ids=${lot.join(',')}`, { headers: { Authorization: 'Bearer ' + tok } });
    if (r.ok) { const j: any = await r.json(); for (const s of j.data ?? []) if (s.attributes?.playParams) trouves.add(s.id); ok = true; }
    else await new Promise((res) => setTimeout(res, 2000));
  }
  if (!ok) { erreurs++; lot.forEach((x) => trouves.add(x)); } // en cas d'erreur API on ne marque rien
  await new Promise((res) => setTimeout(res, 200));
}
const absents = ids.filter((x) => !trouves.has(x));
const detail = lignes.filter((l) => absents.includes(l.apple_music_id));
writeFileSync('/tmp/dispo-musickit.json', JSON.stringify({ total: ids.length, lignes: lignes.length, erreursLots: erreurs, absents: detail }, null, 1));
console.log('ids', ids.length, 'lignes', lignes.length, 'absents', absents.length, 'lignes touchees', detail.length, 'erreursLots', erreurs);
if (ecrire && absents.length && erreurs === 0) {
  const n = await prisma.$executeRawUnsafe(`update official_playlist_tracks set is_playable=false, playability_reason='apple_id_absent_store_fr', playability_checked_at=now() where is_playable and apple_music_id = any($1::text[])`, absents);
  console.log('marques', n);
}
await prisma.$disconnect();
