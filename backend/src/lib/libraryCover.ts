/**
 * libraryCover.ts — feat/tv-carousel-polish
 *
 * Génère dynamiquement une cover mosaïque 2×2 d'une OfficialPlaylist :
 *   - Récupère les 4 premières tracks du pool (ordered by position)
 *   - Fetch leur cover_url côté OfficialPlaylistTrack
 *   - Compose un sprite 512×512 (4 carrés 256×256) via sharp
 *   - Cache in-memory (LRU 50 entries, TTL 6h)
 *
 * Servi par GET /api/library-cover/:slug.jpg (route publique).
 *
 * Si moins de 4 tracks ont une cover_url → on duplique celles dispo pour
 * remplir les 4 cases. Si 0 → renvoie 404 (frontend fallback texte).
 */

import sharp from 'sharp';
import { prisma } from './prisma.js';

interface CacheEntry {
  buffer: Buffer;
  contentType: string;
  generatedAt: number;
}

const CACHE_MAX = 50;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const cache = new Map<string, CacheEntry>();

const CELL = 256; // pixels par case (4× = 512)
const FULL = CELL * 2;

function lruGet(slug: string): CacheEntry | null {
  const entry = cache.get(slug);
  if (!entry) return null;
  if (Date.now() - entry.generatedAt > CACHE_TTL_MS) {
    cache.delete(slug);
    return null;
  }
  // bump LRU position
  cache.delete(slug);
  cache.set(slug, entry);
  return entry;
}

function lruSet(slug: string, entry: CacheEntry): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(slug, entry);
}

/**
 * Fetch + resize une cover externe → buffer 256×256 JPEG.
 * Retourne null si fetch fail / pas une image valide.
 */
async function fetchAndResizeCover(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      // Timeout court : on ne veut pas bloquer la mosaïque pour 1 cover lente.
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return await sharp(buf)
      .resize(CELL, CELL, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch (err) {
    console.warn('[libraryCover] fetch fail:', url, (err as Error).message);
    return null;
  }
}

/**
 * Génère la mosaïque 2×2 pour une OfficialPlaylist (slug).
 * Lève une erreur si la playlist n'existe pas ou n'a aucune cover dispo.
 *
 * fix/prod-bugs-csp-covers-voice-auth — fallback YouTube thumbnail.
 * En prod, beaucoup de playlists ont été importées AVANT l'ajout du champ
 * cover_url, donc cover_url=NULL pour tous leurs tracks → NO_COVERS → 404
 * massif observé en test PO (30+ requêtes en erreur).
 * Solution self-healing : on prend les 4 premiers tracks (cover_url OU
 * youtube_id non-null) puis on construit l'URL de thumbnail YouTube
 * (`img.youtube.com/vi/{id}/hqdefault.jpg`) si cover_url manque.
 * Évite un backfill DB et fonctionne dès le prochain deploy.
 */
export async function generateLibraryCover(slug: string): Promise<CacheEntry> {
  const t0 = Date.now();
  console.info(`[Cover] /api/library-cover/${slug}.jpg called`);
  const cached = lruGet(slug);
  if (cached) {
    console.info(`[Cover] Cache HIT for slug=${slug}`);
    return cached;
  }
  console.info(`[Cover] Cache MISS for slug=${slug}`);

  const playlist = await prisma.officialPlaylist.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!playlist) {
    console.warn(`[Cover] NOT_FOUND for slug=${slug}`);
    throw new Error('NOT_FOUND');
  }

  const tracks = await prisma.officialPlaylistTrack.findMany({
    where: {
      playlist_id: playlist.id,
      OR: [{ cover_url: { not: null } }, { youtube_id: { not: null } }],
    },
    orderBy: { position: 'asc' },
    take: 4,
    select: { cover_url: true, youtube_id: true },
  });
  if (tracks.length === 0) {
    console.warn(`[Cover] NO_COVERS for slug=${slug} (no track has cover_url or youtube_id)`);
    throw new Error('NO_COVERS');
  }

  // Résout l'URL effective par track : cover_url (Spotify) en priorité,
  // sinon thumbnail YouTube via youtube_id.
  const urls = tracks.map(
    (t) =>
      t.cover_url ??
      (t.youtube_id ? `https://img.youtube.com/vi/${t.youtube_id}/hqdefault.jpg` : null),
  );
  console.info(
    `[Cover] Fetching ${urls.length} thumbnails for playlist=${slug} | sources=${urls.map((u) => (u?.includes('youtube') ? 'YT' : u ? 'SP' : 'NULL')).join(',')}`,
  );

  // Récupère + resize en parallèle.
  const buffers = await Promise.all(
    urls.map((u) => (u ? fetchAndResizeCover(u) : Promise.resolve(null))),
  );
  // Filtre les fails, duplique pour remplir 4 cases.
  const valid = buffers.filter((b): b is Buffer => b !== null);
  if (valid.length === 0) {
    console.warn(`[Cover] All ${urls.length} thumbnail fetches failed for slug=${slug}`);
    throw new Error('NO_COVERS');
  }
  while (valid.length < 4) valid.push(valid[valid.length % valid.length]!);

  // Composite 2×2.
  const composite = await sharp({
    create: {
      width: FULL,
      height: FULL,
      channels: 3,
      background: { r: 26, g: 24, b: 20 }, // #1A1814 ink Tutti
    },
  })
    .composite([
      { input: valid[0]!, left: 0, top: 0 },
      { input: valid[1]!, left: CELL, top: 0 },
      { input: valid[2]!, left: 0, top: CELL },
      { input: valid[3]!, left: CELL, top: CELL },
    ])
    .jpeg({ quality: 85 })
    .toBuffer();

  const entry: CacheEntry = {
    buffer: composite,
    contentType: 'image/jpeg',
    generatedAt: Date.now(),
  };
  lruSet(slug, entry);
  console.info(
    `[Cover] Sharp composite completed for slug=${slug} | size=${Math.round(composite.length / 1024)}KB | elapsed=${Date.now() - t0}ms`,
  );
  return entry;
}

/** Purge cache (utile pour script de regen). */
export function clearLibraryCoverCache(): void {
  cache.clear();
}
