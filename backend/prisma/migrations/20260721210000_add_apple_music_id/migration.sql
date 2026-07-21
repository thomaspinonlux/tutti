-- feat/apple-music (étape 1) — colonne additive apple_music_id + index.
-- Aucune donnée existante touchée (nullable, sans default non-null).
ALTER TABLE "official_playlist_tracks" ADD COLUMN "apple_music_id" VARCHAR(64);
CREATE INDEX "official_playlist_tracks_apple_music_id_idx" ON "official_playlist_tracks"("apple_music_id");
