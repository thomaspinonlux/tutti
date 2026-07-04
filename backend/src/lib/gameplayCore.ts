/**
 * Helpers partagés entre la route gameplay (host, mode A) et sessionMaster
 * (master, mode B). Sans contrôle d'auth — c'est aux routes appelantes de
 * vérifier que l'appel est autorisé.
 *
 * Concentre :
 *   - le lookup d'un round avec ses tracks ordonnés
 *   - la construction + broadcast du CurrentTrackState
 *   - l'avance au prochain track avec auto-end de round si plus de tracks
 *   - la révélation manuelle (master "Réponse") sans buzz ni score
 */

import type { CurrentTrackState, GameTrackPhase, ParticipantRole } from '@tutti/shared';
import { DEFAULT_SESSION_SIZE } from '@tutti/shared';
import { prisma } from './prisma.js';
import type { Tier } from '../config/levelWeights.js';
import { broadcastToSession, emitTrackAnswer } from '../socket/index.js';
import {
  clearActiveTrack,
  setActiveTrack,
  setPhase3Revealed,
  getActiveTrack,
} from './gameState.js';

export const LISTEN_DURATION_MS = 30_000; // 30s par défaut V1

// ─────────────────────────────────────────────────────────────────────────────
//  feat/multi-animator-roles — ANTI-TRICHE SERVEUR (garde-fou clé)
//
//  La réponse (artist/title/album/year/cover_url) ne doit JAMAIS transiter dans
//  un payload reçu par un joueur ou un animateur-joueur (ANIMATOR_PLAYING) avant
//  le reveal. Elle ne circule que :
//    - dans le broadcast public une fois la phase publique (phase3*),
//    - sinon exclusivement via le canal privilégié `track:answer`
//      (room answers:{sessionId} = host + ANIMATOR_FULL uniquement).
//  Le filtrage se fait sur le PAYLOAD (serveur), pas seulement à l'affichage.
// ─────────────────────────────────────────────────────────────────────────────

/** La réponse est-elle publique à cette phase ? (révélée à tout le monde) */
export function isTrackAnswerPublic(phase: GameTrackPhase): boolean {
  // Publique seulement au reveal. phase3-skipped = piste sautée, réponse tue.
  return phase === 'phase3' || phase === 'phase3-revealed';
}

/** Copie d'un state SANS les métadonnées-réponse (broadcast public / joueur). */
export function stripTrackAnswer(state: CurrentTrackState): CurrentTrackState {
  return { ...state, artist: '', title: '', album: null, year: null, cover_url: null };
}

/**
 * State à renvoyer à un rôle donné. Seuls host (traité à part) et ANIMATOR_FULL
 * voient la réponse avant le reveal ; PLAYER et ANIMATOR_PLAYING la reçoivent
 * caviardée tant que la phase n'est pas publique.
 */
export function trackStateForRole(
  state: CurrentTrackState,
  role: ParticipantRole,
): CurrentTrackState {
  if (role === 'ANIMATOR_FULL') return state;
  if (isTrackAnswerPublic(state.phase)) return state;
  return stripTrackAnswer(state);
}

/** Payload du canal privilégié `track:answer`. */
export interface TrackAnswerPayload {
  round_id: string;
  track_index: number;
  phase: GameTrackPhase;
  artist: string;
  title: string;
  album: string | null;
  year: number | null;
  cover_url: string | null;
}

/** Extrait la réponse d'un state complet pour le canal privilégié. */
export function trackAnswerFromState(state: CurrentTrackState): TrackAnswerPayload {
  return {
    round_id: state.round_id,
    track_index: state.track_index,
    phase: state.phase,
    artist: state.artist,
    title: state.title,
    album: state.album,
    year: state.year,
    cover_url: state.cover_url,
  };
}

// Inclut la playlist avec ses morceaux ordonnés. Track relie maintenant un
// Artist (catalogue partagé), donc on l'inclut aussi pour avoir artist.canonical_name.
const ROUND_INCLUDE = {
  playlist: {
    include: {
      playlist_tracks: {
        orderBy: { position: 'asc' as const },
        include: { track: { include: { artist: true } } },
      },
    },
  },
} as const;

