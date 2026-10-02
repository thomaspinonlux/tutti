/**
 * Deux playlists, pas trois :
 *   « Un seul tube — France 🇫🇷🌍 »  : 1 chanteur = 1 chanson qui a cartonné en France
 *   « Un seul tube — Monde 🌍 »      : les tubes planétaires (fusion de
 *                                      « Un seul tube 🌍 » et « One-Hit Wonders 🌍 »,
 *                                      qui avaient 39 titres en commun)
 */
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

const slug = (v) => (v ?? '').toLowerCase().normalize('NFD')
  .replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]/g, '');
const sansSuffixe = (t) => slug((t ?? '').replace(/\s*[([].*$/, ''));

const trouve = async (s) => p.officialPlaylist.findFirst({ where: { slug: s } });

const france = await trouve('official-pl-tubes-en-france');
const monde = await trouve('official-pl-one-hit-wonders');
const ancienne = await trouve('official-pl-un-seul-tube');
console.log('france', !!france, 'monde', !!monde, 'ancienne', !!ancienne);

// 1 — un seul titre par artiste : on garde le plus gros succès français vérifié
const aEnlever = await p.officialPlaylistTrack.findMany({
  where: {
    playlist_id: france.id,
    OR: [
      { artist: 'Demis Roussos', NOT: { title: 'My Reason' } },
      { artist: { contains: 'lvaro Soler' }, NOT: { title: 'Sofia' } },
    ],
  },
  select: { id: true, artist: true, title: true },
});
for (const t of aEnlever) console.log('retiré de France :', t.artist, '—', t.title);
await p.officialPlaylistTrack.deleteMany({ where: { id: { in: aEnlever.map((t) => t.id) } } });

await p.officialPlaylist.update({
  where: { id: france.id },
  data: {
    name_fr: 'Un seul tube — France 🇫🇷🌍',
    name_en: 'One-Hit Wonders — France 🇫🇷🌍',
    subtitle_fr: 'Un artiste, une chanson qui a cartonné en France',
    subtitle_en: 'One artist, one song that smashed in France',
    updated_at: new Date(),
  },
});

// 2 — fusion des deux playlists mondiales
if (ancienne && monde) {
  const dansMonde = new Set(
    (await p.officialPlaylistTrack.findMany({
      where: { playlist_id: monde.id }, select: { artist: true, title: true },
    })).map((t) => `${slug(t.artist)}|${sansSuffixe(t.title)}`),
  );
  const source = await p.officialPlaylistTrack.findMany({ where: { playlist_id: ancienne.id } });
  const max = await p.officialPlaylistTrack.aggregate({
    where: { playlist_id: monde.id }, _max: { position: true },
  });
  let pos = max._max.position ?? 0;
  let ajoutes = 0, deja = 0;
  for (const t of source) {
    const k = `${slug(t.artist)}|${sansSuffixe(t.title)}`;
    if (dansMonde.has(k)) { deja++; continue; }
    dansMonde.add(k);
    pos += 1;
    const { id, playlist_id, position, created_at, ...reste } = t;
    await p.officialPlaylistTrack.create({
      data: { ...reste, playlist_id: monde.id, position: pos },
    });
    ajoutes++;
  }
  console.log(`fusion : ${ajoutes} ajoutés dans Monde, ${deja} déjà présents`);
  await p.officialPlaylistTrack.deleteMany({ where: { playlist_id: ancienne.id } });
  await p.officialPlaylist.delete({ where: { id: ancienne.id } });
  await p.officialPlaylist.update({
    where: { id: monde.id },
    data: {
      name_fr: 'Un seul tube — Monde 🌍',
      name_en: 'One-Hit Wonders — Worldwide 🌍',
      subtitle_fr: 'Un artiste, une chanson — le tube planétaire',
      subtitle_en: 'One artist, one song — the global hit',
      updated_at: new Date(),
    },
  });
}

for (const s of ['official-pl-tubes-en-france', 'official-pl-one-hit-wonders']) {
  const pl = await trouve(s);
  if (!pl) continue;
  const n = await p.officialPlaylistTrack.count({ where: { playlist_id: pl.id } });
  await p.officialPlaylist.update({ where: { id: pl.id }, data: { track_count: n } });
  console.log(`${pl.name_fr} : ${n} titres`);
}
await p.$disconnect();
