-- Widen official_playlists.locale_primary VARCHAR(8) → VARCHAR(32)
-- pour accepter des valeurs comme "international", "fr-FR", etc.
-- VARCHAR(8) était trop strict (constaté à l'import du fichier
-- official-pl-italo-disco-classics.json qui utilise "international").

ALTER TABLE "official_playlists"
  ALTER COLUMN "locale_primary" TYPE VARCHAR(32);
