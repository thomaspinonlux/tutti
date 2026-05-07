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
// Choix provider par track : preferProvider du body (sinon "spotify"). Si la
// track n'a pas l'id du provider préféré → fallback à l'autre. Si aucun id
// dispo → track skipped.

const launchBody = z.object({
  session_id: z.string().uuid(),
  preferProvider: z.enum(['spotify', 'youtube']).default('spotify'),
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
    const { session_id, preferProvider } = parsed.data;

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
    for (const t of detail.tracks) {
      // Problème A (fix/playback-and-zombies-v4) — skip tracks invalidées par
      // validate-youtube-ids (vidéo retirée, non-embeddable, blocked FR/LU).
      // Sans ce filtre, le SDK YouTube tombait sur "video not embeddable" en
      // pleine partie → blocage host.
      if (t.is_playable === false) {
        skippedNotPlayable += 1;
        continue;
      }
      let provider: 'spotify' | 'youtube' | null = null;
      let providerId: string | null = null;
      if (preferProvider === 'spotify') {
        if (t.spotify_id) {
          provider = 'spotify';
          providerId = t.spotify_id;
        } else if (t.youtube_id) {
          provider = 'youtube';
          providerId = t.youtube_id;
        }
      } else {
        if (t.youtube_id) {
          provider = 'youtube';
          providerId = t.youtube_id;
        } else if (t.spotify_id) {
          provider = 'spotify';
          providerId = t.spotify_id;
        }
      }
      if (!provider || !providerId) continue; // track non jouable, skip
      // Fallback cover : si pas de cover_url stockée et qu'on a un youtube_id,
      // on dérive la thumbnail YouTube. Garantit un visuel pour chaque track.
      const coverUrl =
        t.cover_url ??
        (t.youtube_id ? `https://img.youtube.com/vi/${t.youtube_id}/hqdefault.jpg` : null);
      chosen.push({
        position: t.position,
        title: t.title,
        artist: t.artist,
        year: t.year,
        provider,
        provider_track_id: providerId,
        cover_url: coverUrl,
        answers_accepted: null,
        official_artist_aliases: t.artist_aliases ?? [],
        official_title_aliases: t.title_aliases ?? [],
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

    // 4. Upsert Artist (par canonical_name) + Track (par provider+id)
    // feat/official-library-aliases — Merge des alias officiels curés avec
    // les alias auto-générés. Si Artist/Track existent déjà, on ajoute les
    // nouveaux alias en dédoublonnant (Set) pour ne pas perdre ceux déjà
    // ajoutés manuellement par l'admin (ex: même artiste dans plusieurs
    // playlists officielles).
    const trackIds: string[] = [];
    for (const c of chosen) {
      const generatedArtistAliases = generateAliases(c.artist, 'artist');
      const mergedArtistAliases = Array.from(
        new Set([...generatedArtistAliases, ...c.official_artist_aliases]),
      );

      const existingArtist = await prisma.artist.findUnique({
        where: { canonical_name: c.artist },
        select: { id: true, aliases: true },
      });
      let artistId: string;
      if (existingArtist) {
        // Merge alias officiels avec ceux déjà en DB pour cet Artist.
        const allArtistAliases = Array.from(
          new Set([...existingArtist.aliases, ...c.official_artist_aliases]),
        );
        if (allArtistAliases.length !== existingArtist.aliases.length) {
          await prisma.artist.update({
            where: { id: existingArtist.id },
            data: { aliases: allArtistAliases },
          });
        }
        artistId = existingArtist.id;
      } else {
        const createdArtist = await prisma.artist.create({
          data: {
            canonical_name: c.artist,
            aliases: mergedArtistAliases,
          },
          select: { id: true },
        });
        artistId = createdArtist.id;
      }

      const generatedTitleAliases = generateAliases(c.title);
      const mergedTitleAliases = Array.from(
        new Set([...generatedTitleAliases, ...c.official_title_aliases]),
      );

      const existingTrack = await prisma.track.findFirst({
        where: { provider: c.provider, provider_track_id: c.provider_track_id },
        select: { id: true, cover_url: true, aliases: true },
      });
      let trackId: string;
      if (existingTrack) {
        // Backfill cover_url + merge alias officiels avec ceux déjà en DB.
        const allTitleAliases = Array.from(
          new Set([...existingTrack.aliases, ...c.official_title_aliases]),
        );
        const updateData: Record<string, unknown> = {};
        if (!existingTrack.cover_url && c.cover_url) {
          updateData.cover_url = c.cover_url;
        }
        if (allTitleAliases.length !== existingTrack.aliases.length) {
          updateData.aliases = allTitleAliases;
        }
        if (Object.keys(updateData).length > 0) {
          await prisma.track.update({
            where: { id: existingTrack.id },
            data: updateData,
          });
        }
        trackId = existingTrack.id;
      } else {
        const created = await prisma.track.create({
          data: {
            artist_id: artistId,
            canonical_title: c.title,
            aliases: mergedTitleAliases,
            year: c.year,
            provider: c.provider,
            provider_track_id: c.provider_track_id,
            cover_url: c.cover_url,
          },
          select: { id: true },
        });
        trackId = created.id;
      }
      trackIds.push(trackId);
    }

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
      select: { id: true },
    });
    await prisma.playlistTrack.createMany({
      data: trackIds.map((trackId, idx) => ({
        playlist_id: playlist.id,
        track_id: trackId,
        position: idx + 1,
      })),
    });

    // 6. Créer SessionRound
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
      started_at: round.started_at,
      ended_at: round.ended_at,
      created_at: round.created_at,
      playlist: {
        id: round.playlist.id,
        name: round.playlist.name,
        level: round.playlist.level,
        tracks_count: round.playlist._count.playlist_tracks,
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

export default router;
