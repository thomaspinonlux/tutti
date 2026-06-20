-- feat/guess-work-mode — colonnes pour le mode "devine l'œuvre".
--
-- OfficialPlaylist.guess_mode :
--   - null (défaut) : matching contre artist+title (mode standard).
--   - 'work'        : matching contre work_title + work_aliases.
--
-- OfficialPlaylistTrack.work_title : nom de l'œuvre (film/série/dessin animé)
-- dont la chanson est issue. Réponse à deviner si guess_mode='work'.
--
-- OfficialPlaylistTrack.work_aliases : alias acceptés pour work_title
-- (traductions, raccourcis). Mergés dans Track.aliases au clone-on-launch.

ALTER TABLE "official_playlists"
  ADD COLUMN "guess_mode" VARCHAR(16);

ALTER TABLE "official_playlist_tracks"
  ADD COLUMN "work_title" TEXT,
  ADD COLUMN "work_aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
