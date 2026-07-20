/**
 * Spotify allowlist gating — fix/disable-spotify-sdk-non-allowlist
 *
 * Le Spotify Web Playback SDK est lourd, génère des erreurs DOM cleanup
 * cascades (NotFoundError) en transition end-round/end-session, et n'est
 * pas le provider principal post-pivot YouTube-only de la bibliothèque
 * officielle.
 *
 * Cette gate restreint le chargement du SDK Spotify aux seuls comptes
 * explicitement allowlistés (Thomas + 4 testeurs). Tous les autres users
 * n'ont AUCUN appel /api/providers/spotify/*, AUCUN script
 * https://sdk.scdn.co/spotify-player.js chargé, ZÉRO log [Spotify SDK].
 *
 * V1 — liste d'emails via env variable SPOTIFY_ALLOWLIST_EMAILS
 * (séparateur `,`). Mêmes sémantiques que SUPER_ADMIN_EMAILS.
 *
 * V2 (futur) — colonne DB `spotify_allowlist BOOLEAN` sur WorkspaceMember
 * éditable depuis /admin/super-admin si besoin gestion dynamique.
 */

/**
 * Allowlist intégrée au code (en plus de SPOTIFY_ALLOWLIST_EMAILS). Permet de
 * débloquer des comptes sans dépendre d'une config Railway. Emails en
 * minuscules (le check normalise aussi l'entrée). Match sur l'EMAIL DE LOGIN
 * Tutti (req.userEmail), pas sur l'email du compte Spotify.
 */
const BUILTIN_ALLOWLIST_EMAILS = ['thomaspinon@gmail.com', 'contact@komptoir.lu'];

function parseEmails(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

let cached: Set<string> | null = null;

function getEmails(): Set<string> {
  if (cached) return cached;
  // Union de l'allowlist intégrée + celle de l'env (les deux sources cumulent).
  cached = new Set([
    ...BUILTIN_ALLOWLIST_EMAILS,
    ...parseEmails(process.env.SPOTIFY_ALLOWLIST_EMAILS),
  ]);
  return cached;
}

export function isSpotifyAllowlisted(email: string | null | undefined): boolean {
  if (!email) return false;
  return getEmails().has(email.toLowerCase());
}

/** Pour les tests / hot reload — vide le cache. */
export function _resetSpotifyAllowlistCache(): void {
  cached = null;
}
