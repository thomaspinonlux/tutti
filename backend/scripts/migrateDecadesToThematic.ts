/**
 * Migration décennies → système thématique cumulatif (#127).
 *
 * Pour chaque décennie (70s/80s/90s/2000s/2010s) :
 *   1. crée une playlist thématique `official-pl-<dec>` (catégorie decades).
 *   2. fusionne les tracks des slugs de niveau existants :
 *        <dec>-easy → difficulty EASY, <dec>-medium → MEDIUM, <dec>-hard → EXPERT.
 *      `-mix` ignoré (redondant). Réutilise les tracks (youtube_id + aliases
 *      copiés, AUCUNE nouvelle résolution YouTube). Dédup (artist,title) :
 *      premier tier rencontré (easy < medium < hard) gagne.
 *   3. masque (visibility → private, RÉVERSIBLE, pas de delete) les 4 slugs
 *      de niveau pour éviter les cartes en double dans le picker.
 *
 * 60s = déjà thématique (`official-pl-60s`, pas de variants) → ignoré.
 * fr-XXs / britpop-90s / eurodance-90s = séries distinctes → hors scope.
 *
 * Idempotent-safe : si `official-pl-<dec>` existe déjà, la décennie est skip.
 * Rollback JSON : created_playlist_ids + track_ids + hidden_slugs (restaurer
 *   visibility public). Undo : scripts/migrateDecadesRollback.ts.
 *
 * Usage : tsx scripts/migrateDecadesToThematic.ts [--dry-run]
 */
import { config as loadEnv } from 'dotenv';
loadEnv();
import { PrismaClient, type Level } from '@prisma/client';
import { writeFileSync } from 'node:fs';

const prisma = new PrismaClient();
const dryRun = process.argv.includes('--dry-run');

const DECADES = [
  { dec: '70s', label: '70', name_en: 'The 70s' },
  { dec: '80s', label: '80', name_en: 'The 80s' },
  { dec: '90s', label: '90', name_en: 'The 90s' },
  { dec: '2000s', label: '2000', name_en: 'The 2000s' },
  { dec: '2010s', label: '2010', name_en: 'The 2010s' },
];
const TIERS: Array<{ suf: string; diff: Level }> = [
  { suf: 'easy', diff: 'EASY' },
  { suf: 'medium', diff: 'MEDIUM' },
  { suf: 'hard', diff: 'EXPERT' },
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
  campaign: 'decades-migration',
  created_playlist_ids: [] as string[],
  track_ids: [] as string[],
  hidden_slugs: [] as Array<{ slug: string; id: string; prev_visibility: string }>,
};

async function main(): Promise<void> {
  console.log(`[decades] start | dry-run=${dryRun}`);
  for (const d of DECADES) {
    const thematicSlug = `official-pl-${d.dec}`;
    const exists = await prisma.officialPlaylist.findUnique({ where: { slug: thematicSlug } });
    if (exists) {
      console.warn(`⚠️  ${thematicSlug} existe déjà → décennie ${d.dec} SKIP`);
      continue;
    }

    // Collecte + dédup des tracks par tier (easy < medium < hard gagne).
    const seen = new Set<string>();
    const toCreate: Array<Record<string, unknown>> = [];
    const perTier: Record<string, number> = { EASY: 0, MEDIUM: 0, EXPERT: 0 };
    for (const { suf, diff } of TIERS) {
      const src = await prisma.officialPlaylist.findUnique({
        where: { slug: `official-pl-${d.dec}-${suf}` },
        include: { tracks: { orderBy: { position: 'asc' } } },
      });
      if (!src) {
        console.warn(`   (pas de slug official-pl-${d.dec}-${suf})`);
        continue;
      }
      for (const t of src.tracks) {
        const k = dedupKey(t.artist, t.title);
        if (seen.has(k)) continue;
        seen.add(k);
        perTier[diff] = (perTier[diff] ?? 0) + 1;
        toCreate.push({
          title: t.title,
          artist: t.artist,
          year: t.year,
          difficulty: diff, // niveau = SLUG source (le champ difficulty décennie MENT)
          spotify_id: t.spotify_id,
          youtube_id: t.youtube_id,
          answers_accepted: t.answers_accepted ?? undefined,
          cover_url: t.cover_url,
          is_playable: t.is_playable,
          playability_reason: t.playability_reason,
          playability_checked_at: t.playability_checked_at,
          last_refreshed_at: t.last_refreshed_at,
          artist_aliases: t.artist_aliases,
          title_aliases: t.title_aliases,
          song_id: t.song_id,
          work_title: t.work_title,
          work_aliases: t.work_aliases,
        });
      }
    }

    console.log(
      `\n=== ${d.dec} → ${thematicSlug} | total=${toCreate.length} | EASY ${perTier.EASY} / MEDIUM ${perTier.MEDIUM} / EXPERT ${perTier.EXPERT} ===`,
    );
    if (dryRun) continue;

    const pl = await prisma.officialPlaylist.create({
      data: {
        slug: thematicSlug,
        name_fr: `Années ${d.label}`,
        name_en: d.name_en,
        locale_primary: 'fr-FR',
        theme: d.dec,
        difficulty: 'MEDIUM',
        visibility: 'public',
        category: 'decades',
        subtitle_fr: `Le meilleur des années ${d.label} — 3 niveaux`,
        subtitle_en: `The best of the ${d.label}s — 3 levels`,
        track_count: toCreate.length,
      },
      select: { id: true },
    });
    rollback.created_playlist_ids.push(pl.id);

    await prisma.officialPlaylistTrack.createMany({
      data: toCreate.map((t, i) => ({ ...t, playlist_id: pl.id, position: i + 1 }) as never),
    });
    const created = await prisma.officialPlaylistTrack.findMany({
      where: { playlist_id: pl.id },
      select: { id: true },
    });
    rollback.track_ids.push(...created.map((c) => c.id));
    console.log(`   ✚ créée ${thematicSlug} (${pl.id}) + ${created.length} tracks`);

    // Masque les 4 slugs de niveau (réversible).
    for (const suf of ['easy', 'medium', 'hard', 'mix']) {
      const slug = `official-pl-${d.dec}-${suf}`;
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
        console.log(`   ⊘ masqué ${slug} (${found.visibility} → private)`);
      }
    }
  }

  if (!dryRun) {
    const path = `/Users/thomaspinon/Documents/Claude Code/tutti/decades-migration-rollback-${STAMP}.json`;
    writeFileSync(path, JSON.stringify(rollback, null, 2));
    console.log(`\n📄 ROLLBACK : ${path}`);
    console.log(
      `   playlists créées=${rollback.created_playlist_ids.length} · tracks=${rollback.track_ids.length} · slugs masqués=${rollback.hidden_slugs.length}`,
    );
  }
}

main()
  .catch((e) => {
    console.error('[decades] fatal:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
