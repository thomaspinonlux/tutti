/**
 * Computed screen state — source unique de vérité pour l'écran TV.
 *
 * Lit la DB à chaque appel (no cache, no in-memory state). Calcule l'état
 * déterministe à partir des rows sessions + session_rounds.
 *
 * États (priorité descendante) :
 *   FINAL_PODIUM  — session.status=ENDED + ended_at < 5min
 *   PAUSED        — session PLAYING + round PLAYING + is_paused=true
 *   PLAYING       — session PLAYING + round PLAYING + !is_paused
 *   ROUND_PODIUM  — session PLAYING + last round ENDED (entre 2 manches)
 *   LOBBY         — session WAITING ou PLAYING sans round actif
 *   IDLE          — pas de session active dans la fenêtre temporelle
 *
 * Time-window filter (anti-zombie) :
 *   - Sessions ENDED gardées 5min après ended_at (pour afficher le podium final)
 *   - Sessions non-ENDED gardées si created_at < 4h ET updated_at < 30min
 *     (au-delà = abandonnée silencieusement)
 */

import type {
  CorrectAnswerEntry,
  CumulativeScore,
  CurrentTrackState,
  SessionWithParticipants,
} from '@tutti/shared';
import { prisma } from './prisma.js';
import { computeRoundResults, type RoundRankingEntry, type FastestPlayer } from './roundResults.js';
import { getCumulativeScores } from './scores.js';
import { buildCurrentTrackStateSnapshot, getEffectiveRoundTrackCount } from './gameplayCore.js';
import { getFocusedSelection } from './playlistSelectionStore.js';
import { getQrOverlay } from './qrOverlayStore.js';
import { getLyricsOverlay } from './lyrics/lyricsOverlayStore.js';
import type { GameMode, Team } from '@tutti/shared';

export type ScreenState =
  | { state: 'IDLE'; lastUpdate: string }
  | {
      state: 'LOBBY';
      sessionId: string;
      joinCode: string;
      sessionName: string | null;
      players: Array<{ id: string; pseudo: string; team_id: string | null }>;
      lastUpdate: string;
    }
  | {
      state: 'PLAYING';
      sessionId: string;
      joinCode: string;
      sessionName: string | null;
      /**
       * Vue session enrichie pour MainScreenView (rounds + participants +
       * is_paused + has_animator + mode). Sérialisée à chaque tick — payload
       * borné (~30 joueurs × ~10 rounds = ~5KB max).
       */
      session: SessionWithParticipants;
      currentTrack: CurrentTrackState | null;
      cumulative: CumulativeScore[];
      correctAnswers: CorrectAnswerEntry[];
      phase2StartedAt: string | null;
      roundPosition: number;
      roundsTotal: number;
      /** feat/tv-join-qr-codes — animateur a demandé l'overlay QR géant. */
      qr_overlay: boolean;
      /**
       * feat/synced-lyrics — animateur a demandé l'affichage des paroles.
       * Ne contient PAS le texte : la TV le charge par la route publique
       * (qui refuse tant que le morceau n'est pas révélé).
       */
      lyrics_overlay: boolean;
      lastUpdate: string;
    }
  | {
      state: 'PAUSED';
      sessionId: string;
      joinCode: string;
      sessionName: string | null;
      session: SessionWithParticipants;
      currentTrack: CurrentTrackState | null;
      /** fix/classement-qui-disparait-en-pause — mêmes scores qu'en jeu. */
      cumulative: CumulativeScore[];
      correctAnswers: CorrectAnswerEntry[];
      /** feat/tv-join-qr-codes — animateur a demandé l'overlay QR géant. */
      qr_overlay: boolean;
      /** feat/synced-lyrics — cf. variante PLAYING. */
      lyrics_overlay: boolean;
      lastUpdate: string;
    }
  | {
      state: 'ROUND_PODIUM';
      sessionId: string;
      joinCode: string;
      sessionName: string | null;
      cumulative: CumulativeScore[];
      /** feat/tv-round-results — classement de la manche + plus rapide (mirror TV). */
      roundRanking: RoundRankingEntry[];
      fastestPlayer: FastestPlayer | null;
      lastEndedRoundPosition: number;
      lastUpdate: string;
    }
  | {
      state: 'FINAL_PODIUM';
      sessionId: string;
      joinCode: string;
      sessionName: string | null;
      finalScores: CumulativeScore[];
      lastUpdate: string;
    }
  | {
      /** feat/tv-grid-mirror — host est sur l'écran de sélection (avant partie
       *  OU entre 2 manches). La TV mirrore la GRILLE complète (qu'elle fetch
       *  elle-même via /api/library-public/catalog), highlight la playlist
       *  centrée et applique le scroll de l'animateur. */
      state: 'PLAYLIST_SELECTION';
      sessionId: string;
      joinCode: string;
      sessionName: string | null;
      focused_playlist_id: string;
      /** Position de scroll VERTICALE de la grille host, ratio 0..1. */
      scroll_ratio: number;
      /** feat/tv-h-scroll — scroll HORIZONTAL par carrousel { catSlug: 0..1 }. */
      h_ratios: Record<string, number>;
      /** feat/host-tv-level-mirror — thème ouvert côté host (étape NIVEAU) ;
       *  null = étape THÈMES. La TV mirrore les cartes de niveau si non-null. */
      selected_theme_key: string | null;
      /** feat/tv-join-qr-codes — animateur a demandé l'overlay QR géant. */
      qr_overlay: boolean;
      lastUpdate: string;
    };

