-- Refonte voice-first du modèle Tutti Tracks (Phase C).
--
-- Tom a validé le wipe des données existantes (playlists/tracks/sessions de
-- test). On en profite pour faire une migration propre sans gymnastique
-- de backfill.
--
-- Changements structurels :
--   1. Track découplée de Playlist via une table de jointure PlaylistTrack
--      → permet à un même Track d'apparaître dans plusieurs playlists.
--   2. Nouveau modèle Artist avec aliases globaux
--      → un alias appris sur "Stromae" sert pour TOUS les morceaux de l'artiste.
--   3. WorkspaceMember : ajout referral_code (auto-gen 6 chars) et referrer_code
--      pour préparer le système de parrainage V1.1.
--   4. Session : ajout buzz_window_seconds (défaut 10s) + max_participants (15).
--   5. Nouvelle table voice_transcripts pour logger toutes les transcriptions
--      Whisper (auto-apprentissage des aliases V1.1).

-- ── Wipe des données existantes (cohérent avec ce que Tom a validé) ──────
TRUNCATE TABLE score_events, participants, session_rounds, sessions, tracks, playlists CASCADE;

-- ── Drop les policies RLS qui référencent les colonnes qu'on va supprimer ─
DROP POLICY IF EXISTS "tracks_all_via_playlist" ON tracks;

-- ── Nouveau modèle Artist ────────────────────────────────────────────────
CREATE TABLE artists (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT NOT NULL,
  aliases        TEXT[] NOT NULL DEFAULT '{}',
  language       VARCHAR(8),
  origin_country VARCHAR(8),
  created_at     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX artists_canonical_name_key ON artists(canonical_name);
CREATE INDEX artists_aliases_idx ON artists USING GIN(aliases);

-- Trigger pour updated_at
CREATE OR REPLACE FUNCTION set_updated_at_artists() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER artists_set_updated_at BEFORE UPDATE ON artists
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_artists();

-- ── Refactor de la table tracks ──────────────────────────────────────────
-- Données wipe → on peut alter agressivement.
ALTER TABLE tracks DROP COLUMN playlist_id;
ALTER TABLE tracks DROP COLUMN position;
ALTER TABLE tracks DROP COLUMN artist;
ALTER TABLE tracks DROP COLUMN artist_aliases;
ALTER TABLE tracks DROP COLUMN title_aliases;
ALTER TABLE tracks RENAME COLUMN title TO canonical_title;
ALTER TABLE tracks ADD COLUMN artist_id UUID NOT NULL REFERENCES artists(id) ON DELETE RESTRICT;
ALTER TABLE tracks ADD COLUMN aliases TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX tracks_artist_id_idx ON tracks(artist_id);
CREATE INDEX tracks_provider_idx ON tracks(provider, provider_track_id);
CREATE INDEX tracks_aliases_idx ON tracks USING GIN(aliases);

-- ── Nouvelle table playlist_tracks (jointure many-to-many) ──────────────
CREATE TABLE playlist_tracks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  track_id    UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  created_at  TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX playlist_tracks_playlist_position_key ON playlist_tracks(playlist_id, position);
CREATE UNIQUE INDEX playlist_tracks_playlist_track_key ON playlist_tracks(playlist_id, track_id);
CREATE INDEX playlist_tracks_track_idx ON playlist_tracks(track_id);

-- ── Champs parrainage sur WorkspaceMember ────────────────────────────────
ALTER TABLE workspace_members
  ADD COLUMN referral_code VARCHAR(8),
  ADD COLUMN referrer_code VARCHAR(8);

CREATE UNIQUE INDEX workspace_members_referral_code_key
  ON workspace_members(referral_code)
  WHERE referral_code IS NOT NULL;

-- ── Champs config session ────────────────────────────────────────────────
ALTER TABLE sessions
  ADD COLUMN buzz_window_seconds INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN max_participants INTEGER NOT NULL DEFAULT 15;

-- ── Nouvelle table voice_transcripts (logging Whisper) ──────────────────
CREATE TABLE voice_transcripts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  participant_id  UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  track_id        UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  transcript      TEXT NOT NULL,
  matched_artist  BOOLEAN NOT NULL DEFAULT FALSE,
  matched_title   BOOLEAN NOT NULL DEFAULT FALSE,
  confidence      REAL,
  created_at      TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX voice_transcripts_session_idx ON voice_transcripts(session_id);
CREATE INDEX voice_transcripts_track_idx ON voice_transcripts(track_id);

-- ── RLS policies ─────────────────────────────────────────────────────────

-- artists : catalogue partagé, lecture publique pour tout authentifié.
ALTER TABLE artists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "artists_select_all" ON artists FOR SELECT USING (true);

-- tracks : catalogue partagé aussi (peut être référencé par plusieurs
-- playlists de différents tenants). Lecture publique.
CREATE POLICY "tracks_select_all" ON tracks FOR SELECT USING (true);

-- playlist_tracks : RLS via la playlist (qui elle-même est tenant-scoped).
ALTER TABLE playlist_tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "playlist_tracks_all_via_playlist" ON playlist_tracks
  FOR ALL
  USING (
    playlist_id IN (
      SELECT id FROM playlists
      WHERE establishment_id IN (
        SELECT id FROM establishments
        WHERE workspace_id IN (SELECT public.user_workspace_ids())
      )
    )
  );

-- voice_transcripts : lecture seule pour le workspace propriétaire de la session.
ALTER TABLE voice_transcripts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "voice_transcripts_select_workspace" ON voice_transcripts
  FOR SELECT
  USING (
    session_id IN (
      SELECT id FROM sessions
      WHERE establishment_id IN (
        SELECT id FROM establishments
        WHERE workspace_id IN (SELECT public.user_workspace_ids())
      )
    )
  );
