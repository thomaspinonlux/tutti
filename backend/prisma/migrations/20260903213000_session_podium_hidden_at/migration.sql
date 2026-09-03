-- feat/classement-final-persistant
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "podium_hidden_at" TIMESTAMPTZ(6);
