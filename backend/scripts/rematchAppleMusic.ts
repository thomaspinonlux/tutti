/**
 * scripts/rematchAppleMusic.ts — feat/apple-rematch-no-unplayable
 *
 * OBJECTIF : garantir qu'AUCUN titre destiné à Apple Music ne soit injouable ni
 * mal matché (le bug « Dragostea Din Tei » : un id Apple qui pointe sur une
 * reprise au lieu de l'original).
 *
 * Deux problèmes traités :
 *   A. MANQUANT  — apple_music_id IS NULL → titre injouable en Apple forcé.
 *   B. DOUTEUX   — apple_music_id présent mais pointant sur une reprise / remix
 *                  / live / karaoké → l'animateur lance l'original, les joueurs
 *                  entendent autre chose.
 *
 * RÈGLE D'OR : on ne touche PAS à ce qui marche. Un id qui pointe déjà sur une
 * version standard n'est JAMAIS remplacé, même si un autre candidat obtient un
 * meilleur score. (Sans cette règle, le script dégradait de bons matchs :
 * « Dreams (Radio Version) » → « Dreams (Twenty 4 Seven Trance Mix) ».)
 *
 * ALGORITHME (par titre) :
 *   1. DIAGNOSTIC de l'id ACTUEL (getTrack). Il est jugé DÉFECTUEUX si :
 *        - absent, ou introuvable au catalogue Apple ;
 *        - porté par un artiste différent (= reprise) ;
 *        - marqué d'une version suspecte (remix/live/karaoké/…).
 *      Sinon → INCHANGÉ, et AUCUNE recherche n'est lancée (moins d'appels API).
 *   2. Seulement si défectueux : recherche catalogue ("<artiste> <titre>", FR).
 *   3. Filtrage STRICT des candidats (cf. VERSION_EXCLUSIONS +
 *      VERSION_EXCLUDED_WORDS, tempérés par VERSION_ALLOWLIST).
 *      ⚠️ Le filtre ne regarde QUE les suffixes de version (parenthèses,
 *      crochets, après un tiret) — sinon « Live and Let Die » ou « Cover Me »
 *      seraient rejetés à tort.
 *   4. Scoring : artiste exact > titre exact > proximité d'année > popularité
 *      implicite (ordre Apple). Le meilleur candidat valide gagne.
 *   5. Aucun candidat valable → le titre est listé pour REMPLACEMENT MANUEL
 *      (avec son id et son titre Apple actuels). Le script ne remplace JAMAIS
 *      de lui-même.
 *
 * Chaque MISE À JOUR affiche la RAISON du remplacement : aucune modification
 * n'est cosmétique.
 *
 * Le script n'ÉCRIT que `apple_music_id`. Il ne touche à aucun autre champ.
 *
 * Usage :
 *   pnpm rematch:apple --dry-run                    # tout le périmètre, rien écrit
 *   pnpm rematch:apple --dry-run --sample=20        # 20 exemples détaillés
 *   pnpm rematch:apple --dry-run --only="dragostea" # UN cas précis (contrôle)
 *   pnpm rematch:apple --scope=missing              # seulement les sans-id
 *   pnpm rematch:apple --scope=verify               # seulement la vérif des ids existants
 *   pnpm rematch:apple                              # run réel (écrit apple_music_id)
 *
 * Env : DATABASE_URL, + les variables du developer token Apple
 *       (APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY — cf.
 *       lib/appleDeveloperToken.ts). Aucune clé Anthropic : pas d'IA ici.
 *
 * COÛT : 0 € — l'API catalogue Apple Music est gratuite (quota/rate-limit
 * seulement). Le seul coût est le temps (throttle volontaire, cf. THROTTLE_MS).
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { AppleMusicProvider } from '../src/music/apple/AppleMusicProvider.js';

config();

const prisma = new PrismaClient();
const apple = new AppleMusicProvider('fr');

/** Throttle entre appels Apple (l'API rate-limit agressivement). */
const THROTTLE_MS = 120;
const SEARCH_LIMIT = 25;

/**
 * Playlists destinées à YouTube (films/séries/DA/génériques/Disney/jeux/anime).
 * Elles sont HORS périmètre : leur source verrouillée sera YouTube, un
 * apple_music_id manquant y est sans conséquence.
 */
