/** P1 recon (read-only): find Bailamos + what its youtube_id actually is. */
import 'dotenv/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prisma } from '../src/lib/prisma.js';

const pexec = promisify(execFile);

async function ytInfo(id: string): Promise<string> {
  try {
    const { stdout } = await pexec(
      'yt-dlp',
      [
        '--no-warnings',
        '--print',
        '%(title)s ::: %(channel)s',
        `https://www.youtube.com/watch?v=${id}`,
      ],
      { timeout: 30000 },
    );
    return stdout.trim();
  } catch (e) {
    return `ERR ${(e as Error).message.split('\n')[0]}`;
  }
}

async function main(): Promise<void> {
  const rows = await prisma.officialPlaylistTrack.findMany({
    where: { title: { contains: 'bailamos', mode: 'insensitive' } },
    select: {
      id: true,
      title: true,
      artist: true,
      youtube_id: true,
      spotify_id: true,
      is_playable: true,
      song_id: true,
      playlist: { select: { name_fr: true } },
    },
  });
  console.log(`Found ${rows.length} track(s) matching "bailamos":\n`);
  for (const r of rows) {
    const info = r.youtube_id ? await ytInfo(r.youtube_id) : '(no youtube_id)';
    console.log(
      `• "${r.title}" — ${r.artist}\n  playlist=${r.playlist.name_fr} yt=${r.youtube_id} sp=${r.spotify_id} playable=${r.is_playable} song=${r.song_id}\n  YT→ ${info}\n`,
    );
  }
  await prisma.$disconnect();
}
void main();
