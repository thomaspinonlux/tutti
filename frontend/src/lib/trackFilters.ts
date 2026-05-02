/**
 * Filtres Tutti transverses appliqués aux résultats Spotify avant import :
 *   - Détection de versions non-standard (remix, live, acoustic, etc.)
 *   - Bornes de durée min/max (1:30 → 6:00 par défaut)
 *   - Marquage de doublons (déjà dans une autre playlist Tutti)
 *
 * Tous les filtres sont "soft" : ils décochent la track par défaut mais
 * l'utilisateur peut forcer l'inclusion via la checkbox.
 */

const REMIX_KEYWORDS_RX =
  /\b(remix(ed)?|mix|live|en concert|acoustic|acoustique|demo|instrumental|karaok[eé]|cover|edit|radio edit|extended|club mix|version)\b/iu;

export const DEFAULT_MIN_DURATION_MS = 90_000; // 1:30
export const DEFAULT_MAX_DURATION_MS = 360_000; // 6:00

export interface TrackFlags {
  isRemix: boolean;
  outsideDurationRange: boolean;
  isDuplicate: boolean;
  duplicatePlaylistName: string | null;
}

export interface FilterOptions {
  minDurationMs: number;
  maxDurationMs: number;
  excludeRemixes: boolean;
  excludeDuplicates: boolean;
  excludeOutsideDuration: boolean;
}

export const DEFAULT_FILTER_OPTIONS: FilterOptions = {
  minDurationMs: DEFAULT_MIN_DURATION_MS,
  maxDurationMs: DEFAULT_MAX_DURATION_MS,
  excludeRemixes: true,
  excludeDuplicates: true,
  excludeOutsideDuration: true,
};

/** Évalue les flags pour un track donné. */
export function computeTrackFlags(
  track: { title: string; duration_ms?: number | null },
  duplicateInfo: { duplicate: boolean; existing_playlist: { playlist_name: string } | null } | null,
  options: FilterOptions,
): TrackFlags {
  const isRemix = REMIX_KEYWORDS_RX.test(track.title);
  const dur = track.duration_ms ?? 0;
  const outsideDurationRange =
    dur > 0 && (dur < options.minDurationMs || dur > options.maxDurationMs);
  return {
    isRemix,
    outsideDurationRange,
    isDuplicate: duplicateInfo?.duplicate ?? false,
    duplicatePlaylistName: duplicateInfo?.existing_playlist?.playlist_name ?? null,
  };
}

/**
 * Décide si une track doit être pré-cochée par défaut (à l'arrivée des
 * résultats). Si elle est flagged + le filtre est actif, on décoche.
 */
export function isPreSelected(flags: TrackFlags, options: FilterOptions): boolean {
  if (options.excludeRemixes && flags.isRemix) return false;
  if (options.excludeOutsideDuration && flags.outsideDurationRange) return false;
  if (options.excludeDuplicates && flags.isDuplicate) return false;
  return true;
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  const min = Math.floor(s / 60);
  const sec = s % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}
