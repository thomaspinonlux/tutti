-- feat/ambiance-salon — musique d'ambiance pendant que les joueurs se connectent.
-- Vide => l'app retombe sur la boucle MP3 embarquée (selection-loop.mp3).
ALTER TABLE "establishments"
  ADD COLUMN IF NOT EXISTS "ambiance_playlist_id" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "ambiance_aleatoire" BOOLEAN NOT NULL DEFAULT true;
