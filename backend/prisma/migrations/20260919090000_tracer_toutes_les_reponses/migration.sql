-- feat/tracer-toutes-les-reponses
--
-- Jusqu'ici la table ne gardait que le texte et deux booleens. Une reponse
-- refusee ne disait donc pas POURQUOI elle l'avait ete, ni ce qui etait
-- attendu, ni a quelle manche elle appartenait — et trois cas de refus
-- (reponse arrivee trop tard, joueur ayant deja trouve, transcription vide)
-- sortaient AVANT l'ecriture : ces reponses-la n'existaient nulle part.
--
-- Soiree du 18/09 (KOMP-X2BA) : 897 reponses, 307 acceptees, 590 refusees,
-- soit 34,2 % d'acceptation — sans aucun moyen de juger les 590.

ALTER TABLE "voice_transcripts"
  ADD COLUMN "session_round_id" UUID,
  ADD COLUMN "track_index"      INTEGER,
  -- Verdict complet : ACCEPTEE, SOUS_LE_SEUIL, FRAGMENT_AMBIGU,
  -- MORCEAU_DEPASSE, ALREADY_ANSWERED, AUCUNE_PAROLE, PHASE_2_EXPIRED.
  ADD COLUMN "decision"         TEXT,
  -- Cible retenue par le moteur : 'title', 'artist', 'artist_title'.
  ADD COLUMN "cible"            TEXT,
  ADD COLUMN "score_titre"      INTEGER,
  ADD COLUMN "score_artiste"    INTEGER,
  ADD COLUMN "score_combo"      INTEGER,
  ADD COLUMN "seuil"            INTEGER,
  -- Photo de ce qui etait attendu A CE MOMENT : le catalogue evolue, le
  -- verdict d'hier doit rester relisible demain.
  ADD COLUMN "titre_attendu"    TEXT,
  ADD COLUMN "artiste_attendu"  TEXT,
  -- 'clavier' ou 'vocal', sans avoir a deviner d'apres level.
  ADD COLUMN "mode_reponse"     TEXT;

CREATE INDEX "voice_transcripts_session_id_decision_idx"
  ON "voice_transcripts" ("session_id", "decision");
CREATE INDEX "voice_transcripts_session_round_id_idx"
  ON "voice_transcripts" ("session_round_id");
