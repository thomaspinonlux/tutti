-- CreateEnum
CREATE TYPE "plan" AS ENUM ('FREE', 'PAY_PER_NIGHT', 'MONTHLY');

-- CreateEnum
CREATE TYPE "role" AS ENUM ('OWNER', 'HOST', 'ANIMATOR');

-- CreateEnum
CREATE TYPE "level" AS ENUM ('EASY', 'MEDIUM', 'EXPERT');

-- CreateEnum
CREATE TYPE "question_type" AS ENUM ('MCQ', 'TRUE_FALSE', 'FREE_TEXT', 'ESTIMATION');

-- CreateEnum
CREATE TYPE "media_type" AS ENUM ('NONE', 'VIDEO', 'AUDIO', 'IMAGE');

-- CreateEnum
CREATE TYPE "game_type" AS ENUM ('TRACKS', 'QUIZZ');

-- CreateEnum
CREATE TYPE "game_mode" AS ENUM ('SOLO', 'TEAMS');

-- CreateEnum
CREATE TYPE "session_status" AS ENUM ('WAITING', 'PLAYING', 'ENDED');

-- CreateEnum
CREATE TYPE "score_event_type" AS ENUM ('ARTIST_FOUND', 'TITLE_BONUS', 'MVP_BONUS', 'CORRECT_ANSWER', 'SPEED_BONUS', 'MANUAL_ADJUSTMENT');

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "plan" "plan" NOT NULL DEFAULT 'FREE',
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "role" NOT NULL DEFAULT 'HOST',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "establishments" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "branding_logo" TEXT,
    "branding_color" TEXT,
    "default_language" VARCHAR(8) NOT NULL DEFAULT 'fr',
    "active_provider" VARCHAR(32) NOT NULL DEFAULT 'demo',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "establishments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "music_provider_credentials" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "account_email" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "music_provider_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playlists" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "cover_url" TEXT,
    "level" "level" NOT NULL DEFAULT 'MEDIUM',
    "language" VARCHAR(8) NOT NULL DEFAULT 'fr',
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "playlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracks" (
    "id" UUID NOT NULL,
    "playlist_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "provider_track_id" VARCHAR(128) NOT NULL,
    "artist" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "album" TEXT,
    "year" INTEGER,
    "genre" TEXT,
    "popularity" INTEGER,
    "duration_ms" INTEGER,
    "cover_url" TEXT,
    "artist_aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "title_aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_sets" (
    "id" UUID NOT NULL,
    "establishment_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cover_url" TEXT,
    "is_bilingual" BOOLEAN NOT NULL DEFAULT false,
    "language_1" VARCHAR(8) NOT NULL DEFAULT 'fr',
    "language_2" VARCHAR(8),
    "is_generic" BOOLEAN NOT NULL DEFAULT false,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL,
    "set_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "question_type" NOT NULL,
    "category" TEXT,
    "text_lang1" TEXT NOT NULL,
    "text_lang2" TEXT,
    "choices_lang1" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "choices_lang2" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "answer_lang1" TEXT NOT NULL,
    "answer_lang2" TEXT,
    "time_limit_sec" INTEGER NOT NULL DEFAULT 30,
    "points" INTEGER NOT NULL DEFAULT 100,
    "media_type" "media_type" NOT NULL DEFAULT 'NONE',
    "media_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "establishment_id" UUID NOT NULL,
    "game_type" "game_type" NOT NULL,
    "status" "session_status" NOT NULL DEFAULT 'WAITING',
    "short_code" VARCHAR(16) NOT NULL,
    "mode" "game_mode" NOT NULL DEFAULT 'SOLO',
    "teams_config" JSONB,
    "language" VARCHAR(8) NOT NULL DEFAULT 'fr',
    "playlist_id" UUID,
    "question_set_id" UUID,
    "current_index" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participants" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "pseudo" VARCHAR(64) NOT NULL,
    "team_id" UUID,
    "is_master" BOOLEAN NOT NULL DEFAULT false,
    "is_kicked" BOOLEAN NOT NULL DEFAULT false,
    "fingerprint" TEXT,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_events" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "team_id" UUID,
    "round_index" INTEGER NOT NULL,
    "type" "score_event_type" NOT NULL,
    "points" INTEGER NOT NULL,
    "buzz_time_ms" INTEGER,
    "match_artist" BOOLEAN,
    "match_title" BOOLEAN,
    "voice_transcript" TEXT,
    "answer" TEXT,
    "reason" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "applied_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_members_user_id_idx" ON "workspace_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_workspace_id_user_id_key" ON "workspace_members"("workspace_id", "user_id");

-- CreateIndex
CREATE INDEX "establishments_workspace_id_idx" ON "establishments"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "music_provider_credentials_workspace_id_provider_key" ON "music_provider_credentials"("workspace_id", "provider");

-- CreateIndex
CREATE INDEX "playlists_establishment_id_idx" ON "playlists"("establishment_id");

-- CreateIndex
CREATE INDEX "tracks_playlist_id_position_idx" ON "tracks"("playlist_id", "position");

-- CreateIndex
CREATE INDEX "question_sets_establishment_id_idx" ON "question_sets"("establishment_id");

-- CreateIndex
CREATE INDEX "questions_set_id_position_idx" ON "questions"("set_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_short_code_key" ON "sessions"("short_code");

-- CreateIndex
CREATE INDEX "sessions_short_code_idx" ON "sessions"("short_code");

-- CreateIndex
CREATE INDEX "sessions_establishment_id_idx" ON "sessions"("establishment_id");

-- CreateIndex
CREATE INDEX "participants_session_id_idx" ON "participants"("session_id");

-- CreateIndex
CREATE INDEX "score_events_session_id_round_index_idx" ON "score_events"("session_id", "round_index");

-- CreateIndex
CREATE INDEX "score_events_participant_id_idx" ON "score_events"("participant_id");

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "establishments" ADD CONSTRAINT "establishments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "music_provider_credentials" ADD CONSTRAINT "music_provider_credentials_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_playlist_id_fkey" FOREIGN KEY ("playlist_id") REFERENCES "playlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_sets" ADD CONSTRAINT "question_sets_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "question_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_events" ADD CONSTRAINT "score_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_events" ADD CONSTRAINT "score_events_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