export type RoundWithTracks = NonNullable<Awaited<ReturnType<typeof findRoundForSession>>>;

const PLAYLIST_LIGHT = {
  id: true,
  name: true,
  level: true,
  _count: { select: { playlist_tracks: true } },
} as const;

/**
 * Cherche un round dans une session donnée, sans contrôle workspace. Utilisé
 * par la route master où le contrôle d'autorisation se fait via JWT
 * participant + flag is_master.
 */
export async function findRoundForSession(roundId: string, sessionId: string) {
  return prisma.sessionRound.findFirst({
    where: { id: roundId, session_id: sessionId },
    include: ROUND_INCLUDE,
  });
}

/**
 * Variante workspace-scoped pour la route host (mode A). Le contrôle se fait
 * via l'auth Supabase + appartenance au workspace.
 */
export async function findRoundForWorkspace(
  roundId: string,
  sessionId: string,
  workspaceId: string,
) {
  return prisma.sessionRound.findFirst({
    where: {
      id: roundId,
      session_id: sessionId,
      session: { establishment: { workspace_id: workspaceId } },
    },
    include: ROUND_INCLUDE,
  });
}

/**
 * Construit un CurrentTrackState à partir d'un round + index, met à jour la
 * gameState en mémoire, persiste le current_track_index, et broadcast
 * 'track:start' à toute la session.
 *
 * Retourne null si l'index est out-of-range (pas de track à cette position).
 *
 * feat/playlist-pool-random-selection — si `round.selected_track_ids` est
 * non-vide, on utilise ce sous-ensemble (ordre = tirage random fait à la
 * création du round). Sinon (legacy rounds créés avant la PR), fallback sur
 * `round.playlist.playlist_tracks[index]` pour rétro-compat.
 */
export async function buildAndBroadcastTrack(
  sessionId: string,
  round: RoundWithTracks,
  trackIndex: number,
): Promise<CurrentTrackState | null> {
  let selected = round.selected_track_ids ?? [];

  // fix/session-pick-respect-default-size — DEFENSE IN DEPTH.
  // Si selected_track_ids est vide (round legacy créé avant PR #75 OU bug
  // silencieux à l'écriture), on AUTO-CLAMP à default_session_size random
  // au lieu de fallback sur les 80 tracks du pool. Persist en DB pour que
  // les advance/next-track suivants utilisent le même sous-ensemble.
  if (selected.length === 0) {
    const sessionSize = round.playlist.default_session_size ?? DEFAULT_SESSION_SIZE;
    const allTrackIds = round.playlist.playlist_tracks.map((pt) => pt.track.id);
    if (allTrackIds.length > sessionSize) {
      // Fisher-Yates pick
      for (let i = allTrackIds.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allTrackIds[i]!, allTrackIds[j]!] = [allTrackIds[j]!, allTrackIds[i]!];
      }
      selected = allTrackIds.slice(0, sessionSize);
    } else {
      selected = allTrackIds;
    }
    console.warn(
      `[gameplayCore] Round ${round.id} avait selected_track_ids vide — AUTO-CLAMP à ${selected.length} tracks (pool=${allTrackIds.length}, sessionSize=${sessionSize})`,
    );
    // Persist pour les advance suivants
    await prisma.sessionRound.update({
      where: { id: round.id },
      data: { selected_track_ids: selected },
    });
    round.selected_track_ids = selected;
  }

  let playlistTrack: RoundWithTracks['playlist']['playlist_tracks'][number] | undefined;
  const targetTrackId = selected[trackIndex];
  if (!targetTrackId) return null;
  playlistTrack = round.playlist.playlist_tracks.find((pt) => pt.track.id === targetTrackId);
  if (!playlistTrack) return null;
  const track = playlistTrack.track;

  const nowMs = Date.now();
  const state: CurrentTrackState = {
    round_id: round.id,
    track_index: trackIndex,
    track_id: track.id,
    provider: track.provider as CurrentTrackState['provider'],
    provider_track_id: track.provider_track_id,
    artist: track.artist.canonical_name,
    title: track.canonical_title,
    album: track.album,
    year: track.year,
    cover_url: track.cover_url,
    started_at: new Date(nowMs).toISOString(),
    duration_ms: track.duration_ms,
    phase: 'phase1',
    phase2_started_at: null,
    correct_answers: [],
  };

  setActiveTrack(round.id, {
    round_id: round.id,
    track_index: trackIndex,
    track_id: track.id,
    started_at_ms: nowMs,
  });

  await prisma.sessionRound.update({
    where: { id: round.id },
    data: { current_track_index: trackIndex },
  });

  // feat/session-no-duplicate-tracks — enregistre le track joué pour cette
  // session. Idempotent : si on relance/restart le même track, on ne crée pas
  // de doublon grâce à @@unique([session_id, track_id]). PR B utilisera ces
  // données pour filtrer les playlists subsequentes.
  await prisma.sessionPlayedTrack
    .upsert({
      where: { session_id_track_id: { session_id: sessionId, track_id: track.id } },
      update: {}, // déjà inséré → no-op (timestamp d'origine préservé)
      create: { session_id: sessionId, track_id: track.id },
    })
    .catch((err) => console.warn('[gameplayCore] SessionPlayedTrack upsert error:', err));

  // ANTI-TRICHE — le broadcast public ne porte JAMAIS la réponse en phase1.
  // La réponse part uniquement sur le canal privilégié (host + ANIMATOR_FULL).
  broadcastToSession(sessionId, 'track:start', { state: stripTrackAnswer(state) });
  emitTrackAnswer(sessionId, trackAnswerFromState(state));
  // NB : on retourne le state COMPLET. Les routes mode B (sessionMaster) qui le
  // renvoient en HTTP doivent le filtrer via trackStateForRole(req.master.role).
  return state;
}

