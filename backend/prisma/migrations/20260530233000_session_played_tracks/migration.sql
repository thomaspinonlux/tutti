-- feat/session-no-duplicate-tracks — anti-doublon cross-playlist par session.

CREATE TABLE "session_played_tracks" (
  "id"         UUID                          NOT NULL DEFAULT gen_random_uuid(),
  "session_id" UUID                          NOT NULL,
  "track_id"   UUID                          NOT NULL,
  "played_at"  TIMESTAMPTZ(6)                NOT NULL DEFAULT NOW(),
  CONSTRAINT "session_played_tracks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "session_played_tracks_session_id_track_id_key"
  ON "session_played_tracks"("session_id", "track_id");

CREATE INDEX "session_played_tracks_session_id_idx"
  ON "session_played_tracks"("session_id");

ALTER TABLE "session_played_tracks"
  ADD CONSTRAINT "session_played_tracks_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE;

ALTER TABLE "session_played_tracks"
  ADD CONSTRAINT "session_played_tracks_track_id_fkey"
  FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE CASCADE;