const YOUTUBE_PLAYLIST_SLUGS = [
  'official-pl-anime-openings',
  'official-pl-jeux-tv-fr',
  'official-pl-cinema-fr-bo',
  'official-pl-club-dorothee',
  'official-pl-series-tv',
  'official-pl-generiques-dessins-animes',
  'official-pl-generiques-disney',
  'official-pl-generiques-films-series',
  'official-pl-video-games',
  'official-pl-disney-en',
  'official-pl-disney-fr',
  'official-pl-james-bond',
  'official-pl-musique-film',
  'official-pl-films-hard',
  'official-pl-films-easy',
  'official-pl-films-medium',
];

/**
 * Marqueurs de VERSION à rejeter. Cherchés UNIQUEMENT dans les suffixes de
 * version (parenthèses / crochets / après un tiret), jamais dans le titre nu.
 */
const VERSION_EXCLUSIONS = [
  'remix',
  'live',
  'karaoke',
  'karaoké',
  'cover',
  'acoustic',
  'acoustique',
  're-record',
  'rerecord',
  're-recorded',
  'made famous by',
  'made popular by',
  'tribute',
  'in the style of',
  'instrumental',
  'workout',
  'sped up',
  'slowed',
  'nightcore',
  'reprise',
  'demo',
  'rehearsal',
  'a cappella',
  'acapella',
  'backing track',
  'originally performed',
  'as made famous',
  'unplugged',
  'concert',
  'session',
  'extended',
  'twenty 4 seven',
  'edit remix',
  'vocal mix',
  'bootleg',
  'mashup',
  'medley',
];

/**
 * Mots-clés rejetés en tant que MOT ENTIER (pas en sous-chaîne). C'est ce qui
 * attrape « Trance Mix », « Club Mix », « 12" Mix », « Twenty 4 Seven Trance
 * Mix » sans avoir à énumérer chaque style. Sûr uniquement grâce à
 * VERSION_ALLOWLIST, évaluée AVANT (sinon « Radio Mix » ≠ « Radio Edit »).
 */
const VERSION_EXCLUDED_WORDS = ['mix', 'remix', 'edits', 'rmx', 'dub', 'version'];

/**
 * Versions explicitement ACCEPTABLES (version standard / studio / radio).
 * Évaluée AVANT les rejets : un segment qui matche est gardé même s'il contient
 * par ailleurs un mot suspect (ex. « Radio Version » contient « version »).
 */
const VERSION_ALLOWLIST = [
  'radio edit',
  'radio version',
  'single version',
  'album version',
  'original version',
  'original mix', // en dance/house, "Original Mix" EST la version studio de référence
  'main version',
  'version originale',
];

interface CliArgs {
  dryRun: boolean;
  sample: number | null;
  only: string | null;
  scope: 'missing' | 'verify' | 'all';
  limit: number | null;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const get = (p: string): string | null => {
    const a = args.find((x) => x.startsWith(`${p}=`));
    return a ? (a.split('=').slice(1).join('=') ?? null) : null;
  };
  const sampleRaw = get('--sample');
  const onlyRaw = get('--only');
  const scopeRaw = get('--scope');
  const limitRaw = get('--limit');
  const scope =
    scopeRaw === 'missing' || scopeRaw === 'verify' || scopeRaw === 'all' ? scopeRaw : 'all';
  return {
    // --sample et --only impliquent TOUJOURS le dry-run : une inspection ne
    // doit jamais pouvoir écrire en base par inadvertance.
    dryRun: args.includes('--dry-run') || Boolean(sampleRaw) || Boolean(onlyRaw),
    sample: sampleRaw ? Number.parseInt(sampleRaw, 10) || null : null,
    only: onlyRaw,
    scope,
    limit: limitRaw ? Number.parseInt(limitRaw, 10) || null : null,
  };
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

/**
 * Extrait les segments de VERSION d'un titre : contenu entre parenthèses,
 * entre crochets, ou après un " - ". C'est là (et seulement là) qu'on cherche
 * les marqueurs de reprise/remix. « Live and Let Die » n'a aucun segment de
 * version → jamais rejeté. « Beat It (Karaoke Version) » en a un → rejeté.
 */
function versionSegments(title: string): string[] {
  const segs: string[] = [];
  for (const m of title.matchAll(/\(([^)]*)\)/gu)) segs.push(m[1] ?? '');
  for (const m of title.matchAll(/\[([^\]]*)\]/gu)) segs.push(m[1] ?? '');
  const dash = title.split(/\s[-–—]\s/u);
  if (dash.length > 1) segs.push(...dash.slice(1));
  return segs;
}

/** True si `n` (déjà normalisé) contient `word` comme MOT ENTIER. */
function hasWord(n: string, word: string): boolean {
  return ` ${n} `.includes(` ${norm(word)} `);
}