/**
 * feat/session-no-duplicate-tracks — helper réutilisable. Retourne la liste
 * des track_id déjà joués dans une session (utilisé par PR B pour exclure les
 * doublons lors du random pick d'une nouvelle playlist).
 */
export async function getSessionPlayedTrackIds(sessionId: string): Promise<Set<string>> {
  const rows = await prisma.sessionPlayedTrack.findMany({
    where: { session_id: sessionId },
    select: { track_id: true },
  });
  return new Set(rows.map((r) => r.track_id));
}

/**
 * Default session size si playlist.default_session_size est null.
 * Source unique = @tutti/shared (partagé avec le frontend). Re-export pour les
 * importeurs backend existants (sessions/library/sessionMaster).
 */
export { DEFAULT_SESSION_SIZE };

/**
 * fix/round-tracks-count-clamped-to-selected — calcul du nombre de tracks
 * EFFECTIFS pour un round sérialisé vers le frontend. Si selected_track_ids
 * est non-vide, c'est la longueur de cette liste (= taille de la manche, 15).
 * Sinon, fallback sur la taille du pool de la playlist (legacy rounds).
 *
 * Avant ce fix, tous les serializers renvoyaient `_count.playlist_tracks`
 * (= taille du pool = 80) → le frontend HostPage affichait
 * "Morceau X / 80" alors que le round n'en joue que 15. PO confusion.
 */
export function getEffectiveRoundTrackCount(round: {
  selected_track_ids?: string[] | null;
  playlist: { _count: { playlist_tracks: number } };
}): number {
  const n = round.selected_track_ids?.length ?? 0;
  return n > 0 ? n : round.playlist._count.playlist_tracks;
}

export interface RandomPickResult {
  selectedTrackIds: string[];
  poolSize: number;
  playedSize: number;
  eligibleSize: number;
}

