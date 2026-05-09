-- feat/official-quiz-library — bibliothèque officielle Tutti pour le mode
-- Quizz. Parallèle à official_playlists / official_playlist_tracks pour
-- questions/réponses bilingues FR/EN avec 3 types (MCQ/TRUE_FALSE/FREE_TEXT).

CREATE TABLE "official_quiz_packs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "slug" VARCHAR(120) NOT NULL,
  "name_fr" TEXT NOT NULL,
  "name_en" TEXT NOT NULL,
  "description_fr" TEXT,
  "description_en" TEXT,
  "locale_primary" VARCHAR(32) NOT NULL,
  "category" VARCHAR(80),
  "difficulty" "level" NOT NULL DEFAULT 'MEDIUM',
  "visibility" "official_visibility" NOT NULL DEFAULT 'public',
  "question_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "official_quiz_packs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "official_quiz_packs_slug_key" ON "official_quiz_packs" ("slug");
CREATE INDEX "official_quiz_packs_visibility_idx" ON "official_quiz_packs" ("visibility");
CREATE INDEX "official_quiz_packs_locale_primary_idx" ON "official_quiz_packs" ("locale_primary");
CREATE INDEX "official_quiz_packs_category_idx" ON "official_quiz_packs" ("category");

CREATE TABLE "official_quiz_questions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "pack_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "type" "question_type" NOT NULL,
  "question_fr" TEXT NOT NULL,
  "question_en" TEXT NOT NULL,
  "choices_fr" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "choices_en" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "correct_answer_index" INTEGER,
  "correct_answer_bool" BOOLEAN,
  "correct_answer_fr" TEXT,
  "correct_answer_en" TEXT,
  "alternatives_fr" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "alternatives_en" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "explanation_fr" TEXT,
  "explanation_en" TEXT,
  "difficulty" "level" NOT NULL DEFAULT 'MEDIUM',
  "media_url" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "official_quiz_questions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "official_quiz_questions_pack_id_position_key" UNIQUE ("pack_id", "position"),
  CONSTRAINT "official_quiz_questions_pack_id_fkey" FOREIGN KEY ("pack_id") REFERENCES "official_quiz_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "official_quiz_questions_pack_id_idx" ON "official_quiz_questions" ("pack_id");
