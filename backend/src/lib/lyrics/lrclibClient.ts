/**
 * lrclibClient.ts — client LRCLIB (https://lrclib.net).
 *
 * API publique, sans clé, qui renvoie des paroles synchronisées au format LRC.
 * Choisie parce qu'Apple ne fournit PAS le texte des paroles par API (MusicKit
 * expose seulement `hasLyrics`).
 *
 * GARDE-FOU CENTRAL — « la bonne version, sinon rien » :
 * un candidat synchronisé dont la durée s'écarte de plus de 2 s de la durée
 * Apple n'est JAMAIS retenu (→ `other_version`). C'est ce qui évite d'afficher
 * les paroles d'un remix ou d'un live sur la version studio.
 *
 * ⚠️ Jamais appelé pendant une partie : uniquement par le prefetch hors ligne
 * (cf. prefetchLyrics.ts). Le gameplay ne lit que le cache `track_lyrics`.
 */

const LRCLIB_BASE = 'https://lrclib.net/api';
/** LRCLIB demande une identification claire du client. */
const CLIENT_ID = 'Tutti/1.0 (+https://tuttiparty.app)';
const TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 2;
/** Écart de durée toléré entre la version Apple et celle des paroles. */
export const DURATION_TOLERANCE_MS = 2000;

export interface LrclibResult {
  /** LRC synchronisé, uniquement si `status === 'found'`. */
  lrc: string | null;
  /** Id LRCLIB de l'entrée retenue (traçabilité / re-vérification). */
  sourceId: number | null;
  /** Durée annoncée par LRCLIB, en ms. */
  sourceDurationMs: number | null;
  /**
   * 'found'         : LRC synchronisé de la BONNE version.
   * 'none'          : rien trouvé.
   * 'plain_only'    : paroles non synchronisées seulement → inutilisables ici.
   * 'other_version' : synchronisé trouvé, mais pour une autre version.
   * 'instrumental'  : LRCLIB marque le morceau comme instrumental.
   * 'fetch_error'   : réseau/HTTP en échec après retries.
   */
  status: 'found' | 'none' | 'plain_only' | 'other_version' | 'instrumental' | 'fetch_error';
  error?: string;
}

interface LrclibEntry {
  id?: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number; // en SECONDES côté LRCLIB
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

function headers(): Record<string, string> {
  return {
    'User-Agent': CLIENT_ID,
    'Lrclib-Client': CLIENT_ID,
    Accept: 'application/json',
  };
}

/** GET JSON avec timeout + retries. 404 → `null` (cas nominal, pas une erreur). */
async function getJson<T>(url: string): Promise<T | null> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers: headers(), signal: controller.signal });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Compte les lignes horodatées non vides (départage les candidats). */
function countSyncedLines(lrc: string): number {
  return lrc
    .split(/\r?\n/)
    .filter((l) => /\[\d{1,3}:\d{1,2}/.test(l) && l.replace(/\[[^\]]*\]/g, '').trim().length > 0)
    .length;
}

export interface FetchSyncedLyricsInput {
  artist: string;
  title: string;
  album?: string | null;
  /** Durée de la version PROVIDER (Apple), en ms. Fait autorité. */
  durationMs: number;
}

/**
 * Récupère un LRC synchronisé correspondant EXACTEMENT à la version fournie.
 *
 * 1. `/api/get` — correspondance exacte (artiste + titre + album + durée).
 * 2. En 404 : `/api/search` — on ne garde que les candidats SYNCHRONISÉS dont
 *    la durée est à ±2 s de la durée Apple, puis celui qui a le plus de lignes.
 *
 * Ne fait AUCUN jugement de qualité sur le contenu du LRC : c'est le rôle de
 * `evaluateLrc` (lrc.ts). Ici on ne décide que « bonne version ou pas ».
 */
export async function fetchSyncedLyrics(input: FetchSyncedLyricsInput): Promise<LrclibResult> {
  const { artist, title, album, durationMs } = input;
  const empty: Omit<LrclibResult, 'status'> = { lrc: null, sourceId: null, sourceDurationMs: null };

  try {
    // ── 1. Correspondance exacte ────────────────────────────────────────────
    const params = new URLSearchParams({
      artist_name: artist,
      track_name: title,
      // LRCLIB attend des SECONDES entières.
      duration: String(Math.round(durationMs / 1000)),
    });
    if (album) params.set('album_name', album);

    const exact = await getJson<LrclibEntry>(`${LRCLIB_BASE}/get?${params.toString()}`);
    if (exact) {
      if (exact.instrumental) {
        return { ...empty, status: 'instrumental' };
      }
      if (exact.syncedLyrics && exact.syncedLyrics.trim()) {
        return {
          lrc: exact.syncedLyrics,
          sourceId: exact.id ?? null,
          sourceDurationMs: exact.duration != null ? Math.round(exact.duration * 1000) : null,
          status: 'found',
        };
      }
      if (exact.plainLyrics && exact.plainLyrics.trim()) {
        return { ...empty, sourceId: exact.id ?? null, status: 'plain_only' };
      }
      return { ...empty, sourceId: exact.id ?? null, status: 'none' };
    }

    // ── 2. Repli : recherche + filtre STRICT sur la durée ───────────────────
    const searchParams = new URLSearchParams({ artist_name: artist, track_name: title });
    const found = await getJson<LrclibEntry[]>(`${LRCLIB_BASE}/search?${searchParams.toString()}`);
    if (!found || found.length === 0) return { ...empty, status: 'none' };

    const synced = found.filter((e) => e.syncedLyrics && e.syncedLyrics.trim());
    if (synced.length === 0) {
      const anyPlain = found.some((e) => e.plainLyrics && e.plainLyrics.trim());
      return { ...empty, status: anyPlain ? 'plain_only' : 'none' };
    }

    // LE garde-fou : même durée = même version. Sinon on refuse.
    const sameVersion = synced.filter((e) => {
      if (e.duration == null) return false;
      return Math.abs(Math.round(e.duration * 1000) - durationMs) <= DURATION_TOLERANCE_MS;
    });
    if (sameVersion.length === 0) return { ...empty, status: 'other_version' };

    // À version égale, le LRC le plus complet gagne.
    sameVersion.sort(
      (a, b) => countSyncedLines(b.syncedLyrics!) - countSyncedLines(a.syncedLyrics!),
    );
    const best = sameVersion[0]!;
    return {
      lrc: best.syncedLyrics!,
      sourceId: best.id ?? null,
      sourceDurationMs: best.duration != null ? Math.round(best.duration * 1000) : null,
      status: 'found',
    };
  } catch (err) {
    return {
      ...empty,
      status: 'fetch_error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
