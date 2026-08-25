/**
 * lyrics.ts — parsing LRC + récupération des paroles du morceau courant.
 *
 * NB : `parseLrc` duplique volontairement backend/src/lib/lyrics/lrc.ts.
 * Le partager via @tutti/shared imposerait de refactorer le module backend
 * (qui l'utilise avec `evaluateLrc`, resté serveur car il dépend de la durée
 * Apple). La copie est ~50 lignes sans dépendance : le coût de la duplication
 * est inférieur à celui du couplage. Toute correction doit être portée des
 * deux côtés — les tests backend (lrc.test.ts) font foi sur le comportement.
 */

import { api } from './api.js';

export interface LrcLine {
  t_ms: number;
  text: string;
}

const METADATA_TAG = /^(ar|ti|al|au|by|offset|length|re|ve|tool|#)$/i;
const TIMESTAMP_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/** Parse un LRC en lignes horodatées triées. Cf. backend lrc.ts. */
export function parseLrc(lrc: string): LrcLine[] {
  if (!lrc) return [];
  const out: LrcLine[] = [];

  for (const rawLine of lrc.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const metaMatch = line.match(/^\[([a-zA-Z#]+):/);
    if (metaMatch && METADATA_TAG.test(metaMatch[1] ?? '')) continue;

    TIMESTAMP_RE.lastIndex = 0;
    const stamps: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = TIMESTAMP_RE.exec(line)) !== null) {
      const min = Number.parseInt(m[1] ?? '0', 10);
      const sec = Number.parseInt(m[2] ?? '0', 10);
      const fracRaw = m[3] ?? '';
      const frac = fracRaw ? Number.parseInt(fracRaw.padEnd(3, '0').slice(0, 3), 10) : 0;
      if (!Number.isFinite(min) || !Number.isFinite(sec)) continue;
      stamps.push(min * 60_000 + sec * 1000 + frac);
    }
    if (stamps.length === 0) continue;

    const text = line.replace(TIMESTAMP_RE, '').trim();
    for (const t_ms of stamps) out.push({ t_ms, text });
  }

  out.sort((a, b) => a.t_ms - b.t_ms);
  return out;
}

/**
 * Index de la ligne active à `positionMs` (recherche binaire — appelée à chaque
 * frame d'animation, elle doit rester O(log n)).
 *
 * Renvoie -1 avant la première ligne (l'overlay affiche alors « ♪ ♪ ♪ »).
 */
export function findLineIndex(lines: LrcLine[], positionMs: number): number {
  if (lines.length === 0) return -1;
  if (positionMs < (lines[0]?.t_ms ?? 0)) return -1;

  let lo = 0;
  let hi = lines.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((lines[mid]?.t_ms ?? 0) <= positionMs) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

export interface CurrentLyricsResponse {
  provider_track_id: string;
  lrc: string;
}

/**
 * Paroles du morceau courant d'une session.
 *
 * Le serveur REFUSE (403) tant que le morceau n'est pas révélé : on ne peut
 * donc pas s'en servir pour tricher. Renvoie null sur tout échec (403/404/
 * réseau) — l'appelant n'affiche simplement rien.
 */
export async function fetchCurrentLyrics(shortCode: string): Promise<LrcLine[] | null> {
  if (!shortCode) return null;
  try {
    const res = await api<CurrentLyricsResponse>(
      `/api/sessions/by-code/${encodeURIComponent(shortCode.toUpperCase())}/lyrics/current`,
      { anonymous: true },
    );
    const lines = parseLrc(res.lrc);
    return lines.length > 0 ? lines : null;
  } catch {
    return null;
  }
}
