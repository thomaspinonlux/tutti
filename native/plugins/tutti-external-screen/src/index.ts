import { registerPlugin } from '@capacitor/core';

import type { TuttiExternalScreenPlugin } from './definitions';

export const TuttiExternalScreen = registerPlugin<TuttiExternalScreenPlugin>('TuttiExternalScreen');

export * from './definitions';
