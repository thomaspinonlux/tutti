-- Suite de 20260913120000 : le defaut suit le renommage. Transaction separee,
-- sinon PostgreSQL rejette la valeur d'enum renommee juste avant (22023).
-- Un membre cree sans role precise est un CLIENT, plus un compte a tous les droits.
ALTER TABLE "workspace_members" ALTER COLUMN "role" SET DEFAULT 'CLIENT';
