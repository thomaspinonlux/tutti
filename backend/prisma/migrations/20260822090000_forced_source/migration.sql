-- feat/forced-source — source audio VERROUILLÉE par playlist.
--
-- Avant : le provider était choisi par le client au launch (défaut 'youtube')
-- puis, côté frontend, par selectProvider() qui donnait la priorité à Spotify.
-- Conséquence : une playlist musique 100 % renseignée en Apple Music partait
-- quand même sur Spotify si le host avait un compte Spotify connecté.
--
-- Cette colonne impose la source au niveau de la playlist. Elle écrase le
-- preferProvider demandé (cf. officialPlaylistLaunch.ts). Valeurs :
--   'apple_music' | 'youtube' | 'spotify' | NULL (= laisse le choix au host).
--
-- Additive, nullable, idempotente → aucun risque sur l'existant.
ALTER TABLE "official_playlists" ADD COLUMN IF NOT EXISTS "forced_source" VARCHAR(16);

-- Valeurs initiales : les 16 playlists films / séries / génériques restent sur
-- YouTube (leur répertoire n'est pas sur Apple), toutes les autres sont
-- verrouillées sur Apple Music.
UPDATE "official_playlists" SET "forced_source" = 'youtube'
WHERE "slug" IN (
  'official-pl-anime-openings','official-pl-jeux-tv-fr','official-pl-cinema-fr-bo',
  'official-pl-club-dorothee','official-pl-series-tv','official-pl-generiques-dessins-animes',
  'official-pl-generiques-disney','official-pl-generiques-films-series','official-pl-video-games',
  'official-pl-disney-en','official-pl-disney-fr','official-pl-james-bond',
  'official-pl-musique-film','official-pl-films-hard','official-pl-films-easy','official-pl-films-medium'
);

UPDATE "official_playlists" SET "forced_source" = 'apple_music'
WHERE "forced_source" IS NULL;