// feat/classement-final-persistant — le podium final reste affiché jusqu'à ce
// que l'animateur le ferme (podium_hidden_at), avec un plafond de sûreté de
// 12 h pour qu'une TV laissée allumée n'affiche pas le podium de la veille.
const FINAL_PODIUM_WINDOW_MS = 12 * 60 * 60 * 1000;
const ZOMBIE_CREATED_WINDOW_MS = 4 * 60 * 60 * 1000; // 4h max depuis création

/**
 * Cherche la session "représentative" du workspace pour le screen-state.
 *
 * Priorité (révisée — Issue 2 du 6 mai) :
 *   1. Session WAITING/PLAYING active (créée dans les 4h anti-zombie)
 *      → l'admin a démarré une nouvelle session, on bascule dessus
 *   2. Sinon session ENDED < 5min ago (pour podium final résiduel)
 *   3. Sinon null → IDLE
 *
 * Avant : ENDED prioritaire → bug TV restée bloquée sur podium ancien
 * pendant 5min même quand une nouvelle session était lancée. Fix : active
 * d'abord, podium final seulement quand plus rien d'actif.
 */
async function findRepresentativeSession(workspaceId: string) {
  const now = new Date();
  const finalPodiumCutoff = new Date(now.getTime() - FINAL_PODIUM_WINDOW_MS);
  const zombieCreatedCutoff = new Date(now.getTime() - ZOMBIE_CREATED_WINDOW_MS);

  // 1. WAITING/PLAYING active, créée dans les 4h (anti-zombie). Prioritaire
  // pour que la TV bascule sur une nouvelle session dès qu'elle est créée.
  // Bug 4 (fix/critical-bugs-v3) — orderBy updated_at desc (au lieu de
  // created_at). Une session récemment terminée a un updated_at plus
  // récent qu'une zombie PLAYING jamais touchée. Avec ce orderBy + le
  // cleanup auto au POST /sessions, une zombie ne peut plus masquer une
  // session ENDED récente.
  const active = await prisma.session.findFirst({
    where: {
      establishment: { workspace_id: workspaceId },
      status: { in: ['WAITING', 'PLAYING'] },
      created_at: { gte: zombieCreatedCutoff },
    },
    // fix/tv-session-loop — ordre DÉTERMINISTE : created_at desc d'abord. La
    // session COURANTE est toujours la plus récemment créée (le cleanup au POST
    // /sessions END les précédentes). created_at est IMMUABLE → si deux sessions
    // actives coexistent transitoirement, la TV ne peut plus osciller entre elles
    // (avant : updated_at desc flippait à chaque poll qui touchait l'ancienne →
    // écran TV en boucle entre l'actuelle et l'ancienne). updated_at en tiebreak.
    orderBy: [{ created_at: 'desc' }, { updated_at: 'desc' }],
    include: {
      participants: { where: { is_kicked: false } },
      rounds: {
        orderBy: { position: 'asc' },
        include: {
          playlist: {
            select: {
              id: true,
              name: true,
              level: true,
              _count: { select: { playlist_tracks: true } },
            },
          },
        },
      },
    },
  });
  if (active) return active;

  // 2. Pas d'active → fallback ENDED <5min pour afficher le podium final
  // résiduel. Si l'admin lance une nouvelle session après, la session active
  // (étape 1 ci-dessus) la masquera immédiatement.
  const endedRecent = await prisma.session.findFirst({
    where: {
      establishment: { workspace_id: workspaceId },
      status: 'ENDED',
      ended_at: { gte: finalPodiumCutoff },
      podium_hidden_at: null,
    },
    orderBy: { ended_at: 'desc' },
    include: {
      participants: { where: { is_kicked: false } },
      rounds: {
        orderBy: { position: 'asc' },
        include: {
          playlist: {
            select: {
              id: true,
              name: true,
              level: true,
              _count: { select: { playlist_tracks: true } },
            },
          },
        },
      },
    },
  });
  return endedRecent ?? null;
}

