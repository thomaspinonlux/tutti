-- feat/acces-gratuit — laissez-passer par maison.
-- Le créneau payé reste obligatoire pour ouvrir une partie ; cette coche, à
-- l'arrêt par défaut, dispense une maison précise (un ami, un essai, un
-- partenaire) d'en réserver un.
ALTER TABLE "workspaces"
  ADD COLUMN IF NOT EXISTS "acces_gratuit" BOOLEAN NOT NULL DEFAULT false;
