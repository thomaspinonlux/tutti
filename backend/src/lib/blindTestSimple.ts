/**
 * blindTestSimple.ts — feat/blind-test-simple
 *
 * Thomas, 22/11 : « un blind test simplifié avec des extraits […] et les gens
 * doivent choisir […] à qui on fait des propositions sur l'artiste, sur le nom
 * de la chanson ».
 *
 * UNE MANCHE = 15 EXTRAITS DE 30 S, 4 PROPOSITIONS SUR LE TÉLÉPHONE.
 *
 * Le blind test complet joue le morceau entier par le compte Apple Music de
 * l'établissement, et les joueurs répondent à la voix. Celui-ci n'a besoin
 * d'aucun compte : il joue l'extrait de 30 s que le catalogue Apple publie pour
 * chaque titre, et les joueurs touchent une proposition parmi quatre. La
 * question alterne — « qui interprète ? », puis « quel est le titre ? » — et,
 * sur les playlists « devine l'œuvre » (films, séries, jeux), demande l'œuvre.
 *
 * Il se joue DANS une partie de quiz : une playlist se choisit comme un thème,
 * ses 15 questions s'ajoutent à la partie (cf. quizzPilotage.ts). Joueurs,
 * équipes, manette, chrono, classement : tout est celui du quiz.
 *
 * Les adresses des extraits ne sont PAS stockées dans le catalogue : elles sont
 * demandées à Apple au moment où la manche est tirée, pour les seuls titres
 * tirés (un titre sans extrait est remplacé par un autre).
 */