/**
 * fix/session-pick-respect-default-size — extrait de POST /sessions/:id/rounds
 * (sessions.ts) pour partage entre les 3 endpoints qui créent des rounds :
 *   - POST /sessions/:id/rounds          (sessions.ts)
 *   - POST /library/playlists/:id/launch (library.ts, clone-on-launch)
 *   - POST /sessions/:id/pick-round      (sessionMaster.ts)
 *
 * Avant ce fix, library.ts et sessionMaster.ts créaient des rounds sans
 * `selected_track_ids` → `gameplayCore.buildAndBroadcastTrack` fallback sur
 * la playlist complète → host jouait les 80 tracks au lieu des 15 random.
 *
 * Récupère tout le pool de la playlist, filtre les tracks déjà jouées dans
 * la session (anti-doublon cross-playlist), shuffle Fisher-Yates, take N.
 *
 * Si la table `session_played_tracks` n'existe pas ou erreur DB → dégrade
 * proprement en ignorant le filtre (pool complet).
 */
export async function pickRandomTrackIdsForRound(
  sessionId: string,
  playlistId: string,
  sessionSize: number,
): Promise<RandomPickResult> {
  const poolTracks = await prisma.playlistTrack.findMany({
    where: { playlist_id: playlistId },
    select: { track_id: true },
    orderBy: { position: 'asc' },
  });
  const playedTrackIds = await prisma.sessionPlayedTrack
    .findMany({
      where: { session_id: sessionId },
      select: { track_id: true },
    })
    .then((rows) => new Set(rows.map((r) => r.track_id)))
    .catch((err) => {
      console.warn(
        '[pickRandomTrackIdsForRound] SessionPlayedTrack lookup failed, degrading:',
        err,
      );
      return new Set<string>();
    });

  const candidates = poolTracks.map((pt) => pt.track_id).filter((tid) => !playedTrackIds.has(tid));

  const eligibleSize = candidates.length;
  if (eligibleSize === 0) {
    return {
      selectedTrackIds: [],
      poolSize: poolTracks.length,
      playedSize: playedTrackIds.size,
      eligibleSize: 0,
    };
  }

  const targetN = Math.min(sessionSize, eligibleSize);
  // Fisher-Yates shuffle (in-place).
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i]!, candidates[j]!] = [candidates[j]!, candidates[i]!];
  }
  return {
    selectedTrackIds: candidates.slice(0, targetN),
    poolSize: poolTracks.length,
    playedSize: playedTrackIds.size,
    eligibleSize,
  };
}

function fisherYates<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i]!, arr[j]!] = [arr[j]!, arr[i]!];
  }
}

/**
 * feat/thematic-level-cumulative-weighted — tirage PONDÉRÉ par tier sur un pool
 * cumulé. Même contrat que pickRandomTrackIdsForRound (anti-répétition via
 * SessionPlayedTrack conservée) mais, au lieu d'un shuffle plat, échantillonne
 * `sessionSize` tracks selon des PROPORTIONS-CIBLES par tier (`weights`,
 * lues depuis config/levelWeights.ts).
 *
 * Stratifié : pass 1 → quota cible par tier (round(part × N), borné par le
 * dispo ET par le reste à pourvoir, tiers traités part décroissante pour que
 * le tier dominant obtienne son quota) ; pass 2 → si court (tier épuisé), comble
 * depuis les restes, choix de tier pondéré par la part ; puis shuffle final.
 *
 * `tierByTrackId` : tier de chaque track clonée (construit au clone-on-launch,
 * où la difficulty catalogue est connue). Tracks absentes de la map → MEDIUM
 * (défensif, ne doit pas arriver).
 */
export async function pickWeightedTrackIdsForRound(
  sessionId: string,
  playlistId: string,
  sessionSize: number,
  tierByTrackId: Map<string, Tier>,
  weights: Partial<Record<Tier, number>>,
): Promise<RandomPickResult> {
  const poolTracks = await prisma.playlistTrack.findMany({
    where: { playlist_id: playlistId },
    select: { track_id: true },
    orderBy: { position: 'asc' },
  });
  const playedTrackIds = await prisma.sessionPlayedTrack
    .findMany({ where: { session_id: sessionId }, select: { track_id: true } })
    .then((rows) => new Set(rows.map((r) => r.track_id)))
    .catch((err) => {
      console.warn(
        '[pickWeightedTrackIdsForRound] SessionPlayedTrack lookup failed, degrading:',
        err,
      );
      return new Set<string>();
    });

  const candidates = poolTracks.map((pt) => pt.track_id).filter((tid) => !playedTrackIds.has(tid));
  const eligibleSize = candidates.length;
  if (eligibleSize === 0) {
    return {
      selectedTrackIds: [],
      poolSize: poolTracks.length,
      playedSize: playedTrackIds.size,
      eligibleSize: 0,
    };
  }
  const targetN = Math.min(sessionSize, eligibleSize);
  const selected = weightedStratifiedSample(candidates, tierByTrackId, weights, targetN);
  return {
    selectedTrackIds: selected,
    poolSize: poolTracks.length,
    playedSize: playedTrackIds.size,
    eligibleSize,
  };
}

