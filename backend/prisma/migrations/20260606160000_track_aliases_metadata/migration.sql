-- feat/ai-aliases-voice-matching — métadonnées génération aliases
-- Source/timestamp de la dernière génération d'aliases pour les Tracks et Artists.
-- Permet à l'admin UI + script CLI de cibler les rows non encore générées.

ALTER TABLE "tracks" ADD COLUMN "aliases_generated_at" TIMESTAMPTZ(6);
ALTER TABLE "tracks" ADD COLUMN "aliases_source" VARCHAR(16);

ALTER TABLE "artists" ADD COLUMN "aliases_generated_at" TIMESTAMPTZ(6);
ALTER TABLE "artists" ADD COLUMN "aliases_source" VARCHAR(16);

CREATE INDEX "tracks_aliases_generated_at_idx" ON "tracks"("aliases_generated_at");
CREATE INDEX "artists_aliases_generated_at_idx" ON "artists"("aliases_generated_at");
