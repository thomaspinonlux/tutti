/**
 * quizzPilotage.ts — feat/quiz-comme-le-blind-test
 *
 * Thomas : « je veux le même système pour la gestion des joueurs et
 * animateurs comme dans le blind test ».
 *
 * LE QUIZ SE JOUE COMME LE BLIND TEST : la partie d'abord, les thèmes ensuite.
 * Avant, choisir un thème de quiz CRÉAIT une nouvelle partie — et, par le
 * nettoyage des parties « zombies », terminait celle en cours : les joueurs
 * déjà connectés étaient perdus, comme le 18/09. Désormais :
 *
 *   1. on ouvre une partie Quiz (avec ou sans animateur, comme le blind test) ;
 *   2. les joueurs scannent le QR code ;
 *   3. on choisit un THÈME (et un niveau) : ses questions s'ajoutent à la
 *      partie — c'est une « manche », comme une playlist ;
 *   4. à la fin de la manche on choisit un autre thème, ou on termine.
 *
 * Tout ce qui pilote la partie passe par ici, que l'ordre vienne de la
 * console (animateur) ou du téléphone qui a la manette : mêmes règles, une
 * seule implémentation (les routes hôte et manette la dupliquaient).
 *
 * CORRIGÉ AU PASSAGE : les questions clonées gardaient la position du pack
 * officiel, numérotée à partir de 1, alors que la partie démarre à l'index
 * 0 → « Question introuvable » dès la première question. Aucune partie de
 * quiz n'avait jamais été jouée (0 sur 284), ce qui explique qu'on ne l'ait
 * pas vu. Les positions sont maintenant contiguës à partir de 0.
 */
import { Prisma, QuestionType as PrismaQuestionType, MediaType, type Question } from '@prisma/client';
import type { QuestionType } from '@tutti/shared';
import { prisma } from './prisma.js';
import { broadcastToSession } from '../socket/index.js';
import { getActiveQuestion, setActiveQuestion } from './gameStateQuizz.js';
import {
  buildAndBroadcastQuestion,
  clearAutoReveal,
  findQuestionAtIndex,
  revealCurrentQuestion,
  scheduleAutoReveal,
} from './gameplayQuizzCore.js';

export type NiveauQuiz = 'EASY' | 'MEDIUM' | 'EXPERT' | 'MIX';

/** Questions par manche : comme une playlist du blind test (15 titres). */
export const QUESTIONS_PAR_MANCHE = 15;

export class QuizzErreur extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

/**
 * Dernière question LANCÉE par session. La question active est effacée entre
 * deux manches ; sans ce curseur, « question suivante » repartait de 0 et
 * rejouait la première manche.
 */
const curseurs = new Map<string, number>();

function melanger<T>(t: T[]): T[] {
  const a = [...t];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

async function sessionQuizz(sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { participants: { where: { is_kicked: false }, select: { id: true } } },
  });
  if (!session) throw new QuizzErreur('NOT_FOUND', 'Partie introuvable', 404);
  if (session.game_type !== 'QUIZZ') throw new QuizzErreur('NOT_QUIZZ', "Cette partie n'est pas un quiz");
  if (session.status === 'ENDED') throw new QuizzErreur('ENDED', 'Cette partie est terminée');
  return session;
}

/**
 * Ajoute un thème (une manche) à la partie : tire `nombre` questions du pack
 * officiel, au niveau demandé, sans reprendre une question déjà posée ce
 * soir-là, et les place à la suite.
 */
