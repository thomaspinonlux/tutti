/**
 * ambiance.ts — feat/ambiance-salon
 *
 * Réglage de la musique d'ambiance du salon d'attente, lu par la console.
 * Vit sur l'établissement (un réglage par lieu, pas par partie) et s'édite
 * dans /admin/settings.
 */

import { api } from './api.js';

export interface ReglageAmbiance {
  /** Playlist Apple Music (pl.xxxx), ou null = boucle MP3 intégrée. */
  playlistId: string | null;
  aleatoire: boolean;
}

/**
 * fix/un-seul-lecteur — musique d'attente Apple par défaut (choix de Thomas,
 * 16/11) : « Chill House », playlist éditoriale Apple Music, catalogue FR,
 * aucun titre en commun avec le catalogue du blind test (vérifié le 16/11).
 * Utilisée seulement sur l'iPad natif avec Apple Music ; ailleurs, la boucle
 * MP3 intégrée reste.
 */
export const AMBIANCE_APPLE_PAR_DEFAUT = 'pl.bd55c25265aa4de8b3fc3e0960751846';

const PAR_DEFAUT: ReglageAmbiance = { playlistId: AMBIANCE_APPLE_PAR_DEFAUT, aleatoire: true };

/**
 * Best-effort : un échec (pas d'établissement, réseau) renvoie le réglage par
 * défaut, donc la boucle intégrée. Jamais d'erreur remontée — le silence dans
 * la salle est un bien moindre mal qu'une console qui refuse de démarrer.
 */
export async function getReglageAmbiance(): Promise<ReglageAmbiance> {
  try {
    const data = await api<{
      establishment: { ambiance_playlist_id: string | null; ambiance_aleatoire: boolean };
    }>('/api/establishment');
    return {
      playlistId: data.establishment.ambiance_playlist_id || AMBIANCE_APPLE_PAR_DEFAUT,
      aleatoire: data.establishment.ambiance_aleatoire !== false,
    };
  } catch {
    return PAR_DEFAUT;
  }
}
