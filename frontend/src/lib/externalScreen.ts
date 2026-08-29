/**
 * externalScreen.ts — pont vers le plugin natif `TuttiExternalScreen`
 * (cf. native/plugins/tutti-external-screen) via le bridge global Capacitor,
 * SANS dépendance ajoutée au build web. No-op partout sauf sur iPad natif.
 *
 * feat/tv-native — deux modes :
 *   • presentNative() : écran joueurs dessiné par l'app (aucune WebView).
 *     Mode préféré : insensible aux gels, synchronisé au son à la milliseconde.
 *   • present(url)    : ancienne WebView /screen, conservée en secours pour
 *     les binaires antérieurs (les méthodes manquantes lèvent → on retombe).
 */

interface ExternalScreenBridge {
  isConnected(): Promise<{ connected: boolean }>;
  present(options: { url: string }): Promise<{ presented: boolean }>;
  presentNative?(options: {
    apiBase: string;
    workspaceId: string;
  }): Promise<{ presented: boolean }>;
  updatePlayback?(options: {
    trackId: string;
    positionMs: number;
    durationMs: number;
    isPaused: boolean;
  }): Promise<void>;
  dismiss(): Promise<void>;
}

function bridge(): ExternalScreenBridge | null {
  if (typeof window === 'undefined') return null;
  const plugins = window.Capacitor?.Plugins as Record<string, unknown> | undefined;
  return (plugins?.TuttiExternalScreen as ExternalScreenBridge | undefined) ?? null;
}

export const externalScreen = {
  isAvailable(): boolean {
    return bridge() !== null;
  },
  /** Le binaire installé sait-il rendre la TV nativement ? */
  supportsNative(): boolean {
    const b = bridge();
    return !!b && typeof b.presentNative === 'function';
  },
  present(url: string): Promise<{ presented: boolean }> {
    return bridge()?.present({ url }) ?? Promise.resolve({ presented: false });
  },
  async presentNative(apiBase: string, workspaceId: string): Promise<boolean> {
    const b = bridge();
    if (!b || typeof b.presentNative !== 'function') return false;
    try {
      const res = await b.presentNative({ apiBase, workspaceId });
      return !!res?.presented;
    } catch {
      return false;
    }
  },
  async updatePlayback(p: {
    trackId: string;
    positionMs: number;
    durationMs: number;
    isPaused: boolean;
  }): Promise<void> {
    const b = bridge();
    if (!b || typeof b.updatePlayback !== 'function') return;
    try {
      await b.updatePlayback(p);
    } catch {
      /* binaire antérieur : sans effet */
    }
  },
  dismiss(): Promise<void> {
    return bridge()?.dismiss() ?? Promise.resolve();
  },
};
