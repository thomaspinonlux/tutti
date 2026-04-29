-- Refonte multi-round (étape 9.5 — préparation étape 10).
-- Une session devient un conteneur de plusieurs manches (SessionRound).
-- Chaque round = 1 playlist. Le score cumule sur toute la session.
--
-- Aussi : enrichissement Playlist pour V1.1 (catalogue Tutti curé).

-- ─── Sessions : retrait playlist_id + current_index, ajout name ─────────────
ALTER TABLE sessions DROP COLUMN IF EXISTS playlist_id;
ALTER TABLE sessions DROP COLUMN IF EXISTS current_index;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS name TEXT;

-- ─── Enum round_status + table session_rounds ──────────────────────────────
DO $$ BEGIN
  CREATE TYPE round_status AS ENUM ('PENDING', 'PLAYING', 'ENDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS session_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  playlist_id UUID NOT NULL REFERENCES playlists(id),
  position INTEGER NOT NULL,
  status round_status NOT NULL DEFAULT 'PENDING',
  current_track_index INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ(6),
  ended_at TIMESTAMPTZ(6),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT session_rounds_session_id_position_key UNIQUE(session_id, position)
);

CREATE INDEX IF NOT EXISTS session_rounds_session_id_position_idx
  ON session_rounds(session_id, position);

-- ─── ScoreEvent : ajout session_round_id ───────────────────────────────────
ALTER TABLE score_events
  ADD COLUMN IF NOT EXISTS session_round_id UUID REFERENCES session_rounds(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS score_events_session_round_id_idx
  ON score_events(session_round_id);

-- ─── Playlist : enrichissement V1 + V1.1 ───────────────────────────────────
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS is_express BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS is_official_tutti BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS external_links JSONB;

-- ─── RLS sur session_rounds ────────────────────────────────────────────────
ALTER TABLE session_rounds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "session_rounds_host_all" ON session_rounds;
CREATE POLICY "session_rounds_host_all" ON session_rounds FOR ALL
USING (
  session_id IN (
    SELECT s.id FROM sessions s
    JOIN establishments e ON s.establishment_id = e.id
    WHERE e.workspace_id IN (SELECT public.user_workspace_ids())
  )
)
WITH CHECK (
  session_id IN (
    SELECT s.id FROM sessions s
    JOIN establishments e ON s.establishment_id = e.id
    WHERE e.workspace_id IN (SELECT public.user_workspace_ids())
  )
);
