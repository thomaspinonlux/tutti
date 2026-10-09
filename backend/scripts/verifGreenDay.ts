import 'dotenv/config';
import { matchAnswer, unSeulMotDEcart, normalizeText } from '../src/lib/voiceMatching.js';

const cas: Array<[string, string]> = [
  ['Bill Green Day Boulevard De Broken Dreams.', 'Boulevard of Broken Dreams'],
  ['Boulevard De Broken Dreams', 'Boulevard of Broken Dreams'],
];
for (const [dit, attendu] of cas) {
  console.log(`\n« ${dit} »  vs  « ${attendu} »`);
  console.log('  normalisé transcript :', normalizeText(dit));
  console.log('  normalisé attendu    :', normalizeText(attendu));
  console.log('  unSeulMotDEcart      :', unSeulMotDEcart(dit, attendu));
  const r = matchAnswer(dit, { title: attendu, artist: 'Green Day' }, 80);
  console.log('  titleMatched         :', r.titleMatched, '| artistMatched :', r.artistMatched);
}
