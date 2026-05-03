-- Phase 4 — Mode C : approbation manuelle des comptes + whitelist + codes invitation

-- 1) Enum member_status
CREATE TYPE "member_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- 2) Workspace_members : ajout des colonnes status / email / invitation_code_used / approved_*
ALTER TABLE "workspace_members"
  ADD COLUMN "status" "member_status" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "email" VARCHAR(320),
  ADD COLUMN "invitation_code_used" VARCHAR(16),
  ADD COLUMN "approved_at" TIMESTAMPTZ(6),
  ADD COLUMN "approved_by" UUID;

-- Tous les membres existants (créés avant Phase 4) sont auto-approuvés
-- pour ne pas casser les sessions en cours.
UPDATE "workspace_members"
  SET "status" = 'APPROVED',
      "approved_at" = NOW()
  WHERE "status" = 'PENDING';

CREATE INDEX "workspace_members_status_idx" ON "workspace_members"("status");

-- 3) Table whitelist_emails (super admin uniquement)
CREATE TABLE "whitelist_emails" (
  "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
  "email"      VARCHAR(320) NOT NULL,
  "note"       VARCHAR(500),
  "added_by"   UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

  CONSTRAINT "whitelist_emails_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whitelist_emails_email_key" ON "whitelist_emails"("email");

-- 4) Table invitation_codes (super admin uniquement)
CREATE TABLE "invitation_codes" (
  "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
  "code"          VARCHAR(16) NOT NULL,
  "note"          VARCHAR(500),
  "created_by"    UUID NOT NULL,
  "max_uses"      INT,
  "uses_count"    INT NOT NULL DEFAULT 0,
  "expires_at"    TIMESTAMPTZ(6),
  "first_used_at" TIMESTAMPTZ(6),
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

  CONSTRAINT "invitation_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invitation_codes_code_key" ON "invitation_codes"("code");
CREATE INDEX "invitation_codes_code_idx" ON "invitation_codes"("code");
