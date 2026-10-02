import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

// 1 — les 2 derniers « injouables » sont deux titres français dans une playlist
// internationale. Ils se lancent très bien : on les range, on ne les écarte pas.
const noel = await p.officialPlaylist.findFirst({ where: { slug: 'official-pl-noel' } });
const yeye = await p.officialPlaylist.findFirst({ where: { slug: 'official-pl-yeye-60s-fr' } });

const dalida = await p.officialPlaylistTrack.findFirst({
  where: { artist: 'Dalida', title: 'Vive le vent', is_playable: false },
});
if (dalida) {
  const deja = await p.officialPlaylistTrack.findFirst({
    where: { playlist_id: noel.id, artist: 'Dalida', title: { contains: 'Vive le vent' } },
  });
  if (deja) {
    await p.officialPlaylistTrack.delete({ where: { id: dalida.id } });
    console.log('Dalida — Vive le vent : déjà dans Noël, doublon retiré');
  } else {
    const m = await p.officialPlaylistTrack.aggregate({
      where: { playlist_id: noel.id }, _max: { position: true },
    });
    await p.officialPlaylistTrack.update({
      where: { id: dalida.id },
      data: { playlist_id: noel.id, position: (m._max.position ?? 0) + 1,
              is_playable: true, playability_reason: null },
    });
    console.log('Dalida — Vive le vent → Noël 🇫🇷🌍');
  }
}

const gall = await p.officialPlaylistTrack.findFirst({
  where: { artist: 'France Gall', is_playable: false },
});
if (gall) {
  const deja = await p.officialPlaylistTrack.findFirst({
    where: { playlist_id: yeye.id, artist: 'France Gall', title: { contains: 'Poupée de cire' } },
  });
  if (deja) {
    await p.officialPlaylistTrack.delete({ where: { id: gall.id } });
    console.log('France Gall — Poupée de cire : déjà dans Yéyé, doublon retiré');
  } else {
    const m = await p.officialPlaylistTrack.aggregate({
      where: { playlist_id: yeye.id }, _max: { position: true },
    });
    await p.officialPlaylistTrack.update({
      where: { id: gall.id },
      data: { playlist_id: yeye.id, position: (m._max.position ?? 0) + 1,
              is_playable: true, playability_reason: null },
    });
    console.log('France Gall → Yéyé 🇫🇷');
  }
}

// 2 — les copies des espaces suivent le renommage (le rapprochement se fait par nom)
const r1 = await p.playlist.updateMany({
  where: { is_official_tutti: true, name: 'One-Hit Wonders 🌍' },
  data: { name: 'Un seul tube — Monde 🌍' },
});
const r2 = await p.playlist.updateMany({
  where: { is_official_tutti: true, name: 'Un seul tube 🌍' },
  data: { name: 'Un seul tube — Monde 🌍' },
});
console.log(`copies renommées : ${r1.count + r2.count}`);

// 3 — track_count à jour partout
const pls = await p.officialPlaylist.findMany({ select: { id: true } });
for (const x of pls) {
  const n = await p.officialPlaylistTrack.count({ where: { playlist_id: x.id } });
  await p.officialPlaylist.update({ where: { id: x.id }, data: { track_count: n } });
}
const restants = await p.officialPlaylistTrack.count({ where: { is_playable: false } });
const total = await p.officialPlaylistTrack.count();
console.log(`catalogue ${total} | injouables ${restants}`);
await p.$disconnect();
