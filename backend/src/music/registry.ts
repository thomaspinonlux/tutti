/**
 * Registry des providers musicaux — point d'entrée unique pour résoudre
 * un provider à partir d'un identifiant + contexte tenant.
 *
 * Pour ajouter un provider (ex. Spotify) :
 *   1. Créer `src/music/spotify/SpotifyProvider.ts` qui implémente MusicProvider
 *   2. Ajouter un case dans `getProvider()` ci-dessous
 *   3. Ajouter le ProviderInfo dans LIST_PROVIDERS si on veut l'exposer en /api/music/providers
 *
 * Aucun autre fichier ne doit être modifié.
 */

import type { MusicProviderId, ProviderInfo } from '@tutti/shared';
import type { MusicProvider, ProviderContext } from './types.js';
import { DemoProvider } from './demo/DemoProvider.js';
import { SPOTIFY_CAPABILITIES, SpotifyProvider } from './spotify/SpotifyProvider.js';

/**
 * Liste les providers disponibles + leurs capacités.
 * Sert au frontend pour afficher la sélection dans /admin/settings.
 */
export const LIST_PROVIDERS: ProviderInfo[] = [
  { id: 'demo', capabilities: new DemoProvider().capabilities },
  { id: 'spotify', capabilities: SPOTIFY_CAPABILITIES },
];

/**
 * Résout un MusicProvider concret pour un establishment donné.
 * `ctx.credentials` est requis pour les providers OAuth (Spotify, Deezer).
 *
 * @throws Error si le provider est inconnu ou nécessite des credentials manquants.
 */
export function getProvider(id: MusicProviderId, ctx: ProviderContext): MusicProvider {
  switch (id) {
    case 'demo':
      // Pas de credentials nécessaires.
      return new DemoProvider();

    case 'spotify':
      if (!ctx.credentials) {
        throw new Error(
          'Spotify non connecté pour ce workspace — passer par /api/auth/spotify/authorize',
        );
      }
      return new SpotifyProvider(ctx.workspaceId, ctx.credentials);

    case 'deezer':
    case 'apple_music':
      throw new Error(`Provider ${id} prévu pour la V2`);

    default: {
      // Type-check exhaustivité : si MusicProviderId gagne un nouveau membre,
      // TypeScript émet une erreur ici tant qu'un case n'est pas ajouté.
      const _exhaustive: never = id;
      void _exhaustive;
      throw new Error(`Provider inconnu: ${id as string}`);
    }
  }
}