/**
 * Renvoie le marqueur de version indésirable détecté, ou null si le titre
 * semble être une version standard. Renvoyer le MARQUEUR (et pas juste un
 * booléen) permet d'expliquer chaque décision dans la sortie.
 */
function excludedVersionReason(title: string, albumName: string | undefined): string | null {
  // L'album peut trahir une compilation karaoké/tribute même si le titre est nu.
  if (albumName) {
    const a = norm(albumName);
    for (const bad of [
      'karaoke',
      'tribute',
      'made famous',
      'in the style of',
      'originally performed',
    ]) {
      if (a.includes(norm(bad))) return `album « ${albumName} » (${bad})`;
    }
  }
  for (const seg of versionSegments(title)) {
    const n = norm(seg);
    if (!n) continue;
    // Version explicitement acceptable (radio edit, radio version, original
    // mix…) → segment gardé, même s'il contient un mot par ailleurs suspect.
    if (VERSION_ALLOWLIST.some((ok) => n.includes(norm(ok)))) continue;
    for (const bad of VERSION_EXCLUSIONS) {
      const nb = norm(bad);
      if (nb && n.includes(nb)) return `« ${seg.trim()} » (${bad})`;
    }
    for (const w of VERSION_EXCLUDED_WORDS) {
      if (hasWord(n, w)) return `« ${seg.trim()} » (${w})`;
    }
  }
  return null;
}

/** Raccourci booléen (filtrage des candidats). */
function hasExcludedVersion(title: string, albumName: string | undefined): boolean {
  return excludedVersionReason(title, albumName) !== null;
}

interface Candidate {
  id: string;
  name: string;
  artist: string;
  album?: string;
  year?: number;
  durationMs: number;
  rank: number; // position dans les résultats Apple (proxy de popularité)
}

interface Scored extends Candidate {
  score: number;
  reasons: string[];
}

function scoreCandidate(
  c: Candidate,
  wantedTitle: string,
  wantedArtist: string,
  wantedYear: number | null,
): Scored {
  const reasons: string[] = [];
  let score = 0;

  const nt = norm(c.name);
  const wt = norm(wantedTitle);
  const na = norm(c.artist);
  const wa = norm(wantedArtist);

  if (na === wa) {
    score += 50;
    reasons.push('artiste exact');
  } else if (na.includes(wa) || wa.includes(na)) {
    score += 25;
    reasons.push('artiste partiel');
  } else {
    score -= 40;
    reasons.push('ARTISTE DIFFÉRENT');
  }

  if (nt === wt) {
    score += 40;
    reasons.push('titre exact');
  } else if (nt.startsWith(wt) || wt.startsWith(nt)) {
    score += 20;
    reasons.push('titre préfixe');
  } else if (nt.includes(wt) || wt.includes(nt)) {
    score += 10;
    reasons.push('titre partiel');
  } else {
    score -= 25;
    reasons.push('TITRE DIVERGENT');
  }

  if (wantedYear && c.year) {
    const d = Math.abs(c.year - wantedYear);
    if (d === 0) {
      score += 15;
      reasons.push('année exacte');
    } else if (d <= 2) {
      score += 8;
      reasons.push(`année ±${d}`);
    } else if (d > 10) {
      // Un écart > 10 ans sur un même titre/artiste = très souvent une
      // re-sortie, une compilation tardive ou un ré-enregistrement.
      score -= 12;
      reasons.push(`année ÉCART ${d} ans`);
    }
  }

  // Ordre Apple = proxy de popularité : léger bonus aux premiers résultats.
  score += Math.max(0, 10 - c.rank);

  return { ...c, score, reasons };
}

