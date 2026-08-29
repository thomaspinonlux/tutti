export interface TuttiExternalScreenPlugin {
  /** True si un écran externe (USB-C / AirPlay) est branché. */
  isConnected(): Promise<{
    connected: boolean;
    width?: number;
    height?: number;
    scale?: number;
    windowWidth?: number;
    windowHeight?: number;
  }>;
  /**
   * Affiche `url` (route /screen de l'app) sur l'écran externe, dans une
   * WebView indépendante. Mode HISTORIQUE — conservé en secours.
   */
  present(options: { url: string }): Promise<{ presented: boolean }>;
  /**
   * feat/tv-native — écran joueurs rendu NATIVEMENT (UIKit), sans aucune
   * WebView : rien qu'iOS puisse geler, et lecture directe du lecteur de
   * l'app pour une synchronisation image/son exacte.
   */
  presentNative(options: {
    apiBase: string;
    workspaceId: string;
  }): Promise<{ presented: boolean }>;
  /**
   * feat/tv-native — pousse la VÉRITÉ DU LECTEUR à la TV native, sans réseau.
   * `trackId` = morceau RÉELLEMENT en cours de lecture : la TV ne bascule que
   * lorsqu'il change ici, donc jamais avant que la salle entende le morceau.
   */
  updatePlayback(options: {
    trackId: string;
    positionMs: number;
    durationMs: number;
    isPaused: boolean;
  }): Promise<void>;
  /** Retire la fenêtre de l'écran externe. */
  dismiss(): Promise<void>;
}
