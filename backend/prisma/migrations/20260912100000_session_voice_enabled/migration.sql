-- feat/option-vocal — la reconnaissance vocale devient un reglage de partie.
-- false = partie 100 % ecrite : le buzzer vocal disparait du telephone des
-- joueurs, seule la saisie clavier reste. Defaut true : rien ne change pour
-- les parties existantes.
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "voice_enabled" BOOLEAN NOT NULL DEFAULT true;
