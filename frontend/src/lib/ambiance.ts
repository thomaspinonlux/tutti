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

const PAR_DEFAUT: ReglageAmbiance = { playlistId: null, aleatoire: true };

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
      playlistId: data.establishment.ambiance_playlist_id ?? null,
      aleatoire: data.establishment.ambiance_aleatoire !== false,
    };
  } catch {
    return PAR_DEFAUT;
  }
}
