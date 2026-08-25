-- feat/synced-lyrics — cache des paroles SYNCHRONISÉES (format LRC).
--
-- Contexte : Apple ne fournit PAS le texte des paroles par API (MusicKit
-- expose seulement `hasLyrics`). La source retenue est LRCLIB
-- (https://lrclib.net) — API publique, sans clé, LRC ligne par ligne.
--
-- Règle produit : on n'affiche QUE des paroles vérifiées. `status='ok'` est le
-- SEUL état affichable ; `unusable` (rien d'exploitable) et `rejected` (rejet
-- manuel d'un animateur via « Paroles fausses ») font disparaître le bouton.
-- Aucun affichage « meilleur effort ».
--
-- La table est remplie HORS LIGNE par `pnpm prefetch:lyrics` — jamais à la
-- volée pendant une partie (aucun appel réseau dans le chemin de jeu).
--
-- Additive : aucune table existante n'est modifiée (hors la relation
-- optionnelle vers songs, portée par la FK ci-dessous).

CREATE TABLE IF NOT EXISTS "track_lyrics" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" VARCHAR(32) NOT NULL,
    "provider_track_id" VARCHAR(128) NOT NULL,
    "song_id" UUID,
    "source" VARCHAR(16) NOT NULL,
    "source_id" INTEGER,
    "provider_duration_ms" INTEGER NOT NULL,
    "source_duration_ms" INTEGER,
    "synced_lrc" TEXT,
    "line_count" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(16) NOT NULL,
    "reason" TEXT,
    "fetched_at" TIMESTAMPTZ(6),
    "checked_at" TIMESTAMPTZ(6),
    "rejected_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "track_lyrics_pkey" PRIMARY KEY ("id")
);

-- Une seule entrée de paroles par (provider, id provider) : c'est la clé de
-- lecture du gameplay (getUsableLyrics) et la clé d'upsert du prefetch.
CREATE UNIQUE INDEX IF NOT EXISTS "track_lyrics_provider_provider_track_id_key"
    ON "track_lyrics"("provider", "provider_track_id");

-- Bilans par statut (rapports de prefetch, requêtes d'audit).
CREATE INDEX IF NOT EXISTS "track_lyrics_status_idx" ON "track_lyrics"("status");

-- SetNull : supprimer une chanson canonique ne doit pas détruire le cache de
-- paroles (il reste adressable par provider + provider_track_id).
ALTER TABLE "track_lyrics"
    ADD CONSTRAINT "track_lyrics_song_id_fkey"
    FOREIGN KEY ("song_id") REFERENCES "songs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
