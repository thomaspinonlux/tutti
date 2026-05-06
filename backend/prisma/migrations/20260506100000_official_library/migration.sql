-- Bibliothèque officielle Tutti — catalogue propriétaire.
-- Stockage en DB Supabase. Tracks matchés via Spotify Search + YouTube Data v3
-- au moment de l'import (script scripts/import-official-library.ts).
-- Au runtime, le joueur lit ces morceaux via Web Playback SDK avec son propre
-- compte. Tutti ne stocke ni redistribue aucun fichier audio.

-- ── Enum visibility ─────────────────────────────────────────────────────────

CREATE TYPE "official_visibility" AS ENUM ('public', 'premium_only', 'private');

-- ── Table official_playlists ────────────────────────────────────────────────

CREATE TABLE "official_playlists" (
    "id"               UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug"             VARCHAR(120) NOT NULL,
    "name_fr"          TEXT NOT NULL,
    "name_en"          TEXT NOT NULL,
    "description_fr"   TEXT,
    "description_en"   TEXT,
    "locale_primary"   VARCHAR(8) NOT NULL,
    "theme"            VARCHAR(80),
    "difficulty"       "level" NOT NULL DEFAULT 'MEDIUM',
    "visibility"       "official_visibility" NOT NULL DEFAULT 'public',
    "track_count"      INTEGER NOT NULL DEFAULT 0,
    "created_by_admin" UUID,
    "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "official_playlists_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "official_playlists_slug_key" ON "official_playlists"("slug");
CREATE INDEX "official_playlists_visibility_idx" ON "official_playlists"("visibility");
CREATE INDEX "official_playlists_locale_primary_idx" ON "official_playlists"("locale_primary");

-- ── Table official_playlist_tracks ──────────────────────────────────────────

CREATE TABLE "official_playlist_tracks" (
    "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
    "playlist_id"       UUID NOT NULL,
    "position"          INTEGER NOT NULL,
    "title"             TEXT NOT NULL,
    "artist"            TEXT NOT NULL,
    "year"              INTEGER,
    "difficulty"        "level" NOT NULL DEFAULT 'MEDIUM',
    "spotify_id"        VARCHAR(40),
    "youtube_id"        VARCHAR(40),
    "answers_accepted"  JSONB,
    "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "official_playlist_tracks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "official_playlist_tracks_playlist_id_fkey"
        FOREIGN KEY ("playlist_id")
        REFERENCES "official_playlists"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "official_playlist_tracks_playlist_id_position_key"
  ON "official_playlist_tracks"("playlist_id", "position");
CREATE INDEX "official_playlist_tracks_playlist_id_idx"
  ON "official_playlist_tracks"("playlist_id");
CREATE INDEX "official_playlist_tracks_spotify_id_idx"
  ON "official_playlist_tracks"("spotify_id");
CREATE INDEX "official_playlist_tracks_youtube_id_idx"
  ON "official_playlist_tracks"("youtube_id");
