/**
 * fix/double-lancement-de-manche
 *
 * Deux demandes de lancement quasi simultanées — l'animateur qui appuie deux
 * fois parce que rien ne bouge, ou l'iPad et le téléphone en même temps —
 * produisaient deux manches : la seconde terminait celle que la première
 * venait de démarrer, et pouvait échouer sur la contrainte d'unicité de
 * position. Résultat en salle : la musique joue mais la manche est close en
 * base, et le bouton « Suivant » répond « la manche est terminée ».
 *
 * Ce verrou est volontairement simple et local au processus : le serveur tourne
 * en une seule instance, comme le reste de l'état de jeu (cf. gameState.ts).
 * Il n'est PAS un mécanisme de sécurité, seulement un garde-fou contre le
 * double appui.
 */

const enCours = new Map<string, number>();

/** Au-delà de ce délai, un verrou oublié (erreur non rattrapée) se libère seul. */
const EXPIRATION_MS = 30_000;

/** Prend le verrou. Rend `false` si un lancement est déjà en cours. */
export function prendreVerrouLancement(sessionId: string): boolean {
  const depuis = enCours.get(sessionId);
  if (depuis !== undefined && Date.now() - depuis < EXPIRATION_MS) return false;
  enCours.set(sessionId, Date.now());
  return true;
}

/** Libère le verrou. À appeler dans un `finally`. */
export function libererVerrouLancement(sessionId: string): void {
  enCours.delete(sessionId);
}
