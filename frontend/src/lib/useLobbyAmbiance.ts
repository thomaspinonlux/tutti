/**
 * useLobbyAmbiance — feat/ambiance-salon
 *
 * De la musique dans la salle PENDANT QUE LES JOUEURS SE CONNECTENT.
 *
 * Avant, l'animateur basculait l'iPad sur une autre appli de musique le temps
 * que tout le monde scanne le QR code, puis revenait sur Tutti. Deux ennuis :
 * le geste à refaire à chaque partie, et surtout iOS qui suspend le contexte
 * audio de la WebView pendant l'aller-retour — c'est la cause la plus
 * fréquente d'un premier morceau qui ne part pas (cf. lib/audioUnlock.ts).
 *
 * Deux chemins, dans cet ordre :
 *
 *   1. iPad natif + playlist Apple Music réglée → le pont natif joue cette
 *      playlist en aléatoire et en boucle (vraie musique, jamais lassante).
 *   2. Sinon → `useSelectionBackgroundMusic`, la boucle MP3 intégrée, qui
 *      marche partout (web, desktop, iPad sans playlist réglée).
 *
 * Le chemin 1 partage la file de `ApplicationMusicPlayer` avec le jeu : il la
 * REND explicitement (`stopAmbiance`) avant que la partie démarre, pour que le
 * premier morceau retrouve exactement l'état qu'il connaît déjà. D'où
 * `arreter()`, que la console appelle sur le bouton de lancement — sans
 * attendre le démontage du hook, qui arriverait trop tard.
 *
 * fix/un-seul-lecteur (16/11) — sur l'iPad natif avec Apple Music, la boucle
 * MP3 n'est PLUS JAMAIS jouée, même en secours : c'est le passage de relais
 * entre elle et le lecteur Apple qui coupait la musique (cf. lib/sonNatif.ts).
 * L'ambiance passe par le lecteur Apple (playlist par défaut : Chill House),
 * et quand un morceau du jeu prend la suite, le lecteur n'est pas mis en
 * pause : le morceau remplace l'ambiance par insertion + saut.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { nativeMusicKit } from './nativeMusicKit.js';
import { remoteLog } from './remoteLog.js';
import { useSelectionBackgroundMusic } from './useSelectionBackgroundMusic.js';

interface Options {
  /** true = phase d'attente / entre-manches / sélection : il faut du son. */
  enabled: boolean;
  /** Playlist Apple Music de l'établissement (pl.xxxx), ou null. */
  playlistId: string | null;
  /** Lire la playlist en aléatoire. */
  aleatoire: boolean;
  /**
   * fix/un-seul-lecteur — true quand le lecteur Apple natif fait tout le son
   * de la soirée (iPad natif, blind test, source Apple). Alors : ambiance par
   * Apple, jamais de boucle MP3.
   */
  appleSeul: boolean;
  /**
   * fix/un-seul-lecteur — true quand la phase qui suit l'ambiance est un
   * morceau du jeu joué par Apple : on ne met pas le lecteur en pause, le
   * morceau remplace l'ambiance.
   */
  sortieVersJeu: boolean;
  /**
   * fix/un-seul-lecteur — true entre deux manches : le dernier morceau du jeu
   * n'a pas été mis en pause (l'ambiance devait le remplacer). Si l'ambiance
   * ne démarre pas, on le met en pause pour ne pas le laisser jouer.
   */
  pauseSiEchec: boolean;
}

interface Resultat {
  /**
   * Rend le lecteur à la partie. À appeler au lancement, avant le 1er morceau.
   * `pause: false` quand le premier morceau est joué par Apple.
   */
  arreter: (options?: { pause?: boolean }) => Promise<void>;
  /** true quand c'est la playlist Apple qui joue (et non la boucle MP3). */
  surApple: boolean;
}

/** Nombre d'essais si le lecteur est occupé (préchauffage en cours…). */
const ESSAIS_AMBIANCE = 5;
const ECART_ESSAIS_MS = 3000;

