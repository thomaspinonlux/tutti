-- feat/reservation-de-creneaux
--
-- Parcours : DEMANDE -> ACCEPTATION (le proprietaire fixe le prix) -> PAIEMENT.
-- Capacite : un compte Apple Music = une partie, et un compte reste toujours
-- libre pour la brasserie -> creneaux clients simultanes <= comptes actifs - 1.
--
-- Migration purement additive : trois tables, un type, aucune colonne touchee
-- dans l existant.

-- CreateEnum
CREATE TYPE "statut_reservation" AS ENUM ('DEMANDEE', 'ACCEPTEE', 'PAYEE', 'GRATUITE', 'REFUSEE', 'ANNULEE');

-- CreateTable
CREATE TABLE "reservations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "demandeur_user_id" UUID NOT NULL,
    "demandeur_email" VARCHAR(320),
    "debut" TIMESTAMPTZ(6) NOT NULL,
    "fin" TIMESTAMPTZ(6) NOT NULL,
    "statut" "statut_reservation" NOT NULL DEFAULT 'DEMANDEE',
    "prix_cents" INTEGER,
    "devise" VARCHAR(3) NOT NULL DEFAULT 'eur',
    "code_gratuit_id" UUID,
    "message_client" VARCHAR(500),
    "motif_refus" VARCHAR(500),
    "stripe_checkout_id" VARCHAR(255),
    "stripe_payment_intent" VARCHAR(255),
    "payee_le" TIMESTAMPTZ(6),
    "decidee_le" TIMESTAMPTZ(6),
    "decidee_par" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "codes_gratuits" (
    "id" UUID NOT NULL,
    "code" VARCHAR(24) NOT NULL,
    "note" VARCHAR(200),
    "utilisations_max" INTEGER NOT NULL DEFAULT 1,
    "utilisations" INTEGER NOT NULL DEFAULT 0,
    "expire_le" TIMESTAMPTZ(6),
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "cree_par" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "codes_gratuits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reglages_reservation" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "duree_min_minutes" INTEGER NOT NULL DEFAULT 60,
    "duree_max_minutes" INTEGER NOT NULL DEFAULT 360,
    "ouverture_avant_minutes" INTEGER NOT NULL DEFAULT 30,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reglages_reservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reservations_stripe_checkout_id_key" ON "reservations"("stripe_checkout_id");

-- CreateIndex
CREATE INDEX "reservations_statut_debut_idx" ON "reservations"("statut", "debut");

-- CreateIndex
CREATE INDEX "reservations_workspace_id_debut_idx" ON "reservations"("workspace_id", "debut");

-- CreateIndex
CREATE UNIQUE INDEX "codes_gratuits_code_key" ON "codes_gratuits"("code");

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_code_gratuit_id_fkey" FOREIGN KEY ("code_gratuit_id") REFERENCES "codes_gratuits"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Les reservations portent des e-mails et des identifiants de paiement : elles
-- ne doivent jamais etre lisibles par la cle publique de Supabase. RLS active
-- SANS politique ferme l acces a anon/authenticated ; le backend, proprietaire
-- des tables, n est pas concerne.
ALTER TABLE "reservations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "codes_gratuits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reglages_reservation" ENABLE ROW LEVEL SECURITY;

-- La ligne unique des reglages, pour que la premiere lecture trouve quelque chose.
INSERT INTO "reglages_reservation" ("id", "updated_at") VALUES (1, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
