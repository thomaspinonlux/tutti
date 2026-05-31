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
export type MusicProviderId = 'demo' | 'spotify' | 'youtube' | 'deezer' | 'apple_music';

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
  /** feat/playlist-pool-random-selection — nb tracks tirés du pool par session. */
  default_session_size?: number;
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
  /**
   * Durée de la fenêtre micro joueur en secondes (10 par défaut, 15 en
   * mode "détendu"). C'est la durée pendant laquelle le micro reste ouvert
   * après un buzz pour capter la réponse vocale.
   */
  buzz_window_seconds: number;
  /** Cap technique de participants par session (15 par défaut V1 B2C). */
  max_participants: number;
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

/**
 * Phases d'un morceau dans la mécanique voice-first (Phase C) :
 *   - phase1 : écoute libre, n'importe qui peut buzzer
 *   - phase2 : 15s après la 1ʳᵉ bonne réponse, les autres peuvent encore
 *              buzzer pour les points dégressifs
 *   - phase3 : phase festive — buzzers désactivés, musique continue
 *              jusqu'à la fin naturelle
 *   - phase3-revealed : master a appuyé sur "Donner la réponse" — le
 *                       morceau est révélé sans qu'aucun joueur ait buzzé,
 *                       puis on passe en festif
 *   - phase3-skipped  : master a appuyé sur "Sauter" — pas de reveal du
 *                       tout, on passe direct au suivant
 */
export type GameTrackPhase = 'phase1' | 'phase2' | 'phase3' | 'phase3-revealed' | 'phase3-skipped';

/** Réponse correcte enregistrée pendant un track (broadcast au fur et à mesure). */
export interface CorrectAnswerEntry {
  participant_id: string;
  pseudo: string;
  team_id: string | null;
  /** Position dans l'ordre d'arrivée (1ʳᵉ = 1, 2ᵉ = 2, etc.). */
  position: number;
  /** Délai écoulé depuis le démarrage du track (ms). */
  answered_at_ms: number;
  matched_artist: boolean;
  matched_title: boolean;
  /** Total points attribués (somme du breakdown ci-dessous). */
  score: number;
  /**
   * Refonte #4 — détail des points pour affichage clarifié côté UI :
   *   "+20 pts artiste (1ʳᵉ place) / +8 pts bonus vitesse / +5 pts bonus titre".
   * Optionnels pour rétrocompat avec les broadcasts plus anciens.
   */
  score_position?: number;
  score_title_bonus?: number;
  score_speed_bonus?: number;
}

/**
 * État courant du track en cours de jeu, broadcast à tous (host + joueurs).
 * Modèle voice-first : pas de buzzer unique, plusieurs réponses possibles
 * en parallèle.
 */
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
  /** Métadonnées du morceau — révélées en phase 2/3. */
  artist: string;
  title: string;
  album: string | null;
  year: number | null;
  cover_url: string | null;
  /** Date de démarrage du track (ISO) pour calculer le timer côté client. */
  started_at: string;
  /** Durée du Track Spotify en ms (informatif, le morceau joue jusqu'au bout). */
  duration_ms: number | null;
  phase: GameTrackPhase;
  /**
   * Date de démarrage de la phase 2 (ISO) si on y est. Permet aux clients
   * d'afficher un chrono "encore X secondes pour buzzer".
   */
  phase2_started_at: string | null;
  /** Toutes les bonnes réponses enregistrées jusque-là, dans l'ordre. */
  correct_answers: CorrectAnswerEntry[];
}

/** Durée de la phase 2 en ms (constante partagée frontend ↔ backend). */
export const PHASE_2_DURATION_MS = 15_000;

// ───── Programme manche (Phase 2.1) ────────────────────────────────────────

/**
 * Statut d'un track dans le programme d'une manche, vu côté animateur.
 *  - PLAYED   : déjà joué (avant current_track_index)
 *  - CURRENT  : le track en cours
 *  - UPCOMING : à venir (après current_track_index)
 */
export type RoundProgramTrackStatus = 'PLAYED' | 'CURRENT' | 'UPCOMING';

export interface RoundProgramItem {
  position: number;
  track_id: string;
  artist: string;
  title: string;
  year: number | null;
  cover_url: string | null;
  duration_ms: number | null;
  status: RoundProgramTrackStatus;
}

