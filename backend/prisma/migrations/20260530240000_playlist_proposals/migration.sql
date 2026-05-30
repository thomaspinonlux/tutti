-- feat/tv-playlist-carousel — propositions de playlists par joueurs en lobby.

CREATE TABLE "playlist_proposals" (
  "id"                   UUID                NOT NULL DEFAULT gen_random_uuid(),
  "session_id"           UUID                NOT NULL,
  "participant_id"       UUID                NOT NULL,
  "official_playlist_id" UUID                NOT NULL,
  "playlist_name"        VARCHAR(200)        NOT NULL,
  "created_at"           TIMESTAMPTZ(6)      NOT NULL DEFAULT NOW(),
  CONSTRAINT "playlist_proposals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "playlist_proposals_session_participant_official_key"
  ON "playlist_proposals"("session_id", "participant_id", "official_playlist_id");

CREATE INDEX "playlist_proposals_session_id_idx"
  ON "playlist_proposals"("session_id");

CREATE INDEX "playlist_proposals_official_playlist_id_idx"
  ON "playlist_proposals"("official_playlist_id");

ALTER TABLE "playlist_proposals"
  ADD CONSTRAINT "playlist_proposals_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE;

ALTER TABLE "playlist_proposals"
  ADD CONSTRAINT "playlist_proposals_participant_id_fkey"
  FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE CASCADE;
