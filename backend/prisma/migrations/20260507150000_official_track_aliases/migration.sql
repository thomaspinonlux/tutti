-- feat/official-library-aliases — Ajoute artist_aliases + title_aliases sur
-- official_playlist_tracks. Mêmes sémantiques que Artist.aliases / Track.aliases
-- côté playlists perso. Curés par les super-admins via /admin/library, mergés
-- au clone-on-launch dans Artist + Track pour que voiceMatch les reconnaisse.

ALTER TABLE "official_playlist_tracks"
  ADD COLUMN "artist_aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "title_aliases"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
