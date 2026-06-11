/**
 * songCatalog.ts — feat/canonical-song-catalog
 *
 * Catalogue canonique de chansons. Principe : les aliases appartiennent à la
 * CHANSON (titre+artiste), pas au videoId — la même chanson existe sous
 * plusieurs liens YouTube (clip, audio, lyric video, re-upload).
 *
 * Entités :
 *   - Song   : (artist_id, canonical_title, normalized_key UNIQUE,
 *              title_aliases[]). Source de vérité des aliases TITRE.
 *   - Artist : déjà dédupliqué par canonical_name. Source de vérité des
 *              aliases ARTISTE.
 *   - tracks / official_playlist_tracks : pointeurs (song_id) — un videoId
 *              par row, plusieurs rows peuvent pointer la même Song.
 *
 * Lookup à l'ingest (ordre) :
 *   1. videoId exact (fast path — via tracks.provider_track_id ou
 *      official_playlist_tracks.youtube_id déjà liés à une song)
 *   2. normalized_key (titre+artiste normalisés)
 *   3. rien → chanson inédite (création + génération aliases async)
 *
 * Génération asynchrone NON-bloquante : l'ingest répond immédiatement (le
 * fuzzy-match vocal sert de fallback pendant la latence), le job écrit au
 * CATALOGUE (Song/Artist) puis recopie vers la track workspace. Idempotent :
 * skip si title_aliases déjà remplis. Retry 1× sur échec API.
 */

import { prisma } from './prisma.js';
import { generateAliases, generateArtistAliases } from './aliasGeneration.js';

// ───── Normalisation ───────────────────────────────────────────────────────

/** Suffixes parasites fréquents dans les titres YouTube/Spotify. */
const NOISE_PATTERNS: RegExp[] = [
  /\((official\s*)?(music\s*)?(video|audio|clip|visualizer|lyric(s)?\s*video)\)/gi,
  /\[(official\s*)?(music\s*)?(video|audio|clip|visualizer|lyric(s)?\s*video)\]/gi,
  /\((clip\s*)?officiel(le)?\)/gi,
  /\[(clip\s*)?officiel(le)?\]/gi,
  /\(remaster(ed|isé)?\s*\d{0,4}\)/gi,
  /\[remaster(ed|isé)?\s*\d{0,4}\]/gi,
  /\b(remaster(ed|isé)?)\s*\d{4}\b/gi,
  /\((radio\s*edit|single\s*version|album\s*version|mono|stereo)\)/gi,
  /\((from|de)\s+[^)]*\)/gi, // "(from 'Movie')"
  /\(\s*\d{4}\s*\)/g, // "(1999)"
  /\bHD\b|\b4K\b/g,
];

/** Sépare la partie "feat./ft./featuring X" — exclue de la clé de matching
 *  mais conservée dans le canonical. */
const FEAT_REGEX = /\s*[([]?\s*(?:feat\.?|ft\.?|featuring|avec)\s+[^)\]]*[)\]]?\s*$/i;

export function stripFeat(s: string): string {
  return s.replace(FEAT_REGEX, '').trim();
}

/** Normalise une chaîne pour la clé de matching : lowercase, accents strip,
 *  suffixes parasites retirés, ponctuation strip, espaces collapsés. */
export function normalizeForKey(s: string): string {
  let out = s;
  for (const re of NOISE_PATTERNS) out = out.replace(re, ' ');
  out = stripFeat(out);
  out = out
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accents
    .replace(/['']/g, '') // apostrophes (don't → dont)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ') // ponctuation → espace
    .replace(/\s+/g, ' ')
    .trim();
  return out;
}

/** Clé canonique d'une chanson : norm(artiste)|norm(titre). */
export function songKey(artist: string, title: string): string {
  return `${normalizeForKey(artist)}|${normalizeForKey(title)}`.slice(0, 300);
}

// ───── Lookup ──────────────────────────────────────────────────────────────

export interface SongLookupResult {
  songId: string;
  titleAliases: string[];
  artistId: string;
  artistAliases: string[];
  /** 'video_id' | 'normalized_key' | 'created' — comment on a matché. */
  matchedBy: 'video_id' | 'normalized_key' | 'created';
}

/**
 * Fast path : retrouve la Song d'un videoId déjà connu (workspace track OU
 * catalogue). null si le videoId n'est lié à aucune song.
 */
