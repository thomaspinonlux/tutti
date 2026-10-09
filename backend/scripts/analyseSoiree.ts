/**
 * analyseSoiree.ts — rejoue les réponses d'une soirée contre le moteur de
 * reconnaissance pour mesurer ce qu'il a laissé passer.
 */
import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';
import { matchAnswer, unSeulMotDEcart } from '../src/lib/voiceMatching.js';

const SESSION = process.argv[2] ?? '';

/** Même garde que le moteur, mais appliquée à une FENÊTRE du transcript. */
function unSeulMotDEcartGlissant(transcript: string, attendu: string): boolean {
  const mots = transcript.toLowerCase().split(/\s+/).filter(Boolean);
  const n = attendu.split(/\s+/).filter(Boolean).length;
  for (let taille = n; taille <= n + 1; taille++) {
    for (let i = 0; i + taille <= mots.length; i++) {
      if (unSeulMotDEcart(mots.slice(i, i + taille).join(' '), attendu)) return true;
    }
  }
  return false;
}

async function main(): Promise<void> {
  const pistes = await prisma.$queryRawUnsafe<
    Array<{ played_at: Date; fin: Date | null; artiste: string; titre: string }>
  >(`
    select spt.played_at, lead(spt.played_at) over (order by spt.played_at) as fin,
           a.canonical_name as artiste, t.canonical_title as titre
    from session_played_tracks spt
    join tracks t on t.id = spt.track_id join artists a on a.id = t.artist_id
    where spt.session_id = '${SESSION}' order by spt.played_at
  `);
  const evts = await prisma.scoreEvent.findMany({
    where: { session_id: SESSION, voice_transcript: { not: null } },
    select: { created_at: true, voice_transcript: true, match_artist: true, match_title: true },
  });

  let titreRate = 0;
  const rattrapables: string[] = [];
  for (const e of evts) {
    const p = pistes.find((x) => e.created_at >= x.played_at && (!x.fin || e.created_at < x.fin));
    if (!p) continue;
    const brut = (e.voice_transcript ?? '').replace(/^\[[a-z-]+\]\s*/i, '');
    if (e.match_title) continue;
    titreRate += 1;
    // Le titre est-il bien là, à un mot près, quelque part dans la phrase ?
    if (!unSeulMotDEcartGlissant(brut, p.titre)) continue;
    const clavier = /\[clavier\]/i.test(e.voice_transcript ?? '');
    const avant = matchAnswer(brut, { title: p.titre, artist: p.artiste }, 80, { clavier });
    // Le moteur n'a pas crédité le titre : score sous le seuil ou cible artiste.
    const dejaPris = avant.scores.title_combined >= 80;
    if (!dejaPris) rattrapables.push(`${brut}   →   « ${p.titre} » (${p.artiste})`);
  }
  console.log(`réponses où le titre n'a PAS été crédité : ${titreRate}`);
  console.log(`dont le titre est présent à un mot près : ${rattrapables.length}`);
  for (const r of rattrapables) console.log('   ' + r);
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