/**
 * Sérialise une session Prisma chargée (avec participants + rounds.playlist
 * incluant _count.playlist_tracks) au format SessionWithParticipants pour le
 * frontend. Convertit aussi _count.playlist_tracks → tracks_count.
 */
function serializeSession(
  session: Awaited<ReturnType<typeof findRepresentativeSession>>,
): SessionWithParticipants {
  if (!session) {
    throw new Error('serializeSession called with null session');
  }
  return {
    id: session.id,
    establishment_id: session.establishment_id,
    name: session.name,
    game_type: session.game_type,
    status: session.status,
    short_code: session.short_code,
    mode: session.mode,
    teams_config: (session.teams_config as Team[] | null) ?? null,
    language: session.language,
    question_set_id: session.question_set_id ?? null,
    has_animator: session.has_animator,
    is_paused: session.is_paused,
    buzz_window_seconds: session.buzz_window_seconds,
    max_participants: session.max_participants,
    created_at: session.created_at.toISOString(),
    started_at: session.started_at ? session.started_at.toISOString() : null,
    ended_at: session.ended_at ? session.ended_at.toISOString() : null,
    participants: session.participants.map((p) => ({
      id: p.id,
      session_id: p.session_id,
      pseudo: p.pseudo,
      team_id: p.team_id,
      is_master: p.is_master,
      role: p.role,
      is_kicked: p.is_kicked,
      joined_at: p.joined_at.toISOString(),
    })),
    rounds: session.rounds.map((r) => ({
      id: r.id,
      session_id: r.session_id,
      playlist_id: r.playlist_id,
      position: r.position,
      status: r.status,
      current_track_index: r.current_track_index,
      started_at: r.started_at ? r.started_at.toISOString() : null,
      ended_at: r.ended_at ? r.ended_at.toISOString() : null,
      created_at: r.created_at.toISOString(),
      playlist: {
        id: r.playlist.id,
        name: r.playlist.name,
        level: r.playlist.level,
        tracks_count: getEffectiveRoundTrackCount(r),
      },
    })),
  };
}

/**
 * Calcule l'état screen actuel pour un workspace donné. Lit la DB à chaque
 * appel — déterministe, no cache.
 */
/**
 * fix/reponse-en-clair — L'ÉCRAN TV EST SERVI PAR UNE ROUTE PUBLIQUE.
 *
 * Le calcul d'état renvoyait titre, artiste, album, année et pochette DÈS LA
 * PHASE 1. L'affichage les masquait bien, mais quiconque connaissait l'adresse
 * de l'écran (elle est visible sur l'iPad, et dans l'historique du navigateur)
 * pouvait lire la réponse avant tout le monde. On les retire tant que le
 * morceau n'est pas révélé à toute la salle.
 */
