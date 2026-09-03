-- fix/morceaux-en-double
-- Un même couple (fournisseur, identifiant du morceau) ne peut plus exister
-- deux fois. Les doublons existants ont été fusionnés au préalable ; l'index
-- est créé de façon idempotente pour rester rejouable sans risque.
CREATE UNIQUE INDEX IF NOT EXISTS "tracks_provider_provider_track_id_key"
  ON "tracks" ("provider", "provider_track_id");
