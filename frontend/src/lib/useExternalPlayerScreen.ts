/**
 * useExternalPlayerScreen — phase 2 du plan natif.
 *
 * Sur iPad natif (et seulement là), pousse la route `/screen` de l'app sur un
 * affichage EXTERNE branché à la tablette, via le plugin `TuttiExternalScreen`.
 * L'animateur garde la console sur l'iPad, les joueurs voient la TV — un seul
 * appareil, deux affichages.
 *
 * Sécurité : `supportsExternalPlayerScreen()` est faux hors iPad natif → le hook
 * est un no-op total sur web / desktop (aucun effet, aucun risque).
 *
 * Nuance honnête : la fenêtre externe charge l'URL /screen hébergée. Le gain
 * immédiat est opérationnel (plus besoin d'un 2ᵉ appareil / cast) ; elle
 * bénéficie déjà du correctif socket TV. Le rendu 100 % local (latence nulle)
 * demanderait de servir le bundle à la WebView externe — étape ultérieure.
 */

import { useEffect } from 'react';
import { supportsExternalPlayerScreen } from './platform.js';
import { externalScreen } from './externalScreen.js';

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
    if (active && workspaceId) {
      const url = `${webOrigin.replace(/\/$/, '')}/screen?workspace=${encodeURIComponent(workspaceId)}`;
      void externalScreen.present(url);
    } else {
      void externalScreen.dismiss();
    }
    return () => {
      void externalScreen.dismiss();
    };
  }, [webOrigin, workspaceId, active]);
}
