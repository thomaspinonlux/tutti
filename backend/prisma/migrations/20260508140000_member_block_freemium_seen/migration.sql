-- feat/admin-users-and-email-notifications — gestion users côté super-admin :
-- - is_blocked + blocked_at/by : suspension manuelle, middleware retourne 403
-- - freemium_sessions_count + freemium_period_start : compteur usage gratuit
--   resetable depuis /admin/users
-- - last_seen_at : tracé pour tri "Dernière connexion"

ALTER TABLE "workspace_members"
  ADD COLUMN "is_blocked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "blocked_at" TIMESTAMPTZ(6),
  ADD COLUMN "blocked_by" UUID,
  ADD COLUMN "freemium_sessions_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "freemium_period_start" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "last_seen_at" TIMESTAMPTZ(6);

CREATE INDEX "workspace_members_is_blocked_idx"
  ON "workspace_members" ("is_blocked");
