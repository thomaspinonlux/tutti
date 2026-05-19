/**
 * Routes /api/admin/library/* — gestion bibliothèque officielle Tutti.
 *
 *   - GET    /playlists                         : liste official_playlists
 *   - GET    /playlists/:id                     : détail + tracks
 *   - PATCH  /playlists/:id                     : update name/desc/visibility
 *   - POST   /playlists/:id/resync              : re-import depuis JSON source
 *   - POST   /reimport                          : re-import tous les .json
 *
 * Toutes les routes sont gardées par requireAuth + requireSuperAdmin.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireSuperAdmin } from '../middleware/tenant.js';
import {
  DEFAULT_PLAYLISTS_DIR,
  processAllFiles,
  processOneSlug,
} from '../lib/officialLibraryImport.js';
import { invalidateCachedPlaylist } from '../lib/playlistCache.js';

const router: Router = Router();

router.use(requireAuth, requireSuperAdmin);

// ───── GET /playlists — liste avec filtre visibility + recherche ──────────

const listQuery = z.object({
  visibility: z.enum(['public', 'premium_only', 'private']).optional(),
  q: z.string().optional(),
});

router.get('/playlists', async (req: Request, res: Response): Promise<void> => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'INVALID_QUERY', message: parsed.error.message } });
    return;
  }
  const { visibility, q } = parsed.data;
  const where: Record<string, unknown> = {};
  if (visibility) where.visibility = visibility;
  if (q && q.trim()) {
    const term = q.trim();
    where.OR = [
      { name_fr: { contains: term, mode: 'insensitive' } },
      { name_en: { contains: term, mode: 'insensitive' } },
      { theme: { contains: term, mode: 'insensitive' } },
      { slug: { contains: term, mode: 'insensitive' } },
    ];
  }
  const playlists = await prisma.officialPlaylist.findMany({
    where,
    orderBy: { updated_at: 'desc' },
    select: {
      id: true,
      slug: true,
      name_fr: true,
      name_en: true,
      theme: true,
      difficulty: true,
      locale_primary: true,
      visibility: true,
      track_count: true,
      created_at: true,
      updated_at: true,
    },
  });
  res.json({ playlists });
});

// ───── GET /playlists/:id — détail + tracks ──────────────────────────────

router.get('/playlists/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  const playlist = await prisma.officialPlaylist.findUnique({
    where: { id: req.params.id },
    include: {
      tracks: { orderBy: { position: 'asc' } },
    },
  });
  if (!playlist) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Playlist introuvable' } });
    return;
  }
  res.json({ playlist });
});

// ───── PATCH /playlists/:id — update name/desc/visibility ────────────────

const patchBody = z.object({
  name_fr: z.string().min(1).max(200).optional(),
  name_en: z.string().min(1).max(200).optional(),
  description_fr: z.string().max(2000).nullable().optional(),
  description_en: z.string().max(2000).nullable().optional(),
  visibility: z.enum(['public', 'premium_only', 'private']).optional(),
});

router.patch(
  '/playlists/:id',
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const parsed = patchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
      return;
    }
    const exists = await prisma.officialPlaylist.findUnique({ where: { id: req.params.id } });
    if (!exists) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Playlist introuvable' } });
      return;
    }
    const playlist = await prisma.officialPlaylist.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    // feat/playlist-cache-and-availability-check — invalidate cache après
    // mutation (le check version updated_at suffit théoriquement mais on
    // force ici pour éviter une fenêtre de race si plusieurs requests
    // parallèles).
    invalidateCachedPlaylist(req.params.id, 'admin_patch_playlist');
    res.json({ playlist });
  },
);

// ───── POST /playlists/:id/resync — re-import depuis JSON source ─────────

router.post(
  '/playlists/:id/resync',
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const playlist = await prisma.officialPlaylist.findUnique({
      where: { id: req.params.id },
      select: { slug: true },
    });
    if (!playlist) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Playlist introuvable' } });
      return;
    }
    try {
      const report = await processOneSlug(DEFAULT_PLAYLISTS_DIR, playlist.slug);
      invalidateCachedPlaylist(req.params.id, 'admin_resync');
      res.json({ report });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      res.status(500).json({ error: { code: 'IMPORT_FAILED', message } });
    }
  },
);

// ───── GET /tracks/unplayable — liste des tracks à corriger ─────────────
//
// Retourne tous les tracks officiels qui ne peuvent pas être lus (youtube_id
// null OU is_playable false). Utilisé par /admin/library/audit pour permettre
// aux super-admins de corriger manuellement les manqués de l'import auto.

router.get('/tracks/unplayable', async (_req: Request, res: Response): Promise<void> => {
  const tracks = await prisma.officialPlaylistTrack.findMany({
    where: {
      OR: [{ youtube_id: null }, { is_playable: false }],
    },
    orderBy: [{ playlist: { slug: 'asc' } }, { position: 'asc' }],
    include: {
      playlist: { select: { id: true, slug: true, name_fr: true } },
    },
  });
  res.json({
    tracks: tracks.map((t) => ({
      id: t.id,
      playlist_id: t.playlist_id,
      playlist_slug: t.playlist.slug,
      playlist_name_fr: t.playlist.name_fr,
      position: t.position,
      title: t.title,
      artist: t.artist,
      year: t.year,
      youtube_id: t.youtube_id,
      cover_url: t.cover_url,
      is_playable: t.is_playable,
      playability_reason: t.playability_reason,
    })),
  });
});

// ───── PATCH /tracks/:trackId — édition manuelle d'un track officiel ─────
//
// Permet aux super-admins de corriger les youtube_id/spotify_id/cover_url
// foireux après import auto, ET de curer manuellement les alias de
// prononciation pour le matching vocal Whisper. Mêmes sémantiques que
// PATCH /api/playlists/:id/tracks/:trackId côté playlists perso.
//
// Side-effect : les alias officiels sont mergés au clone-on-launch dans
// Track.aliases (titre) + Artist.aliases (artiste) côté workspace user
// pour que voiceMatch les reconnaisse.

const patchTrackBody = z.object({
  spotify_id: z.string().min(1).max(40).nullable().optional(),
  youtube_id: z.string().min(1).max(40).nullable().optional(),
  cover_url: z.string().url().nullable().optional(),
  artist_aliases: z.array(z.string().min(1).max(120)).max(50).optional(),
  title_aliases: z.array(z.string().min(1).max(120)).max(50).optional(),
});

router.patch(
  '/tracks/:trackId',
  async (req: Request<{ trackId: string }>, res: Response): Promise<void> => {
    const parsed = patchTrackBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'INVALID_BODY', message: parsed.error.message } });
      return;
    }
    const exists = await prisma.officialPlaylistTrack.findUnique({
      where: { id: req.params.trackId },
      select: { id: true, youtube_id: true, cover_url: true },
    });
    if (!exists) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Track introuvable' } });
      return;
    }

    // Si youtube_id change et la cover_url actuelle est la thumbnail YT
    // dérivée (ou pas de cover du tout), on régénère la thumbnail pour la
    // nouvelle vidéo. Sinon on respecte le cover_url custom.
    const data: Record<string, unknown> = { ...parsed.data };
    if (
      parsed.data.youtube_id !== undefined &&
      parsed.data.youtube_id &&
      parsed.data.cover_url === undefined
    ) {
      const looksLikeYtThumb =
        !exists.cover_url ||
        exists.cover_url.startsWith(`https://img.youtube.com/vi/${exists.youtube_id ?? ''}/`);
      if (looksLikeYtThumb) {
        data.cover_url = `https://img.youtube.com/vi/${parsed.data.youtube_id}/hqdefault.jpg`;
      }
    }

    // Dédoublonnage + trim côté backend pour les alias.
    if (parsed.data.artist_aliases) {
      data.artist_aliases = Array.from(
        new Set(parsed.data.artist_aliases.map((a) => a.trim()).filter((a) => a.length > 0)),
      );
    }
    if (parsed.data.title_aliases) {
      data.title_aliases = Array.from(
        new Set(parsed.data.title_aliases.map((a) => a.trim()).filter((a) => a.length > 0)),
      );
    }

    const track = await prisma.officialPlaylistTrack.update({
      where: { id: req.params.trackId },
      data,
    });
    res.json({ track });
  },
);

// ───── POST /reimport — re-import toutes les playlists ───────────────────

router.post('/reimport', async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await processAllFiles(DEFAULT_PLAYLISTS_DIR);
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    res.status(500).json({ error: { code: 'IMPORT_FAILED', message } });
  }
});

export default router;