async function findSongByVideoId(videoId: string): Promise<string | null> {
  const ws = await prisma.track.findFirst({
    where: { provider: 'youtube', provider_track_id: videoId, song_id: { not: null } },
    select: { song_id: true },
  });
  if (ws?.song_id) return ws.song_id;
  const cat = await prisma.officialPlaylistTrack.findFirst({
    where: { youtube_id: videoId, song_id: { not: null } },
    select: { song_id: true },
  });
  return cat?.song_id ?? null;
}

/**
 * Trouve ou crée la chanson canonique. Ne génère PAS d'aliases ici — la
 * génération async est de la responsabilité du caller (ingestTrackAliases)
 * pour rester non-bloquant.
 */
export async function findOrCreateSong(params: {
  title: string;
  artist: string;
  videoId?: string | null;
}): Promise<SongLookupResult> {
  // 1. Fast path videoId
  if (params.videoId) {
    const songId = await findSongByVideoId(params.videoId);
    if (songId) {
      const song = await prisma.song.findUnique({
        where: { id: songId },
        select: {
          id: true,
          title_aliases: true,
          artist: { select: { id: true, aliases: true } },
        },
      });
      if (song) {
        return {
          songId: song.id,
          titleAliases: song.title_aliases,
          artistId: song.artist.id,
          artistAliases: song.artist.aliases,
          matchedBy: 'video_id',
        };
      }
    }
  }

  // 2. normalized_key
  const key = songKey(params.artist, params.title);
  const existing = await prisma.song.findUnique({
    where: { normalized_key: key },
    select: {
      id: true,
      title_aliases: true,
      artist: { select: { id: true, aliases: true } },
    },
  });
  if (existing) {
    return {
      songId: existing.id,
      titleAliases: existing.title_aliases,
      artistId: existing.artist.id,
      artistAliases: existing.artist.aliases,
      matchedBy: 'normalized_key',
    };
  }

  // 3. Inédit — upsert Artist (P2002-safe) + create Song (P2002-safe : si un
  // ingest concurrent vient de créer la même song, on la relit).
  let artist: { id: string; aliases: string[] };
  try {
    artist = await prisma.artist.upsert({
      where: { canonical_name: params.artist },
      create: { canonical_name: params.artist },
      update: {},
      select: { id: true, aliases: true },
    });
  } catch (err) {
    if ((err as { code?: string })?.code !== 'P2002') throw err;
    const found = await prisma.artist.findUnique({
      where: { canonical_name: params.artist },
      select: { id: true, aliases: true },
    });
    if (!found) throw err;
    artist = found;
  }

  try {
    const song = await prisma.song.create({
      data: {
        artist_id: artist.id,
        canonical_title: params.title,
        normalized_key: key,
      },
      select: { id: true },
    });
    return {
      songId: song.id,
      titleAliases: [],
      artistId: artist.id,
      artistAliases: artist.aliases,
      matchedBy: 'created',
    };
  } catch (err) {
    if ((err as { code?: string })?.code !== 'P2002') throw err;
    const raced = await prisma.song.findUnique({
      where: { normalized_key: key },
      select: { id: true, title_aliases: true },
    });
    if (!raced) throw err;
    return {
      songId: raced.id,
      titleAliases: raced.title_aliases,
      artistId: artist.id,
      artistAliases: artist.aliases,
      matchedBy: 'normalized_key',
    };
  }
}

// ───── Alias-on-ingest ─────────────────────────────────────────────────────

/** Merge util — union dédupliquée, conserve l'ordre existant d'abord. */
function mergeAliases(existing: string[], incoming: string[]): string[] {
  return Array.from(new Set([...existing, ...incoming]));
}

/**
 * Copie les aliases canoniques (Song + Artist) vers une track workspace.
 * No-op partiel si la song n'a pas encore d'aliases (génération en cours).
 */
async function copyAliasesToWorkspaceTrack(
  trackId: string,
  artistId: string,
  titleAliases: string[],
  artistAliases: string[],
): Promise<void> {
  if (titleAliases.length > 0) {
    const t = await prisma.track.findUnique({ where: { id: trackId }, select: { aliases: true } });
    if (t) {
      const merged = mergeAliases(t.aliases, titleAliases);
      if (merged.length !== t.aliases.length) {
        await prisma.track.update({
          where: { id: trackId },
          data: { aliases: merged, aliases_source: 'catalog', aliases_generated_at: new Date() },
        });
      }
    }
  }
  if (artistAliases.length > 0) {
    const a = await prisma.artist.findUnique({
      where: { id: artistId },
      select: { aliases: true },
    });
    if (a) {
      const merged = mergeAliases(a.aliases, artistAliases);
      if (merged.length !== a.aliases.length) {
        await prisma.artist.update({
          where: { id: artistId },
          data: { aliases: merged, aliases_source: 'catalog', aliases_generated_at: new Date() },
        });
      }
    }
  }
}

