/**
 * ScreenApercuPage — /screen/apercu
 *
 * fix/ecran-tv-jamais-vu-avant-la-soiree — LA TV SE VERIFIE SANS SOIREE.
 *
 * Jusqu ici, le seul moyen de voir l ecran TV etait de lancer une vraie
 * partie : une correction de mise en page se decouvrait en salle, devant les
 * clients, sur un ecran de 1280 x 900 qu on ne pouvait pas reproduire. Cette
 * page rend TvScreenView avec des donnees fictives, dans les trois etats qui
 * comptent, avec des noms VOLONTAIREMENT longs pour eprouver la regle
 * « retrecit puis passe a la ligne, jamais coupe ».
 *
 *   /screen/apercu?etat=revelation   reponse devoilee + classement du titre
 *   /screen/apercu?etat=ecoute       morceau en cours, un joueur a trouve
 *   /screen/apercu?etat=attente      entre deux morceaux
 *   &court=1                         noms courts (defaut : longs)
 *
 * Aucune donnee reelle, aucun appel serveur : la page est purement visuelle.
 * A ouvrir sur la TV elle-meme, ou dans un navigateur a la taille de la TV.
 */

import type {
  CorrectAnswerEntry,
  CumulativeScore,
  CurrentTrackState,
  SessionWithParticipants,
} from '@tutti/shared';
import { useSearchParams } from 'react-router-dom';
import { TvScreenView } from './TvScreenView.js';

const NOMS_LONGS = [
  'Les Bretons du fond de la salle',
  'Christina & les Garçons de Mondorf',
  'Équipe Anniversaire Sophie 40 ans',
  'Marion',
  'Les Inséparables du Komptoir',
  'Kevin',
];
const NOMS_COURTS = ['Marion', 'Kevin', 'Sophie', 'Léa', 'Tom', 'Nina'];

export function ScreenApercuPage(): JSX.Element {
  const [params] = useSearchParams();
  const etat = params.get('etat') ?? 'revelation';
  const noms = params.get('court') ? NOMS_COURTS : NOMS_LONGS;
  const now = Date.now();

  const participants = noms.map((pseudo, i) => ({
    id: `p${i}`,
    pseudo,
    team_id: null,
    is_master: i === 0,
    is_kicked: false,
  }));

  const session = {
    id: 'apercu',
    short_code: 'APERCU',
    name: 'Aperçu TV',
    mode: 'SOLO',
    is_paused: false,
    has_animator: true,
    participants,
    rounds: [
      {
        id: 'r1',
        position: 1,
        status: 'PLAYING',
        current_track_index: 4,
        playlist: { id: 'pl', name: 'Variétés françaises années 80', tracks_count: 25 },
      },
    ],
  } as unknown as SessionWithParticipants;

  const cumulative: CumulativeScore[] = participants.map((p, i) => ({
    id: p.id,
    label: p.pseudo,
    color: null,
    total_points: [268, 241, 156, 98, 61, 20][i] ?? 0,
  }));

  const correctAnswers: CorrectAnswerEntry[] = participants.slice(0, 4).map((p, i) => ({
    participant_id: p.id,
    pseudo: p.pseudo,
    team_id: null,
    position: i + 1,
    answered_at_ms: [4200, 6800, 9100, 11400][i]!,
    matched_artist: true,
    matched_title: i === 0,
    score: [38, 15, 10, 5][i]!,
    score_position: [20, 15, 10, 5][i]!,
    score_title_bonus: i === 0 ? 10 : 0,
    score_speed_bonus: i === 0 ? 8 : 0,
  }));

  const phase = etat === 'revelation' ? 'phase3-revealed' : etat === 'ecoute' ? 'phase2' : 'phase1';
  const currentTrack =
    etat === 'attente'
      ? null
      : ({
          round_id: 'r1',
          track_id: 't1',
          track_index: 4,
          phase,
          started_at: new Date(now - 32_000).toISOString(),
          duration_ms: 180_000,
          artist: 'Christina Aguilera, Lil’ Kim, Mýa & Pink',
          title: 'Lady Marmalade (Voulez-vous coucher avec moi ce soir ?)',
          song_title: null,
          year: 2001,
          album: 'Moulin Rouge! Music from Baz Luhrmann’s Film',
          cover_url: null,
          correct_answers: correctAnswers,
        } as unknown as CurrentTrackState);

  return (
    <TvScreenView
      session={session}
      currentTrack={currentTrack}
      cumulative={cumulative}
      correctAnswers={etat === 'attente' ? [] : correctAnswers}
      phase2StartedAt={etat === 'ecoute' ? new Date(now - 3_000).toISOString() : null}
      lastReveal={
        etat === 'revelation'
          ? {
              artist: 'Christina Aguilera, Lil’ Kim, Mýa & Pink',
              title: 'Lady Marmalade (Voulez-vous coucher avec moi ce soir ?)',
            }
          : null
      }
      activeBuzzCount={etat === 'ecoute' ? 3 : 0}
    />
  );
}
