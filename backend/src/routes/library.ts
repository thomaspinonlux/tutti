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
import { invalidateCachedPlaylist } from '../lib/playlistCache.js';
import { classifyYoutubeIds } from '../lib/youtubeValidation.js';
import {
  launchOfficialPlaylistForSession,
  NoPlayableTrackError,
} from '../lib/officialPlaylistLaunch.js';

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
  // feat/apple-music — 3e source jouable. Défaut youtube (comportement inchangé).
  preferProvider: z.enum(['spotify', 'youtube', 'apple_music']).default('youtube'),
  // feat/thematic-level-filter — niveau choisi sur une playlist thématique. Le
  // clone ne matérialise QUE les OfficialPlaylistTrack de ce difficulty
  // (clone-filtré, pas de migration schéma). Absent / undefined = tous niveaux
  // (Mix, décennies, legacy plates). Garde-fou côté route : pool < 15 → Mix.
  difficulty: z.enum(['EASY', 'MEDIUM', 'EXPERT']).optional(),
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
    const preferProvider: 'spotify' | 'youtube' | 'apple_music' = parsed.data.preferProvider;

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

    // 3-7. Clone official → Playlist user + création SessionRound (extrait dans
    // lib/officialPlaylistLaunch.ts, réutilisé par la route master). Contrat
    // externe INCHANGÉ : mêmes broadcasts (round:created), même clone batch,
    // même pondération/fallback niveau→Mix, même réponse JSON.
    try {
      const result = await launchOfficialPlaylistForSession(
        detail,
        session.id,
        session.establishment_id,
        { preferProvider, difficulty: parsed.data.difficulty },
      );
      res.json({
        round: result.round,
        playable_count: result.playable_count,
        total_count: result.total_count,
        provider_used: result.provider_used,
      });
    } catch (err: unknown) {
      if (err instanceof NoPlayableTrackError) {
        res.status(400).json({ error: { code: err.code, message: err.message } });
        return;
      }
      throw err;
    }
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
