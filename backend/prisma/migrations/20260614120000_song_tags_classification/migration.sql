-- feat/song-tags-classification (ÉTAPE 1)
-- Tags de classification portés par la chanson canonique : themes[] (multi),
-- langue (2 booléens indépendants), niveau 1/2/3, et œuvre (work_title/kind).
-- Une playlist devient une requête (theme, langue, niveau_max) sur ces tags.
-- 100% ADDITIF : colonnes nullable ou à défaut, aucune donnée existante touchée.
-- (SQL généré par `prisma migrate diff` — aucun drift vs schema.prisma.)

-- AlterTable
ALTER TABLE "songs" ADD COLUMN     "is_francophone" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "is_international" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "level" INTEGER,
ADD COLUMN     "tags_reviewed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "themes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "work_kind" VARCHAR(24),
ADD COLUMN     "work_title" TEXT;

-- CreateIndex
CREATE INDEX "songs_level_idx" ON "songs"("level");

-- CreateIndex
CREATE INDEX "songs_themes_idx" ON "songs" USING GIN ("themes");
