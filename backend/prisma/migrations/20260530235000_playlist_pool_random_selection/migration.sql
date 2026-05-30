-- feat/playlist-pool-random-selection
--   Playlist devient un POOL : on tire `default_session_size` tracks
--   aléatoirement à chaque round (anti-doublons via PR C SessionPlayedTrack).
--   SessionRound stocke le subset ordonné qui a été tiré pour cette manche.

ALTER TABLE "playlists"
  ADD COLUMN "default_session_size" INTEGER NOT NULL DEFAULT 15;

ALTER TABLE "session_rounds"
  ADD COLUMN "selected_track_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
