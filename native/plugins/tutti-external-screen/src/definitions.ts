export interface TuttiExternalScreenPlugin {
  /** True si un écran externe (USB-C / AirPlay) est branché. */
  isConnected(): Promise<{ connected: boolean }>;
  /**
   * Affiche `url` (typiquement la route /screen de l'app) sur l'écran externe,
   * dans une fenêtre indépendante de la console. Rendu localement par l'iPad →
   * aucune latence réseau côté TV.
   */
  present(options: { url: string }): Promise<{ presented: boolean }>;
  /** Retire la fenêtre de l'écran externe. */
  dismiss(): Promise<void>;
}