/**
 * feat/thematic-level-cumulative-weighted — échantillonnage stratifié pur
 * (sans DB → testable). Tire `targetN` ids parmi `candidates` selon des
 * PROPORTIONS-CIBLES par tier (`weights`, normalisées). Pass 1 : quota cible par
 * tier (round(part × N), borné par dispo ET reste, tiers part décroissante →
 * le tier dominant sert en premier). Pass 2 : si court (tier épuisé), comble
 * depuis les restes (choix de tier pondéré par la part). Shuffle final pour
 * que l'ordre de jeu ne soit pas groupé par tier.
 */
export function weightedStratifiedSample(
  candidates: string[],
  tierByTrackId: Map<string, Tier>,
  weights: Partial<Record<Tier, number>>,
  targetN: number,
): string[] {
  const byTier: Record<Tier, string[]> = { EASY: [], MEDIUM: [], EXPERT: [] };
  for (const tid of candidates) byTier[tierByTrackId.get(tid) ?? 'MEDIUM'].push(tid);
  fisherYates(byTier.EASY);
  fisherYates(byTier.MEDIUM);
  fisherYates(byTier.EXPERT);

  const tiers = (Object.keys(weights) as Tier[]).filter((t) => (weights[t] ?? 0) > 0);
  const totalWeight = tiers.reduce((s, t) => s + (weights[t] ?? 0), 0) || 1;
  const selected: string[] = [];

  // Pass 1 — quota cible par tier (part décroissante → tier dominant en premier).
  for (const tier of [...tiers].sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0))) {
    const want = Math.round(((weights[tier] ?? 0) / totalWeight) * targetN);
    const take = Math.min(want, byTier[tier].length, targetN - selected.length);
    if (take > 0) selected.push(...byTier[tier].splice(0, take));
  }

  // Pass 2 — comble le reste depuis les leftovers, tier choisi pondéré par la part.
  while (selected.length < targetN) {
    const avail = tiers.filter((t) => byTier[t].length > 0);
    if (avail.length === 0) break;
    const wsum = avail.reduce((s, t) => s + (weights[t] ?? 0), 0) || 1;
    let r = Math.random() * wsum;
    let chosenTier: Tier = avail[avail.length - 1]!;
    for (const t of avail) {
      r -= weights[t] ?? 0;
      if (r <= 0) {
        chosenTier = t;
        break;
      }
    }
    selected.push(byTier[chosenTier].shift()!);
  }

  fisherYates(selected);
  return selected.slice(0, targetN);
}

/**
 * "Recommencer le morceau" — reset gameState (phase=phase1, started_at=now,
 * vide buzzes/answers) ET re-broadcast 'track:start' avec nouveau state pour
 * que les clients se synchronisent (timer reset, phase reset, audio seek 0).
 *
 * Conserve track_id + track_index (même morceau). N'utilise PAS d'event
 * spécial 'track:restart' — single source of truth = track:start.
 *
 * Bug 1.3 : si la session est en pause, on la dépause + broadcast
 * session:resumed AVANT le track:start. Sinon les clients reçoivent le
 * track:start mais Spotify reste paused (is_paused=true bloque play).
 */
