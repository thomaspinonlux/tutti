import { registerPlugin } from '@capacitor/core';

import type { TuttiMusicKitPlugin } from './definitions';

/**
 * Enregistre le plugin natif sous le nom « TuttiMusicKit ». Une fois la coque
 * native buildée, il est aussi accessible côté frontend via le bridge global
 * `window.Capacitor.Plugins.TuttiMusicKit` (cf. frontend/src/lib/nativeMusicKit.ts,
 * qui n'importe PAS ce package pour garder le build web sans dépendance).
 */
export const TuttiMusicKit = registerPlugin<TuttiMusicKitPlugin>('TuttiMusicKit');

export * from './definitions';
