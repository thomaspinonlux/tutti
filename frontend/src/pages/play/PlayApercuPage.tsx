/**
 * PlayApercuPage — /play/apercu
 *
 * feat/telephone-au-style-tv — LE TELEPHONE JOUEUR SE VERIFIE SANS SOIREE.
 *
 * Meme principe que /screen/apercu pour la TV : cette page rend l ecran de
 * jeu du telephone avec des donnees fictives, pour juger la mise en page et
 * les couleurs sans lancer de partie devant les clients.
 *
 *   /play/apercu?etat=buzz        morceau en cours, buzzer disponible
 *   /play/apercu?etat=trouve      le joueur a trouve, bandeau de validation
 *   /play/apercu?etat=revelation  reponse devoilee (pochette + titre)
 *   &long=1                       pseudo et equipe volontairement longs
 *
 * Aucune donnee reelle. Les boutons ne mènent nulle part : la page est
 * purement visuelle.
 */

import type { CorrectAnswerEntry, CumulativeScore, CurrentTrackState } from '@tutti/shared';
import { useSearchParams } from 'react-router-dom';
import { PlayingView, useFondJoueurSombre } from '../PlayPage.js';

export function PlayApercuPage(): JSX.Element {
  useFondJoueurSombre();
  const [params] = useSearchParams();
  const etat = params.get('etat') ?? 'buzz';
  const long = params.get('long') !== null;
  const now = Date.now();

  const moi = {
    token: 'apercu',
    participantId: 'p0',
    sessionId: 'apercu',
    pseudo: long ? 'Christina & les Garçons de Mondorf' : 'Marion',
    teamId: null,
  };

  const currentTrack: CurrentTrackState = {
    round_id: 'r1',
    track_index: 4,
    track_id: 't1',
    provider: 'apple_music',
    provider_track_id: '0',
    artist: 'Christina Aguilera, Lil’ Kim, Mýa & Pink',
    title: 'Lady Marmalade (Voulez-vous coucher avec moi ce soir ?)',
    album: 'Moulin Rouge!',
    year: 2001,
    cover_url: null,
    work_title: null,
    song_title: null,
    started_at: new Date(now - 12_000).toISOString(),
    duration_ms: 258_000,
    phase: etat === 'revelation' ? 'phase3-revealed' : etat === 'trouve' ? 'phase2' : 'phase1',
    phase2_started_at: etat === 'trouve' ? new Date(now - 3_000).toISOString() : null,
    correct_answers: [],
    lyrics_available: false,
  };

  const correctAnswers: CorrectAnswerEntry[] =
    etat === 'buzz'
      ? []
      : [
          {
            participant_id: 'p0',
            pseudo: moi.pseudo,
            team_id: null,
            position: 1,
            answered_at_ms: 4_200,
            matched_artist: true,
            matched_title: true,
            score: 38,
            score_position: 20,
            score_title_bonus: 10,
            score_speed_bonus: 8,
          },
        ];

  const cumulative: CumulativeScore[] = [
    { id: 'p0', label: moi.pseudo, total_points: 268, color: null },
    { id: 'p1', label: 'Kevin', total_points: 241, color: null },
  ];

  return (
    <div className="mx-auto min-h-screen w-full max-w-[500px] bg-[#0B0B0F] px-4 py-3 text-white">
      <PlayingView
        currentTrack={currentTrack}
        identity={moi}
        myScore={268}
        correctAnswers={correctAnswers}
        lastReveal={
          etat === 'revelation'
            ? {
                artist: currentTrack.artist,
                title: currentTrack.title,
                song_title: null,
                cover_url: null,
              }
            : null
        }
        phase2StartedAt={currentTrack.phase2_started_at}
        busy={false}
        setBusy={() => undefined}
        teamName={long ? 'Les Inséparables du Komptoir' : null}
        teamColor="#FF5C4D"
        myRank={1}
        totalParticipants={14}
        roundPosition={2}
        isMaster={false}
        isPaused={false}
        cumulative={cumulative}
      />
    </div>
  );
}
