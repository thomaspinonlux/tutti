/**
 * adminSongTags.ts — feat/song-tags-classification (ÉTAPE 4)
 *
 * Révision humaine du tagging auto (ÉTAPE 3) des songs canoniques.
 * Toutes les routes : requireAuth + requireSuperAdmin (pas exposé aux hosts).
 *
 *   GET  /meta                 vocabulaire (52 thèmes + work_kinds)
 *   GET  /                     liste PAGINÉE + filtres (thème GIN / statut / q)
 *   PATCH /:id                 écrit les tags d'une song + tags_reviewed=true
 *   POST /bulk-validate        tags_reviewed=true sur le filtre courant (count)
 *
 * Aucune dérivation ici : on lit/écrit ce que l'humain décide. La passe auto
 * (scripts/autoTagSongs.ts) a déjà posé les valeurs ; ici on les corrige.
 */
import { Router, type Request, type Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireSuperAdmin } from '../middleware/tenant.js';
import { SONG_THEMES, SONG_THEME_SLUGS } from '../lib/songThemes.js';

const router: Router = Router();
router.use(requireAuth, requireSuperAdmin);

const WORK_KINDS = ['film', 'serie', 'dessin_anime', 'jeu_video', 'comedie_musicale'] as const;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

// ── GET /meta ──────────────────────────────────────────────────────────────
router.get('/meta', (_req: Request, res: Response): void => {
  res.json({ themes: SONG_THEMES, work_kinds: WORK_KINDS });
});

// ── Filtre commun (liste + bulk) ───────────────────────────────────────────
const filterSchema = z.object({
  theme: z.string().optional(),
  status: z.enum(['all', 'reviewed', 'unreviewed']).optional(),
  q: z.string().trim().max(120).optional(),
});

function buildWhere(f: z.infer<typeof filterSchema>): Prisma.SongWhereInput {
  const where: Prisma.SongWhereInput = {};
  if (f.theme && SONG_THEME_SLUGS.has(f.theme)) {
    where.themes = { has: f.theme }; // index GIN sur themes[]
  }
  if (f.status === 'reviewed') where.tags_reviewed = true;
  else if (f.status === 'unreviewed') where.tags_reviewed = false;
  if (f.q) {
    where.OR = [
      { canonical_title: { contains: f.q, mode: 'insensitive' } },
      { artist: { canonical_name: { contains: f.q, mode: 'insensitive' } } },
    ];
  }
  return where;
}

interface SongRow {
  id: string;
  canonical_title: string;
  themes: string[];
  is_francophone: boolean;
  is_international: boolean;
  level: number | null;
  work_title: string | null;
  work_kind: string | null;
  tags_reviewed: boolean;
  artist: { canonical_name: string };
  catalog_tracks: { year: number | null }[];
}

function serialize(s: SongRow): Record<string, unknown> {
  return {
    id: s.id,
    title: s.canonical_title,
    artist: s.artist.canonical_name,
    year: s.catalog_tracks[0]?.year ?? null,
    themes: s.themes,
    is_francophone: s.is_francophone,
    is_international: s.is_international,
    level: s.level,
    work_title: s.work_title,
    work_kind: s.work_kind,
    tags_reviewed: s.tags_reviewed,
  };
}

const SONG_SELECT = {
  id: true,
  canonical_title: true,
  themes: true,
  is_francophone: true,
  is_international: true,
  level: true,
  work_title: true,
  work_kind: true,
  tags_reviewed: true,
  artist: { select: { canonical_name: true } },
  catalog_tracks: { where: { year: { not: null } }, select: { year: true }, take: 1 },
} as const;

// ── GET / (liste paginée) ──────────────────────────────────────────────────
const listSchema = filterSchema.extend({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
});

router.get('/', async (req: Request, res: Response): Promise<void> => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    return;
  }
  const { page = 1, limit = DEFAULT_LIMIT, ...filter } = parsed.data;
  const where = buildWhere(filter);

  const [total, songs] = await prisma.$transaction([
    prisma.song.count({ where }),
    prisma.song.findMany({
      where,
      orderBy: [{ tags_reviewed: 'asc' }, { canonical_title: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
      select: SONG_SELECT,
    }),
  ]);

  res.json({ songs: (songs as SongRow[]).map(serialize), total, page, limit });
});

// ── PATCH /:id (écrit les tags + tags_reviewed=true) ───────────────────────
const patchSchema = z
  .object({
    themes: z.array(z.string()).optional(),
    is_francophone: z.boolean().optional(),
    is_international: z.boolean().optional(),
    level: z.number().int().min(1).max(3).nullable().optional(),
    work_title: z.string().trim().max(200).nullable().optional(),
    work_kind: z.enum(WORK_KINDS).nullable().optional(),
  })
  .strict();

router.patch('/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  if (!z.string().uuid().safeParse(req.params.id).success) {
    res.status(400).json({ error: { code: 'INVALID_ID', message: 'id invalide' } });
    return;
  }
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    return;
  }
  const b = parsed.data;

  if (b.themes) {
    const bad = b.themes.filter((t) => !SONG_THEME_SLUGS.has(t));
    if (bad.length > 0) {
      res
        .status(400)
        .json({ error: { code: 'UNKNOWN_THEME', message: `Thèmes inconnus: ${bad.join(', ')}` } });
      return;
    }
  }

  const data: Prisma.SongUpdateInput = { tags_reviewed: true };
  if (b.themes) data.themes = { set: Array.from(new Set(b.themes)) };
  if (b.is_francophone !== undefined) data.is_francophone = b.is_francophone;
  if (b.is_international !== undefined) data.is_international = b.is_international;
  if (b.level !== undefined) data.level = b.level;
  if (b.work_title !== undefined) data.work_title = b.work_title === '' ? null : b.work_title;
  if (b.work_kind !== undefined) data.work_kind = b.work_kind;

  try {
    const song = await prisma.song.update({
      where: { id: req.params.id },
      data,
      select: SONG_SELECT,
    });
    res.json({ song: serialize(song as SongRow) });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Song introuvable' } });
      return;
    }
    throw err;
  }
});

// ── POST /bulk-validate (tags_reviewed=true sur le filtre, RIEN d'autre) ────
router.post('/bulk-validate', async (req: Request, res: Response): Promise<void> => {
  const parsed = filterSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    return;
  }
  const where = buildWhere(parsed.data);
  // updateMany = une seule requête (transactionnelle, idempotente). Ne touche
  // QUE tags_reviewed — aucun tag modifié.
  const { count } = await prisma.song.updateMany({ where, data: { tags_reviewed: true } });
  res.json({ count });
});

export default router;