export async function restartCurrentTrackAndBroadcast(
  sessionId: string,
  round: RoundWithTracks,
): Promise<CurrentTrackState | null> {
  const current = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { is_paused: true },
  });
  if (current?.is_paused) {
    await prisma.session.update({
      where: { id: sessionId },
      data: { is_paused: false },
    });
    broadcastToSession(sessionId, 'session:resumed', { session_id: sessionId });
  }
  // Le track courant = round.current_track_index
  return buildAndBroadcastTrack(sessionId, round, round.current_track_index);
}

/**
 * Avance au track suivant. Si on a dépassé la dernière piste, termine le round
 * automatiquement (status ENDED + broadcast 'round:ended').
 *
 * Retourne :
 *   - { ended: true,  round: enriched }  si le round est terminé
 *   - { ended: false, state }            si un nouveau track est démarré
 */
export async function advanceToNextOrEndRound(
  sessionId: string,
  round: RoundWithTracks,
): Promise<
  { ended: true; round: EnrichedEndedRound | null } | { ended: false; state: CurrentTrackState }
> {
  const nextIndex = round.current_track_index + 1;
  // fix/session-pick-respect-default-size — défense en profondeur : clamp
  // à default_session_size. Si selected_track_ids est vide, l'auto-clamp
  // côté buildAndBroadcastTrack a déjà persisté un sous-ensemble — mais on
  // protège aussi ici au cas où on entre dans advance avant le 1er
  // buildAndBroadcastTrack.
  const sessionSize = round.playlist.default_session_size ?? DEFAULT_SESSION_SIZE;
  const rawLength =
    (round.selected_track_ids?.length ?? 0) > 0
      ? round.selected_track_ids.length
      : round.playlist.playlist_tracks.length;
  const effectiveLength = Math.min(sessionSize, rawLength);
  if (nextIndex < effectiveLength) {
    // fix/next-track-resume-buzz-unlock — si la session était en pause au
    // moment du "Morceau suivant", auto-resume avant de broadcast track:start.
    // Sinon les clients reçoivent le nouveau morceau mais restent paused →
    // buzz bloqué côté joueurs + audio en pause. Même pattern que
    // restartCurrentTrackAndBroadcast (Bug 1.3).
    const current = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { is_paused: true },
    });
    if (current?.is_paused) {
      await prisma.session.update({
        where: { id: sessionId },
        data: { is_paused: false },
      });
      broadcastToSession(sessionId, 'session:resumed', { session_id: sessionId });
    }
    const state = await buildAndBroadcastTrack(sessionId, round, nextIndex);
    if (!state) {
      // ne devrait pas arriver, on a déjà vérifié l'index
      return { ended: false, state: state as never };
    }
    return { ended: false, state };
  }
  // Plus de tracks → auto-end du round
  return { ended: true, round: await endRoundInternal(sessionId, round.id) };
}

export interface EnrichedEndedRound {
  id: string;
  session_id: string;
  playlist_id: string;
  position: number;
  status: string;
  current_track_index: number;
  started_at: Date | null;
  ended_at: Date | null;
  created_at: Date;
  playlist: { id: string; name: string; level: string; tracks_count: number };
}

/**
 * Persiste le passage d'un round à ENDED, clear la gameState, et broadcast
 * 'round:ended'. Ne touche pas à la session globale.
 */
export async function endRoundInternal(
  sessionId: string,
  roundId: string,
): Promise<EnrichedEndedRound | null> {
  await prisma.sessionRound.update({
    where: { id: roundId },
    data: { status: 'ENDED', ended_at: new Date() },
  });
  clearActiveTrack(roundId);
  const updated = await prisma.sessionRound.findUnique({
    where: { id: roundId },
    include: { playlist: { select: PLAYLIST_LIGHT } },
  });
  const enriched: EnrichedEndedRound | null = updated
    ? {
        ...updated,
        playlist: {
          id: updated.playlist.id,
          name: updated.playlist.name,
          level: updated.playlist.level,
          // BUG3 — taille EFFECTIVE de manche (selected_track_ids.length, capé
          // à 15), jamais le pool brut de la playlist.
          tracks_count: getEffectiveRoundTrackCount(updated),
        },
      }
    : null;
  broadcastToSession(sessionId, 'round:ended', { round: enriched });
  return enriched;
}

