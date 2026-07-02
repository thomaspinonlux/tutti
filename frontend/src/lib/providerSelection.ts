/**
 * Helper de sélection provider audio pour les morceaux de la bibliothèque
 * officielle Tutti.
 *
 * Logique brief Sujet 3 :
 *   if hostAccounts.spotify.connected && spotify.premium && track.spotify_id:
 *     return { provider: 'spotify', id: track.spotify_id }
 *   if hostAccounts.youtube.connected && track.youtube_id:
 *     return { provider: 'youtube', id: track.youtube_id }
 *   return { provider: null, error: 'NO_PROVIDER_AVAILABLE' }
 *
 * V1 hypothèse : connexion Spotify ⇒ Premium (Web Playback SDK le requiert).
 * Pas de check premium séparé côté frontend.
 *
 * Utilisé pour :
 *   - Pré-calculer la disponibilité d'une playlist côté UI (Sujet 4 modal preview)
 *   - Choisir le preferProvider à passer à POST /api/library/playlists/:id/launch
 */

export interface HostProviders {
  spotify: { connected: boolean; premium?: boolean };
  youtube: { connected: boolean; premium?: boolean };
}

export interface LibraryTrackProviderIds {
  spotify_id: string | null;
  youtube_id: string | null;
}

export type ProviderChoice =
  | { provider: 'spotify'; id: string }
  | { provider: 'youtube'; id: string }
  | { provider: null; error: 'NO_PROVIDER_AVAILABLE' };

export function selectProvider(
  track: LibraryTrackProviderIds,
  host: HostProviders,
): ProviderChoice {
  if (host.spotify.connected && track.spotify_id) {
    return { provider: 'spotify', id: track.spotify_id };
  }
  if (host.youtube.connected && track.youtube_id) {
    return { provider: 'youtube', id: track.youtube_id };
  }
  return { provider: null, error: 'NO_PROVIDER_AVAILABLE' };
}

/**
 * Préfère Spotify si dispo, sinon YouTube. Utilisé pour le param
 * `preferProvider` envoyé à POST /launch — backend choisit ensuite par track
 * avec fallback intégré.
 */
export function preferredProvider(host: HostProviders): 'spotify' | 'youtube' | null {
  // Pivot YouTube-only — Spotify sorti du flow officiel. On exige
  // YouTube connecté ; ignore Spotify même si dispo.
  if (host.youtube.connected) return 'youtube';
  return null;
}

/**
 * Compte les tracks "jouables" avec les comptes connectés du host.
 * Utilisé pour le modal preview (Sujet 4) :
 *   "Avec ton compte Spotify Premium : 15/15 jouables"
 */
export interface PlayabilityReport {
  total: number;
  playable: number;
  via_spotify: number;
  via_youtube: number;
}

export function computePlayability(
  tracks: LibraryTrackProviderIds[],
  host: HostProviders,
  // feat/watertight-provider — source ACTIVE (toggle UI). Si fournie, compte
  // STRICTEMENT cette source (mondes étanches) : mode youtube → seuls les
  // youtube_id comptent (via_spotify = 0) ; mode spotify → inverse. Sans elle →
  // legacy (selectProvider spotify-first). L'aperçu doit refléter la source.
  forceProvider?: 'youtube' | 'spotify',
): PlayabilityReport {
  let playable = 0;
  let viaSpotify = 0;
  let viaYouTube = 0;
  for (const t of tracks) {
    let provider: 'spotify' | 'youtube' | null;
    if (forceProvider === 'youtube') {
      provider = host.youtube.connected && t.youtube_id ? 'youtube' : null;
    } else if (forceProvider === 'spotify') {
      provider = host.spotify.connected && t.spotify_id ? 'spotify' : null;
    } else {
      provider = selectProvider(t, host).provider;
    }
    if (provider === 'spotify') {
      playable += 1;
      viaSpotify += 1;
    } else if (provider === 'youtube') {
      playable += 1;
      viaYouTube += 1;
    }
  }
  return { total: tracks.length, playable, via_spotify: viaSpotify, via_youtube: viaYouTube };
}
