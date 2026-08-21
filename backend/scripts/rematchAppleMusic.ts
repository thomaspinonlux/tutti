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
 * ALGORITHME (par titre) :
 *   1. Recherche catalogue Apple ("<artiste> <titre>", storefront FR).
 *   2. Filtrage STRICT des candidats — rejet de : remix, live, karaoke, cover,
 *      acoustic, re-recorded, "made famous by", tribute, instrumental,
 *      "in the style of", edit radio douteux… (cf. VERSION_EXCLUSIONS).
 *      ⚠️ Le filtre ne regarde QUE les suffixes de version (parenthèses,
 *      crochets, après un tiret) — sinon « Live and Let Die » ou « Cover Me »
 *      seraient rejetés à tort.
 *   3. Scoring : artiste exact > titre exact > proximité d'année > popularité
 *      implicite (ordre Apple). Le meilleur candidat valide gagne.
 *   4. Aucun candidat valable → le titre est listé pour REMPLACEMENT MANUEL.
 *      Le script ne remplace JAMAIS de lui-même.
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
  // Remixes de club : rejetés. ⚠️ NE PAS mettre "edit" ni "mix" tout court —
  // « Radio Edit » et « Single Version » sont des versions STANDARD acceptables
  // (norm() retire les parenthèses, un 'mix)' rejetterait "Radio Edit" à tort).
  'extended mix',
  'club mix',
  'dance mix',
  'dub mix',
  'extended version',
  'radio mix',
];

/**
 * Versions explicitement ACCEPTABLES : si un segment matche l'une de ces
 * expressions, il n'est pas considéré comme un marqueur de rejet même s'il
 * contient par ailleurs un mot listé ci-dessus.
 */
const VERSION_ALLOWLIST = ['radio edit', 'single version', 'album version', 'original version'];

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

/** True si le titre porte un marqueur de version indésirable. */
function hasExcludedVersion(title: string, albumName: string | undefined): boolean {
  const haystacks = [...versionSegments(title)];
  // L'album peut trahir une compilation karaoké/tribute même si le titre est nu.
  if (albumName) {
    const a = norm(albumName);
    if (
      a.includes('karaoke') ||
      a.includes('karaoke version') ||
      a.includes('tribute') ||
      a.includes('made famous') ||
      a.includes('in the style of') ||
      a.includes('originally performed')
    ) {
      return true;
    }
  }
  for (const seg of haystacks) {
    const n = norm(seg);
    if (!n) continue;
    // Version explicitement acceptable (radio edit, single version…) → on ne
    // rejette pas ce segment, même s'il contient un mot par ailleurs suspect.
    if (VERSION_ALLOWLIST.some((ok) => n.includes(norm(ok)))) continue;
    for (const bad of VERSION_EXCLUSIONS) {
      const nb = norm(bad);
      if (nb && n.includes(nb)) return true;
    }
  }
  return false;
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

  const needsReplacement: Array<{ title: string; artist: string; why: string; rows: number }> = [];
  let matched = 0;
  let unchanged = 0;
  let updated = 0;
  let errors = 0;

  for (const group of groups) {
    const t = group[0]!;
    const currentId = t.apple_music_id;

    // Pour un id existant, on récupère le NOM EXACT de la piste Apple pointée :
    // c'est ce qui révèle une reprise (bug Dragostea Din Tei).
    let currentName: string | null = null;
    let currentArtist: string | null = null;
    let currentAlbum: string | null = null;
    if (currentId) {
      try {
        const cur = await apple.getTrack(currentId);
        currentName = cur?.title ?? '(introuvable au catalogue)';
        currentArtist = cur?.artist ?? null;
        currentAlbum = cur?.album ?? null;
      } catch (err) {
        currentName = `(erreur lookup : ${err instanceof Error ? err.message : 'inconnue'})`;
      }
      await sleep(THROTTLE_MS);
    }

    let best: Scored | null = null;
    let rejected = 0;
    let totalCandidates = 0;
    try {
      ({ best, rejected, totalCandidates } = await searchBest(t.title, t.artist, t.year));
    } catch (err) {
      errors += 1;
      console.error(
        `[RematchApple] ERREUR recherche "${t.artist} — ${t.title}" : ${err instanceof Error ? err.message : 'inconnue'}`,
      );
      await sleep(THROTTLE_MS);
      continue;
    }
    await sleep(THROTTLE_MS);

    const currentLooksWrong =
      currentId !== null &&
      currentName !== null &&
      hasExcludedVersion(currentName, currentAlbum ?? undefined);

    if (!best) {
      needsReplacement.push({
        title: t.title,
        artist: t.artist,
        why:
          totalCandidates === 0
            ? 'aucun résultat Apple'
            : `aucun candidat valable (${totalCandidates} résultats, ${rejected} rejetés pour version)`,
        rows: group.length,
      });
      console.info(
        `\n❌ REMPLACEMENT REQUIS — "${t.artist} — ${t.title}"${t.year ? ` (${t.year})` : ''}\n` +
          `   playlists : ${group.map((g) => g.playlist.name_fr).join(', ')}\n` +
          `   id actuel : ${currentId ?? 'AUCUN'}${currentName ? ` → « ${currentName} »` : ''}\n` +
          `   raison    : ${totalCandidates === 0 ? 'aucun résultat Apple' : `${totalCandidates} résultats, ${rejected} rejetés (version), aucun au-dessus du seuil`}`,
      );
      continue;
    }

    matched += 1;
    const willChange = currentId !== best.id;

    // Affichage détaillé en dry-run / sample / only : c'est CE bloc qui permet
    // de vérifier qu'on ne prend pas une reprise.
    if (dryRun) {
      console.info(
        `\n${willChange ? '🔄' : '✅'} "${t.artist} — ${t.title}"${t.year ? ` (${t.year})` : ''}   [${group.length} ligne(s)]\n` +
          `   playlists   : ${[...new Set(group.map((g) => g.playlist.name_fr))].join(', ')}\n` +
          `   AVANT       : ${currentId ?? 'AUCUN'}${currentName ? `  → « ${currentName} »${currentArtist ? ` — ${currentArtist}` : ''}${currentAlbum ? ` [${currentAlbum}]` : ''}` : ''}${currentLooksWrong ? '   ⚠️ VERSION SUSPECTE' : ''}\n` +
          `   APRÈS       : ${best.id}  → « ${best.name} » — ${best.artist}${best.album ? ` [${best.album}]` : ''}${best.year ? ` (${best.year})` : ''}\n` +
          `   score       : ${best.score} (${best.reasons.join(', ')})\n` +
          `   candidats   : ${totalCandidates} trouvés, ${rejected} rejetés (remix/live/karaoké/…)\n` +
          `   action      : ${willChange ? 'MISE À JOUR' : 'inchangé (déjà le bon id)'}`,
      );
    }

    if (!willChange) {
      unchanged += 1;
      continue;
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
  console.info(`  Morceaux traités       : ${groups.length}`);
  console.info(`  Matchés (id valable)   : ${matched}`);
  console.info(`  Déjà corrects          : ${unchanged}`);
  console.info(`  Lignes mises à jour    : ${dryRun ? '0 (DRY-RUN)' : updated}`);
  console.info(`  REMPLACEMENT REQUIS    : ${needsReplacement.length}`);
  console.info(`  Erreurs API            : ${errors}`);
  if (needsReplacement.length > 0) {
    console.info('\n  ── Titres à remplacer (aucune version standard sur Apple) ──');
    for (const r of needsReplacement) {
      console.info(`   • ${r.artist} — ${r.title}  (${r.rows} ligne(s)) — ${r.why}`);
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
