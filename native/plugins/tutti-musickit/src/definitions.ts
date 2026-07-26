/**
 * Interface du pont MusicKit natif (iOS). Miroir minimal de ce dont
 * useAppleMusicPlayer a besoin — mais servi par MusicKit Swift
 * (ApplicationMusicPlayer), donc lecture full-track sans blocage autoplay.
 */
export interface TuttiMusicKitPlugin {
  /** Demande l'autorisation Apple Music (abonnement requis pour le full-track). */
  authorize(): Promise<{ authorized: boolean }>;
  /**
   * Récupère le Music User Token (compte abonné) en natif, SANS popup web.
   * `developerToken` est minté par le backend. À persister via /connect.
   */
  getUserToken(options: { developerToken: string }): Promise<{ userToken: string }>;
  /** Lit un morceau par son catalog id Apple Music. */
  play(options: { catalogId: string }): Promise<{ ok: boolean }>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** Seek absolu en millisecondes. */
  seek(options: { ms: number }): Promise<void>;
  /** Volume 0..1 (best-effort — ApplicationMusicPlayer suit le volume système). */
  setVolume(options: { value: number }): Promise<void>;
  /** État courant pour l'interpolation UI (position / lecture). */
  getStatus(): Promise<{ isPlaying: boolean; positionMs: number; durationMs: number }>;
}
