/**
 * Constantes partagées frontend + backend.
 */

/**
 * Taille de manche par défaut (nombre de morceaux JOUÉS dans un round) quand
 * la playlist n'a pas de `default_session_size`. Source UNIQUE pour le backend
 * (enforcement du pick + sérialiseur `getEffectiveRoundTrackCount`) ET le
 * frontend (cap d'affichage pré-lancement). Règle absolue : une manche joue au
 * plus ce nombre de titres — jamais la taille brute du pool de la playlist.
 */
export const DEFAULT_SESSION_SIZE = 15;
