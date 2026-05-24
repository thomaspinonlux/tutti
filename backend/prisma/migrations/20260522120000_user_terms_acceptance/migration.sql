-- feat/youtube-compliance — timestamp d'acceptation des CGU + Politique de
-- confidentialité, capturé via la checkbox required du signup.
--
-- WorkspaceMember = lien user↔workspace (Tutti délègue auth.users à Supabase
-- donc pas de model User Prisma). Stocker accepted_terms_at ici permet
-- d'auditer l'acceptation par membre/workspace.
--
-- Nullable pour rétro-compat : les comptes legacy créés avant cette PR
-- n'ont pas de timestamp. Re-prompt UI prévue dans une PR future si on
-- veut forcer l'acceptation rétroactive.

ALTER TABLE "workspace_members"
  ADD COLUMN "accepted_terms_at" TIMESTAMPTZ(6);
