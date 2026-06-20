/**
 * Routes /api/library/* — accès host à la bibliothèque officielle Tutti.
 *
 * Lecture seule + endpoint de "lancement" (clone official → playlist user
 * avec is_official_tutti=true → création round). Différent de /api/admin/
 * library/* qui sont super-admin-only.
 *
 *   GET  /playlists                                    : liste filtrable
 *   GET  /playlists/:id                                : détail + tracks
 *   POST /playlists/:id/launch  { session_id }         : clone + crée round
 *
 * Toutes les routes nécessitent auth (requireAuth + requireWorkspace).
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireWorkspace } from '../middleware/tenant.js';
import { listVisiblePlaylists, getVisiblePlaylistDetail } from '../lib/officialLibraryQueries.js';
import { generateAliases } from '../lib/aliases.js';
import { broadcastToSession } from '../socket/index.js';
import { invalidateCachedPlaylist } from '../lib/playlistCache.js';
import { classifyYoutubeIds } from '../lib/youtubeValidation.js';
import {
  DEFAULT_SESSION_SIZE,
  getEffectiveRoundTrackCount,
  pickRandomTrackIdsForRound,
} from '../lib/gameplayCore.js';

const router: Router = Router();

router.use(requireAuth, requireWorkspace);

// ───── GET /playlists ─────────────────────────────────────────────────────

const listQuery = z.object({
  locale: z.string().optional(),
  theme: z.string().optional(),
  difficulty: z.enum(['easy', 'medium', 'expert', 'EASY', 'MEDIUM', 'EXPERT']).optional(),
});

router.get('/playlists', async (req: Request, res: Response): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'userId manquant' } });
    return;
  }
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'INVALID_QUERY', message: parsed.error.message } });
    return;
  }
  const playlists = await listVisiblePlaylists(req.userId, parsed.data);
  res.json({ playlists });
});

// ───── GET /playlists-by-category ─────────────────────────────────────────
//
// feat/playlist-categories-schema — endpoint pour la nouvelle UI sélection
// host (sections horizontales par catégorie, façon "This Is Blind Test").
//
// Output :
//   {
//     categories: [
//       {
//         slug, label_fr, label_en, description_fr, description_en, order,
//         playlists: [LibraryPlaylistSummary, ...]
//       },
//       ...
//     ]
//   }
//
// Catégories ordonnées par `order` (PLAYLIST_CATEGORIES). Playlists triées
// par `position_in_category` (NULL → fin, par updated_at desc fallback).

router.get('/playlists-by-category', async (req: Request, res: Response): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'userId manquant' } });
    return;
  }
  try {
    const { PLAYLIST_CATEGORIES, UNCATEGORIZED_CATEGORY, getCategoryDef } =
      await import('../lib/playlistCategories.js');
    // feat/two-provider-libraries — onglet provider. 'spotify' ne garde que les
    // playlists ayant ≥15 tracks avec spotify_id (1 manche = 15 → jouable).
    const provider = req.query.provider === 'spotify' ? 'spotify' : 'youtube';
    const SPOTIFY_MIN_TRACKS = 15;
    const all = (await listVisiblePlaylists(req.userId, {})).filter(
      (p) =>
        provider !== 'spotify' ||
        ((p as unknown as { spotify_count?: number }).spotify_count ?? 0) >= SPOTIFY_MIN_TRACKS,
    );

    // Group by category slug. Garde l'ordre de tri retourné par
    // listVisiblePlaylists (déjà sorted par updated_at desc) puis ré-trie
    // par position_in_category côté response (pour le futur ordering manuel
    // via admin).
    const byCategory = new Map<string, typeof all>();
    for (const p of all) {
      const slug =
        (p as unknown as { category?: string | null }).category ?? UNCATEGORIZED_CATEGORY.slug;
      const arr = byCategory.get(slug) ?? [];
      arr.push(p);
      byCategory.set(slug, arr);
    }

    // Sort dans chaque bucket par position_in_category (asc, NULL last).
    for (const [, arr] of byCategory) {
      arr.sort((a, b) => {
        const pa = (a as unknown as { position_in_category?: number | null }).position_in_category;
        const pb = (b as unknown as { position_in_category?: number | null }).position_in_category;
        if (pa === undefined || pa === null) return 1;
        if (pb === undefined || pb === null) return -1;
        return pa - pb;
      });
    }

    // Output : catégories ordered + uncategorized en dernier si non-vide.
    const ordered = PLAYLIST_CATEGORIES.map((cat) => ({
      slug: cat.slug,
      label_fr: cat.label_fr,
      label_en: cat.label_en,
      description_fr: cat.description_fr,
      description_en: cat.description_en,
      order: cat.order,
      playlists: byCategory.get(cat.slug) ?? [],
    })).filter((entry) => entry.playlists.length > 0);

    const uncat = byCategory.get(UNCATEGORIZED_CATEGORY.slug);
    if (uncat && uncat.length > 0) {
      const def = getCategoryDef(null);
      ordered.push({
        slug: def.slug,
        label_fr: def.label_fr,
        label_en: def.label_en,
        description_fr: def.description_fr,
        description_en: def.description_en,
        order: def.order,
        playlists: uncat,
      });
    }

    res.json({ categories: ordered });
  } catch (err) {
    console.error('[GET /library/playlists-by-category] error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: (err as Error).message } });
  }
});

// ───── GET /playlists/:id ─────────────────────────────────────────────────

router.get('/playlists/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  if (!req.userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'userId manquant' } });
    return;
  }
  const detail = await getVisiblePlaylistDetail(req.userId, req.params.id);
  if (!detail) {
    res
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'Playlist introuvable ou inaccessible' } });
    return;
  }
  res.json({ playlist: detail });
});

// ───── POST /playlists/:id/launch ─────────────────────────────────────────
//
// Clone l'official_playlist en Playlist + Tracks dans le workspace du user
// (is_official_tutti=true, hidden de listPlaylists côté UI), puis crée un
// SessionRound pour la session passée en body.
//
// Pivot YouTube-only : preferProvider toujours forcé à "youtube" côté
// serveur. Le body peut envoyer ce champ pour compat, mais l'override
// garantit qu'aucune track ne sera lue via Spotify pour la lib officielle.

const launchBody = z.object({
  session_id: z.string().uuid(),
  preferProvider: z.enum(['spotify', 'youtube']).default('youtube'),
});

router.post(
  '/playlists/:id/launch',
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;
    const parsed = launchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
      return;
    }
    const { session_id } = parsed.data;
    // feat/two-provider-libraries — on RESPECTE le provider demandé (défaut
    // youtube via le schema → comportement inchangé pour tous). 'spotify' n'est
    // envoyé que par l'onglet Spotify (host allowlisté), qui ne liste que des
    // playlists couvertes → clone 100% Spotify, aucun fallback YouTube.
    const preferProvider: 'spotify' | 'youtube' = parsed.data.preferProvider;

    // 1. Vérif accès playlist (visibilité + premium)
    const detail = await getVisiblePlaylistDetail(userId, req.params.id);
    if (!detail) {
      res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', message: 'Playlist introuvable ou inaccessible' } });
      return;
    }

    // 2. Vérif session appartient au workspace
    const session = await prisma.session.findFirst({
      where: { id: session_id, establishment: { workspace_id: workspaceId } },
      select: { id: true, status: true, establishment_id: true },
    });
    if (!session) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Session introuvable' } });
      return;
    }
    if (session.status === 'ENDED') {
      res.status(409).json({ error: { code: 'INVALID_STATUS', message: 'Session déjà terminée' } });
      return;
    }

    // 3. Pour chaque track : choisir provider + provider_track_id
    type ChosenTrack = {
      position: number;
      title: string;
      artist: string;
      year: number | null;
      provider: 'spotify' | 'youtube';
      provider_track_id: string;
      cover_url: string | null;
      answers_accepted: Record<string, unknown> | null;
      // feat/official-library-aliases — alias curés par les super-admins.
      // Mergés au moment du clone-on-launch dans Artist.aliases + Track.aliases
      // côté workspace user pour que voiceMatch les reconnaisse pendant le
      // blind test.
      official_artist_aliases: string[];
      official_title_aliases: string[];
    };
    const chosen: ChosenTrack[] = [];
    let skippedNotPlayable = 0;
    // feat/guess-work-mode — playlist "devine l'œuvre" : la réponse à matcher
    // côté Whisper/text n'est pas l'artiste+titre, mais le nom de l'œuvre
    // (work_title) + ses alias. Le clone substitue donc title ↔ work_title et
    // pousse work_aliases dans Track.aliases. L'artiste reste pour affichage
    // (reveal) mais n'intervient pas dans le matching.
    const isGuessWork = detail.guess_mode === 'work';
    for (const t of detail.tracks) {
      // Problème A (fix/playback-and-zombies-v4) — skip tracks invalidées par
      // validate-youtube-ids (vidéo retirée, non-embeddable, blocked FR/LU).
      // Sans ce filtre, le SDK YouTube tombait sur "video not embeddable" en
      // pleine partie → blocage host.
      if (t.is_playable === false) {
        skippedNotPlayable += 1;
        continue;
      }
      // feat/two-provider-libraries — choix provider selon l'onglet :
      //   spotify → UNIQUEMENT spotify_id, provider='spotify', AUCUN fallback
      //             (les tracks sans spotify_id sont skip → playlist 100% Spotify)
      //   youtube → youtube_id prioritaire, spotify_id en fallback legacy ultime
      let provider: 'spotify' | 'youtube' | null = null;
      let providerId: string | null = null;
      if (preferProvider === 'spotify') {
        if (t.spotify_id) {
          provider = 'spotify';
          providerId = t.spotify_id;
        }
      } else if (t.youtube_id) {
        provider = 'youtube';
        providerId = t.youtube_id;
      } else if (t.spotify_id) {
        provider = 'spotify';
        providerId = t.spotify_id;
      }
      if (!provider || !providerId) continue; // track non jouable pour ce provider, skip
      // Fallback cover : si pas de cover_url stockée et qu'on a un youtube_id,
      // on dérive la thumbnail YouTube. Garantit un visuel pour chaque track.
      const coverUrl =
        t.cover_url ??
        (t.youtube_id ? `https://img.youtube.com/vi/${t.youtube_id}/hqdefault.jpg` : null);
      // feat/guess-work-mode — substitue title ↔ work_title si guess_mode='work'.
      // Si la track n'a pas de work_title rempli, on retombe sur le titre
      // chanson original (fallback safe → pas de NaN/empty match).
      const matchTitle = isGuessWork && t.work_title ? t.work_title : t.title;
      const matchTitleAliases = isGuessWork
        ? [...(t.work_aliases ?? []), ...(t.title_aliases ?? [])]
        : (t.title_aliases ?? []);
      chosen.push({
        position: t.position,
        title: matchTitle,
        artist: t.artist,
        year: t.year,
        provider,
        provider_track_id: providerId,
        cover_url: coverUrl,
        answers_accepted: null,
        official_artist_aliases: t.artist_aliases ?? [],
        official_title_aliases: matchTitleAliases,
      });
    }
    if (chosen.length === 0) {
      res
        .status(400)
        .json({ error: { code: 'NO_PLAYABLE_TRACK', message: 'Aucun morceau jouable' } });
      return;
    }
    if (skippedNotPlayable > 0) {
      console.info(
        `[Launch] Playlist ${detail.slug}: skipped ${skippedNotPlayable} track(s) marked is_playable=false`,
      );
    }

    // 4. Upsert Artist (par canonical_name) + Track (par provider+id) en BATCH.
    //
    // perf/library-launch-batch-clone — l'ancienne boucle faisait 2 à 4 requêtes
    // SÉQUENTIELLES par track (findUnique/findFirst + create|update) = 160-320
    // allers-retours Supabase pour 80 tracks → 1-2 min de latence au lancement.
    // Ici : ~8 requêtes set-based (findMany + createMany + re-findMany, updates
    // en parallèle). Clés de dédup INCHANGÉES (Artist par canonical_name unique,
    // Track par (provider, provider_track_id)) + copie des aliases officiels
    // catalogue→clone (feat/official-library-aliases) préservée.
    const cloneStartedAt = Date.now();

    // ── Artists ──────────────────────────────────────────────────────────
    // Union des aliases officiels par nom (un artiste = plusieurs tracks).
    const artistOfficialAliases = new Map<string, Set<string>>();
    for (const c of chosen) {
      const set = artistOfficialAliases.get(c.artist) ?? new Set<string>();
      c.official_artist_aliases.forEach((a) => set.add(a));
      artistOfficialAliases.set(c.artist, set);
    }
    const artistNames = [...artistOfficialAliases.keys()];

    const existingArtists = await prisma.artist.findMany({
      where: { canonical_name: { in: artistNames } },
      select: { id: true, canonical_name: true, aliases: true },
    });
    const existingArtistNames = new Set(existingArtists.map((a) => a.canonical_name));

    // Créations : artistes absents (canonical_name @unique → skipDuplicates safe).
    const artistsToCreate = artistNames
      .filter((name) => !existingArtistNames.has(name))
      .map((name) => {
        const official = [...(artistOfficialAliases.get(name) ?? [])];
        const aliases = Array.from(new Set([...generateAliases(name, 'artist'), ...official]));
        return { canonical_name: name, aliases };
      });
    if (artistsToCreate.length > 0) {
      await prisma.artist.createMany({ data: artistsToCreate, skipDuplicates: true });
    }

    // Mises à jour : artistes existants dont le set d'aliases grandit (merge
    // official). En parallèle (Promise.all) — pas séquentiel.
    const artistUpdates = existingArtists.flatMap((a) => {
      const official = [...(artistOfficialAliases.get(a.canonical_name) ?? [])];
      const merged = Array.from(new Set([...a.aliases, ...official]));
      return merged.length !== a.aliases.length
        ? [prisma.artist.update({ where: { id: a.id }, data: { aliases: merged } })]
        : [];
    });
    if (artistUpdates.length > 0) await Promise.all(artistUpdates);

    // Re-fetch ids (créés + existants) — autoritaire (gère une création concurrente).
    const allArtists = await prisma.artist.findMany({
      where: { canonical_name: { in: artistNames } },
      select: { id: true, canonical_name: true },
    });
    const artistIdByName = new Map(allArtists.map((a) => [a.canonical_name, a.id]));

    // ── Tracks ───────────────────────────────────────────────────────────
    const trackKey = (provider: string, id: string): string => `${provider} ${id}`;
    interface TrackAgg {
      provider: 'spotify' | 'youtube';
      provider_track_id: string;
      title: string;
      artist: string;
      year: number | null;
      cover_url: string | null;
      official: Set<string>;
    }
    // Dédup `chosen` par (provider, provider_track_id) + union aliases officiels.
    const trackAggByKey = new Map<string, TrackAgg>();
    for (const c of chosen) {
      const k = trackKey(c.provider, c.provider_track_id);
      const agg =
        trackAggByKey.get(k) ??
        ({
          provider: c.provider,
          provider_track_id: c.provider_track_id,
          title: c.title,
          artist: c.artist,
          year: c.year,
          cover_url: c.cover_url,
          official: new Set<string>(),
        } satisfies TrackAgg);
      c.official_title_aliases.forEach((a) => agg.official.add(a));
      trackAggByKey.set(k, agg);
    }
    const providerTrackIds = [...trackAggByKey.values()].map((t) => t.provider_track_id);

    const existingTracks = await prisma.track.findMany({
      where: { provider_track_id: { in: providerTrackIds } },
      select: { id: true, provider: true, provider_track_id: true, cover_url: true, aliases: true },
    });
    const existingTrackKeys = new Set(
      existingTracks.map((t) => trackKey(t.provider, t.provider_track_id)),
    );

    // Créations : tracks absentes. Dédup APP (pas de contrainte unique sur
    // (provider, provider_track_id) → skipDuplicates inopérant ici ; même
    // fenêtre de course que l'ancien findFirst+create).
    const tracksToCreate = [...trackAggByKey.values()]
      .filter((t) => !existingTrackKeys.has(trackKey(t.provider, t.provider_track_id)))
      .map((t) => ({
        artist_id: artistIdByName.get(t.artist)!,
        canonical_title: t.title,
        aliases: Array.from(new Set([...generateAliases(t.title), ...t.official])),
        year: t.year,
        provider: t.provider,
        provider_track_id: t.provider_track_id,
        cover_url: t.cover_url,
      }));
    if (tracksToCreate.length > 0) {
      await prisma.track.createMany({ data: tracksToCreate });
    }

    // Mises à jour : tracks existantes — backfill cover_url + merge aliases. Parallèle.
    const trackUpdates = existingTracks.flatMap((t) => {
      const agg = trackAggByKey.get(trackKey(t.provider, t.provider_track_id));
      if (!agg) return [];
      const merged = Array.from(new Set([...t.aliases, ...agg.official]));
      const data: { cover_url?: string | null; aliases?: string[] } = {};
      if (!t.cover_url && agg.cover_url) data.cover_url = agg.cover_url;
      if (merged.length !== t.aliases.length) data.aliases = merged;
      return Object.keys(data).length > 0
        ? [prisma.track.update({ where: { id: t.id }, data })]
        : [];
    });
    if (trackUpdates.length > 0) await Promise.all(trackUpdates);

    // Re-fetch ids (créés + existants).
    const allTracks = await prisma.track.findMany({
      where: { provider_track_id: { in: providerTrackIds } },
      select: { id: true, provider: true, provider_track_id: true },
    });
    const trackIdByKey = new Map(
      allTracks.map((t) => [trackKey(t.provider, t.provider_track_id), t.id]),
    );

    // Ordre + doublons préservés : 1 entrée par `chosen` (positions playlist).
    const trackIds: string[] = chosen.map(
      (c) => trackIdByKey.get(trackKey(c.provider, c.provider_track_id))!,
    );

    // Mesure perf (avant : N+1 séquentiel 160-320 RT ≈ 1-2 min ; après : ~8 RT).
    console.info(
      `[Launch] clone-batch done in ${Date.now() - cloneStartedAt}ms | tracks=${chosen.length} ` +
        `artists(new=${artistsToCreate.length},upd=${artistUpdates.length}) ` +
        `tracks(new=${tracksToCreate.length},upd=${trackUpdates.length})`,
    );

    // 5. Créer Playlist clone (is_official_tutti=true → caché de "Mes playlists")
    const playlist = await prisma.playlist.create({
      data: {
        establishment_id: session.establishment_id,
        name: detail.name_fr,
        is_published: true,
        is_official_tutti: true,
        is_express: false,
        language: detail.locale_primary.startsWith('fr') ? 'fr' : 'en',
      },
      select: { id: true, default_session_size: true },
    });
    await prisma.playlistTrack.createMany({
      data: trackIds.map((trackId, idx) => ({
        playlist_id: playlist.id,
        track_id: trackId,
        position: idx + 1,
      })),
    });

    // 6. Créer SessionRound
    //    fix/session-pick-respect-default-size — random pick depuis le pool
    //    (playlist enrichie peut avoir 80 tracks, on n'en joue que 15).
    //    Avant ce fix, ce path créait des rounds avec selected_track_ids
    //    vide → gameplayCore fallback sur full playlist → 80 tracks joués.
    const sessionSize = playlist.default_session_size ?? DEFAULT_SESSION_SIZE;
    const pick = await pickRandomTrackIdsForRound(session.id, playlist.id, sessionSize);
    console.info(
      `[POST /library/launch] session=${session.id} playlist=${playlist.id} | pool=${pick.poolSize} played=${pick.playedSize} eligible=${pick.eligibleSize} session_size=${sessionSize} → selected=${pick.selectedTrackIds.length}`,
    );

    const existingRoundsCount = await prisma.sessionRound.count({
      where: { session_id: session.id },
    });
    const round = await prisma.sessionRound.create({
      data: {
        session_id: session.id,
        playlist_id: playlist.id,
        position: existingRoundsCount + 1,
        status: 'PENDING',
        current_track_index: 0,
        selected_track_ids: pick.selectedTrackIds,
      },
      include: {
        playlist: {
          select: {
            id: true,
            name: true,
            level: true,
            _count: { select: { playlist_tracks: true } },
          },
        },
      },
    });

    // 7. Broadcast round:created (Issue 1 fix : sans ce broadcast, le HostPage
    // socket listener ne met pas à jour session.rounds → derived phase reste
    // 'roundSelection' → host coincé sur l'écran de sélection alors que la
    // session est active backend-side. Symétrie avec POST /sessions/:id/rounds.
    const enriched = {
      id: round.id,
      session_id: round.session_id,
      playlist_id: round.playlist_id,
      position: round.position,
      status: round.status,
      current_track_index: round.current_track_index,
      selected_track_ids: round.selected_track_ids,
      started_at: round.started_at,
      ended_at: round.ended_at,
      created_at: round.created_at,
      playlist: {
        id: round.playlist.id,
        name: round.playlist.name,
        level: round.playlist.level,
        tracks_count: getEffectiveRoundTrackCount(round),
        selected_tracks_count: pick.selectedTrackIds.length,
      },
    };
    broadcastToSession(session.id, 'round:created', { round: enriched });

    res.json({
      round: enriched,
      playable_count: chosen.length,
      total_count: detail.tracks.length,
      provider_used: preferProvider,
    });
  },
);

// ───── POST /playlists/:id/check-availability ────────────────────────────
//
// feat/playlist-cache-and-availability-check — bouton host pour tester en
// amont la jouabilité d'une playlist officielle SANS lancer de session.
//
// Stratégie : pour chaque OfficialPlaylistTrack avec youtube_id, batch YT
// Data API videos.list + classify (embeddable/private/region/removed).
// Update OfficialPlaylistTrack.is_playable + playability_reason +
// playability_checked_at. INVALIDE le cache du detail (le payload change).
//
// Accessible à tous les hosts (lecture détail déjà filtrée par visibility).
// Pour le bouton "Vérifier" côté UI hosts, peu importe qui paye le check
// (résultat partagé via Track global).

router.post(
  '/playlists/:id/check-availability',
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const userId = req.userId!;
    const playlistId = req.params.id;

    const detail = await getVisiblePlaylistDetail(userId, playlistId);
    if (!detail) {
      res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', message: 'Playlist introuvable ou inaccessible' } });
      return;
    }

    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      res.status(503).json({
        error: { code: 'YT_API_KEY_MISSING', message: 'YouTube API non configurée côté serveur' },
      });
      return;
    }

    const tracksWithYt = detail.tracks.filter((t) => t.youtube_id !== null);
    if (tracksWithYt.length === 0) {
      res.json({
        total: detail.tracks.length,
        playable: detail.tracks.length,
        unavailable: [],
        checked_at: new Date().toISOString(),
      });
      return;
    }

    try {
      const verdicts = await classifyYoutubeIds(
        apiKey,
        tracksWithYt.map((t) => t.youtube_id!),
      );

      const now = new Date();
      const unavailable: Array<{
        track_id: string;
        title: string;
        artist: string;
        reason: string;
      }> = [];

      await Promise.all(
        tracksWithYt.map(async (t) => {
          const verdict = verdicts.get(t.youtube_id!) ?? {
            is_playable: false,
            reason: 'no_response',
          };
          await prisma.officialPlaylistTrack.update({
            where: { id: t.id },
            data: {
              is_playable: verdict.is_playable,
              playability_reason: verdict.reason,
              playability_checked_at: now,
            },
          });
          if (!verdict.is_playable) {
            unavailable.push({
              track_id: t.id,
              title: t.title,
              artist: t.artist,
              reason: verdict.reason ?? 'unknown',
            });
          }
        }),
      );

      invalidateCachedPlaylist(playlistId, 'check_availability');

      console.info(
        `[Availability:lib] playlist_id=${playlistId} total=${detail.tracks.length} unavailable=${unavailable.length}`,
      );

      res.json({
        total: detail.tracks.length,
        playable: detail.tracks.length - unavailable.length,
        unavailable,
        checked_at: now.toISOString(),
      });
    } catch (err: unknown) {
      console.error('[POST /library/playlists/:id/check-availability] error:', err);
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      res.status(500).json({ error: { code: 'CHECK_FAILED', message } });
    }
  },
);

export default router;
