-- feat/jeux-de-salon — trois nouveaux types de question : Bluff, Réponse drôle
-- votée, P'tit Bac. Ajout de valeurs à l'énumération : sans effet sur
-- l'existant.
ALTER TYPE "question_type" ADD VALUE IF NOT EXISTS 'BLUFF';
ALTER TYPE "question_type" ADD VALUE IF NOT EXISTS 'FUNNY';
ALTER TYPE "question_type" ADD VALUE IF NOT EXISTS 'PETIT_BAC';
