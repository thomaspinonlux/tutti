/**
 * externalScreen.ts — pont vers le plugin natif `TuttiExternalScreen`
 * (cf. native/plugins/tutti-external-screen) via le bridge global Capacitor,
 * SANS dépendance ajoutée au build web. No-op partout sauf sur iPad natif.
 */

interface ExternalScreenBridge {
  isConnected(): Promise<{ connected: boolean }>;
  present(options: { url: string }): Promise<{ presented: boolean }>;
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
  present(url: string): Promise<{ presented: boolean }> {
    return bridge()?.present({ url }) ?? Promise.resolve({ presented: false });
  },
  dismiss(): Promise<void> {
    return bridge()?.dismiss() ?? Promise.resolve();
  },
};
