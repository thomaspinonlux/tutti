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
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { nativeMusicKit } from './nativeMusicKit.js';
import { useSelectionBackgroundMusic } from './useSelectionBackgroundMusic.js';

interface Options {
  /** true = phase d'attente / entre-manches / sélection : il faut du son. */
  enabled: boolean;
  /** Playlist Apple Music de l'établissement (pl.xxxx), ou null. */
  playlistId: string | null;
  /** Lire la playlist en aléatoire. */
  aleatoire: boolean;
  /** Apple Music est connecté sur cette console. */
  appleConnected: boolean;
}

interface Resultat {
  /** Rend le lecteur à la partie. À appeler au lancement, avant le 1er morceau. */
  arreter: () => Promise<void>;
  /** true quand c'est la playlist Apple qui joue (et non la boucle MP3). */
  surApple: boolean;
}

export function useLobbyAmbiance({
  enabled,
  playlistId,
  aleatoire,
  appleConnected,
}: Options): Resultat {
  const [surApple, setSurApple] = useState(false);
  /** Garde-fou : une seule tentative par entrée en phase d'attente. */
  const tenteRef = useRef(false);
  const arreteRef = useRef(false);
  /**
   * fix/gel-au-demarrage — true seulement si la playlist Apple d'ambiance a
   * réellement été lancée sur le lecteur natif.
   *
   * Journal de l'iPad du 07/11 (essais de Thomas, 12:02 → 12:12) : à chaque
   * gel, la console avait appelé `stopAmbiance` quelques secondes avant le
   * premier morceau Apple, ALORS QU'AUCUNE AMBIANCE APPLE NE JOUAIT (c'est la
   * boucle MP3 qui joue). Sur un lecteur jamais utilisé, `stopAmbiance` fait
   * stop() + file vide ; le premier play() qui suit reste bloqué dans un appel
   * synchrone au service musique d'iOS (pile MetricKit : MusicKit →
   * MediaPlayer → Foundation → libxpc, attente sans fin) et l'iPad se fige.
   *   12:02:21 stopAmbiance → 12:02:29 préchauffage → GEL
   *   12:07:44 stopAmbiance → 12:07:49 préchauffage → GEL
   *   12:11:54 stopAmbiance → 12:11:59 préchauffage → GEL
   *   12:03:25 et 12:09:15, sans stopAmbiance avant → prêt en 0,4 et 0,7 s
   * On ne touche donc plus au lecteur Apple pour « rendre » une ambiance
   * qu'il n'a jamais jouée.
   */
  const ambianceAppleLanceeRef = useRef(false);

  const peutApple =
    enabled &&
    appleConnected &&
    playlistId !== null &&
    playlistId !== '' &&
    nativeMusicKit.isAvailable();

  const arreter = useCallback(async (): Promise<void> => {
    if (arreteRef.current) return;
    arreteRef.current = true;
    setSurApple(false);
    if (!ambianceAppleLanceeRef.current) return;
    ambianceAppleLanceeRef.current = false;
    await nativeMusicKit.stopAmbiance();
  }, []);

  useEffect(() => {
    if (!peutApple) {
      tenteRef.current = false;
      setSurApple(false);
      return;
    }
    if (tenteRef.current) return;
    tenteRef.current = true;
    arreteRef.current = false;

    let vivant = true;
    void (async () => {
      // Un binaire sans la méthode, une playlist introuvable ou un refus
      // d'Apple renvoient false : on laisse alors la boucle MP3 prendre le
      // relais plutôt que de laisser la salle en silence.
      ambianceAppleLanceeRef.current = true;
      const ok = await nativeMusicKit.playPlaylist(playlistId, aleatoire);
      if (vivant) setSurApple(ok);
    })();

    return () => {
      vivant = false;
      if (ambianceAppleLanceeRef.current) {
        ambianceAppleLanceeRef.current = false;
        void nativeMusicKit.stopAmbiance();
      }
      setSurApple(false);
    };
  }, [peutApple, playlistId, aleatoire]);

  // Repli : la boucle intégrée, sauf si la playlist Apple joue déjà.
  useSelectionBackgroundMusic({ enabled: enabled && !surApple });

  return { arreter, surApple };
}
