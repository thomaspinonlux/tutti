-- Problème A (fix/playback-and-zombies-v4) — Validation YouTube embeddable +
-- region restriction. Le script validate-youtube-ids.ts batch GET YouTube
-- Data API videos endpoint (status,contentDetails) et flag is_playable=false
-- pour les vidéos non-embeddable, retirées, ou bloquées FR/LU.
--
-- Le host frontend skip ces tracks au clone-on-launch (POST /api/library/
-- playlists/:id/launch) → playlist effective ne contient que les playable.

ALTER TABLE "official_playlist_tracks"
  ADD COLUMN "is_playable" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "playability_reason" TEXT,
  ADD COLUMN "playability_checked_at" TIMESTAMPTZ(6);

CREATE INDEX "official_playlist_tracks_is_playable_idx"
  ON "official_playlist_tracks" ("is_playable");
