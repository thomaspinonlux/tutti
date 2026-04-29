-- Mode animateur (A) vs mode "tout le monde joue" (B).
--
-- has_animator : false par défaut côté Prisma (= mode B B2C, le défaut produit
-- pour les nouvelles sessions). On backfill les sessions existantes à TRUE
-- pour préserver leur comportement actuel (toutes les sessions pré-feature
-- étaient implicitement en mode A).
--
-- is_paused : flag de pause master (mode B). Le timer continue de courir
-- côté client, c'est juste l'audio qui s'arrête (V1 pragmatique). On
-- documentera l'amélioration si besoin.

ALTER TABLE sessions
  ADD COLUMN has_animator BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN is_paused BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill : toutes les sessions existantes étaient en mode "avec animateur".
UPDATE sessions SET has_animator = TRUE;
