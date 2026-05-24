-- feat/youtube-compliance — colonne last_refreshed_at pour les tracks
-- (workspace + officielle) afin de tracker le dernier rafraîchissement
-- automatique par le cron job 30 jours.
--
-- YouTube API Services Developer Policies III.E.4 : les données API
-- stockées (statut, embeddable, region restriction) doivent être
-- rafraîchies ou supprimées au moins tous les 30 jours.
--
-- Différent de `playability_checked_at` (PR #37) qui correspond aux
-- check-availability ON-DEMAND déclenchés par l'utilisateur. Le cron utilise
-- son propre timestamp pour planifier les batches indépendamment des
-- vérifications manuelles.
--
-- Index pour permettre des queries efficaces du cron :
--   WHERE last_refreshed_at IS NULL OR last_refreshed_at < NOW() - INTERVAL '30 days'

ALTER TABLE "tracks"
  ADD COLUMN "last_refreshed_at" TIMESTAMPTZ(6);

CREATE INDEX "tracks_last_refreshed_at_idx" ON "tracks" ("last_refreshed_at");

ALTER TABLE "official_playlist_tracks"
  ADD COLUMN "last_refreshed_at" TIMESTAMPTZ(6);

CREATE INDEX "official_playlist_tracks_last_refreshed_at_idx"
  ON "official_playlist_tracks" ("last_refreshed_at");
