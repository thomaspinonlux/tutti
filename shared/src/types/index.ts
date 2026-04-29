/**
 * Types de base partagés entre frontend et backend.
 * Étendus au fil des étapes du plan de dev.
 */

// ───── API health-check (étape 1) ─────────────────────────────────────────

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  uptime: number;
  version: string;
}

// ───── Locale ─────────────────────────────────────────────────────────────

export type Locale = 'fr' | 'en';

export const SUPPORTED_LOCALES = ['fr', 'en'] as const;
export const DEFAULT_LOCALE: Locale = 'fr';

// ───── Erreur API standardisée ────────────────────────────────────────────

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

// ───── Music providers (étape 7+) ─────────────────────────────────────────

/**
 * Identifiants des providers musicaux supportés.
 * Doit rester aligné avec l'enum côté backend (registry.ts) et la colonne
 * `establishments.active_provider`.
 */
export type MusicProviderId = 'demo' | 'spotify' | 'deezer' | 'apple_music';

/**
 * Résultat d'une recherche / lecture d'un morceau, format unifié entre
 * tous les providers. Les champs optionnels permettent à un provider
 * minimaliste (Demo) de ne fournir que l'essentiel.
 */
export interface TrackResult {
  /** ID du provider qui possède ce morceau (= clé pour getTrack ensuite). */
  provider: MusicProviderId;
  /** ID du morceau côté provider (Spotify URI, hash demo, etc.). */
  provider_track_id: string;
  artist: string;
  title: string;
  album?: string;
  year?: number;
  duration_ms?: number;
  cover_url?: string;
  /** URL de pré-écoute (30s typiquement). null si indisponible. */
  preview_url?: string | null;
  /** Score de popularité 0-100 (Spotify-style), pour tri secondaire. */
  popularity?: number;
}

export interface ProviderCapabilities {
  /** Le provider exige une connexion OAuth utilisateur (Spotify, Deezer). */
  requires_oauth: boolean;
  /** Le provider sait jouer le morceau entier (Spotify Premium, Apple Music). */
  supports_full_playback: boolean;
  /** Le provider expose un preview de 30s (Demo, Spotify gratuit). */
  supports_preview: boolean;
  /** Nombre maximum de résultats retournés par search(). */
  max_results: number;
}

export interface ProviderInfo {
  id: MusicProviderId;
  capabilities: ProviderCapabilities;
}

// ───── Playlists Tutti Tracks (étape 8+) ──────────────────────────────────

export type Level = 'EASY' | 'MEDIUM' | 'EXPERT';

export interface Playlist {
  id: string;
  establishment_id: string;
  name: string;
  cover_url: string | null;
  level: Level;
  language: string;
  is_published: boolean;
  created_at: string;
  updated_at: string;
  /** Comptage léger renvoyé par l'API liste (sans inclure les tracks). */
  tracks_count?: number;
}

export interface Track {
  id: string;
  playlist_id: string;
  position: number;
  provider: MusicProviderId;
  provider_track_id: string;
  artist: string;
  title: string;
  album: string | null;
  year: number | null;
  genre: string | null;
  popularity: number | null;
  duration_ms: number | null;
  cover_url: string | null;
  artist_aliases: string[];
  title_aliases: string[];
  created_at: string;
}

export interface PlaylistWithTracks extends Playlist {
  tracks: Track[];
}