/**
 * Master "Réponse" : personne n'a buzzé, on révèle manuellement le morceau.
 * Passe la phase à 'cooldown', broadcast 'track:revealed' avec artist/title,
 * AUCUN ScoreEvent créé (0 point).
 *
 * Renvoie false si la phase n'est pas 'listening' (déjà buzzé / cooldown /
 * pas de track actif).
 */
/**
 * Phase 2.3 — snapshot CurrentTrackState pour restore au reload.
 *
 * Construit un CurrentTrackState complet à partir :
 *  - de l'état mémoire (phase, phase2_started_at, correct_answers, started_at)
 *  - des métadonnées DB (artist, title, year, cover_url, duration_ms)
 *
 * Retourne null si :
 *  - le round n'a pas d'activeTrack en mémoire (backend redémarré, ou round
 *    pas encore lancé via play-track),
 *  - ou si le track DB est introuvable.
 *
 * Pas de broadcast — usage côté handshake socket pour rehydrater le frontend.
 */
export async function buildCurrentTrackStateSnapshot(
  roundId: string,
): Promise<CurrentTrackState | null> {
  const active = getActiveTrack(roundId);
  if (!active) return null;
  const track = await prisma.track.findUnique({
    where: { id: active.track_id },
    include: { artist: { select: { canonical_name: true } } },
  });
  if (!track) return null;
  return {
    round_id: active.round_id,
    track_index: active.track_index,
    track_id: track.id,
    provider: track.provider as CurrentTrackState['provider'],
    provider_track_id: track.provider_track_id,
    artist: track.artist.canonical_name,
    title: track.canonical_title,
    album: track.album,
    year: track.year,
    cover_url: track.cover_url,
    started_at: new Date(active.started_at_ms).toISOString(),
    duration_ms: track.duration_ms,
    phase: active.phase,
    phase2_started_at: active.phase2_started_at_ms
      ? new Date(active.phase2_started_at_ms).toISOString()
      : null,
    correct_answers: active.correct_answers.map((a) => ({
      participant_id: a.participant_id,
      pseudo: a.pseudo,
      team_id: a.team_id,
      position: a.position,
      answered_at_ms: a.answered_at_ms,
      matched_artist: a.matched_artist,
      matched_title: a.matched_title,
      score: a.score,
      score_position: a.score_position,
      score_title_bonus: a.score_title_bonus,
      score_speed_bonus: a.score_speed_bonus,
    })),
  };
}

export async function revealCurrentTrack(
  sessionId: string,
  roundId: string,
): Promise<{ artist: string; title: string; track_index: number } | null> {
  const active = getActiveTrack(roundId);
  // "Donner la réponse" : permis en phase1 (personne n'a buzzé) et phase2
  // (fenêtre retardataires — abrège l'attente). Refusé en phase3+ (déjà révélé).
  if (!active || (active.phase !== 'phase1' && active.phase !== 'phase2')) return null;

  const track = await prisma.track.findUnique({
    where: { id: active.track_id },
    select: { canonical_title: true, artist: { select: { canonical_name: true } } },
  });
  if (!track) return null;

  setPhase3Revealed(roundId);
  const payload = {
    round_id: roundId,
    track_index: active.track_index,
    artist: track.artist.canonical_name,
    title: track.canonical_title,
  };
  // Bug fix — broadcast track:phase_changed AVANT track:revealed pour que
  // les clients (HostPage, ScreenPage, PlayPage) mettent à jour
  // currentTrack.phase en 'phase3-revealed' et fassent transitionner leur
  // UI (ResultPanel, FindersRecap, ValidatedBanner phase3, etc.).
  // Sans cet event, lastReveal était bien set mais phase restait phase1/2.
  broadcastToSession(sessionId, 'track:phase_changed', {
    round_id: roundId,
    phase: 'phase3-revealed',
    artist: track.artist.canonical_name,
    title: track.canonical_title,
  });
  broadcastToSession(sessionId, 'track:revealed', payload);
  return {
    artist: track.artist.canonical_name,
    title: track.canonical_title,
    track_index: active.track_index,
  };
}
