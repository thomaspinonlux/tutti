-- feat/multi-animator-roles — rôle par participant (multi-animateurs + 2 profils).
CREATE TYPE "participant_role" AS ENUM ('PLAYER', 'ANIMATOR_FULL', 'ANIMATOR_PLAYING');

ALTER TABLE "participants" ADD COLUMN "role" "participant_role" NOT NULL DEFAULT 'PLAYER';

-- Rétro-compat : les masters existants deviennent animateurs-joueurs (comportement actuel).
UPDATE "participants" SET "role" = 'ANIMATOR_PLAYING' WHERE "is_master" = true;
