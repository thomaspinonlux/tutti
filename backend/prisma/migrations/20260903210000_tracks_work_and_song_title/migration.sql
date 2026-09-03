-- feat/oeuvre-affichee — nom de l'œuvre et vrai titre de la chanson sur les
-- morceaux de l'espace, pour l'affichage œuvre / chanson / interprète.
ALTER TABLE "tracks" ADD COLUMN IF NOT EXISTS "work_title" TEXT;
ALTER TABLE "tracks" ADD COLUMN IF NOT EXISTS "song_title" TEXT;
