import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
await p.officialPlaylistTrack.deleteMany({
  where: { id: '3f02d99a-db15-4604-bb69-81fdf38f05c3' },
});
const pl = await p.officialPlaylist.findFirst({
  where: { slug: 'official-pl-tubes-en-france' },
});
const n = await p.officialPlaylistTrack.count({ where: { playlist_id: pl.id } });
console.log('RESTE', n);
await p.$disconnect();
