-- Tutti Quizz V0 — alias de réponse pour les questions FREE_TEXT.
--
-- Pour FREE_TEXT, on a souvent plusieurs orthographes/formulations
-- acceptables (ex: "Coupe du Monde 1998" → ["coupe du monde 98",
-- "mondial 98", "France 98"]). Ces aliases permettent un fuzzy match
-- côté backend lors du scoring.
--
-- Pour ESTIMATION, on encode `{ "target": 1953, "min": 1900, "max": 2000,
-- "unit": "années" }` en JSON dans answer_lang1 directement (pas besoin
-- de colonnes dédiées en V0).
--
-- Pour MCQ et TRUE_FALSE, ces aliases ne sont pas utilisés.

ALTER TABLE questions
  ADD COLUMN answer_aliases_lang1 TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN answer_aliases_lang2 TEXT[] NOT NULL DEFAULT '{}';
