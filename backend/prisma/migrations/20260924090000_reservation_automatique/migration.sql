-- feat/reservation-automatique — tarif horaire et validation automatique.
-- Tant que les tarifs valent 0, rien ne change : le propriétaire continue
-- d'accepter chaque demande et de fixer le prix à la main.
ALTER TABLE "reglages_reservation"
  ADD COLUMN IF NOT EXISTS "tarif_horaire_cents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "tarif_horaire_soir_cents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "heure_soiree_debut" INTEGER NOT NULL DEFAULT 18,
  ADD COLUMN IF NOT EXISTS "jours_soiree" VARCHAR(20) NOT NULL DEFAULT '5,6',
  ADD COLUMN IF NOT EXISTS "validation_automatique" BOOLEAN NOT NULL DEFAULT false;
