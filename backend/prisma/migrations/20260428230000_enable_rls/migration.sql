-- Tutti — Activation de Row Level Security et politiques de base
--
-- Principe: chaque table métier a un workspace_id (direct ou via FK).
-- Aucune requête ne doit traverser la frontière workspace.
--
-- Pour V1, le backend s'authentifie via SUPABASE_SERVICE_ROLE_KEY qui
-- bypass RLS. Ces politiques sont une défense en profondeur pour l'avenir
-- où des clients pourraient se connecter avec des JWT user-scoped.
--
-- Tables joueurs anonymes (sessions, participants, score_events) :
-- politiques plus permissives — accès via short_code de session.

-- ─── Helper : workspaces accessibles par l'utilisateur courant ───
CREATE OR REPLACE FUNCTION public.user_workspace_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid();
$$;

-- ─── workspaces ───
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspaces_select_member" ON workspaces
  FOR SELECT
  USING (id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "workspaces_update_owner" ON workspaces
  FOR UPDATE
  USING (
    id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid() AND role = 'OWNER'
    )
  );

-- ─── workspace_members ───
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_members_select_self_or_workspace" ON workspace_members
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR workspace_id IN (SELECT public.user_workspace_ids())
  );

CREATE POLICY "workspace_members_insert_owner" ON workspace_members
  FOR INSERT
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid() AND role = 'OWNER'
    )
  );

-- ─── establishments ───
ALTER TABLE establishments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "establishments_all_workspace" ON establishments
  FOR ALL
  USING (workspace_id IN (SELECT public.user_workspace_ids()))
  WITH CHECK (workspace_id IN (SELECT public.user_workspace_ids()));

-- ─── music_provider_credentials ───
ALTER TABLE music_provider_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "music_credentials_all_workspace" ON music_provider_credentials
  FOR ALL
  USING (workspace_id IN (SELECT public.user_workspace_ids()))
  WITH CHECK (workspace_id IN (SELECT public.user_workspace_ids()));

-- ─── playlists (via establishment) ───
ALTER TABLE playlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "playlists_all_via_establishment" ON playlists
  FOR ALL
  USING (
    establishment_id IN (
      SELECT id FROM establishments
      WHERE workspace_id IN (SELECT public.user_workspace_ids())
    )
  )
  WITH CHECK (
    establishment_id IN (
      SELECT id FROM establishments
      WHERE workspace_id IN (SELECT public.user_workspace_ids())
    )
  );

-- ─── tracks (via playlist → establishment) ───
ALTER TABLE tracks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tracks_all_via_playlist" ON tracks
  FOR ALL
  USING (
    playlist_id IN (
      SELECT id FROM playlists
      WHERE establishment_id IN (
        SELECT id FROM establishments
        WHERE workspace_id IN (SELECT public.user_workspace_ids())
      )
    )
  )
  WITH CHECK (
    playlist_id IN (
      SELECT id FROM playlists
      WHERE establishment_id IN (
        SELECT id FROM establishments
        WHERE workspace_id IN (SELECT public.user_workspace_ids())
      )
    )
  );

-- ─── question_sets (avec packs génériques accessibles à tous) ───
ALTER TABLE question_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "question_sets_select_workspace_or_generic" ON question_sets
  FOR SELECT
  USING (
    is_generic = true
    OR establishment_id IN (
      SELECT id FROM establishments
      WHERE workspace_id IN (SELECT public.user_workspace_ids())
    )
  );

CREATE POLICY "question_sets_modify_own_workspace" ON question_sets
  FOR ALL
  USING (
    establishment_id IN (
      SELECT id FROM establishments
      WHERE workspace_id IN (SELECT public.user_workspace_ids())
    )
  )
  WITH CHECK (
    establishment_id IN (
      SELECT id FROM establishments
      WHERE workspace_id IN (SELECT public.user_workspace_ids())
    )
  );

-- ─── questions (via set) ───
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "questions_select_via_set" ON questions
  FOR SELECT
  USING (
    set_id IN (
      SELECT id FROM question_sets
      WHERE is_generic = true
        OR establishment_id IN (
          SELECT id FROM establishments
          WHERE workspace_id IN (SELECT public.user_workspace_ids())
        )
    )
  );

CREATE POLICY "questions_modify_via_set" ON questions
  FOR ALL
  USING (
    set_id IN (
      SELECT id FROM question_sets
      WHERE establishment_id IN (
        SELECT id FROM establishments
        WHERE workspace_id IN (SELECT public.user_workspace_ids())
      )
    )
  )
  WITH CHECK (
    set_id IN (
      SELECT id FROM question_sets
      WHERE establishment_id IN (
        SELECT id FROM establishments
        WHERE workspace_id IN (SELECT public.user_workspace_ids())
      )
    )
  );

-- ─── sessions (RLS plus permissive : accès lecture via short_code) ───
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Lecture publique anonymous : nécessaire pour les joueurs qui scannent le QR.
-- Le filtrage par short_code se fait au niveau de la requête applicative.
CREATE POLICY "sessions_select_public" ON sessions
  FOR SELECT
  USING (true);

CREATE POLICY "sessions_modify_own_workspace" ON sessions
  FOR ALL
  USING (
    establishment_id IN (
      SELECT id FROM establishments
      WHERE workspace_id IN (SELECT public.user_workspace_ids())
    )
  )
  WITH CHECK (
    establishment_id IN (
      SELECT id FROM establishments
      WHERE workspace_id IN (SELECT public.user_workspace_ids())
    )
  );

-- ─── participants (joueurs anonymes) ───
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;

-- Lecture publique : un joueur doit pouvoir voir la liste des autres joueurs
-- de SA session. Filtrage côté applicatif.
CREATE POLICY "participants_select_public" ON participants
  FOR SELECT
  USING (true);

-- Insertion publique : un joueur rejoint via le short_code, pas besoin d'auth.
CREATE POLICY "participants_insert_public" ON participants
  FOR INSERT
  WITH CHECK (true);

-- Update / delete : seul l'host (workspace owner) peut kicker / modifier.
CREATE POLICY "participants_modify_own_workspace" ON participants
  FOR UPDATE
  USING (
    session_id IN (
      SELECT id FROM sessions
      WHERE establishment_id IN (
        SELECT id FROM establishments
        WHERE workspace_id IN (SELECT public.user_workspace_ids())
      )
    )
  );

CREATE POLICY "participants_delete_own_workspace" ON participants
  FOR DELETE
  USING (
    session_id IN (
      SELECT id FROM sessions
      WHERE establishment_id IN (
        SELECT id FROM establishments
        WHERE workspace_id IN (SELECT public.user_workspace_ids())
      )
    )
  );

-- ─── score_events (audit log de la partie) ───
ALTER TABLE score_events ENABLE ROW LEVEL SECURITY;

-- Lecture publique : les joueurs voient les scores de leur session.
CREATE POLICY "score_events_select_public" ON score_events
  FOR SELECT
  USING (true);

-- Insertion / modification : seul le backend (service role) ou l'host.
CREATE POLICY "score_events_modify_own_workspace" ON score_events
  FOR ALL
  USING (
    session_id IN (
      SELECT id FROM sessions
      WHERE establishment_id IN (
        SELECT id FROM establishments
        WHERE workspace_id IN (SELECT public.user_workspace_ids())
      )
    )
  )
  WITH CHECK (
    session_id IN (
      SELECT id FROM sessions
      WHERE establishment_id IN (
        SELECT id FROM establishments
        WHERE workspace_id IN (SELECT public.user_workspace_ids())
      )
    )
  );
