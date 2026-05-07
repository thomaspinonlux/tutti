-- Bug 4 (fix/critical-bugs-v3) — Ajoute updated_at sur sessions pour
-- permettre orderBy updated_at desc dans findRepresentativeSession.
-- Une session ENDED via POST /:id/end aura un updated_at plus récent
-- qu'une zombie PLAYING jamais touchée → la TV affiche le bon FINAL_PODIUM.
--
-- Backfill : updated_at = COALESCE(ended_at, started_at, created_at) pour
-- préserver un ordre cohérent sur les rows existantes (sinon toutes
-- auraient le même timestamp = NOW() au moment du run de migration).

ALTER TABLE "sessions"
  ADD COLUMN "updated_at" TIMESTAMPTZ(6);

UPDATE "sessions"
SET "updated_at" = COALESCE("ended_at", "started_at", "created_at");

ALTER TABLE "sessions"
  ALTER COLUMN "updated_at" SET NOT NULL,
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
