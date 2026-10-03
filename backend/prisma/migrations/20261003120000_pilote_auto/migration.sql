-- feat/pilote-automatique — la console enchaîne seule.
-- Modifiable EN COURS DE PARTIE, contrairement à voice_enabled.
ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "pilote_auto" BOOLEAN NOT NULL DEFAULT false;