export interface RoundProgramResponse {
  round_id: string;
  round_status: RoundStatus;
  current_track_index: number;
  total_tracks: number;
  tracks: RoundProgramItem[];
}

// ───── Tutti Quizz (étape 15) ─────────────────────────────────────────────

export type QuestionType = 'MCQ' | 'TRUE_FALSE' | 'FREE_TEXT' | 'ESTIMATION';
export type QuestionMediaType = 'NONE' | 'VIDEO' | 'AUDIO' | 'IMAGE';

export interface QuestionSet {
  id: string;
  establishment_id: string | null;
  name: string;
  description: string | null;
  cover_url: string | null;
  is_bilingual: boolean;
  language_1: string;
  language_2: string | null;
  is_generic: boolean;
  is_published: boolean;
  created_at: string;
  /** Comptage léger renvoyé par l'API liste (sans inclure les questions). */
  questions_count?: number;
}

export interface Question {
  id: string;
  set_id: string;
  position: number;
  type: QuestionType;
  category: string | null;
  text_lang1: string;
  text_lang2: string | null;
  choices_lang1: string[];
  choices_lang2: string[];
  answer_lang1: string;
  answer_lang2: string | null;
  answer_aliases_lang1: string[];
  answer_aliases_lang2: string[];
  time_limit_sec: number;
  points: number;
  media_type: QuestionMediaType;
  media_url: string | null;
  created_at: string;
}

export interface QuestionSetWithQuestions extends QuestionSet {
  questions: Question[];
}

/**
 * Métadonnées encodées dans answer_lang1 pour les questions ESTIMATION.
 *   target : valeur exacte à deviner
 *   min, max : borne du slider côté joueur (pour bornage UI + scoring)
 *   unit : unité affichée à côté du chiffre (ex. "année", "km", "%")
 */
export interface EstimationAnswer {
  target: number;
  min: number;
  max: number;
  unit?: string;
}

/**
 * État courant d'une question en cours (équivalent de CurrentTrackState
 * pour Tutti Tracks). Broadcast à tous (host + joueurs).
 */
export interface CurrentQuestionState {
  round_id: string;
  question_index: number;
  question_id: string;
  /** Texte de la question dans les langues actives. */
  text: string;
  text_alt?: string; // langue 2 si is_bilingual
  type: QuestionType;
  category: string | null;
  /** Choix MCQ (vide pour les autres types). */
  choices: string[];
  choices_alt?: string[];
  /** Borne pour ESTIMATION (parsée depuis answer_lang1 JSON côté serveur). */
  estimation_min?: number;
  estimation_max?: number;
  estimation_unit?: string;
  /** Médias optionnels. */
  media_type: QuestionMediaType;
  media_url: string | null;
  /** feat/quiz-question-media — extrait YouTube structuré (AUDIO/VIDEO).
   *  Si media_type=AUDIO|VIDEO + media_youtube_id renseigné, le gameplay
   *  embed un IFrame YouTube qui joue [start, start+duration]. */
  media_youtube_id?: string | null;
  media_start_sec?: number | null;
  media_duration_sec?: number | null;
  /** Date de démarrage (ISO) pour calculer le timer côté client. */
  started_at: string;
  /** Durée d'écoute autorisée avant timeout (s, défaut 30). */
  time_limit_sec: number;
  /** Points en jeu pour cette question. */
  points: number;
  /** Phase courante : asking (joueurs répondent) → revealed (réponse + recap). */
  phase: 'asking' | 'revealed';
  /** Réponse révélée (visible en phase 'revealed' uniquement). */
  reveal?: { answer: string; answer_alt?: string };
}

/** Réponse soumise par un joueur (avant scoring). */
export interface QuizzAnswerSubmission {
  /** MCQ : index dans choices. TRUE_FALSE : "true"/"false". FREE_TEXT : texte libre. ESTIMATION : nombre. */
  value: string;
}

/** Résultat du scoring d'une réponse, broadcast après reveal. */
export interface QuizzAnswerResult {
  participant_id: string;
  pseudo: string;
  team_id: string | null;
  is_correct: boolean;
  answered_at_ms: number;
  score: number;
  /** Réponse soumise (pour affichage debug/transparence). */
  submitted: string;
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
