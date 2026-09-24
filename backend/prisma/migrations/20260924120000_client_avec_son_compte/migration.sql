-- feat/client-avec-son-compte + feat/offre-de-lancement
-- Trois nouveautés, toutes à l'arrêt par défaut : rien ne change tant que le
-- propriétaire n'a rien activé.
-- 1. Un client peut jouer avec SON abonnement Apple Music : il ne prend aucun
--    compte du parc et paie la grille réduite.
-- 2. Les comptes créés sur le site peuvent être validés automatiquement, sans
--    obligation de réserver ni de payer.
-- 3. Une remise (offre de lancement) s'applique au prix et reste visible.

ALTER TABLE "workspaces"
  ADD COLUMN IF NOT EXISTS "compte_apple_propre" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "reglages_reservation"
  ADD COLUMN IF NOT EXISTS "tarif_horaire_propre_cents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "tarif_horaire_propre_soir_cents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "validation_auto_comptes" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "reduction_pct" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "reduction_libelle" VARCHAR(60) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "reduction_fin" TIMESTAMPTZ(6);

-- Les réservations d'un client qui joue avec son compte n'occupent pas le parc.
ALTER TABLE "reservations"
  ADD COLUMN IF NOT EXISTS "compte_client" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "prix_plein_cents" INTEGER;
