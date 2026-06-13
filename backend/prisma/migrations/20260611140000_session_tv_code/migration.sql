-- feat/tv-join-code-multidevice
-- Code court (5 chars, alphabet non ambigu) pour qu'un 2e device rejoigne
-- une session en mode "Écran TV". Nullable + unique. Additif.

ALTER TABLE "sessions" ADD COLUMN "tv_code" VARCHAR(8);
CREATE UNIQUE INDEX "sessions_tv_code_key" ON "sessions"("tv_code");
