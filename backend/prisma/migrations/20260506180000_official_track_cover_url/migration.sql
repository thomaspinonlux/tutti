-- Ajout colonne cover_url sur official_playlist_tracks pour stocker l'URL
-- de la cover album/track récupérée via Spotify lors de l'import.
-- Copiée dans Track.cover_url au clone-on-launch (POST /api/library/.../launch).
-- Null si non résolue (track non trouvée Spotify ou pas d'images).

ALTER TABLE "official_playlist_tracks"
  ADD COLUMN "cover_url" TEXT;
