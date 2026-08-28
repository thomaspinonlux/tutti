/**
 * nativeMusicKit.ts — accès au pont MusicKit natif (plugin Capacitor
 * `TuttiMusicKit`, cf. native/plugins/tutti-musickit) DEPUIS le frontend, via le
 * bridge global `window.Capacitor.Plugins` — SANS importer `@capacitor/core`,
 * pour ne rien ajouter aux dépendances du build web.
 *
 * C'est l'implémentation « native » de la lecture Apple Music, choisie par
 * useAppleMusicPlayer quand `supportsNativeAppleMusic()` est vrai (iPad natif).
 * Sur web / desktop, `isAvailable()` renvoie false → on reste sur MusicKit JS.
 */

interface NativeMusicKitBridge {
  authorize(): Promise<{ authorized: boolean }>;
  getUserToken(options: { developerToken: string }): Promise<{ userToken: string }>;
  play(options: { catalogId: string }): Promise<{ ok: boolean }>;
  /** feat/next-track-preload — absents des binaires < build 34 : appels gardés try/catch. */
  queueNext?(options: { catalogId: string }): Promise<{ ok: boolean }>;
  skipToNext?(): Promise<{ ok: boolean }>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(options: { ms: number }): Promise<void>;
  setVolume(options: { value: number }): Promise<void>;
  getStatus(): Promise<{ isPlaying: boolean; positionMs: number; durationMs: number }>;
}

function bridge(): NativeMusicKitBridge | null {
  if (typeof window === 'undefined') return null;
  const plugins = window.Capacitor?.Plugins as Record<string, unknown> | undefined;
  return (plugins?.TuttiMusicKit as NativeMusicKitBridge | undefined) ?? null;
}

export const nativeMusicKit = {
  /** True si le plugin natif est présent (coque iPad buildée). */
  isAvailable(): boolean {
    return bridge() !== null;
  },
  authorize(): Promise<{ authorized: boolean }> {
    return bridge()?.authorize() ?? Promise.resolve({ authorized: false });
  },
  /** Music User Token natif (compte abonné), pour persister la connexion sans popup. */
  getUserToken(developerToken: string): Promise<{ userToken: string }> {
    return bridge()?.getUserToken({ developerToken }) ?? Promise.resolve({ userToken: '' });
  },
  play(catalogId: string): Promise<{ ok: boolean }> {
    return bridge()?.play({ catalogId }) ?? Promise.resolve({ ok: false });
  },
  pause(): Promise<void> {
    return bridge()?.pause() ?? Promise.resolve();
  },
  resume(): Promise<void> {
    return bridge()?.resume() ?? Promise.resolve();
  },
  seek(ms: number): Promise<void> {
    return bridge()?.seek({ ms }) ?? Promise.resolve();
  },
  setVolume(value: number): Promise<void> {
    return bridge()?.setVolume({ value }) ?? Promise.resolve();
  },
  getStatus(): Promise<{ isPlaying: boolean; positionMs: number; durationMs: number }> {
    return (
      bridge()?.getStatus() ?? Promise.resolve({ isPlaying: false, positionMs: 0, durationMs: 0 })
    );
  },
  /** feat/next-track-preload — précharge le morceau suivant. false si binaire trop ancien. */
  async queueNext(catalogId: string): Promise<boolean> {
    try {
      const r = await bridge()?.queueNext?.({ catalogId });
      return r?.ok === true;
    } catch {
      return false;
    }
  },
  /** feat/next-track-preload — saute sur le morceau préchargé. false → fallback play(). */
  async skipToNext(): Promise<boolean> {
    try {
      const r = await bridge()?.skipToNext?.();
      return r?.ok === true;
    } catch {
      return false;
    }
  },
};
