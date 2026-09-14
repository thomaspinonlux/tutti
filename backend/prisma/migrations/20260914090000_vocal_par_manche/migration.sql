-- feat/vocal-par-manche — le mode de reponse peut etre change pour UNE manche.
--
-- NULL = la manche suit le reglage de la partie (sessions.voice_enabled), qui
-- reste le defaut de toutes les playlists. Une valeur = choix volontaire fait
-- au lancement de cette playlist, valable pour elle seule.
ALTER TABLE "session_rounds" ADD COLUMN "voice_enabled" BOOLEAN;
