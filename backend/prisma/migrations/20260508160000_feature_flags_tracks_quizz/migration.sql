-- feat/granular-tracks-quizz-access — flags par user pour contrôler accès
-- aux modes Tutti (Blind Test Tracks + Quizz). Défaut true (rétro-compat,
-- comportement existant inchangé pour les users actifs).

ALTER TABLE "workspace_members"
  ADD COLUMN "can_use_tracks" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "can_use_quizz" BOOLEAN NOT NULL DEFAULT true;