export async function ajouterTheme(
  sessionId: string,
  packId: string,
  options: { niveau?: NiveauQuiz; nombre?: number } = {},
): Promise<{ set_id: string; debut: number; fin: number; nombre: number; theme: string }> {
  const session = await sessionQuizz(sessionId);
  const active = getActiveQuestion(sessionId);
  if (active && active.phase === 'asking') {
    throw new QuizzErreur('QUESTION_EN_COURS', 'Une question est en cours : attends la réponse.');
  }
  const pack = await prisma.officialQuizPack.findUnique({
    where: { id: packId },
    include: { questions: true },
  });
  if (!pack) throw new QuizzErreur('NOT_FOUND', 'Thème introuvable', 404);

  const niveau = options.niveau ?? 'MIX';
  const nombre = Math.max(1, Math.min(50, options.nombre ?? QUESTIONS_PAR_MANCHE));
  const langue = session.language?.startsWith('en') ? 'en' : 'fr';

  return prisma.$transaction(
    async (tx) => {
      let setId = session.question_set_id;
      if (!setId) {
        const set = await tx.questionSet.create({
          data: {
            establishment_id: session.establishment_id,
            name: `Quiz — ${session.name ?? session.short_code}`,
            // Une seule langue à l'écran : celle de la partie.
            is_bilingual: false,
            language_1: langue,
            language_2: langue === 'fr' ? 'en' : 'fr',
            is_generic: false,
            is_published: true,
          },
        });
        setId = set.id;
        await tx.session.update({ where: { id: sessionId }, data: { question_set_id: setId } });
      }

      const dejaPosees = new Set(
        (await tx.question.findMany({ where: { set_id: setId }, select: { text_lang1: true } })).map(
          (q) => q.text_lang1,
        ),
      );
      const texte = (q: (typeof pack.questions)[number]): string =>
        langue === 'en' ? q.question_en : q.question_fr;
      const candidates = pack.questions.filter(
        (q) => (niveau === 'MIX' || q.difficulty === niveau) && !dejaPosees.has(texte(q)),
      );
      if (candidates.length === 0) {
        throw new QuizzErreur(
          'THEME_EPUISE',
          niveau === 'MIX'
            ? 'Toutes les questions de ce thème ont déjà été posées ce soir.'
            : 'Plus aucune question de ce niveau dans ce thème : choisis un autre niveau.',
        );
      }
      const tirage = melanger(candidates).slice(0, nombre);

      const derniere = await tx.question.aggregate({ where: { set_id: setId }, _max: { position: true } });
      const debut = (derniere._max.position ?? -1) + 1;

      const lignes: Prisma.QuestionCreateManyInput[] = tirage.map((q, i) => {
        const enFr = langue === 'fr';
        const choix1 = enFr ? q.choices_fr : q.choices_en;
        const choix2 = enFr ? q.choices_en : q.choices_fr;
        let reponse1 = '';
        let reponse2 = '';
        let alias1: string[] = [];
        let alias2: string[] = [];
        if (q.type === PrismaQuestionType.MCQ) {
          const idx = q.correct_answer_index ?? 0;
          reponse1 = choix1[idx] ?? '';
          reponse2 = choix2[idx] ?? '';
        } else if (q.type === PrismaQuestionType.TRUE_FALSE) {
          reponse1 = reponse2 = q.correct_answer_bool ? 'true' : 'false';
        } else {
          reponse1 = (enFr ? q.correct_answer_fr : q.correct_answer_en) ?? '';
          reponse2 = (enFr ? q.correct_answer_en : q.correct_answer_fr) ?? '';
          alias1 = enFr ? q.alternatives_fr : q.alternatives_en;
          alias2 = enFr ? q.alternatives_en : q.alternatives_fr;
        }
        return {
          set_id: setId!,
          position: debut + i,
          type: q.type,
          // Le nom du thème accompagne chaque question : la TV et les
          // téléphones savent dans quelle manche on est.
          category: enFr ? pack.name_fr : pack.name_en,
          text_lang1: enFr ? q.question_fr : q.question_en,
          text_lang2: enFr ? q.question_en : q.question_fr,
          choices_lang1: choix1,
          choices_lang2: choix2,
          answer_lang1: reponse1,
          answer_lang2: reponse2,
          answer_aliases_lang1: alias1,
          answer_aliases_lang2: alias2,
          // fix/quiz-15-secondes — Thomas : à 30 s, les joueurs ont le temps
          // de chercher la réponse sur internet.
          time_limit_sec: 15,
          points: 100,
          media_type: q.media_type ?? MediaType.NONE,
          media_url: q.media_url,
          media_youtube_id: q.media_youtube_id,
          media_start_sec: q.media_start_sec,
          media_duration_sec: q.media_duration_sec,
        };
      });
      await tx.question.createMany({ data: lignes });

      return {
        set_id: setId!,
        debut,
        fin: debut + lignes.length - 1,
        nombre: lignes.length,
        theme: langue === 'fr' ? pack.name_fr : pack.name_en,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  ).then((resultat) => {
    // Diffusé APRÈS l'écriture : un écran qui réagit tout de suite trouve
    // les questions en base.
    broadcastToSession(sessionId, 'quizz:theme_added', resultat);
    return resultat;
  });
}

/** Lance la question d'index donné (démarre la partie si elle attendait). */
export async function lancerQuestion(sessionId: string, index: number): Promise<unknown> {
  let session = await sessionQuizz(sessionId);
  if (!session.question_set_id) {
    throw new QuizzErreur('AUCUN_THEME', "Choisis d'abord un thème.");
  }
  if (session.status === 'WAITING') {
    const maj = await prisma.session.update({
      where: { id: sessionId },
      data: { status: 'PLAYING', started_at: new Date() },
    });
    broadcastToSession(sessionId, 'session:started', { session: maj });
    session = { ...session, ...maj };
  }
  const [set, question] = await Promise.all([
    prisma.questionSet.findUnique({ where: { id: session.question_set_id! }, select: { is_bilingual: true } }),
    findQuestionAtIndex(session.question_set_id!, index),
  ]);
  if (!set || !question) throw new QuizzErreur('NO_QUESTION', 'Question introuvable', 404);
  return demarrer(sessionId, question, set.is_bilingual, session.participants.map((p) => p.id));
}

function demarrer(sessionId: string, question: Question, bilingue: boolean, participants: string[]): unknown {
  clearAutoReveal(sessionId);
  const state = buildAndBroadcastQuestion(sessionId, question, bilingue);
  setActiveQuestion(sessionId, {
    question_index: question.position,
    question_id: question.id,
    question_type: question.type as QuestionType,
    time_limit_ms: question.time_limit_sec * 1000,
    points: question.points,
    expected_participants: participants,
  });
  curseurs.set(sessionId, question.position);
  scheduleAutoReveal(sessionId, question.time_limit_sec * 1000, () => {
    void revealCurrentQuestion(sessionId);
  });
  return state;
}

/**
 * Question suivante. À la fin d'une manche, la partie N'EST PLUS TERMINÉE
 * d'office : on annonce la fin de manche, et l'animateur choisit un autre
 * thème ou termine lui-même la partie — comme au blind test.
 */
export async function questionSuivante(
  sessionId: string,
): Promise<{ state: unknown } | { fin_de_manche: true }> {
  const session = await sessionQuizz(sessionId);
  if (!session.question_set_id) throw new QuizzErreur('AUCUN_THEME', "Choisis d'abord un thème.");
  const active = getActiveQuestion(sessionId);
  const precedente = active?.question_index ?? curseurs.get(sessionId) ?? -1;
  const question = await findQuestionAtIndex(session.question_set_id, precedente + 1);
  if (!question) {
    clearAutoReveal(sessionId);
    broadcastToSession(sessionId, 'quizz:block_ended', { derniere: precedente });
    return { fin_de_manche: true };
  }
  const set = await prisma.questionSet.findUnique({
    where: { id: session.question_set_id },
    select: { is_bilingual: true },
  });
  return { state: demarrer(sessionId, question, set?.is_bilingual ?? false, session.participants.map((p) => p.id)) };
}

/** Révéler la réponse maintenant (sans attendre la fin du temps). */
export async function revelerQuestion(sessionId: string): Promise<void> {
  await sessionQuizz(sessionId);
  await revealCurrentQuestion(sessionId);
}

/** Thèmes proposés : les packs officiels publics, avec le nombre de questions par niveau. */
export async function listerThemes(): Promise<
  Array<{ id: string; nom_fr: string; nom_en: string; categorie: string | null; niveaux: Record<string, number>; total: number }>
> {
  const packs = await prisma.officialQuizPack.findMany({
    where: { visibility: 'public' },
    orderBy: [{ category: 'asc' }, { name_fr: 'asc' }],
    select: { id: true, name_fr: true, name_en: true, category: true },
  });
  const comptes = await prisma.officialQuizQuestion.groupBy({
    by: ['pack_id', 'difficulty'],
    _count: { _all: true },
  });
  return packs.map((p) => {
    const niveaux: Record<string, number> = { EASY: 0, MEDIUM: 0, EXPERT: 0 };
    for (const c of comptes) if (c.pack_id === p.id) niveaux[c.difficulty] = c._count._all;
    return {
      id: p.id,
      nom_fr: p.name_fr,
      nom_en: p.name_en,
      categorie: p.category,
      niveaux,
      total: niveaux.EASY! + niveaux.MEDIUM! + niveaux.EXPERT!,
    };
  });
}

/** À appeler quand la partie se termine : le curseur ne sert plus. */
export function oublierQuizz(sessionId: string): void {
  curseurs.delete(sessionId);
}
