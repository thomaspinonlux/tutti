-- feat/playlist-categories-schema — refonte présentation playlists
-- inspirée "This Is Blind Test" : groupes par catégories horizontales.

ALTER TABLE "official_playlists"
  ADD COLUMN "category"             VARCHAR(40),
  ADD COLUMN "position_in_category" INTEGER,
  ADD COLUMN "subtitle_fr"          VARCHAR(200),
  ADD COLUMN "subtitle_en"          VARCHAR(200);

CREATE INDEX "official_playlists_category_position_in_category_idx"
  ON "official_playlists"("category", "position_in_category");

-- Backfill : assigne une catégorie par heuristique sur slug + theme.
-- Patterns observés ("italo-disco-classics", "french-pop-2010s", etc.).
-- Une playlist non-matchée reste category=NULL → groupée dans "uncategorized"
-- côté API (silencieusement, frontend l'affiche en dernier).

UPDATE "official_playlists" SET "category" = 'decades'
  WHERE "category" IS NULL AND (
    slug ILIKE '%80s%' OR slug ILIKE '%90s%' OR slug ILIKE '%2000s%' OR
    slug ILIKE '%2010s%' OR slug ILIKE '%70s%' OR slug ILIKE '%60s%' OR
    theme ILIKE '%decade%'
  );

UPDATE "official_playlists" SET "category" = 'wedding'
  WHERE "category" IS NULL AND (
    slug ILIKE '%wedding%' OR slug ILIKE '%mariage%' OR
    slug ILIKE '%love%' OR slug ILIKE '%slow%' OR
    theme ILIKE '%love%' OR theme ILIKE '%wedding%'
  );

UPDATE "official_playlists" SET "category" = 'special'
  WHERE "category" IS NULL AND (
    slug ILIKE '%eurovision%' OR slug ILIKE '%disney%' OR
    slug ILIKE '%movie%' OR slug ILIKE '%film%' OR slug ILIKE '%bo-%' OR
    slug ILIKE '%james-bond%' OR slug ILIKE '%christmas%' OR slug ILIKE '%noel%'
  );

UPDATE "official_playlists" SET "category" = 'genres'
  WHERE "category" IS NULL AND (
    slug ILIKE '%rock%' OR slug ILIKE '%pop%' OR slug ILIKE '%rap%' OR
    slug ILIKE '%electro%' OR slug ILIKE '%disco%' OR slug ILIKE '%jazz%' OR
    slug ILIKE '%reggae%' OR slug ILIKE '%hip-hop%' OR slug ILIKE '%rnb%' OR
    slug ILIKE '%funk%' OR slug ILIKE '%metal%' OR slug ILIKE '%punk%' OR
    theme ILIKE '%rock%' OR theme ILIKE '%pop%'
  );

UPDATE "official_playlists" SET "category" = 'forbidden_30'
  WHERE "category" IS NULL AND (
    slug ILIKE '%gen-z%' OR slug ILIKE '%tiktok%' OR
    slug ILIKE '%recent%' OR slug ILIKE '%new-music%'
  );

UPDATE "official_playlists" SET "category" = 'originals'
  WHERE "category" IS NULL AND (
    slug ILIKE '%official-%' OR slug ILIKE '%tutti%'
  );

-- Fallback : tout le reste → 'classics' (les incontournables blind test).
UPDATE "official_playlists" SET "category" = 'classics'
  WHERE "category" IS NULL;

-- Backfill subtitles depuis description si présente (sinon vide, on
-- complétera manuellement via admin futur).
UPDATE "official_playlists"
  SET "subtitle_fr" = SUBSTRING(description_fr FROM 1 FOR 200)
  WHERE "subtitle_fr" IS NULL AND description_fr IS NOT NULL;

UPDATE "official_playlists"
  SET "subtitle_en" = SUBSTRING(description_en FROM 1 FOR 200)
  WHERE "subtitle_en" IS NULL AND description_en IS NOT NULL;

-- Position dans la catégorie : ordonne par updated_at desc → les playlists
-- récemment modifiées remontent. ROW_NUMBER par catégorie.
UPDATE "official_playlists" op
SET "position_in_category" = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY category ORDER BY updated_at DESC) AS rn
  FROM "official_playlists"
  WHERE category IS NOT NULL
) sub
WHERE op.id = sub.id;
