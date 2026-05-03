-- Phase 3.5+ — multi-select sources musicales actives
-- Remplace establishments.active_provider (String) par active_providers (String[])

ALTER TABLE "establishments"
  ADD COLUMN "active_providers" TEXT[] NOT NULL DEFAULT ARRAY['demo']::TEXT[];

-- Backfill: copie active_provider existant dans active_providers
UPDATE "establishments"
  SET "active_providers" = ARRAY["active_provider"]::TEXT[]
  WHERE "active_provider" IS NOT NULL;

-- Drop ancien champ
ALTER TABLE "establishments"
  DROP COLUMN "active_provider";
