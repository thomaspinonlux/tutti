-- Phase 5 — partage de playlist par code court

CREATE TABLE "playlist_share_codes" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "code"        VARCHAR(8) NOT NULL,
  "playlist_id" UUID NOT NULL,
  "created_by"  UUID NOT NULL,
  "max_uses"    INT,
  "uses_count"  INT NOT NULL DEFAULT 0,
  "expires_at"  TIMESTAMPTZ(6),
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

  CONSTRAINT "playlist_share_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "playlist_share_codes_code_key" ON "playlist_share_codes"("code");
CREATE INDEX "playlist_share_codes_code_idx" ON "playlist_share_codes"("code");
CREATE INDEX "playlist_share_codes_playlist_id_idx" ON "playlist_share_codes"("playlist_id");
