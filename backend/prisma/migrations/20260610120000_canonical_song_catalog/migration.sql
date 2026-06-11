-- feat/canonical-song-catalog
-- Catalogue canonique de chansons : les aliases appartiennent à la CHANSON
-- (titre+artiste normalisés), pas au videoId. Additif uniquement — aucune
-- colonne existante modifiée, song_id nullable backfillé par script.

-- CreateTable
CREATE TABLE "songs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "artist_id" UUID NOT NULL,
    "canonical_title" TEXT NOT NULL,
    "normalized_key" VARCHAR(300) NOT NULL,
    "title_aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "aliases_source" VARCHAR(16),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "songs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "songs_normalized_key_key" ON "songs"("normalized_key");
CREATE INDEX "songs_artist_id_idx" ON "songs"("artist_id");

-- AddForeignKey
ALTER TABLE "songs" ADD CONSTRAINT "songs_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "artists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable tracks
ALTER TABLE "tracks" ADD COLUMN "song_id" UUID;
CREATE INDEX "tracks_song_id_idx" ON "tracks"("song_id");
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_song_id_fkey" FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable official_playlist_tracks
ALTER TABLE "official_playlist_tracks" ADD COLUMN "song_id" UUID;
CREATE INDEX "official_playlist_tracks_song_id_idx" ON "official_playlist_tracks"("song_id");
ALTER TABLE "official_playlist_tracks" ADD CONSTRAINT "official_playlist_tracks_song_id_fkey" FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
