/**
 * nativeOAuth.ts — connexion OAuth (Spotify / YouTube) DANS la coque native.
 *
 * Problème : en natif, `window.location.href = authUrl` fait quitter la WebView
 * vers le fournisseur OAuth ; le callback backend redirige ensuite vers le SITE
 * web (tuttiparty.app), jamais vers `capacitor://localhost` → l'app native ne
 * récupère jamais la main, la connexion « part dans le vide ».
 *
 * Solution : ouvrir l'URL OAuth dans un NAVIGATEUR IN-APP (plugin Capacitor
 * `Browser` = SFSafariViewController sur iOS), où les redirections OAuth et le
 * login fournisseur fonctionnent normalement. Le backend rattache la connexion
 * au compte via le `state` OAuth signé (aucun cookie de session requis) → on
 * SONDE le statut jusqu'à « connecté », puis on ferme le navigateur.
 *
 * Accès au plugin via le bridge global `window.Capacitor.Plugins.Browser` — sans
 * importer `@capacitor/browser`, pour ne rien ajouter au build web. Le plugin
 * natif est fourni par la coque (native/package.json).
 */

import { isCapacitorNative } from './platform.js';

interface BrowserPlugin {
  open(options: { url: string }): Promise<void>;
  close(): Promise<void>;
  addListener(
    eventName: 'browserFinished',
    listenerFunc: () => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

function browserPlugin(): BrowserPlugin | null {
  if (typeof window === 'undefined') return null;
  const plugins = window.Capacitor?.Plugins as Record<string, unknown> | undefined;
  return (plugins?.Browser as BrowserPlugin | undefined) ?? null;
}

/** True si l'OAuth in-app est possible (coque native + plugin Browser présent). */
export function canUseInAppOAuth(): boolean {
  return isCapacitorNative() && browserPlugin() !== null;
}

/**
 * Ouvre `authUrl` dans le navigateur in-app puis sonde `isConnected()` jusqu'au
 * succès (ou fermeture par l'utilisateur / timeout). Retourne true si connecté.
 */
export async function connectViaInAppBrowser(
  authUrl: string,
  isConnected: () => Promise<boolean>,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const browser = browserPlugin();
  if (!browser) throw new Error('Navigateur in-app indisponible.');
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const intervalMs = opts.intervalMs ?? 2_000;

  let userClosed = false;
  const listener = await browser.addListener('browserFinished', () => {
    userClosed = true;
  });

  await browser.open({ url: authUrl });

  const startedAt = Date.now();
  try {
    for (;;) {
      await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
      if (await isConnected().catch(() => false)) {
        await browser.close().catch(() => undefined);
        return true;
      }
      if (userClosed) return false;
      if (Date.now() - startedAt > timeoutMs) {
        await browser.close().catch(() => undefined);
        return false;
      }
    }
  } finally {
    await listener.remove().catch(() => undefined);
  }
}
