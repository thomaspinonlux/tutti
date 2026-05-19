-- feat/playlist-cache-and-availability-check — extension du flag de
-- jouabilité aux playlists workspace (en plus de la lib officielle).
--
-- `tracks` (workspace) : reçoit les mêmes 3 colonnes que
-- `official_playlist_tracks` pour bénéficier du même filtre is_playable=false
-- au clone-on-launch et du bouton "Vérifier la disponibilité" côté host.
--
-- `playlists` (workspace) : agrégats — date du dernier check + count des
-- tracks invalidés. Permet d'afficher un badge "✅ Tous OK / ⚠️ N indispo"
-- sur les cards playlist.

-- ── Track (workspace) ────────────────────────────────────────────────────
ALTER TABLE "tracks"
  ADD COLUMN "is_playable" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "playability_reason" TEXT,
  ADD COLUMN "playability_checked_at" TIMESTAMPTZ(6);

CREATE INDEX "tracks_is_playable_idx" ON "tracks" ("is_playable");

-- ── Playlist (workspace) ─────────────────────────────────────────────────
ALTER TABLE "playlists"
  ADD COLUMN "last_checked_at" TIMESTAMPTZ(6),
  ADD COLUMN "unplayable_count" INTEGER NOT NULL DEFAULT 0;
