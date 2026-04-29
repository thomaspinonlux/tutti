/**
 * Helper d'upload vers Supabase Storage.
 *
 * Convention de chemin : <workspace_id>/<filename>.<ext>
 * Le bucket `establishment-logos` est public en lecture, écriture limitée
 * aux membres du workspace via RLS storage policies.
 */

import { supabase } from './supabase.js';

interface UploadResult {
  /** URL publique du fichier uploadé. */
  publicUrl: string;
  /** Chemin dans le bucket (utile pour delete ultérieur). */
  path: string;
}

/**
 * Upload un logo d'établissement.
 *
 * @param workspaceId  ID du workspace courant (= premier dossier dans le path)
 * @param file         Fichier à envoyer (max 2 MB, types autorisés par le bucket)
 */
export async function uploadEstablishmentLogo(
  workspaceId: string,
  file: File,
): Promise<UploadResult> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png';
  // Cache-buster timestamp pour forcer le refresh des CDN après remplacement.
  const path = `${workspaceId}/logo-${Date.now()}.${ext}`;

  const { error } = await supabase.storage.from('establishment-logos').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type,
  });

  if (error) {
    throw new Error(error.message);
  }

  const { data } = supabase.storage.from('establishment-logos').getPublicUrl(path);
  return { publicUrl: data.publicUrl, path };
}
