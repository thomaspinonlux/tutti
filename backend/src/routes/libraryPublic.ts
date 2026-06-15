/**
 * Routes /api/library-public/* — catalogue officiel en LECTURE SEULE et SANS
 * AUTH, destiné à l'écran TV (feat/tv-grid-mirror).
 *
 * La TV (page /screen, ouverte dans un browser sans cookies admin) doit
 * mirrorer la grille de sélection de l'animateur. Elle fetch donc le catalogue
 * elle-même via cet endpoint public, puis applique le focus + scroll reçus via
 * screen-state.
 *
 *   GET /api/library-public/catalog : grille catégorisée (identique à
 *                                      /api/library/playlists-by-category mais
 *                                      vue anonyme/non-premium, sans auth).
 *
 * Aucune donnée sensible : uniquement métadonnées playlists (titre, cover,
 * compteurs). Le détail des tracks reste protégé (routes /api/library/* auth).
 */

import { Router, type Request, type Response } from 'express';
import { listPublicPlaylists } from '../lib/officialLibraryQueries.js';

const router: Router = Router();

// ───── GET /catalog ────────────────────────────────────────────────────────
// Même structure de réponse que GET /api/library/playlists-by-category, pour
// que la TV réutilise le même composant de grille que l'animateur.

router.get('/catalog', async (_req: Request, res: Response): Promise<void> => {
  try {
    const { PLAYLIST_CATEGORIES, UNCATEGORIZED_CATEGORY, getCategoryDef } =
      await import('../lib/playlistCategories.js');
    const all = await listPublicPlaylists();

    // Group by category slug (cf. /playlists-by-category).
    const byCategory = new Map<string, typeof all>();
    for (const p of all) {
      const slug = p.category ?? UNCATEGORIZED_CATEGORY.slug;
      const arr = byCategory.get(slug) ?? [];
      arr.push(p);
      byCategory.set(slug, arr);
    }

    // Sort dans chaque bucket par position_in_category (asc, NULL last).
    for (const [, arr] of byCategory) {
      arr.sort((a, b) => {
        const pa = a.position_in_category;
        const pb = b.position_in_category;
        if (pa === undefined || pa === null) return 1;
        if (pb === undefined || pb === null) return -1;
        return pa - pb;
      });
    }

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

    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ categories: ordered });
  } catch (err) {
    console.error('[GET /library-public/catalog] error:', err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: (err as Error).message } });
  }
});

export default router;
