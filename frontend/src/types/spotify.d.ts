/**
 * Types minimaux pour le Spotify Web Playback SDK chargé depuis le CDN.
 * On ne couvre que ce qu'on utilise vraiment dans useSpotifyPlayer.
 *
 * Doc officielle :
 *   https://developer.spotify.com/documentation/web-playback-sdk/reference
 *
 * Note : ambient declarations (pas d'export) — visibles partout via inclusion
 * automatique TS dans src/.
 */

interface SpotifyPlayerInit {
  name: string;
  getOAuthToken: (cb: (token: string) => void) => void;
  volume?: number;
}

interface SpotifyPlayerState {
  paused: boolean;
  position: number;
  duration: number;
  track_window?: {
    current_track?: {
      id: string;
      name: string;
      uri: string;
      artists?: Array<{ name: string }>;
    };
  };
}

interface SpotifyPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  /**
   * Active le pipeline audio HTMLMediaElement interne (anti-blocage Chrome
   * autoplay). Doit être appelé après une interaction utilisateur. Idempotent.
   * Méthode présente depuis 2022 dans le SDK officiel.
   */
  activateElement(): Promise<void>;
  addListener(event: 'autoplay_failed', cb: () => void): boolean;
  addListener(event: 'ready', cb: (state: { device_id: string }) => void): boolean;
  addListener(event: 'not_ready', cb: (state: { device_id: string }) => void): boolean;
  addListener(
    event: 'initialization_error' | 'authentication_error' | 'account_error' | 'playback_error',
    cb: (state: { message: string }) => void,
  ): boolean;
  addListener(
    event: 'player_state_changed',
    cb: (state: SpotifyPlayerState | null) => void,
  ): boolean;
  removeListener(event: string): boolean;
  getCurrentState(): Promise<SpotifyPlayerState | null>;
  setName(name: string): Promise<void>;
  getVolume(): Promise<number>;
  setVolume(v: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  togglePlay(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  previousTrack(): Promise<void>;
  nextTrack(): Promise<void>;
}

interface SpotifyPlayerConstructor {
  new (options: SpotifyPlayerInit): SpotifyPlayer;
}

interface SpotifySdk {
  Player: SpotifyPlayerConstructor;
}

interface Window {
  Spotify?: SpotifySdk;
  onSpotifyWebPlaybackSDKReady?: () => void;
}