/**
 * Job async : génère les aliases manquants pour une Song (titre) et/ou son
 * Artist, écrit au CATALOGUE, puis recopie vers la track workspace.
 * Idempotent (skip si déjà remplis). Retry 1× par appel API.
 *
 * Cas gérés :
 *   - artiste connu + chanson nouvelle → génère le TITRE seul
 *   - tout inédit → génère titre + artiste
 */
async function generateMissingAliasesJob(args: {
  songId: string;
  artistId: string;
  title: string;
  artist: string;
  workspaceTrackId?: string;
}): Promise<void> {
  const tag = `[SongCatalog] song=${args.songId.slice(0, 8)}`;
  try {
    const song = await prisma.song.findUnique({
      where: { id: args.songId },
      select: { title_aliases: true },
    });
    const artistRow = await prisma.artist.findUnique({
      where: { id: args.artistId },
      select: { aliases: true },
    });
    if (!song || !artistRow) return;

    let titleAliases = song.title_aliases;
    let artistAliases = artistRow.aliases;

    // Titre manquant → génère (retry 1×)
    if (titleAliases.length === 0) {
      let r = await generateAliases(args.title, args.artist);
      if (r.error || r.aliases.length === 0) {
        r = await generateAliases(args.title, args.artist);
      }
      if (r.aliases.length > 0) {
        titleAliases = r.aliases;
        await prisma.song.update({
          where: { id: args.songId },
          data: { title_aliases: titleAliases, aliases_source: 'ai' },
        });
        console.info(`${tag} title aliases générés (${titleAliases.length})`);
      } else {
        console.warn(`${tag} génération titre échouée après retry : ${r.error ?? 'vide'}`);
      }
    }

    // Artiste manquant → génère (retry 1×). Artiste déjà connu = skip → on
    // ne paye QUE le titre pour une chanson nouvelle d'un artiste connu.
    if (artistAliases.length === 0) {
      let r = await generateArtistAliases(args.artist);
      if (r.error || r.aliases.length === 0) {
        r = await generateArtistAliases(args.artist);
      }
      if (r.aliases.length > 0) {
        artistAliases = r.aliases;
        await prisma.artist.update({
          where: { id: args.artistId },
          data: {
            aliases: artistAliases,
            aliases_source: 'ai',
            aliases_generated_at: new Date(),
          },
        });
        console.info(`${tag} artist aliases générés (${artistAliases.length})`);
      } else {
        console.warn(`${tag} génération artiste échouée après retry : ${r.error ?? 'vide'}`);
      }
    }

    if (args.workspaceTrackId) {
      await copyAliasesToWorkspaceTrack(
        args.workspaceTrackId,
        args.artistId,
        titleAliases,
        artistAliases,
      );
    }
  } catch (err) {
    console.error(`${tag} job error:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Point d'entrée ingest — appelé quand une track entre dans un workspace
 * (ajout custom host, clone, sync). NON-bloquant : retourne immédiatement
 * les aliases déjà connus (copie gratuite), déclenche la génération async
 * pour ce qui manque.
 *
 * @returns aliases connus à copier de façon synchrone (peut être vide).
 */
export async function ingestTrackAliases(params: {
  title: string;
  artist: string;
  videoId?: string | null;
  /** Track workspace à enrichir quand la génération async aboutit. */
  workspaceTrackId?: string;
}): Promise<SongLookupResult> {
  const result = await findOrCreateSong(params);

  const needsGeneration = result.titleAliases.length === 0 || result.artistAliases.length === 0;
  if (needsGeneration) {
    // Fire-and-forget : la réponse HTTP ne doit pas attendre Claude.
    // Single-instance Railway → un setImmediate suffit (pas de queue infra).
    setImmediate(() => {
      void generateMissingAliasesJob({
        songId: result.songId,
        artistId: result.artistId,
        title: params.title,
        artist: params.artist,
        workspaceTrackId: params.workspaceTrackId,
      });
    });
  } else if (params.workspaceTrackId) {
    // Tout est connu → copie synchrone immédiate (0 appel Claude).
    await copyAliasesToWorkspaceTrack(
      params.workspaceTrackId,
      result.artistId,
      result.titleAliases,
      result.artistAliases,
    );
  }
  return result;
}
