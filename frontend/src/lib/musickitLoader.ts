/**
 * musickitLoader.ts — chargement partagé du SDK MusicKit JS (v3) + types
 * minimaux. Utilisé par useAppleMusicPlayer (lecture) et par la connexion
 * interactive Apple Music (Settings). feat/apple-music (étape 5).
 */

const SDK_SCRIPT_URL = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
const SDK_SCRIPT_ID = 'apple-musickit-js';

export interface MusicKitSetQueueOptions {
  song?: string;
  songs?: string[];
}
export interface MusicKitInstance {
  isAuthorized: boolean;
  volume: number;
  currentPlaybackTime: number;
  currentPlaybackDuration: number;
  isPlaying: boolean;
  authorize(): Promise<string>;
  unauthorize?(): Promise<void>;
  setQueue(opts: MusicKitSetQueueOptions): Promise<unknown>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  seekToTime(seconds: number): Promise<void>;
  addEventListener(name: string, cb: (e: unknown) => void): void;
  removeEventListener(name: string, cb: (e: unknown) => void): void;
}
export interface MusicKitNamespace {
  configure(config: {
    developerToken: string;
    app: { name: string; build: string };
  }): Promise<MusicKitInstance>;
  getInstance(): MusicKitInstance | undefined;
}

declare global {
  interface Window {
    MusicKit?: MusicKitNamespace;
  }
}

/** Charge le script MusicKit une seule fois. Résout quand window.MusicKit est prêt. */
export async function loadMusicKitSdk(): Promise<MusicKitNamespace> {
  if (typeof window === 'undefined') throw new Error('SSR non supporté');
  if (window.MusicKit) return window.MusicKit;

  await new Promise<void>((resolve, reject) => {
    const done = (): void => {
      if (window.MusicKit) resolve();
      else reject(new Error('MusicKit indisponible après chargement'));
    };
    if (document.getElementById(SDK_SCRIPT_ID)) {
      if (window.MusicKit) return resolve();
      document.addEventListener('musickitloaded', () => done(), { once: true });
      window.setTimeout(
        () => (window.MusicKit ? resolve() : reject(new Error('MusicKit timeout'))),
        10_000,
      );
      return;
    }
    const script = document.createElement('script');
    script.id = SDK_SCRIPT_ID;
    script.src = SDK_SCRIPT_URL;
    script.async = true;
    document.addEventListener('musickitloaded', () => done(), { once: true });
    script.onerror = () => reject(new Error('Échec de chargement de MusicKit JS'));
    document.head.appendChild(script);
    window.setTimeout(() => (window.MusicKit ? resolve() : undefined), 10_000);
  });
  if (!window.MusicKit) throw new Error('MusicKit indisponible');
  return window.MusicKit;
}
