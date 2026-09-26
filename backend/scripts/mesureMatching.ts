/**
 * mesureMatching.ts — banc d'essai des règles de reconnaissance.
 *
 * Rejoue les réponses des soirées passées avec le moteur actuel, puis avec
 * les règles candidates, et compte ce que chacune rattrape (réponses justes
 * refusées à tort) et ce qu'elle laisse passer (réponses fausses acceptées).
 *
 *   node --import tsx/esm scripts/mesureMatching.ts
 */
import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';
import { matchAnswer, combinedScore } from '../src/lib/voiceMatching.js';
import { decouperArtiste } from '../src/lib/aliases.js';

const SEUIL = 80;

/**
 * En base, le transcript est préfixé par le moteur (« [deepgram] ») et les
 * doubles écoutes sont jointes par « | ». Le moteur, lui, reçoit chaque
 * transcription nue : on refait le découpage.
 */
function transcriptions(brut: string): string[] {
  return brut
    .split('|')
    .map((v) => v.replace(/^\s*\[[a-z0-9]+\]\s*/i, '').trim())
    .filter((v) => v.length > 0);
}

interface Piste {
  id: string;
  titre: string;
  alias: string[];
  artiste: string;
  aliasArtiste: string[];
  oeuvre: string | null;
}

function candidatsTitre(p: Piste): string[] {
  return [p.titre, ...(p.alias ?? [])].filter((s) => typeof s === 'string' && s.length > 0);
}
function candidatsArtiste(p: Piste): string[] {
  return Array.from(
    new Set(
      [p.artiste, ...(p.aliasArtiste ?? [])]
        .filter((s): s is string => typeof s === 'string' && s.length > 0)
        .flatMap((nom) => [nom, ...decouperArtiste(nom)]),
    ),
  ).filter((s) => s.length > 0);
}

/** Meilleur score de chaque moitié, comme le fait le serveur. */
function moities(brut: string, p: Piste, clavier: boolean): { titre: number; artiste: number } {
  let titre = 0;
  let artiste = 0;
  for (const tr of transcriptions(brut)) {
    for (const t of candidatsTitre(p)) {
      for (const a of candidatsArtiste(p)) {
        const r = matchAnswer(tr, { title: t, artist: a }, SEUIL, { clavier });
        if (r.scores.title_combined > titre) titre = r.scores.title_combined;
        if (r.scores.artist_combined > artiste) artiste = r.scores.artist_combined;
      }
    }
  }
  return { titre, artiste };
}

/** Le moteur d'AVANT : la note brute, sans les nouvelles règles. */
function moitiesAvant(brut: string, p: Piste): { titre: number; artiste: number } {
  let titre = 0;
  let artiste = 0;
  for (const tr of transcriptions(brut)) {
    for (const t of candidatsTitre(p)) {
      const v = combinedScore(tr, t);
      if (v > titre) titre = v;
    }
    for (const a of candidatsArtiste(p)) {
      const v = combinedScore(tr, a);
      if (v > artiste) artiste = v;
    }
  }
  return { titre, artiste };
}

async function main(): Promise<void> {
  const depuis = new Date('2026-09-01T00:00:00Z');
  const lignes = await prisma.voiceTranscript.findMany({
    where: { created_at: { gte: depuis } },
    select: {
      transcript: true,
      decision: true,
      mode_reponse: true,
      track_id: true,
      session_round_id: true,
    },
  });
  const idsPistes = [...new Set(lignes.map((l) => l.track_id).filter((v): v is string => !!v))];
  const idsManches = [
    ...new Set(lignes.map((l) => l.session_round_id).filter((v): v is string => !!v)),
  ];

  const manches = await prisma.sessionRound.findMany({
    where: { id: { in: idsManches } },
    select: { id: true, selected_track_ids: true },
  });
  const pistesDesManches = [...new Set(manches.flatMap((m) => m.selected_track_ids))];

  const pistesBrutes = await prisma.track.findMany({
    where: { id: { in: [...new Set([...idsPistes, ...pistesDesManches])] } },
    include: { artist: true },
  });
  const pistes = new Map<string, Piste>(
    pistesBrutes.map((t) => [
      t.id,
      {
        id: t.id,
        titre: t.canonical_title,
        alias: t.aliases ?? [],
        artiste: t.artist.canonical_name,
        aliasArtiste: t.artist.aliases ?? [],
        oeuvre: t.work_title,
      },
    ]),
  );
  const autresDeLaManche = new Map<string, string[]>(
    manches.map((m) => [m.id, m.selected_track_ids]),
  );

  console.log(`${lignes.length} réponses rejouées, ${pistes.size} morceaux.`);

  let acceptees = 0,
    refusees = 0;
  const rattrapees: string[] = [];
  let fausses = 0,
    faussesAvant = 0,
    pairesTestees = 0;
  const exemplesFaux: string[] = [];

  for (const l of lignes) {
    if (!l.track_id || !l.session_round_id || !l.transcript) continue;
    const p = pistes.get(l.track_id);
    if (!p) continue;
    const clavier = l.mode_reponse === 'clavier';

    const avant = moitiesAvant(l.transcript, p);
    const apres = moities(l.transcript, p, clavier);
    const passeAvant = avant.titre >= SEUIL || avant.artiste >= SEUIL;
    const passeApres = apres.titre >= SEUIL || apres.artiste >= SEUIL;
    if (passeApres) acceptees++;
    else refusees++;
    if (!passeAvant && passeApres) {
      rattrapees.push(
        `${(l.mode_reponse ?? '?').padEnd(7)} | ${l.transcript.slice(0, 64)} | ${p.artiste} — ${p.titre}`,
      );
    }

    // Contrôle : la même réponse, confrontée aux AUTRES morceaux de la manche.
    // Tout ce qui passe là est une acceptation à tort.
    for (const id of autresDeLaManche.get(l.session_round_id) ?? []) {
      if (id === p.id) continue;
      const q = pistes.get(id);
      if (!q) continue;
      pairesTestees++;
      const av = moitiesAvant(l.transcript, q);
      const ap = moities(l.transcript, q, clavier);
      if (av.titre >= SEUIL) faussesAvant++;
      if (ap.titre >= SEUIL) {
        fausses++;
        if (av.titre < SEUIL && exemplesFaux.length < 15) {
          exemplesFaux.push(`${l.transcript.slice(0, 50)} → ${q.artiste} — ${q.titre}`);
        }
      }
    }
  }

  console.log(`\nnouvelles règles : ${acceptees} acceptées, ${refusees} refusées`);
  console.log(`rattrapées : ${rattrapees.length}`);
  for (const r of rattrapees) console.log('  + ' + r);
  console.log(
    `\nacceptations à tort : ${faussesAvant} avant → ${fausses} après (sur ${pairesTestees} paires)`,
  );
  for (const e of exemplesFaux) console.log('  ! ' + e);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
