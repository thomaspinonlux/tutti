/**
 * scripts/_controleCroise.ts — contrôle croisé d'un identifiant Apple.
 *
 * Interroge la MÊME référence par les deux chemins utilisés dans le projet :
 *   - l'API iTunes Lookup (celle du vérificateur de catalogue) ;
 *   - l'API Apple Music catalogue (celle de la recherche et de la lecture).
 * Sert à trancher quand les deux ne racontent pas la même histoire.
 *
 * Usage : pnpm tsx scripts/_controleCroise.ts 6798898150 1675560578 …
 */
import 'dotenv/config';
import { AppleMusicProvider } from '../src/music/apple/AppleMusicProvider.js';

const ids = process.argv.slice(2);
const apple = new AppleMusicProvider('fr');

for (const id of ids) {
  const url = `https://itunes.apple.com/lookup?id=${id}&country=FR&entity=song`;
  let lookup = 'rien';
  try {
    const rep = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const corps = (await rep.json()) as { results?: Array<Record<string, unknown>> };
    const r = corps.results?.[0];
    lookup = r
      ? `${String(r.trackName)} — ${String(r.artistName)} [${String(r.collectionName)}]`
      : 'absent';
  } catch (e) {
    lookup = `erreur ${(e as Error).message}`;
  }
  let catalogue = 'rien';
  try {
    const t = await apple.getTrack(id);
    catalogue = t ? `${t.title} — ${t.artist} [${t.album ?? ''}]` : 'absent';
  } catch (e) {
    catalogue = `erreur ${(e as Error).message}`;
  }
  console.info(`ID ${id}\n  lookup    : ${lookup}\n  catalogue : ${catalogue}`);
}
