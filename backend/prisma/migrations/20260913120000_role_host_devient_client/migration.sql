-- Le role HOST devient CLIENT (aucun membre ne le portait : 26 membres, tous OWNER).
--
-- ATTENTION — cette migration ne contient QUE le renommage. PostgreSQL refuse
-- (erreur 22023) qu'une valeur d'enum fraichement renommee soit utilisee dans
-- la meme transaction : un `SET DEFAULT 'CLIENT'` place ici fait echouer la
-- migration, et Prisma refuse alors de demarrer le serveur.
-- Le defaut est pose dans la migration suivante, 20260913120100.
ALTER TYPE "role" RENAME VALUE 'HOST' TO 'CLIENT';
