-- feat/quiz-question-media — embeds YouTube structurés (AUDIO/VIDEO) sur
-- les questions Quizz (officielles + workspace clones).
--
-- OfficialQuizQuestion : ajoute media_type (enum MediaType) + media_youtube_id
-- + media_start_sec + media_duration_sec. Le gameplay (RoundPlayingScreen
-- mode QUIZZ) embed un IFrame YouTube qui joue [start, start+duration].
-- AUDIO = IFrame caché. VIDEO = IFrame visible.
--
-- Question (workspace clone) : ajoute les 3 fields structurés. media_type
-- existait déjà (enum). Propagés depuis OfficialQuizQuestion lors du
-- clone-on-launch (POST /api/library/quiz-packs/:id/launch).

-- ── OfficialQuizQuestion ──────────────────────────────────────────────────
ALTER TABLE "official_quiz_questions"
  ADD COLUMN "media_type" "media_type" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "media_youtube_id" TEXT,
  ADD COLUMN "media_start_sec" INTEGER,
  ADD COLUMN "media_duration_sec" INTEGER;

-- ── Question (workspace) ──────────────────────────────────────────────────
ALTER TABLE "questions"
  ADD COLUMN "media_youtube_id" TEXT,
  ADD COLUMN "media_start_sec" INTEGER,
  ADD COLUMN "media_duration_sec" INTEGER;