function masquerReponseAvantRevelation(track: CurrentTrackState | null): CurrentTrackState | null {
  if (!track) return null;
  const revele =
    track.phase === 'phase3' ||
    track.phase === 'phase3-revealed' ||
    track.phase === 'phase3-skipped';
  if (revele) return track;
  return {
    ...track,
    artist: '',
    title: '',
    album: null,
    year: null,
    cover_url: null,
    work_title: null,
    song_title: null,
  };
}

// perf/journal-bavard — LE JOURNAL N'ÉCRIT QUE SUR CHANGEMENT.
// Chaque TV interroge cet état une fois par seconde : une ligne écrite à
// chaque calcul remplissait les journaux de Railway de milliers de lignes
// identiques par soirée, ce qui coûte cher et masque les vraies erreurs.
const dernierEtatJournalise = new Map<string, string>();

function journaliserSiChange(workspaceId: string, ligne: string): void {
  if (dernierEtatJournalise.get(workspaceId) === ligne) return;
  // Plafond de sûreté : cette table est alimentée par un paramètre d'adresse.
  if (dernierEtatJournalise.size > 200) dernierEtatJournalise.clear();
  dernierEtatJournalise.set(workspaceId, ligne);
  console.info(ligne);
}

export async function computeScreenState(workspaceId: string): Promise<ScreenState> {
  const lastUpdate = new Date().toISOString();
  const session = await findRepresentativeSession(workspaceId);

  if (!session) {
    journaliserSiChange(
      workspaceId,
      `[ScreenState] Workspace ${workspaceId} → IDLE (pas de session active)`,
    );
    return { state: 'IDLE', lastUpdate };
  }

  const players = session.participants.map((p) => ({
    id: p.id,
    pseudo: p.pseudo,
    team_id: p.team_id,
  }));

  // FINAL_PODIUM : session ENDED dans la fenêtre 5min
  if (session.status === 'ENDED') {
    const finalScores = await getCumulativeScores({
      sessionId: session.id,
      mode: session.mode as GameMode,
      teams: (session.teams_config as Team[] | null) ?? null,
      participants: players,
    });
    journaliserSiChange(
      workspaceId,
      `[ScreenState] Workspace ${workspaceId} → FINAL_PODIUM (session=${session.id})`,
    );
    return {
      state: 'FINAL_PODIUM',
      sessionId: session.id,
      joinCode: session.short_code,
      sessionName: session.name,
      finalScores,
      lastUpdate,
    };
  }

  const playingRound = session.rounds.find((r) => r.status === 'PLAYING');
  const lastEndedRound = [...session.rounds].reverse().find((r) => r.status === 'ENDED');
  const roundsTotal = session.rounds.length;

  // PAUSED : session PLAYING + round PLAYING + is_paused
  if (playingRound && session.is_paused) {
    const currentTrack = await buildCurrentTrackStateSnapshot(playingRound.id);
    // fix/classement-qui-disparait-en-pause — L'ÉTAT EN PAUSE PORTE AUSSI LES
    // SCORES. Il ne contenait ni le classement ni les joueurs ayant trouvé :
    // dès que l'animateur mettait en pause pour une annonce, le classement
    // s'effaçait de la TV alors que la console l'affichait toujours. Au retour
    // de pause tout réapparaissait — ça ressemblait à une perte de points.
    const cumulativePause = await getCumulativeScores({
      sessionId: session.id,
      mode: session.mode as GameMode,
      teams: (session.teams_config as Team[] | null) ?? null,
      participants: players,
    });
    journaliserSiChange(
      workspaceId,
      `[ScreenState] Workspace ${workspaceId} → PAUSED (session=${session.id}, round=${playingRound.position})`,
    );
    return {
      state: 'PAUSED',
      sessionId: session.id,
      joinCode: session.short_code,
      sessionName: session.name,
      session: serializeSession(session),
      currentTrack: masquerReponseAvantRevelation(currentTrack),
      cumulative: cumulativePause,
      correctAnswers: currentTrack?.correct_answers ?? [],
      qr_overlay: getQrOverlay(workspaceId),
      lyrics_overlay: getLyricsOverlay(session.id),
      lastUpdate,
    };
  }

  // PLAYING : session PLAYING + round PLAYING + !is_paused
  if (playingRound && !session.is_paused) {
    const currentTrack = await buildCurrentTrackStateSnapshot(playingRound.id);
    const cumulative = await getCumulativeScores({
      sessionId: session.id,
      mode: session.mode as GameMode,
      teams: (session.teams_config as Team[] | null) ?? null,
      participants: players,
    });
    journaliserSiChange(
      workspaceId,
      `[ScreenState] Workspace ${workspaceId} → PLAYING (session=${session.id}, round=${playingRound.position}/${roundsTotal})`,
    );
    return {
      state: 'PLAYING',
      sessionId: session.id,
      joinCode: session.short_code,
      sessionName: session.name,
      session: serializeSession(session),
      currentTrack: masquerReponseAvantRevelation(currentTrack),
      cumulative,
      correctAnswers: currentTrack?.correct_answers ?? [],
      phase2StartedAt: currentTrack?.phase2_started_at ?? null,
      roundPosition: playingRound.position,
      roundsTotal,
      qr_overlay: getQrOverlay(workspaceId),
      lyrics_overlay: getLyricsOverlay(session.id),
      lastUpdate,
    };
  }

  // PLAYLIST_SELECTION : host est sur l'écran de sélection (grille playlists).
  // Prioritaire sur ROUND_PODIUM et LOBBY (pas sur PAUSED/PLAYING/FINAL_PODIUM).
  // Le store in-memory (TTL 30s) est alimenté par POST /screen-state/focused-playlist.
  // On renvoie juste l'id focused + le scroll : la TV fetch la grille catalogue
  // elle-même (/api/library-public/catalog) et mirrore l'écran animateur.
  const focus = getFocusedSelection(workspaceId);
  if (focus) {
    journaliserSiChange(
      workspaceId,
      `[ScreenState] Workspace ${workspaceId} → PLAYLIST_SELECTION (session=${session.id}, focus=${focus.playlistId}, scroll=${focus.scrollRatio.toFixed(2)})`,
    );
    return {
      state: 'PLAYLIST_SELECTION',
      sessionId: session.id,
      joinCode: session.short_code,
      sessionName: session.name,
      focused_playlist_id: focus.playlistId,
      scroll_ratio: focus.scrollRatio,
      h_ratios: focus.hRatios,
      selected_theme_key: focus.selectedThemeKey,
      qr_overlay: getQrOverlay(workspaceId),
      lastUpdate,
    };
  }

  // ROUND_PODIUM : session PLAYING (status) ET dernier round ENDED (entre 2 manches)
  if (lastEndedRound && session.status === 'PLAYING') {
    const [cumulative, roundResults] = await Promise.all([
      getCumulativeScores({
        sessionId: session.id,
        mode: session.mode as GameMode,
        teams: (session.teams_config as Team[] | null) ?? null,
        participants: players,
      }),
      computeRoundResults(session.id, lastEndedRound.id),
    ]);
    journaliserSiChange(
      workspaceId,
      `[ScreenState] Workspace ${workspaceId} → ROUND_PODIUM (session=${session.id}, lastRound=${lastEndedRound.position})`,
    );
    return {
      state: 'ROUND_PODIUM',
      sessionId: session.id,
      joinCode: session.short_code,
      sessionName: session.name,
      cumulative,
      roundRanking: roundResults.round_ranking,
      fastestPlayer: roundResults.fastest_player,
      lastEndedRoundPosition: lastEndedRound.position,
      lastUpdate,
    };
  }

  // LOBBY : session WAITING ou PLAYING sans round actif
  journaliserSiChange(
    workspaceId,
    `[ScreenState] Workspace ${workspaceId} → LOBBY (session=${session.id}, players=${players.length})`,
  );
  return {
    state: 'LOBBY',
    sessionId: session.id,
    joinCode: session.short_code,
    sessionName: session.name,
    players,
    lastUpdate,
  };
}
