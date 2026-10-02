/**
 * Les 14 artistes non francophones qui traînaient dans les playlists
 * « … 🇫🇷 » (100 % française) en sortent. On ne supprime pas : chaque titre
 * part dans la playlist internationale de sa décennie, sauf s'il y est déjà.
 */
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

const NON_FRANCOPHONES = [
  'al bano & romina power', 'alexander rybak', 'alvaro soler', 'álvaro soler',
  'andrea bocelli', 'anitta', 'awilo longomba', 'carlinhos brown & dj dero',
  'chayanne', 'juanes', 'kaoma', 'sergio mendes', 'demis roussos', 'billy crawford',
];

const slug = (v) => (v ?? '').toLowerCase().normalize('NFD')
  .replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]/g, '');
const sansSuffixe = (t) => slug((t ?? '').replace(/\s*[([].*$/, ''));

const DECENNIE_INT = {
  1960: 'official-pl-60s', 1970: 'official-pl-70s-int', 1980: 'official-pl-80s-int',
  1990: 'official-pl-90s-int', 2000: 'official-pl-2000s-int',
  2010: 'official-pl-2010s-int', 2020: 'official-pl-2020s-int',
};

const playlists = await p.officialPlaylist.findMany();
const parId = new Map(playlists.map((x) => [x.id, x]));
const parSlug = new Map(playlists.map((x) => [x.slug, x]));

const toutes = await p.officialPlaylistTrack.findMany();
const presence = new Set(toutes.map((t) => `${t.playlist_id}|${slug(t.artist)}|${sansSuffixe(t.title)}`));
const maxPos = new Map();
for (const t of toutes) {
  const v = maxPos.get(t.playlist_id) ?? 0;
  if ((t.position ?? 0) > v) maxPos.set(t.playlist_id, t.position ?? 0);
}

const candidats = toutes.filter((t) => {
  const pl = parId.get(t.playlist_id);
  if (!pl) return false;
  const fr = pl.name_fr.includes('🇫🇷') && !pl.name_fr.includes('🌍');
  return fr && NON_FRANCOPHONES.includes((t.artist ?? '').trim().toLowerCase());
});

let deplaces = 0, retires = 0, sansCible = 0;
for (const t of candidats) {
  const de = parId.get(t.playlist_id).name_fr;
  const dec = t.year == null ? null : Math.floor(t.year / 10) * 10;
  const cible = dec != null ? parSlug.get(DECENNIE_INT[dec >= 2020 ? 2020 : dec]) : null;
  if (!cible) {
    sansCible++;
    console.log(`SANS CIBLE  ${t.artist} — ${t.title} (${t.year}) [${de}]`);
    continue;
  }
  const k = `${cible.id}|${slug(t.artist)}|${sansSuffixe(t.title)}`;
  if (presence.has(k)) {
    await p.officialPlaylistTrack.delete({ where: { id: t.id } });
    retires++;
    console.log(`DÉJÀ DANS « ${cible.name_fr} »  ${t.artist} — ${t.title}`);
    continue;
  }
  const pos = (maxPos.get(cible.id) ?? 0) + 1;
  maxPos.set(cible.id, pos);
  presence.add(k);
  await p.officialPlaylistTrack.update({
    where: { id: t.id }, data: { playlist_id: cible.id, position: pos, is_playable: true, playability_reason: null },
  });
  deplaces++;
  console.log(`DÉPLACÉ  ${t.artist} — ${t.title} : « ${de} » → « ${cible.name_fr} »`);
}
console.log(`\ndéplacés ${deplaces} | retirés (déjà ailleurs) ${retires} | sans cible ${sansCible}`);
await p.$disconnect();
