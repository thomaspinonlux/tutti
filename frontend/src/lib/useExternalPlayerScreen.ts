/**
 * useExternalPlayerScreen — phase 2 du plan natif.
 *
 * Sur iPad natif (et seulement là), pousse la route `/screen` de l'app sur un
 * affichage EXTERNE branché à la tablette, via le plugin `TuttiExternalScreen`.
 * L'animateur garde la console sur l'iPad, les joueurs voient la TV — un seul
 * appareil, deux affichages.
 *
 * fix/tv-freeze — SUPERVISION DEPUIS LA CONSOLE. Le chien de garde interne à
 * la page TV ne peut rien si iOS tue/gèle la WebView externe (son JS meurt
 * avec elle). La page TV interroge le serveur ~1×/s ; le serveur horodate
 * chaque interrogation (route publique /screen-state/alive/:workspaceId). Ici,
 * la CONSOLE vérifie ce signe de vie toutes les 2 s : TV muette ≥ 2 contrôles
 * d'affilée (~6-8 s) → on re-`present()` l'écran externe, ce qui détruit et reconstruit
 * intégralement la fenêtre TV (le plugin fait tearDown + recreate). La TV
 * revit donc toute seule en ~10 s au pire, sans toucher à l'iPad. (Avec le
 * build natif qui embarque l'armure, la cause principale — processus tué par
 * iOS — est détectée par le natif lui-même et reconstruite en 1-2 s.)
 *
 * Sécurité : `supportsExternalPlayerScreen()` est faux hors iPad natif → le
 * hook est un no-op total sur web / desktop (aucun effet, aucun risque).
 */

import { useEffect } from 'react';
import { supportsExternalPlayerScreen } from './platform.js';
import { externalScreen } from './externalScreen.js';
import { api } from './api.js';

/** Contrôle du signe de vie toutes les 2 s. */
const SUPERVISE_EVERY_MS = 2_000;
/** TV considérée gelée après 2 contrôles muets d'affilée (~4-6 s). */
const STALE_CHECKS_BEFORE_REVIVE = 2;
/** Silence toléré : la TV interroge ~1×/s, 6 s sans nouvelle = vraiment morte. */
const STALE_THRESHOLD_MS = 6_000;
/** Après une relance, on laisse la TV redémarrer avant de rejuger. */
const REVIVE_COOLDOWN_MS = 15_000;

/**
 * fix/retour-ecran-web — DÉSACTIVÉ. La TV native (phase 1) n'affichait pas
 * encore la grille de playlists ni les écrans complets : régression visuelle
 * en exploitation. On repasse donc à l'écran joueurs WEB, complet et connu.
 * Le code natif reste en place, prêt à être réactivé quand il rendra
 * strictement tout ce que la version web affiche.
 */
const USE_NATIVE_TV = false;

interface Options {
  /** Origine web hébergée à charger sur l'écran externe (ex: https://app.tutti…). */
  webOrigin: string;
  /** Workspace de la session en cours (pour /screen?workspace=…). */
  workspaceId: string | null;
  /** Actif seulement pendant une session (sinon on retire la fenêtre externe). */
  active: boolean;
}

export function useExternalPlayerScreen({ webOrigin, workspaceId, active }: Options): void {
  useEffect(() => {
    if (!supportsExternalPlayerScreen() || !externalScreen.isAvailable()) return;
    if (!(active && workspaceId)) {
      void externalScreen.dismiss();
      return () => {
        void externalScreen.dismiss();
      };
    }

    const url = `${webOrigin.replace(/\/$/, '')}/screen?workspace=${encodeURIComponent(workspaceId)}`;

    // feat/tv-native — MODE PRÉFÉRÉ : écran joueurs dessiné par l'app (UIKit).
    // Aucune WebView sur la TV → rien qu'iOS puisse geler, et la vue lit le
    // lecteur de l'app pour ne jamais afficher un morceau que la salle
    // n'entend pas encore. La supervision « signe de vie » ne s'applique PAS
    // ici : elle mesure les interrogations de la page web, qui n'existe plus.
    if (USE_NATIVE_TV && externalScreen.supportsNative()) {
      const apiBase =
        (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';
      void externalScreen.presentNative(apiBase, workspaceId).then((ok) => {
        if (!ok) {
          console.warn('[externalScreen] TV native indisponible → repli WebView');
          void externalScreen.present(url);
        }
      });
      return () => {
        void externalScreen.dismiss();
      };
    }

    void externalScreen.present(url);

    let staleChecks = 0;
    let lastReviveAt = Date.now(); // le present() initial compte comme relance
    const supervise = window.setInterval(() => {
      void (async () => {
        try {
          const { last_seen_ms_ago } = await api<{ last_seen_ms_ago: number | null }>(
            `/api/workspace/screen-state/alive/${encodeURIComponent(workspaceId)}`,
          );
          const alive = last_seen_ms_ago !== null && last_seen_ms_ago < STALE_THRESHOLD_MS;
          if (alive) {
            staleChecks = 0;
            return;
          }
          staleChecks += 1;
          if (
            staleChecks >= STALE_CHECKS_BEFORE_REVIVE &&
            Date.now() - lastReviveAt > REVIVE_COOLDOWN_MS
          ) {
            console.warn('[externalScreen] TV muette — relance de la fenêtre externe');
            staleChecks = 0;
            lastReviveAt = Date.now();
            void externalScreen.present(url);
          }
        } catch {
          // Serveur injoignable depuis la console : on ne juge pas la TV là-dessus.
        }
      })();
    }, SUPERVISE_EVERY_MS);

    return () => {
      window.clearInterval(supervise);
      void externalScreen.dismiss();
    };
  }, [webOrigin, workspaceId, active]);
}
