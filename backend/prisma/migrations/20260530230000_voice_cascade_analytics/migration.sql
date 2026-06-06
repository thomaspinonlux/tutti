-- feat/voice-cascade-l3-assemblyai — analytics colonnes pour la cascade voix
-- (PR #48 cascade L1+L2 déjà en prod, ajout L3 AssemblyAI + tracking par niveau).

ALTER TABLE "voice_transcripts"
  ADD COLUMN "level"      VARCHAR(32),
  ADD COLUMN "latency_ms" INTEGER;

CREATE INDEX "voice_transcripts_level_idx" ON "voice_transcripts"("level");
