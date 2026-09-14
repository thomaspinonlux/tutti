-- feat/parc-comptes-apple — parc de comptes Apple Music partages.
--
-- Un abonnement Apple Music = UN flux simultane. Pour faire tourner N soirees
-- en meme temps il faut N comptes. Ce parc les detient et en reserve un par
-- session ; au-dela, le lancement est refuse proprement.
--
-- AUCUN MOT DE PASSE N EST STOCKE : Apple ne delivre de jeton que via
-- music.authorize(), donc une connexion faite par une personne dans la fenetre
-- Apple. On conserve ce Music User Token, obtenu une fois par compte.
CREATE TABLE "apple_music_accounts" (
  "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
  "libelle"          VARCHAR(80)  NOT NULL,
  "account_email"    VARCHAR(200),
  "music_user_token" TEXT         NOT NULL,
  "expires_at"       TIMESTAMPTZ(6),
  "actif"            BOOLEAN      NOT NULL DEFAULT true,
  "verifie_le"       TIMESTAMPTZ(6),
  "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "apple_music_accounts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "sessions" ADD COLUMN "apple_music_account_id" UUID;

CREATE INDEX "sessions_apple_music_account_id_idx" ON "sessions"("apple_music_account_id");

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_apple_music_account_id_fkey"
  FOREIGN KEY ("apple_music_account_id") REFERENCES "apple_music_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
