/**
 * sonNatif.ts — fix/un-seul-lecteur
 *
 * UN SEUL LECTEUR POUR TOUT LE SON DE LA SOIRÉE SUR L'IPAD.
 *
 * Toutes les coupures connues (18/09, 02/10 ×2, 30/10 ×2, 06/11 ×2, 13/11 ×2)
 * tombent sur le premier morceau Apple qui suit un son joué par l'app
 * elle-même : boucle MP3 d'attente, déverrouillages audio de la page (son
 * muet, AudioContext, réveil YouTube). Le lecteur Apple joue dans le service
 * Musique d'iOS, pas dans l'app : chaque passage de relais entre les deux
 * oblige l'un à couper l'autre, et c'est là qu'Apple refuse ou fige l'iPad.
 *
 * Quand ce drapeau est levé (iPad natif, blind test, source Apple), la page ne
 * produit AUCUN son : la musique d'attente passe elle aussi par le lecteur
 * Apple (useLobbyAmbiance) et les déverrouillages audio du navigateur, inutiles
 * pour le lecteur natif, sont sautés.
 */

let appleSeul = false;

export function setAppleSeul(valeur: boolean): void {
  appleSeul = valeur;
}

/** true = la page ne doit jouer aucun son (le lecteur Apple natif fait tout). */
export function estAppleSeul(): boolean {
  return appleSeul;
}
