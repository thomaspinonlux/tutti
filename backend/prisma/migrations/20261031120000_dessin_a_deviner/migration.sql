-- feat/dessin-a-deviner — nouveau type de question : un joueur dessine le mot,
-- les autres devinent. Ajout d'une valeur à l'énumération : sans effet sur les
-- lignes existantes.
ALTER TYPE "question_type" ADD VALUE IF NOT EXISTS 'DRAWING';
