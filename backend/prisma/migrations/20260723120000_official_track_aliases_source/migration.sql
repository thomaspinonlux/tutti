-- fix/official-import-canonical — marqueur d'origine des title_aliases du cache
-- catalogue (heuristic | catalog | ai | null). Additif, nullable → zéro risque,
-- idempotent (IF NOT EXISTS) pour survivre à un éventuel desync migrate/DDL.
ALTER TABLE "official_playlist_tracks" ADD COLUMN IF NOT EXISTS "aliases_source" VARCHAR(16);
