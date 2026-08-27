/**
 * Migration anti-doublons : fusionne des slugs de niveau dans une playlist
 * thématique (existante ou créée) + cache les slugs niveau (visibility private,
 * réversible). Même principe que migrateDecadesToThematic.ts, généralisé.
 *
 * Cibles :
 *   - 2020s            : thématique EXISTE (official-pl-2020s) → fusion dedans.
 *   - Musique de Film  : créer official-pl-musique-film.
 *   - Variété FR 80/90/2000/2010 : créer official-pl-fr-{80s,90s,2000s,2010s}.
 *
 * difficulty = niveau du SLUG source (easy→EASY, medium→MEDIUM, hard→EXPERT) ;
 * -mix ignoré. Dédup (artist,title) ; pour une thématique existante on dédup
 * AUSSI contre ses tracks déjà présentes (n'ajoute que les nouvelles). Reuse
 * youtube_id + aliases (copie, aucune résolution YouTube).
 *
 * Rollback JSON : created_playlist_ids (UNIQUEMENT les thématiques créées) +
 * track_ids (ajoutées) + hidden_slugs (restaurer visibility). Undo :
 * migrateDecadesRollback.ts (même format).
 *
 * Usage : tsx scripts/migrateLevelSlugsToThematic.ts [--dry-run]
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
import { PrismaClient, type Level } from '@prisma/client';
import { writeFileSync } from 'node:fs';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

interface Target {
  thematicSlug: string;
  exists: boolean; // true = ne pas créer, fusionner dans l'existant
  name_fr: string;
  name_en: string;
  category: string;
  theme: string;
  sources: Array<{ slug: string; diff: Level }>; // ordre = priorité dédup (1er gagne)
  hide: string[]; // slugs à masquer (inclut -mix)
}

const TARGETS: Target[] = [
  {
    thematicSlug: 'official-pl-2020s',
    exists: true,
    name_fr: 'Années 2020',
    name_en: 'The 2020s',
    category: 'decades',
    theme: '2020s',
    sources: [
      { slug: 'official-pl-2020s-easy', diff: 'EASY' },
      { slug: 'official-pl-2020s-medium', diff: 'MEDIUM' },
      { slug: 'official-pl-2020s-hard', diff: 'EXPERT' },
    ],
    hide: [
      'official-pl-2020s-easy',
      'official-pl-2020s-medium',
      'official-pl-2020s-hard',
      'official-pl-2020s-mix',
    ],
  },
  {
    thematicSlug: 'official-pl-musique-film',
    exists: false,
    name_fr: 'Musique de Film',
    name_en: 'Movie Soundtracks',
    category: 'special',
    theme: 'musique-film',
    sources: [
      { slug: 'official-pl-films-easy', diff: 'EASY' },
      { slug: 'official-pl-films-medium', diff: 'MEDIUM' },
      { slug: 'official-pl-films-hard', diff: 'EXPERT' },
    ],
    hide: ['official-pl-films-easy', 'official-pl-films-medium', 'official-pl-films-hard'],
  },
  ...(['80s', '90s', '2000s', '2010s'] as const).map((d) => ({
    thematicSlug: `official-pl-fr-${d}`,
    exists: false,
    name_fr: `Variété FR — Années ${d.replace('s', '')}`,
    name_en: `French Variété — ${d}`,
    category: 'decades',
    theme: `fr-${d}`,
    sources: [
      { slug: `official-pl-fr-${d}-easy`, diff: 'EASY' as Level },
      { slug: `official-pl-fr-${d}-medium`, diff: 'MEDIUM' as Level },
      { slug: `official-pl-fr-${d}-hard`, diff: 'EXPERT' as Level },
    ],
    hide: [
      `official-pl-fr-${d}-easy`,
      `official-pl-fr-${d}-medium`,
      `official-pl-fr-${d}-hard`,
      `official-pl-fr-${d}-mix`,
    ],
  })),
];

function lower(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}
function dedupKey(artist: string, title: string): string {
  return `${lower(artist)}|||${lower(title)}`;
}

const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const rollback = {
  created_at: new Date().toISOString(),
  campaign: 'level-slugs-migration',
  created_playlist_ids: [] as string[],
  track_ids: [] as string[],
  hidden_slugs: [] as Array<{ slug: string; id: string; prev_visibility: string }>,
};

async function main(): Promise<void> {
  console.log(`[migrate] start | dry-run=${dryRun}`);
  for (const t of TARGETS) {
    // Résout / crée la thématique cible.
    let plId: string;
    const seen = new Set<string>();
    const existing = await prisma.officialPlaylist.findUnique({
      where: { slug: t.thematicSlug },
      select: { id: true },
    });
    if (t.exists) {
      if (!existing) {
        console.warn(`⚠️  ${t.thematicSlug} attendu existant mais absent → SKIP`);
        continue;
      }
      plId = existing.id;
      // pré-remplit `seen` avec les tracks déjà présentes (n'ajoute que les nouvelles)
      const cur = await prisma.officialPlaylistTrack.findMany({
        where: { playlist_id: plId },
        select: { artist: true, title: true },
      });
      for (const x of cur) seen.add(dedupKey(x.artist, x.title));
    } else if (existing) {
      console.warn(`⚠️  ${t.thematicSlug} existe déjà (création attendue) → SKIP`);
      continue;
    }

    // Collecte tracks des sources (dédup, 1er tier gagne).
    const toCreate: Array<Record<string, unknown>> = [];
    const perTier: Record<string, number> = { EASY: 0, MEDIUM: 0, EXPERT: 0 };
    for (const src of t.sources) {
      const sp = await prisma.officialPlaylist.findUnique({
        where: { slug: src.slug },
        include: { tracks: { orderBy: { position: 'asc' } } },
      });
      if (!sp) {
        console.warn(`   (source absente ${src.slug})`);
        continue;
      }
      for (const tr of sp.tracks) {
        const k = dedupKey(tr.artist, tr.title);
        if (seen.has(k)) continue;
        seen.add(k);
        perTier[src.diff] = (perTier[src.diff] ?? 0) + 1;
        toCreate.push({
          title: tr.title,
          artist: tr.artist,
          year: tr.year,
          difficulty: src.diff,
          spotify_id: tr.spotify_id,
          youtube_id: tr.youtube_id,
          answers_accepted: tr.answers_accepted ?? undefined,
          cover_url: tr.cover_url,
          is_playable: tr.is_playable,
          playability_reason: tr.playability_reason,
          playability_checked_at: tr.playability_checked_at,
          last_refreshed_at: tr.last_refreshed_at,
          artist_aliases: tr.artist_aliases,
          title_aliases: tr.title_aliases,
          song_id: tr.song_id,
          work_title: tr.work_title,
          work_aliases: tr.work_aliases,
        });
      }
    }

    console.log(
      `\n=== ${t.thematicSlug} (${t.exists ? 'existant' : 'créé'}) | +${toCreate.length} | nouveaux E ${perTier.EASY} / M ${perTier.MEDIUM} / X ${perTier.EXPERT} ===`,
    );
    if (dryRun) continue;

    if (!t.exists) {
      const pl = await prisma.officialPlaylist.create({
        data: {
          slug: t.thematicSlug,
          name_fr: t.name_fr,
          name_en: t.name_en,
          locale_primary: 'fr-FR',
          theme: t.theme,
          difficulty: 'MEDIUM',
          visibility: 'public',
          category: t.category,
          subtitle_fr: `${t.name_fr} — 3 niveaux`,
          subtitle_en: `${t.name_en} — 3 levels`,
          track_count: 0,
        },
        select: { id: true },
      });
      plId = pl.id;
      rollback.created_playlist_ids.push(pl.id);
    }

    // Position de départ = max actuel (append derrière l'existant pour 2020s).
    const agg = await prisma.officialPlaylistTrack.aggregate({
      where: { playlist_id: plId! },
      _max: { position: true },
    });
    let pos = agg._max.position ?? 0;
    if (toCreate.length > 0) {
      await prisma.officialPlaylistTrack.createMany({
        data: toCreate.map((tr) => ({ ...tr, playlist_id: plId!, position: ++pos }) as never),
      });
    }
    // Récupère les ids créés (les N derniers de la playlist par position).
    const created = await prisma.officialPlaylistTrack.findMany({
      where: { playlist_id: plId!, position: { gt: agg._max.position ?? 0 } },
      select: { id: true },
    });
    rollback.track_ids.push(...created.map((c) => c.id));
    await prisma.officialPlaylist.update({
      where: { id: plId! },
      data: { track_count: { increment: created.length } },
    });
    console.log(`   ✚ +${created.length} tracks dans ${t.thematicSlug}`);

    // Masque les slugs niveau.
    for (const slug of t.hide) {
      const found = await prisma.officialPlaylist.findUnique({
        where: { slug },
        select: { id: true, visibility: true },
      });
      if (found && found.visibility !== 'private') {
        await prisma.officialPlaylist.update({
          where: { id: found.id },
          data: { visibility: 'private' },
        });
        rollback.hidden_slugs.push({ slug, id: found.id, prev_visibility: found.visibility });
        console.log(`   ⊘ masqué ${slug}`);
      }
    }
  }

  if (!dryRun) {
    const path = `/Users/thomaspinon/Documents/Claude Code/tutti/level-slugs-migration-rollback-${STAMP}.json`;
    writeFileSync(path, JSON.stringify(rollback, null, 2));
    console.log(
      `\n📄 ROLLBACK : ${path}\n   créées=${rollback.created_playlist_ids.length} · tracks=${rollback.track_ids.length} · masqués=${rollback.hidden_slugs.length}`,
    );
  }
}

main()
  .catch((e) => {
    console.error('[migrate] fatal:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
