/** P1 shared (throwaway): normalize + strict yt-dlp re-resolver. Read-only. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const pexec = promisify(execFile);

export function norm(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const STOP = new Set([
  'the',
  'and',
  'les',
  'des',
  'los',
  'las',
  'feat',
  'ft',
  'featuring',
  'with',
  'vs',
  'de',
  'du',
  'la',
  'le',
  'el',
  'un',
  'une',
  'a',
  'an',
  'of',
  'et',
  'y',
]);

/** Artistes "placeholder" (mode œuvre) : la reco doit se faire sur le TITRE seul. */
const PLACEHOLDER =
  /bande originale|bande son|b\.?\s?o\.?|g[eé]n[eé]rique|comptine|various|soundtrack|walt disney|\bdisney\b|pixar|dreamworks|traditionnel|inconnu|unknown|karaoke|karaok/i;

/** Artiste principal : coupe sur &, virgule, feat/ft/x/vs. */
export function primaryArtist(artist: string): string {
  return artist
    .split(/\s*(?:&|,|\/|;|\bfeat\b|\bft\b|\bfeaturing\b|\bavec\b|\bx\b|\bvs\b)\s*/i)[0]
    .trim();
}

function sigTokens(s: string, minLen = 3): string[] {
  return norm(s)
    .split(' ')
    .filter((w) => w.length >= minLen && !STOP.has(w));
}

/** Fraction des tokens significatifs du titre présents dans la vidéo. */
function titleCoverage(catalogTitle: string, hay: string): number {
  const toks = sigTokens(catalogTitle, 2);
  if (toks.length === 0) return 1;
  const hit = toks.filter((t) => hay.includes(t)).length;
  return hit / toks.length;
}

export interface Verdict {
  correct: boolean;
  reason: 'ok' | 'title_mismatch' | 'artist_mismatch' | 'removed';
}

/**
 * La vidéo correspond-elle au (artiste, titre) catalogue ? Haute précision
 * (minimise les faux positifs = évite de remplacer une bonne vidéo).
 *  - placeholder artist (BO, Disney…) → validation sur le TITRE seul.
 *  - sinon : le titre doit être couvert (≥60 %) ET l'artiste principal présent
 *    (au moins son token le plus distinctif).
 */
export function classifyVideo(
  catalogArtist: string,
  catalogTitle: string,
  ytTitle: string,
  ytChannel: string,
): Verdict {
  const hay = ' ' + norm(ytTitle + ' ' + ytChannel) + ' ';
  const titleOk = titleCoverage(catalogTitle, hay) >= 0.6;

  if (PLACEHOLDER.test(catalogArtist)) {
    return { correct: titleOk, reason: titleOk ? 'ok' : 'title_mismatch' };
  }

  const primaryToks = sigTokens(primaryArtist(catalogArtist), 3);
  // token le plus distinctif de l'artiste (le plus long) — doit apparaître.
  const distinctive = primaryToks.slice().sort((a, b) => b.length - a.length)[0];
  const artistOk = !distinctive || hay.includes(distinctive);

  if (!titleOk) return { correct: false, reason: 'title_mismatch' };
  if (!artistOk) return { correct: false, reason: 'artist_mismatch' };
  return { correct: true, reason: 'ok' };
}

/** Compat : l'artiste apparaît-il ? (utilisé par le resolver). */
export function artistMatches(artist: string, videoTitle: string, channel: string): boolean {
  const hay = ' ' + norm(videoTitle + ' ' + channel) + ' ';
  const toks = sigTokens(primaryArtist(artist), 3);
  const distinctive = toks.slice().sort((a, b) => b.length - a.length)[0];
  return !distinctive || hay.includes(distinctive);
}

export interface Candidate {
  id: string;
  title: string;
  channel: string;
}

/** Recherche flat (rapide, pas d'extraction complète). */
export async function ytSearch(query: string, n = 8): Promise<Candidate[]> {
  try {
    const { stdout } = await pexec(
      'yt-dlp',
      [
        '--no-warnings',
        '--flat-playlist',
        '--print',
        '%(id)s\t%(title)s\t%(channel)s',
        `ytsearch${n}:${query}`,
      ],
      { timeout: 45000 },
    );
    return stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [id, title, channel] = line.split('\t');
        return { id, title: title ?? '', channel: channel ?? '' };
      });
  } catch {
    return [];
  }
}

const OFFICIAL_RE = /(vevo|official|topic|- topic)/i;

/**
 * Re-résout un couple (artiste, titre) en vidéo valide : le titre de la vidéo
 * doit contenir le titre du morceau ET l'artiste (titre+chaîne). Priorité aux
 * chaînes officielles/VEVO/Topic.
 */
export async function resolveStrict(artist: string, title: string): Promise<Candidate | null> {
  const cands = await ytSearch(`${artist} ${title} official audio`, 8);
  const titleWords = norm(title)
    .split(' ')
    .filter((w) => w.length >= 2);
  const valid = cands.filter((c) => {
    const nt = norm(c.title);
    const titleOk = titleWords.length === 0 || titleWords.every((w) => nt.includes(w));
    return titleOk && artistMatches(artist, c.title, c.channel);
  });
  if (valid.length === 0) return null;
  const official = valid.find((c) => OFFICIAL_RE.test(c.channel) || OFFICIAL_RE.test(c.title));
  return official ?? valid[0];
}
