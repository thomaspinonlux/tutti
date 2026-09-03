-- perf/tableau-de-bord-vocal
-- Les statistiques vocales filtrent sur la date de création. Sans index, la
-- requête balaie l'intégralité de la table la plus volumineuse du jeu.
CREATE INDEX IF NOT EXISTS "voice_transcripts_created_at_idx"
  ON "voice_transcripts" ("created_at");
