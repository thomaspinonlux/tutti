-- Phase 3.5 — OAuth YouTube Premium (scope youtube.readonly)

ALTER TABLE "workspace_members"
  ADD COLUMN "youtube_access_token"     TEXT,
  ADD COLUMN "youtube_refresh_token"    TEXT,
  ADD COLUMN "youtube_token_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "youtube_premium"          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "youtube_connected_at"     TIMESTAMPTZ(6),
  ADD COLUMN "youtube_account_email"    VARCHAR(320);
