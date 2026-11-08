// Charge les quiz KPMG (quiz-kpmg.json) comme quiz de l'établissement Komptoir.
// Ne recrée pas un quiz déjà présent (même nom). Sauvegarde des ids : backup-quiz-kpmg-20261108.json
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../backend/package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js');
const env = Object.fromEntries(readFileSync(new URL('../backend/.env', import.meta.url), 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ETAB = '41013afd-e3c3-4d0f-b123-edbd23435780';
const quiz = JSON.parse(readFileSync(new URL('./quiz-kpmg.json', import.meta.url), 'utf8'));
const backup = [];
for (const q of quiz) {
  const { data: deja, error: e0 } = await sb.from('question_sets').select('id').eq('establishment_id', ETAB).eq('name', q.nom);
  if (e0) throw e0;
  if (deja.length) { console.log('DEJA PRESENT', q.nom, deja[0].id); continue; }
  const setId = randomUUID();
  const { error: e1 } = await sb.from('question_sets').insert({ id: setId, establishment_id: ETAB, name: q.nom, is_bilingual: false, language_1: 'en', is_generic: false, is_published: true });
  if (e1) throw e1;
  const lignes = q.questions.map((x, i) => ({ id: randomUUID(), set_id: setId, position: i, type: 'MCQ', category: q.nom, text_lang1: x.texte, choices_lang1: x.choix, choices_lang2: [], answer_lang1: x.reponse, answer_aliases_lang1: [], answer_aliases_lang2: [], time_limit_sec: x.temps, points: 100, media_type: 'NONE' }));
  const { error: e2 } = await sb.from('questions').insert(lignes);
  if (e2) throw e2;
  backup.push({ set_id: setId, nom: q.nom, questions: lignes.length });
  console.log('OK', q.nom, lignes.length, 'questions');
}
writeFileSync(new URL('./backup-quiz-kpmg-20261108.json', import.meta.url), JSON.stringify(backup, null, 1));
console.log('FINI');
