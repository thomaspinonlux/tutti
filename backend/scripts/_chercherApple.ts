/**
 * scripts/_chercherApple.ts — aide au diagnostic : montre ce que la boutique FR
 * répond pour une recherche texte. Usage :
 *   pnpm tsx scripts/_chercherApple.ts "France Gall Laisse tomber les filles"
 */
import 'dotenv/config';
import { AppleMusicProvider } from '../src/music/apple/AppleMusicProvider.js';

const apple = new AppleMusicProvider('fr');
for (const q of process.argv.slice(2)) {
  const res = await apple.search(q, { limit: 8 });
  console.info(`\n### ${q}`);
  for (const r of res) {
    console.info(
      `  ${r.provider_track_id} | ${r.title} — ${r.artist} | ${r.album ?? ''} | ${Math.round((r.duration_ms ?? 0) / 1000)}s | ${r.year ?? ''}`,
    );
  }
}