import { MediaType, QuestionType as PrismaQuestionType, type Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { getAppleDeveloperToken } from './appleDeveloperToken.js';
import { getCategoryDef } from './playlistCategories.js';

export type NiveauBlindTestSimple = 'EASY' | 'MEDIUM' | 'EXPERT' | 'MIX';

/** Chrono d'une question : la durée de l'extrait. */
export const SECONDES_PAR_EXTRAIT = 30;
/** Une playlist n'est proposée que si elle peut remplir une manche. */
const MINIMUM_TITRES = 15;

export class BlindTestSimpleErreur extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Question prête à être rangée dans la partie (sans set ni position). */
export type QuestionExtrait = Omit<Prisma.QuestionCreateManyInput, 'set_id' | 'position'>;

interface Titre {
  id: string;
  title: string;
  artist: string;
  work_title: string | null;
  difficulty: string;
  apple_music_id: string;
}

const TITRE_JOUABLE = { is_playable: true, apple_music_id: { not: null } } as const;

function melanger<T>(t: T[]): T[] {
  const a = [...t];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Forme de comparaison : sans accents, sans parenthèses ni « feat. ». */
export function cle(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(feat|ft|featuring)\b.*$/, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Deux libellés désignent-ils la même chose (ou l'un contient l'autre) ? */
function seRecoupent(a: string, b: string): boolean {
  const ka = cle(a);
  const kb = cle(b);
  if (!ka || !kb) return true;
  return ka === kb || ka.includes(kb) || kb.includes(ka);
}

/** Ce que les joueurs lisent une fois la réponse révélée. */
export function identite(t: { title: string; artist: string; work_title: string | null }, oeuvre: boolean): string {
  return oeuvre && t.work_title ? `${t.work_title} — ${t.title}` : `${t.title} — ${t.artist}`;
}

/**
 * Les playlists jouables en blind test simple, avec le nombre de titres par
 * niveau — même forme que les thèmes du quiz, pour le même écran de choix.
 */
export async function listerPlaylistsBlindTestSimple(): Promise<
  Array<{
    id: string;
    nom_fr: string;
    nom_en: string;
    categorie: string | null;
    famille: 'blind_test';
    groupe_fr: string;
    groupe_en: string;
    niveaux: Record<string, number>;
    total: number;
  }>
> {
  const [playlists, comptes] = await Promise.all([
    prisma.officialPlaylist.findMany({
      where: { visibility: 'public' },
      select: { id: true, name_fr: true, name_en: true, category: true, position_in_category: true },
    }),
    prisma.officialPlaylistTrack.groupBy({
      by: ['playlist_id', 'difficulty'],
      where: TITRE_JOUABLE,
      _count: { _all: true },
    }),
  ]);
  const parPlaylist = new Map<string, Record<string, number>>();
  for (const c of comptes) {
    const n = parPlaylist.get(c.playlist_id) ?? { EASY: 0, MEDIUM: 0, EXPERT: 0 };
    n[c.difficulty] = c._count._all;
    parPlaylist.set(c.playlist_id, n);
  }
  return playlists
    .map((p) => {
      const niveaux = parPlaylist.get(p.id) ?? { EASY: 0, MEDIUM: 0, EXPERT: 0 };
      const cat = getCategoryDef(p.category);
      return {
        id: p.id,
        nom_fr: p.name_fr,
        nom_en: p.name_en,
        categorie: p.category,
        famille: 'blind_test' as const,
        groupe_fr: cat.label_fr,
        groupe_en: cat.label_en,
        niveaux,
        total: (niveaux.EASY ?? 0) + (niveaux.MEDIUM ?? 0) + (niveaux.EXPERT ?? 0),
        ordre: cat.order,
        rang: p.position_in_category ?? 9999,
      };
    })
    .filter((p) => p.total >= MINIMUM_TITRES)
    .sort((a, b) => a.ordre - b.ordre || a.rang - b.rang || a.nom_fr.localeCompare(b.nom_fr, 'fr'))
    .map((p) => ({
      id: p.id,
      nom_fr: p.nom_fr,
      nom_en: p.nom_en,
      categorie: p.categorie,
      famille: p.famille,
      groupe_fr: p.groupe_fr,
      groupe_en: p.groupe_en,
      niveaux: p.niveaux,
      total: p.total,
    }));
}

/** L'extrait de 30 s de chaque titre, demandé au catalogue Apple (boutique FR). */
async function extraitsApple(ids: string[]): Promise<Map<string, string>> {
  const trouves = new Map<string, string>();
  if (ids.length === 0) return trouves;
  const { token } = getAppleDeveloperToken();
  for (let i = 0; i < ids.length; i += 300) {
    const lot = ids.slice(i, i + 300);
    const reponse = await fetch(`https://api.music.apple.com/v1/catalog/fr/songs?ids=${lot.join(',')}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!reponse.ok) {
      throw new BlindTestSimpleErreur('APPLE_INDISPONIBLE', `Apple Music ne répond pas (${reponse.status}).`);
    }
    const corps = (await reponse.json()) as {
      data?: Array<{ id: string; attributes?: { previews?: Array<{ url?: string }> } }>;
    };
    for (const s of corps.data ?? []) {
      const url = s.attributes?.previews?.[0]?.url;
      if (url) trouves.set(s.id, url);
    }
  }
  return trouves;
}

type Sujet = 'artiste' | 'titre' | 'oeuvre';

const TEXTES: Record<Sujet, { fr: string; en: string }> = {
  artiste: { fr: 'Qui interprète ce morceau ?', en: 'Who performs this track?' },
  titre: { fr: 'Quel est le titre de ce morceau ?', en: 'What is the title of this track?' },
  oeuvre: { fr: 'De quel film, série ou jeu vient cet extrait ?', en: 'Which film, series or game is this from?' },
};

const valeur = (t: Titre, sujet: Sujet): string =>
  sujet === 'artiste' ? t.artist : sujet === 'oeuvre' ? (t.work_title ?? '') : t.title;

/** Trois fausses propositions tirées de la même playlist, toutes différentes. */
function faussesPropositions(bonne: Titre, sujet: Sujet, playlist: Titre[]): string[] | null {
  const juste = valeur(bonne, sujet);
  const retenues: string[] = [];
  for (const autre of melanger(playlist)) {
    if (autre.id === bonne.id) continue;
    const v = valeur(autre, sujet);
    if (!v || seRecoupent(v, juste)) continue;
    // Un titre du même interprète ne piège personne sur « qui interprète ? »,
    // et le même morceau peut figurer deux fois sous deux écritures.
    if (retenues.some((r) => seRecoupent(r, v))) continue;
    retenues.push(v);
    if (retenues.length === 3) return retenues;
  }
  return null;
}

/**
 * Tire une manche : `nombre` titres de la playlist au niveau demandé, jamais
 * un titre déjà passé ce soir-là (`dejaJoues` = identités déjà posées).
 */
export async function tirerMancheBlindTestSimple(
  playlistId: string,
  options: { niveau: NiveauBlindTestSimple; nombre: number; dejaJoues: Set<string>; langue: 'fr' | 'en' },
): Promise<{ theme: string; questions: QuestionExtrait[] } | null> {
  const playlist = await prisma.officialPlaylist.findUnique({
    where: { id: playlistId },
    select: { id: true, name_fr: true, name_en: true, guess_mode: true, visibility: true },
  });
  if (!playlist) return null;
  if (playlist.visibility !== 'public') {
    throw new BlindTestSimpleErreur('NOT_FOUND', 'Playlist introuvable');
  }

  const lignes = await prisma.officialPlaylistTrack.findMany({
    where: { playlist_id: playlistId, ...TITRE_JOUABLE },
    select: { id: true, title: true, artist: true, work_title: true, difficulty: true, apple_music_id: true },
  });
  const titres: Titre[] = lignes.flatMap((l) => (l.apple_music_id ? [{ ...l, apple_music_id: l.apple_music_id }] : []));

  const modeOeuvre = playlist.guess_mode === 'work';
  const candidats = melanger(
    titres.filter(
      (t) =>
        (options.niveau === 'MIX' || t.difficulty === options.niveau) &&
        !options.dejaJoues.has(identite(t, modeOeuvre)),
    ),
  );
  if (candidats.length === 0) {
    throw new BlindTestSimpleErreur(
      'THEME_EPUISE',
      options.niveau === 'MIX'
        ? 'Tous les titres de cette playlist sont déjà passés ce soir.'
        : 'Plus aucun titre de ce niveau dans cette playlist : choisis un autre niveau.',
    );
  }

  // On demande l'extrait de quelques titres de plus que nécessaire : un titre
  // sans extrait est simplement remplacé par le suivant.
  const reserve = candidats.slice(0, options.nombre + 10);
  const extraits = await extraitsApple([...new Set(reserve.map((t) => t.apple_music_id))]);

  const theme = options.langue === 'en' ? playlist.name_en : playlist.name_fr;
  const questions: QuestionExtrait[] = [];
  const identitesTirees = new Set<string>();
  for (const t of reserve) {
    if (questions.length >= options.nombre) break;
    const url = extraits.get(t.apple_music_id);
    if (!url) continue;
    const quoi = identite(t, modeOeuvre);
    if (identitesTirees.has(quoi)) continue;

    // Alternance interprète / titre. Si la playlist n'offre pas trois autres
    // interprètes (playlist d'un seul artiste), on demande le titre.
    const voulu: Sujet = modeOeuvre && t.work_title ? 'oeuvre' : questions.length % 2 === 0 ? 'artiste' : 'titre';
    let sujet: Sujet = voulu;
    let fausses = faussesPropositions(t, sujet, titres);
    if (!fausses && sujet !== 'titre') {
      sujet = 'titre';
      fausses = faussesPropositions(t, sujet, titres);
    }
    if (!fausses) continue;

    const juste = valeur(t, sujet);
    const choix = melanger([juste, ...fausses]);
    const texte = TEXTES[sujet];
    identitesTirees.add(quoi);
    questions.push({
      type: PrismaQuestionType.MCQ,
      category: theme,
      text_lang1: options.langue === 'en' ? texte.en : texte.fr,
      text_lang2: options.langue === 'en' ? texte.fr : texte.en,
      choices_lang1: choix,
      choices_lang2: choix,
      answer_lang1: juste,
      // Révélé avec la bonne proposition : après « qui interprète ? », les
      // joueurs veulent aussi le titre (et inversement).
      answer_lang2: quoi,
      time_limit_sec: SECONDES_PAR_EXTRAIT,
      points: 100,
      media_type: MediaType.AUDIO,
      media_url: url,
      media_duration_sec: SECONDES_PAR_EXTRAIT,
    });
  }

  if (questions.length === 0) {
    throw new BlindTestSimpleErreur('AUCUN_EXTRAIT', "Apple ne fournit d'extrait pour aucun de ces titres.");
  }
  return { theme, questions };
}
