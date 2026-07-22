-- feat/apple-music — réconciliation idempotente de apple_music_id.
--
-- La migration 20260721210000_add_apple_music_id a été enregistrée dans
-- _prisma_migrations (donc `migrate deploy` la considère appliquée), mais son
-- ALTER TABLE n'a jamais atterri sur la table physique en prod (desync :
-- Prisma "Unknown argument apple_music_id" côté runtime).
--
-- Comme la ligne existe déjà, Prisma ne rejouera JAMAIS ce SQL. On répare donc
-- via une nouvelle migration idempotente (IF NOT EXISTS) : elle s'applique au
-- prochain `migrate deploy` quel que soit l'état réel de la colonne, sans
-- jamais échouer si la colonne/l'index existent déjà.
ALTER TABLE "official_playlist_tracks" ADD COLUMN IF NOT EXISTS "apple_music_id" VARCHAR(64);
CREATE INDEX IF NOT EXISTS "official_playlist_tracks_apple_music_id_idx" ON "official_playlist_tracks"("apple_music_id");