export function useLobbyAmbiance({
  enabled,
  playlistId,
  aleatoire,
  appleSeul,
  sortieVersJeu,
  pauseSiEchec,
}: Options): Resultat {
  const [surApple, setSurApple] = useState(false);
  /** Garde-fou : une seule tentative par entrée en phase d'attente. */
  const tenteRef = useRef(false);
  const arreteRef = useRef(false);
  /**
   * fix/gel-au-demarrage — true seulement si la playlist Apple d'ambiance a
   * réellement été demandée au lecteur natif (on ne « rend » jamais un lecteur
   * qui n'a pas joué d'ambiance : journal du 07/11, stopAmbiance sur un lecteur
   * jamais utilisé → gel au premier morceau).
   */
  const ambianceAppleLanceeRef = useRef(false);
  /** Lu au démontage : la phase suivante est-elle un morceau Apple du jeu ? */
  const sortieVersJeuRef = useRef(sortieVersJeu);
  sortieVersJeuRef.current = sortieVersJeu;
  const pauseSiEchecRef = useRef(pauseSiEchec);
  pauseSiEchecRef.current = pauseSiEchec;

  const appleNatif =
    appleSeul && playlistId !== null && playlistId !== '' && nativeMusicKit.isAvailable();
  const peutApple = enabled && appleNatif;

  const arreter = useCallback(async (options: { pause?: boolean } = {}): Promise<void> => {
    if (arreteRef.current) return;
    arreteRef.current = true;
    setSurApple(false);
    if (!ambianceAppleLanceeRef.current) return;
    ambianceAppleLanceeRef.current = false;
    await nativeMusicKit.stopAmbiance({ pause: options.pause !== false });
  }, []);

  useEffect(() => {
    if (!peutApple || playlistId === null) {
      tenteRef.current = false;
      setSurApple(false);
      return;
    }
    if (tenteRef.current) return;
    tenteRef.current = true;
    arreteRef.current = false;

    let vivant = true;
    let minuteur: number | null = null;
    const essayer = async (essai: number): Promise<void> => {
      if (!vivant) return;
      ambianceAppleLanceeRef.current = true;
      const ok = await nativeMusicKit.playPlaylist(playlistId, aleatoire);
      if (!vivant) return;
      if (ok) {
        setSurApple(true);
        remoteLog('ambiance', 'musique d attente Apple : lecture demandée', { playlistId, essai });
        return;
      }
      // Lecteur occupé (préchauffage, morceau en cours de démarrage) ou
      // refus : on réessaie un peu plus tard. Pas de boucle MP3 en secours —
      // c'est elle qui cassait le premier morceau Apple.
      if (essai < ESSAIS_AMBIANCE) {
        minuteur = window.setTimeout(() => void essayer(essai + 1), ECART_ESSAIS_MS);
      } else {
        if (pauseSiEchecRef.current) void nativeMusicKit.pause().catch(() => undefined);
        remoteLog(
          'ambiance',
          'musique d attente Apple : pas démarrée après plusieurs essais — salle sans musique d attente',
          { playlistId },
          'warn',
        );
      }
    };
    void essayer(1);

    return () => {
      vivant = false;
      if (minuteur !== null) window.clearTimeout(minuteur);
      if (ambianceAppleLanceeRef.current) {
        ambianceAppleLanceeRef.current = false;
        void nativeMusicKit.stopAmbiance({ pause: !sortieVersJeuRef.current });
      }
      setSurApple(false);
    };
  }, [peutApple, playlistId, aleatoire]);

  // Boucle MP3 intégrée : partout SAUF sur l'iPad natif quand Apple fait tout
  // le son (fix/un-seul-lecteur — même pas en secours).
  useSelectionBackgroundMusic({ enabled: enabled && !appleNatif });

  return { arreter, surApple };
}