async function searchBest(
  title: string,
  artist: string,
  year: number | null,
): Promise<{ best: Scored | null; rejected: number; totalCandidates: number }> {
  const results = await apple.search(`${artist} ${title}`, { limit: SEARCH_LIMIT });
  const candidates: Candidate[] = results.map((r, i) => ({
    id: r.provider_track_id,
    name: r.title,
    artist: r.artist,
    album: r.album,
    year: r.year,
    durationMs: r.duration_ms,
    rank: i,
  }));

  const kept: Scored[] = [];
  let rejected = 0;
  for (const c of candidates) {
    if (hasExcludedVersion(c.name, c.album)) {
      rejected += 1;
      continue;
    }
    const s = scoreCandidate(c, title, artist, year);
    // Seuil : en dessous, on considère qu'aucun match fiable n'a été trouvé
    // (mieux vaut lister pour remplacement manuel qu'écrire un mauvais id).
    if (s.score >= 40) kept.push(s);
  }
  kept.sort((a, b) => b.score - a.score);
  return { best: kept[0] ?? null, rejected, totalCandidates: candidates.length };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const { dryRun, sample, only, scope, limit } = parseArgs();
  console.info(
    `[RematchApple] start | dry-run=${dryRun} | scope=${scope} | sample=${sample ?? 'none'} | only=${only ?? 'none'} | limit=${limit ?? 'none'}`,
  );
  console.info("[RematchApple] Coût : 0 € (API catalogue Apple gratuite, pas d'IA).");

  const youtubePlaylists = await prisma.officialPlaylist.findMany({
    where: { slug: { in: YOUTUBE_PLAYLIST_SLUGS } },
    select: { id: true },
  });
  const youtubeIds = youtubePlaylists.map((p) => p.id);

  let tracks = await prisma.officialPlaylistTrack.findMany({
    where: {
      playlist_id: { notIn: youtubeIds },
      ...(scope === 'missing' ? { apple_music_id: null } : {}),
      ...(scope === 'verify' ? { NOT: { apple_music_id: null } } : {}),
      ...(only
        ? {
            OR: [
              { title: { contains: only, mode: 'insensitive' as const } },
              { artist: { contains: only, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      title: true,
      artist: true,
      year: true,
      apple_music_id: true,
      playlist: { select: { name_fr: true } },
    },
    orderBy: [{ artist: 'asc' }, { title: 'asc' }],
  });

  // Dédup par (artiste,titre) : le même morceau apparaît dans plusieurs
  // playlists — une seule recherche Apple, appliquée à toutes ses occurrences.
  const byKey = new Map<string, typeof tracks>();
  for (const t of tracks) {
    const k = `${norm(t.artist)}|${norm(t.title)}`;
    const arr = byKey.get(k) ?? [];
    arr.push(t);
    byKey.set(k, arr);
  }
  let groups = [...byKey.values()];
  console.info(
    `[RematchApple] ${tracks.length} lignes | ${groups.length} morceaux uniques à traiter`,
  );
  if (limit) groups = groups.slice(0, limit);
  if (sample) groups = groups.slice(0, sample);

  const needsReplacement: Array<{
    title: string;
    artist: string;
    why: string;
    rows: number;
    currentId: string | null;
    currentName: string | null;
  }> = [];
  let kept = 0;
  let filled = 0;
  let replaced = 0;
  let updated = 0;
  let errors = 0;

  for (const group of groups) {
    const t = group[0]!;
    const currentId = t.apple_music_id;
    const label = `"${t.artist} — ${t.title}"${t.year ? ` (${t.year})` : ''}`;
    const playlists = [...new Set(group.map((g) => g.playlist.name_fr))].join(', ');

    // ── 1. DIAGNOSTIC de l'id actuel ───────────────────────────────────────
    // Règle d'or : on ne touche PAS à ce qui marche. Un remplacement n'est
    // envisagé que si l'id actuel est réellement défectueux.
    let currentName: string | null = null;
    let currentArtist: string | null = null;
    let currentAlbum: string | null = null;
    let problem: string | null = null;

    if (!currentId) {
      problem = 'aucun apple_music_id (titre injouable en Apple)';
    } else {
      try {
        const cur = await apple.getTrack(currentId);
        if (!cur) {
          problem = 'id introuvable au catalogue Apple';
        } else {
          currentName = cur.title;
          currentArtist = cur.artist;
          currentAlbum = cur.album ?? null;
          const versionProblem = excludedVersionReason(cur.title, cur.album);
          if (versionProblem) {
            problem = `version suspecte : ${versionProblem}`;
          } else if (
            norm(cur.artist) !== norm(t.artist) &&
            !norm(cur.artist).includes(norm(t.artist))
          ) {
            // Artiste différent = très probablement une reprise.
            problem = `artiste différent : « ${cur.artist} » au lieu de « ${t.artist} » (reprise ?)`;
          }
        }
      } catch (err) {
        errors += 1;
        console.error(
          `[RematchApple] ERREUR lookup ${label} : ${err instanceof Error ? err.message : 'inconnue'}`,
        );
        await sleep(THROTTLE_MS);
        continue;
      }
      await sleep(THROTTLE_MS);
    }

    // ── 2. Id actuel SAIN → on garde, sans même chercher ──────────────────
    if (!problem) {
      kept += 1;
      if (dryRun) {
        console.info(
          `\n✅ ${label}   [${group.length} ligne(s)]\n` +
            `   playlists : ${playlists}\n` +
            `   ACTUEL    : ${currentId} → « ${currentName} » — ${currentArtist}${currentAlbum ? ` [${currentAlbum}]` : ''}\n` +
            `   action    : INCHANGÉ (version standard, on ne touche pas à ce qui marche)`,
        );
      }
      continue;
    }

    // ── 3. Id défectueux ou absent → recherche d'un remplaçant ────────────
    let best: Scored | null = null;
    let rejected = 0;
    let totalCandidates = 0;
    try {
      ({ best, rejected, totalCandidates } = await searchBest(t.title, t.artist, t.year));
    } catch (err) {
      errors += 1;
      console.error(
        `[RematchApple] ERREUR recherche ${label} : ${err instanceof Error ? err.message : 'inconnue'}`,
      );
      await sleep(THROTTLE_MS);
      continue;
    }
    await sleep(THROTTLE_MS);

    // Aucun candidat valable → on ne modifie RIEN, on liste pour arbitrage.
    if (!best || best.id === currentId) {
      const why = !best
        ? totalCandidates === 0
          ? 'aucun résultat Apple'
          : `aucune version standard trouvée (${totalCandidates} résultats, ${rejected} rejetés)`
        : `seul candidat = l'id actuel, lui-même défectueux (${problem})`;
      needsReplacement.push({
        title: t.title,
        artist: t.artist,
        why,
        rows: group.length,
        currentId,
        currentName,
      });
      console.info(
        `\n❌ REMPLACEMENT REQUIS — ${label}   [${group.length} ligne(s)]\n` +
          `   playlists : ${playlists}\n` +
          `   ACTUEL    : ${currentId ?? 'AUCUN'}${currentName ? ` → « ${currentName} »${currentArtist ? ` — ${currentArtist}` : ''}${currentAlbum ? ` [${currentAlbum}]` : ''}` : ''}\n` +
          `   problème  : ${problem}\n` +
          `   raison    : ${why}`,
      );
      continue;
    }

    if (currentId) replaced += 1;
    else filled += 1;

    if (dryRun) {
      console.info(
        `\n🔄 ${label}   [${group.length} ligne(s)]\n` +
          `   playlists : ${playlists}\n` +
          `   AVANT     : ${currentId ?? 'AUCUN'}${currentName ? ` → « ${currentName} »${currentArtist ? ` — ${currentArtist}` : ''}${currentAlbum ? ` [${currentAlbum}]` : ''}` : ''}\n` +
          `   RAISON    : ${problem}\n` +
          `   APRÈS     : ${best.id} → « ${best.name} » — ${best.artist}${best.album ? ` [${best.album}]` : ''}${best.year ? ` (${best.year})` : ''}\n` +
          `   score     : ${best.score} (${best.reasons.join(', ')})\n` +
          `   candidats : ${totalCandidates} trouvés, ${rejected} rejetés (remix/live/karaoké/…)\n` +
          `   action    : ${currentId ? 'MISE À JOUR' : 'RENSEIGNEMENT'}`,
      );
    }

    if (!dryRun) {
      await prisma.officialPlaylistTrack.updateMany({
        where: { id: { in: group.map((g) => g.id) } },
        data: { apple_music_id: best.id },
      });
      updated += group.length;
    }
  }

  console.info('\n[RematchApple] ═══════════ SUMMARY ═══════════');
  console.info(`  Morceaux traités        : ${groups.length}`);
  console.info(`  INCHANGÉS (déjà bons)   : ${kept}`);
  console.info(`  RENSEIGNÉS (id absent)  : ${filled}`);
  console.info(`  REMPLACÉS (id pourri)   : ${replaced}`);
  console.info(`  Lignes écrites          : ${dryRun ? '0 (DRY-RUN)' : updated}`);
  console.info(`  REMPLACEMENT REQUIS     : ${needsReplacement.length}`);
  console.info(`  Erreurs API             : ${errors}`);
  if (needsReplacement.length > 0) {
    console.info('\n  ── Titres à arbitrer (aucune version standard sur Apple) ──');
    for (const r of needsReplacement) {
      console.info(
        `   • ${r.artist} — ${r.title}  (${r.rows} ligne(s))\n` +
          `     id actuel : ${r.currentId ?? 'AUCUN'}${r.currentName ? ` → « ${r.currentName} »` : ''}\n` +
          `     raison    : ${r.why}`,
      );
    }
    console.info("\n  ⚠️ Ces titres n'ont PAS été modifiés. À valider/remplacer manuellement.");
  }
  console.info('[RematchApple] ════════════════════════════════');
}

main()
  .catch((err) => {
    console.error('[RematchApple] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
