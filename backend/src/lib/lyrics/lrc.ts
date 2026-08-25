/**
 * lrc.ts — parsing et VALIDATION QUALITÉ du format LRC.
 *
 * Règle produit (non négociable) : on n'affiche que des paroles propres. Ce
 * fichier est le filtre qui décide si un LRC est affichable en soirée. En cas
 * de doute → on rejette (pas de bouton « Paroles ») plutôt que d'afficher des
 * paroles décalées devant une salle.
 *
 * Format LRC : chaque ligne est `[mm:ss.xx] texte`, avec possiblement PLUSIEURS
 * timestamps pour un même texte (refrain répété). Les tags de métadonnées
 * (`[ar:]`, `[ti:]`, `[al:]`, `[by:]`, `[offset:]`, `[length:]`…) sont ignorés.
 */

export interface LrcLine {
  /** Timestamp de la ligne, en millisecondes depuis le début du morceau. */
  t_ms: number;
  /** Texte de la ligne (peut être vide = silence/interlude). */
  text: string;
}

export interface LrcEvaluation {
  ok: boolean;
  /** Raison du rejet — vocabulaire aligné sur track_lyrics.reason. */
  reason?: string;
  /** Nombre de lignes horodatées NON VIDES. */
  lineCount: number;
}

/** Tags de métadonnées LRC (pas des paroles) — ignorés au parsing. */
const METADATA_TAG = /^(ar|ti|al|au|by|offset|length|re|ve|tool|#)$/i;

/** `[mm:ss.xx]`, `[mm:ss.xxx]` ou `[mm:ss]`. */
const TIMESTAMP_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/**
 * Parse un LRC en lignes horodatées, triées par temps croissant.
 *
 * - Gère plusieurs timestamps sur une même ligne (`[00:12.00][01:04.00] refrain`)
 *   → une entrée par timestamp.
 * - Ignore les tags de métadonnées.
 * - Conserve les lignes VIDES horodatées : elles marquent les interludes, ce qui
 *   permet à l'overlay d'effacer le texte pendant un solo au lieu de laisser la
 *   dernière phrase affichée.
 */
export function parseLrc(lrc: string): LrcLine[] {
  if (!lrc) return [];
  const out: LrcLine[] = [];

  for (const rawLine of lrc.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    // Tag de métadonnée pur : `[ar:Artiste]` → aucun timestamp exploitable.
    const metaMatch = line.match(/^\[([a-zA-Z#]+):/);
    if (metaMatch && METADATA_TAG.test(metaMatch[1] ?? '')) continue;

    TIMESTAMP_RE.lastIndex = 0;
    const stamps: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = TIMESTAMP_RE.exec(line)) !== null) {
      const min = Number.parseInt(m[1] ?? '0', 10);
      const sec = Number.parseInt(m[2] ?? '0', 10);
      const fracRaw = m[3] ?? '';
      // `.9` = 900 ms, `.99` = 990 ms, `.999` = 999 ms.
      const frac = fracRaw ? Number.parseInt(fracRaw.padEnd(3, '0').slice(0, 3), 10) : 0;
      if (!Number.isFinite(min) || !Number.isFinite(sec)) continue;
      stamps.push(min * 60_000 + sec * 1000 + frac);
    }
    if (stamps.length === 0) continue;

    // Le texte = ce qui reste une fois TOUS les timestamps retirés.
    const text = line.replace(TIMESTAMP_RE, '').trim();
    for (const t_ms of stamps) out.push({ t_ms, text });
  }

  out.sort((a, b) => a.t_ms - b.t_ms);
  return out;
}

/** Longueur max d'une ligne — au-delà, c'est un bloc de texte, pas du LRC. */
const MAX_LINE_LENGTH = 200;
/** Minimum de lignes chantées pour que l'affichage ait un intérêt. */
const MIN_LINES = 8;
/** La 1ʳᵉ parole doit arriver dans la 1ʳᵉ moitié du morceau. */
const FIRST_LINE_MAX_RATIO = 0.5;
/** Tolérance de dépassement du dernier timestamp au-delà de la durée. */
const LAST_LINE_GRACE_MS = 3000;

/**
 * Décide si un LRC est AFFICHABLE pour un morceau de `providerDurationMs`.
 *
 * Chaque rejet renvoie une `reason` du vocabulaire de track_lyrics :
 *   - `too_few_lines`  : moins de 8 lignes chantées
 *   - `non_monotonic`  : timestamps décroissants (fichier corrompu)
 *   - `out_of_range`   : 1ʳᵉ ligne trop tardive, ou fin au-delà de la durée
 *                        (= paroles d'une AUTRE version du morceau)
 *   - `plain_only`     : du HTML ou des lignes trop longues → pas du vrai LRC
 */
export function evaluateLrc(lrc: string, providerDurationMs: number): LrcEvaluation {
  const lines = parseLrc(lrc);
  const sung = lines.filter((l) => l.text.length > 0);

  if (sung.length < MIN_LINES) {
    return { ok: false, reason: 'too_few_lines', lineCount: sung.length };
  }

  // parseLrc trie déjà ; on vérifie la source AVANT tri pour détecter un
  // fichier corrompu (timestamps dans le désordre = synchro non fiable).
  const rawOrder: number[] = [];
  TIMESTAMP_RE.lastIndex = 0;
  for (const rawLine of lrc.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const metaMatch = line.match(/^\[([a-zA-Z#]+):/);
    if (metaMatch && METADATA_TAG.test(metaMatch[1] ?? '')) continue;
    TIMESTAMP_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    let first: number | null = null;
    while ((m = TIMESTAMP_RE.exec(line)) !== null) {
      const min = Number.parseInt(m[1] ?? '0', 10);
      const sec = Number.parseInt(m[2] ?? '0', 10);
      const fracRaw = m[3] ?? '';
      const frac = fracRaw ? Number.parseInt(fracRaw.padEnd(3, '0').slice(0, 3), 10) : 0;
      if (first === null) first = min * 60_000 + sec * 1000 + frac;
    }
    if (first !== null) rawOrder.push(first);
  }
  for (let i = 1; i < rawOrder.length; i += 1) {
    if ((rawOrder[i] ?? 0) < (rawOrder[i - 1] ?? 0)) {
      return { ok: false, reason: 'non_monotonic', lineCount: sung.length };
    }
  }

  // HTML ou lignes-fleuves → ce n'est pas un LRC propre.
  for (const l of sung) {
    if (l.text.includes('<')) {
      return { ok: false, reason: 'plain_only', lineCount: sung.length };
    }
    if (l.text.length > MAX_LINE_LENGTH) {
      return { ok: false, reason: 'plain_only', lineCount: sung.length };
    }
  }

  // Bornes temporelles : détecte les paroles d'une autre version (intro
  // rallongée, edit plus court…), même si la durée annoncée collait.
  if (providerDurationMs > 0) {
    const firstSung = sung[0]!;
    if (firstSung.t_ms > providerDurationMs * FIRST_LINE_MAX_RATIO) {
      return { ok: false, reason: 'out_of_range', lineCount: sung.length };
    }
    const last = sung[sung.length - 1]!;
    if (last.t_ms > providerDurationMs + LAST_LINE_GRACE_MS) {
      return { ok: false, reason: 'out_of_range', lineCount: sung.length };
    }
  }

  return { ok: true, lineCount: sung.length };
}
