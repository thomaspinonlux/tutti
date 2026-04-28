/**
 * Augmente Express Request avec les champs injectés par les middlewares
 * d'auth (`auth`) et de tenant (`tenant`).
 *
 * Utilise `declare global` pour augmenter le namespace Express partout
 * dans le projet sans avoir besoin d'importer ce fichier.
 */

export {};

declare global {
  namespace Express {
    interface Request {
      /** ID du user Supabase Auth (auth.users.id), injecté par middleware auth. */
      userId?: string;
      /** Email du user, injecté par middleware auth (pour logs/debug). */
      userEmail?: string;
      /** ID du workspace courant, injecté par middleware tenant. */
      workspaceId?: string;
    }
  }
}
