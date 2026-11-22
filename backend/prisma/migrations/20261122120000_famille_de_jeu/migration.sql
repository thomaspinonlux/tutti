-- feat/back-office-en-familles — la famille de jeu choisie sur l'accueil du
-- back-office (quiz, jeux de salon, blind test simple) : elle ouvre le bon
-- onglet du choix du thème, sur la console comme sur le téléphone.
ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "famille" VARCHAR(16);
