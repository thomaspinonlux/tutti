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
  description: string | null;
  cover_url: string | null;
  level: Level;
  language: string;
  is_published: boolean;
  is_express: boolean;
  is_official_tutti: boolean;
  external_links: { spotify?: string; deezer?: string; apple_music?: string } | null;
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

// ───── Sessions Tutti Tracks (étape 9+) ───────────────────────────────────

export type GameType = 'TRACKS' | 'QUIZZ';
export type GameMode = 'SOLO' | 'TEAMS';
export type SessionStatus = 'WAITING' | 'PLAYING' | 'ENDED';

export interface Team {
  id: string;
  name: string;
  color: string; // hex #RRGGBB (parmi les couleurs Pop Cocktail)
}

export interface Session {
  id: string;
  establishment_id: string;
  name: string | null;
  game_type: GameType;
  status: SessionStatus;
  short_code: string; // ex. "KOMP-7K2X"
  mode: GameMode;
  teams_config: Team[] | null;
  language: string;
  question_set_id: string | null;
  /**
   * true = mode A (avec animateur, host pilote depuis l'iPad).
   * false = mode B (sans animateur, défaut B2C : un joueur master pilote
   * depuis son tel et l'iPad affiche la vue publique festive).
   */
  has_animator: boolean;
  /**
   * Pause déclenchée par le master en mode B. Pas d'auto-resume — le master
   * appuie sur "Reprendre" quand il veut. Le timer continue de courir
   * pendant la pause côté UI (V1 simple) ; seul l'audio est mis en pause.
   */
  is_paused: boolean;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

export type RoundStatus = 'PENDING' | 'PLAYING' | 'ENDED';

export interface SessionRound {
  id: string;
  session_id: string;
  playlist_id: string;
  position: number;
  status: RoundStatus;
  current_track_index: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

/** SessionRound enrichi de la playlist (utilisé pour /host). */
export interface SessionRoundWithPlaylist extends SessionRound {
  playlist: { id: string; name: string; level: string; tracks_count?: number };
}

// ───── Boucle de jeu Tutti Tracks (étape 10) ──────────────────────────────

export type GameTrackPhase = 'listening' | 'buzzed' | 'cooldown';

/** État courant du track en cours de jeu, broadcast à tous (host + joueurs). */
export interface CurrentTrackState {
  round_id: string;
  track_index: number;
  track_id: string;
  /**
   * Provider du morceau ('spotify', 'demo', etc.) — sert au host pour décider
   * comment déclencher la lecture (Web Playback SDK pour Spotify, <audio> ou
   * fallback manuel pour Demo).
   */
  provider: MusicProviderId;
  /** ID du morceau côté provider (Spotify track ID, hash demo, etc.). */
  provider_track_id: string;
  /** Métadonnées affichées côté host (révélées aux joueurs en fin de track). */
  artist: string;
  title: string;
  album: string | null;
  year: number | null;
  cover_url: string | null;
  /** Date de démarrage (ISO) pour calculer le timer côté client. */
  started_at: string;
  /** Durée d'écoute autorisée avant timeout (ms). */
  duration_ms: number;
  phase: GameTrackPhase;
  /** ID du participant qui a buzzé en 1ᵉʳ (si phase === 'buzzed'). */
  buzzer_id: string | null;
  /** Pseudo du buzzeur (rendu pour l'UI sans round-trip). */
  buzzer_pseudo: string | null;
}

/** Résultat d'une réponse, broadcast à tous après le verdict. */
export interface BuzzResult {
  round_id: string;
  track_index: number;
  participant_id: string;
  participant_pseudo: string;
  team_id: string | null;
  matched_artist: boolean;
  matched_title: boolean;
  artist_points: number;
  title_points: number;
  total_points: number;
  /** Métadonnées du track révélées en fin de manche. */
  reveal: { artist: string; title: string };
}

/** Score agrégé sur l'ensemble de la session pour un participant ou une équipe. */
export interface CumulativeScore {
  /** ID participant (mode SOLO) ou ID team (mode TEAMS). */
  id: string;
  /** Nom à afficher (pseudo ou nom d'équipe). */
  label: string;
  /** Couleur (hex) pour les équipes ; null en mode solo. */
  color: string | null;
  total_points: number;
}

export interface Participant {
  id: string;
  session_id: string;
  pseudo: string;
  team_id: string | null;
  is_master: boolean;
  is_kicked: boolean;
  joined_at: string;
}

export interface SessionWithParticipants extends Session {
  participants: Participant[];
  rounds: SessionRoundWithPlaylist[];
}

/** Vue publique côté joueur (pas d'établissement, pas de stats sensibles). */
export interface PublicSessionView {
  short_code: string;
  status: SessionStatus;
  mode: GameMode;
  teams_config: Team[] | null;
  language: string;
  game_type: GameType;
  /** Nom de l'établissement pour l'écran d'accueil joueur. */
  establishment_name: string;
  /** Couleur d'accent pour le branding (étape 6). */
  branding_color: string | null;
  /** Liste minimale des participants (pseudo + team_id seuls — pas d'IDs internes). */
  participants_count: number;
  /** Mode A (true) vs Mode B (false). Le tel adapte ses contrôles selon. */
  has_animator: boolean;
  /** Pseudo du master désigné (mode B). null si personne n'est encore animateur. */
  master_pseudo: string | null;
}

/** Réponse au /join : retourne un token JWT pour la connexion Socket.IO. */
export interface JoinResponse {
  participant: Participant;
  token: string;
}
