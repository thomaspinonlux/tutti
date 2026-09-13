-- Le role HOST devient CLIENT (aucun membre ne le portait : 26 membres, tous OWNER).
ALTER TYPE "role" RENAME VALUE 'HOST' TO 'CLIENT';

-- Le defaut suit le renommage : un membre cree sans role precise est un CLIENT,
-- plus un compte a tous les droits.
ALTER TABLE "workspace_members" ALTER COLUMN "role" SET DEFAULT 'CLIENT';
