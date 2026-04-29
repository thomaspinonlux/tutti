-- Bucket Supabase Storage pour les logos d'établissement (étape 6).
-- Public en lecture (les logos s'affichent dans toute l'app).
-- Écriture / mise à jour / suppression réservée aux membres du workspace
-- propriétaire de l'establishment, via les politiques storage RLS ci-dessous.
--
-- Convention de chemin : <workspace_id>/<filename>.<ext>
-- (le path commence par le workspace_id pour faciliter le contrôle d'accès)

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'establishment-logos',
  'establishment-logos',
  true,
  2097152,                                              -- 2 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ───── Policies storage.objects pour ce bucket ────────────────────────────

-- Lecture publique (le bucket est public, mais on déclare la policy pour
-- la cohérence si quelqu'un toggle le flag).
DROP POLICY IF EXISTS "logos_public_read" ON storage.objects;
CREATE POLICY "logos_public_read" ON storage.objects FOR SELECT
USING (bucket_id = 'establishment-logos');

-- Helper : extraire le workspace_id à partir du chemin de l'objet.
-- Le path est de la forme '<workspace_id>/<filename>'.
-- storage.foldername() retourne le tableau des dossiers parent.
DROP POLICY IF EXISTS "logos_insert_own_workspace" ON storage.objects;
CREATE POLICY "logos_insert_own_workspace" ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'establishment-logos'
  AND (storage.foldername(name))[1]::uuid IN (SELECT public.user_workspace_ids())
);

DROP POLICY IF EXISTS "logos_update_own_workspace" ON storage.objects;
CREATE POLICY "logos_update_own_workspace" ON storage.objects FOR UPDATE
USING (
  bucket_id = 'establishment-logos'
  AND (storage.foldername(name))[1]::uuid IN (SELECT public.user_workspace_ids())
);

DROP POLICY IF EXISTS "logos_delete_own_workspace" ON storage.objects;
CREATE POLICY "logos_delete_own_workspace" ON storage.objects FOR DELETE
USING (
  bucket_id = 'establishment-logos'
  AND (storage.foldername(name))[1]::uuid IN (SELECT public.user_workspace_ids())
);
