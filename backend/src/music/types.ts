/**
 * Module Music Provider — abstraction centrale (étape 7).
 *
 * Tous les providers musicaux (Demo, Spotify, Deezer, Apple Music…)
 * implémentent cette interface. Le code de jeu ne dépend JAMAIS d'un
 * provider concret, il passe par le registre (`registry.ts`) qui résout
 * le provider actif d'un establishment.
 *
 * Pour ajouter un provider :
 *   1. Créer une classe qui implémente `MusicProvider`
 *   2. L'enregistrer dans `registry.ts` (un case dans la factory)
 *   3. C'est tout — aucun autre fichier à toucher.
 */

import type { MusicProviderId, ProviderCapabilities, TrackResult } from '@tutti/shared';

export interface SearchOptions {
  /** Limite le nombre de résultats (clamp côté provider via max_results). */
  limit?: number;
  /** Filtrage de marché / pays (codes ISO 3166-1 alpha-2). */
  market?: string;
  /** Code de langue ISO 639-1 (utile pour les paroles/aliases). */
  locale?: string;
}

/**
 * Contexte d'instanciation du provider :
 *   - `workspaceId` : pour scoping (ex. logging, rate limiting par tenant)
 *   - `credentials` : tokens OAuth chiffrés (Spotify, etc.) ou null pour Demo
 */
export interface ProviderContext {
  workspaceId: string;
  credentials?: {
    access_token: string;
    refresh_token: string | null;
    expires_at: Date | null;
  } | null;
}

export interface MusicProvider {
  /** Identifiant stable, jamais changé après mise en prod. */
  readonly id: MusicProviderId;

  /** Métadonnées exposées au frontend (pour adapter l'UI). */
  readonly capabilities: ProviderCapabilities;

  /**
   * Recherche un morceau par texte libre. Le provider est libre d'interpréter
   * (artiste + titre, hash, ID externe…). Doit retourner les résultats
   * triés par pertinence décroissante.
   */
  search(query: string, opts?: SearchOptions): Promise<TrackResult[]>;

  /**
   * Récupère un morceau par son `provider_track_id`. null si introuvable
   * (mais pas une erreur — l'appelant peut décider d'archiver ou de retirer
   * le morceau d'une playlist).
   */
  getTrack(providerTrackId: string): Promise<TrackResult | null>;
}
