/**
 * playlistCache.ts — feat/playlist-cache-and-availability-check
 *
 * Cache in-memory pour le détail des playlists (workspace + officielle).
 * Évite de refaire le payload complet et les vérifications dérivées à chaque
 * lancement de session.
 *
 * Stratégie :
 *   - clé      : playlist_id (string UUID)
 *   - valeur   : { payload, cached_at, playlist_updated_at }
 *   - TTL      : 6h glissantes (CACHE_TTL_MS)
 *   - invalid. : auto si `playlist_updated_at` cache ≠ `playlist_updated_at`
 *                fourni au .get() — détecte une modif côté DB sans avoir à
 *                broadcaster un événement d'invalidation
 *
 * Mémoire seulement (Railway = 1 instance backend en V1) :
 *   - pas de Redis nécessaire pour l'instant
 *   - si le serveur redémarre (deploy), le cache est purgé → MISS naturel
 *   - migration future vers Redis = remplacer l'impl de Map par ioredis,
 *     interface inchangée
 *
 * Logs explicites pour debug :
 *   [Cache] HIT  playlist_id=<id> cached_at=<...>
 *   [Cache] MISS playlist_id=<id> computing fresh (reason=<...>)
 *   [Cache] INVALIDATED playlist_id=<id> reason=updated_at_changed
 */

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

interface CacheEntry<T> {
  payload: T;
  cached_at: number; // Date.now()
  /** ISO string. Comparaison strict equal pour détecter une modif côté DB. */
  playlist_updated_at: string;
}

const store = new Map<string, CacheEntry<unknown>>();

/**
 * Lecture cache avec check de fraîcheur ET version (updated_at). Retourne
 * null sur MISS / TTL expiré / version stale.
 *
 * @param key                 playlist_id
 * @param currentUpdatedAt    valeur DB actuelle (Playlist.updated_at). Si
 *                            différente de la version cachée → invalidation
 *                            auto avant retour null.
 */
export function getCachedPlaylist<T>(key: string, currentUpdatedAt: Date | string): T | null {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) {
    console.info(`[Cache] MISS playlist_id=${key} reason=no_entry`);
    return null;
  }
  const ageMs = Date.now() - entry.cached_at;
  if (ageMs > CACHE_TTL_MS) {
    store.delete(key);
    console.info(`[Cache] MISS playlist_id=${key} reason=ttl_expired ageMs=${ageMs}`);
    return null;
  }
  const currentIso =
    currentUpdatedAt instanceof Date ? currentUpdatedAt.toISOString() : currentUpdatedAt;
  if (entry.playlist_updated_at !== currentIso) {
    store.delete(key);
    console.info(
      `[Cache] INVALIDATED playlist_id=${key} reason=updated_at_changed cached=${entry.playlist_updated_at} current=${currentIso}`,
    );
    return null;
  }
  console.info(
    `[Cache] HIT  playlist_id=${key} cached_at=${new Date(entry.cached_at).toISOString()} ageMs=${ageMs}`,
  );
  return entry.payload;
}

/**
 * Stocke un payload sous une clé playlist_id + version. Écrase si déjà
 * présent. Ne fait pas de check de TTL (assumé fresh au moment du set).
 */
export function setCachedPlaylist<T>(
  key: string,
  payload: T,
  playlistUpdatedAt: Date | string,
): void {
  const playlist_updated_at =
    playlistUpdatedAt instanceof Date ? playlistUpdatedAt.toISOString() : playlistUpdatedAt;
  store.set(key, {
    payload,
    cached_at: Date.now(),
    playlist_updated_at,
  });
  console.info(`[Cache] SET  playlist_id=${key} updated_at=${playlist_updated_at}`);
}

/**
 * Invalide explicitement une entrée. Appelé par les endpoints qui mutent
 * la playlist (PATCH name/desc, check-availability) pour forcer un MISS
 * au prochain accès même si updated_at n'a pas encore été flush en DB.
 */
export function invalidateCachedPlaylist(key: string, reason: string): void {
  const had = store.delete(key);
  if (had) {
    console.info(`[Cache] INVALIDATED playlist_id=${key} reason=${reason}`);
  }
}

/** Pour les tests + diagnostic admin éventuel. */
export function getCacheStats(): { size: number; ttlMs: number } {
  return { size: store.size, ttlMs: CACHE_TTL_MS };
}

/** Tests uniquement — purge tout. NE PAS APPELER EN PROD. */
export function _clearCacheForTests(): void {
  store.clear();
}
