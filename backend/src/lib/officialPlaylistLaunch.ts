/**
 * Lib partagée — logique de "lancement" d'une playlist officielle Tutti dans
 * une session (clone official → Playlist user is_official_tutti=true → création
 * SessionRound + broadcast round:created).
 *
 * EXTRACTION MÉCANIQUE de POST /api/library/playlists/:id/launch (library.ts).
 * Le contenu (buildChosen, fallback niveau→Mix, clone batch Artist/Track,
 * création Playlist clone, pickWeighted/pickRandom, création SessionRound,
 * broadcast round:created) est identique — seule l'auth/visibilité host reste
 * dans la route appelante. Réutilisée par les routes host ET master.
 *
 * IMPORTANT : cette lib NE fait AUCUN contrôle d'auth/visibilité. C'est à
 * l'appelant de vérifier la visibilité (getVisiblePlaylistDetail* pour le host,
 * getVisiblePlaylistDetailForWorkspace pour le master) AVANT d'appeler.
 */

import { prisma } from './prisma.js';
import { generateAliases } from './aliases.js';
import { broadcastToSession } from '../socket/index.js';
import {
  DEFAULT_SESSION_SIZE,
  getEffectiveRoundTrackCount,
  pickRandomTrackIdsForRound,
  pickWeightedTrackIdsForRound,
} from './gameplayCore.js';
import { LEVEL_WEIGHTS, cumulativeTiers, type Tier } from '../config/levelWeights.js';
import type { LibraryPlaylistDetail } from './officialLibraryQueries.js';
import type { CurrentTrackState } from '@tutti/shared';

/**
 * Erreur métier "aucun morceau jouable" — l'ancienne route renvoyait
 * res.status(400) { code: 'NO_PLAYABLE_TRACK' }. Comme une lib ne peut pas
 * répondre HTTP, on jette cette erreur typée ; les routes appelantes la
 * mappent sur le 400 correspondant.
 */
export class NoPlayableTrackError extends Error {
  readonly code = 'NO_PLAYABLE_TRACK';
  constructor(message = 'Aucun morceau jouable') {
    super(message);
    this.name = 'NoPlayableTrackError';
  }
}

export interface LaunchOfficialPlaylistResult {
  round: {
    id: string;
    session_id: string;
    playlist_id: string;
    position: number;
    status: string;
    current_track_index: number;
    selected_track_ids: string[];
    started_at: Date | null;
    ended_at: Date | null;
    created_at: Date;
    playlist: {
      id: string;
      name: string;
      level: string;
      tracks_count: number;
      selected_tracks_count: number;
    };
  };
  state: CurrentTrackState | null;
  playable_count: number;
  total_count: number;
  provider_used: PlayProvider;
}

/** feat/apple-music — sources jouables « mondes étanches ». */
export type PlayProvider = 'spotify' | 'youtube' | 'apple_music';

/**
 * Clone une playlist officielle dans le workspace de la session + crée un
 * SessionRound PENDING (broadcast round:created). Comportement IDENTIQUE à
 * l'ancien inline de POST /library/playlists/:id/launch.
 *
 * @throws {NoPlayableTrackError} si aucun morceau jouable après filtre.
 */
export async function launchOfficialPlaylistForSession(
  playlistDetail: LibraryPlaylistDetail,
  sessionId: string,
  establishmentId: string,
  opts: {
    preferProvider: PlayProvider;
    difficulty?: 'EASY' | 'MEDIUM' | 'EXPERT';
  },
): Promise<LaunchOfficialPlaylistResult> {
  const detail = playlistDetail;
  const preferProvider: PlayProvider = opts.preferProvider;

  // 3. Pour chaque track : choisir provider + provider_track_id
  type ChosenTrack = {
    position: number;
    title: string;
    artist: string;
    year: number | null;
    provider: PlayProvider;
    provider_track_id: string;
    cover_url: string | null;
    answers_accepted: Record<string, unknown> | null;
    // feat/official-library-aliases — alias curés par les super-admins.
    // Mergés au moment du clone-on-launch dans Artist.aliases + Track.aliases
    // côté workspace user pour que voiceMatch les reconnaisse pendant le
    // blind test.
    official_artist_aliases: string[];
    official_title_aliases: string[];
    // feat/thematic-level-cumulative-weighted — tier catalogue, conservé en
    // mémoire jusqu'au tirage pour la pondération (Track clonée sans champ
    // difficulty).
    tier: Tier;
  };
  // feat/guess-work-mode — playlist "devine l'œuvre" : la réponse à matcher
  // côté Whisper/text n'est pas l'artiste+titre, mais le nom de l'œuvre
  // (work_title) + ses alias. Le clone substitue donc title ↔ work_title et
  // pousse work_aliases dans Track.aliases. L'artiste reste pour affichage
  // (reveal) mais n'intervient pas dans le matching.
  const isGuessWork = detail.guess_mode === 'work';

  // feat/thematic-level-cumulative-weighted — construit le pool clonable.
  // level ≠ null → pool CUMULATIF (inclusif vers le bas) : ne matérialise que
  // les tiers de cumulativeTiers(level) (ex. EXPERT → EASY+MEDIUM+EXPERT) ;
  // null → tous niveaux (Mix / décennies / legacy plates = comportement
  // historique inchangé). La playabilité (is_playable + provider) est
  // appliquée APRÈS le filtre niveau. Chaque track conserve son `tier`.
  const buildChosen = (
    level: Tier | null,
  ): { chosen: ChosenTrack[]; skippedNotPlayable: number } => {
    const allowedTiers = level ? cumulativeTiers(level) : null;
    const out: ChosenTrack[] = [];
    let skipped = 0;
    for (const t of detail.tracks) {
      const tier = (t.difficulty as Tier) ?? 'MEDIUM';
      // Pool cumulé : skip les tracks hors des tiers du niveau choisi (filtre
      // volontaire, ne compte pas comme "non jouable").
      if (allowedTiers && !allowedTiers.includes(tier)) continue;
      // Problème A (fix/playback-and-zombies-v4) — skip tracks invalidées par
      // validate-youtube-ids (vidéo retirée, non-embeddable, blocked FR/LU).
      // Sans ce filtre, le SDK YouTube tombait sur "video not embeddable" en
      // pleine partie → blocage host.
      if (t.is_playable === false) {
        skipped += 1;
        continue;
      }
      // feat/watertight-provider — mondes ÉTANCHES : la source active impose
      // SON id, aucun fallback croisé. Spotify → spotify_id, YouTube →
      // youtube_id, Apple Music → apple_music_id. Une track sans l'id de la
      // source active est SKIP → la playlist clonée est 100% mono-provider
      // (jamais de mix qui bloquerait le son selon le compte du host).
      let provider: PlayProvider | null = null;
      let providerId: string | null = null;
      if (preferProvider === 'spotify') {
        if (t.spotify_id) {
          provider = 'spotify';
          providerId = t.spotify_id;
        }
      } else if (preferProvider === 'apple_music') {
        if (t.apple_music_id) {
          provider = 'apple_music';
          providerId = t.apple_music_id;
        }
      } else if (t.youtube_id) {
        provider = 'youtube';
        providerId = t.youtube_id;
      }
      if (!provider || !providerId) continue; // pas d'id pour la source active → skip
      // Fallback cover : si pas de cover_url stockée et qu'on a un youtube_id,
      // on dérive la thumbnail YouTube. Garantit un visuel pour chaque track.
      const coverUrl =
        t.cover_url ??
        (t.youtube_id ? `https://img.youtube.com/vi/${t.youtube_id}/hqdefault.jpg` : null);
      // feat/guess-work-mode — substitue title ↔ work_title si guess_mode='work'.
      // Si la track n'a pas de work_title rempli, on retombe sur le titre
      // chanson original (fallback safe → pas de NaN/empty match).
      const matchTitle = isGuessWork && t.work_title ? t.work_title : t.title;
      const matchTitleAliases = isGuessWork
        ? [...(t.work_aliases ?? []), ...(t.title_aliases ?? [])]
        : (t.title_aliases ?? []);
      out.push({
        position: t.position,
        title: matchTitle,
        artist: t.artist,
        year: t.year,
        provider,
        provider_track_id: providerId,
        cover_url: coverUrl,
        answers_accepted: null,
        official_artist_aliases: t.artist_aliases ?? [],
        official_title_aliases: matchTitleAliases,
        tier,
      });
    }
    return { chosen: out, skippedNotPlayable: skipped };
  };

  // feat/thematic-level-cumulative-weighted — applique le niveau demandé
  // (pool CUMULATIF), avec garde-fou : si le pool cumulé tombe sous 15 tracks
  // jouables → fallback Mix (tous niveaux, tirage plat) → jamais d'écran vide
  // ni de manche famélique. `effectiveDifficulty` = niveau réellement appliqué
  // (null si fallback Mix), relu au tirage pour décider pondéré vs plat.
  // Anti-répétition (SessionPlayedTrack) conservée en aval.
  const MIN_LEVEL_POOL = 15;
  const requestedDifficulty = (opts.difficulty as Tier | undefined) ?? null;
  let effectiveDifficulty: Tier | null = requestedDifficulty;
  let { chosen, skippedNotPlayable } = buildChosen(requestedDifficulty);
  if (requestedDifficulty && chosen.length < MIN_LEVEL_POOL) {
    console.info(
      `[Launch] Playlist ${detail.slug}: niveau ${requestedDifficulty} → pool cumulé=${chosen.length} < ${MIN_LEVEL_POOL} jouables → fallback Mix (tous niveaux, tirage plat)`,
    );
    effectiveDifficulty = null;
    ({ chosen, skippedNotPlayable } = buildChosen(null));
  } else if (requestedDifficulty) {
    console.info(
      `[Launch] Playlist ${detail.slug}: niveau cumulé ${requestedDifficulty} (tiers ${cumulativeTiers(requestedDifficulty).join('+')}) → pool=${chosen.length} jouables`,
    );
  }
  if (chosen.length === 0) {
    throw new NoPlayableTrackError();
  }
  if (skippedNotPlayable > 0) {
    console.info(
      `[Launch] Playlist ${detail.slug}: skipped ${skippedNotPlayable} track(s) marked is_playable=false`,
    );
  }

  // 4. Upsert Artist (par canonical_name) + Track (par provider+id) en BATCH.
  //
  // perf/library-launch-batch-clone — l'ancienne boucle faisait 2 à 4 requêtes
  // SÉQUENTIELLES par track (findUnique/findFirst + create|update) = 160-320
  // allers-retours Supabase pour 80 tracks → 1-2 min de latence au lancement.
  // Ici : ~8 requêtes set-based (findMany + createMany + re-findMany, updates
  // en parallèle). Clés de dédup INCHANGÉES (Artist par canonical_name unique,
  // Track par (provider, provider_track_id)) + copie des aliases officiels
  // catalogue→clone (feat/official-library-aliases) préservée.
  const cloneStartedAt = Date.now();

  // ── Artists ──────────────────────────────────────────────────────────
  // Union des aliases officiels par nom (un artiste = plusieurs tracks).
  const artistOfficialAliases = new Map<string, Set<string>>();
  for (const c of chosen) {
    const set = artistOfficialAliases.get(c.artist) ?? new Set<string>();
    c.official_artist_aliases.forEach((a) => set.add(a));
    artistOfficialAliases.set(c.artist, set);
  }
  const artistNames = [...artistOfficialAliases.keys()];

  const existingArtists = await prisma.artist.findMany({
    where: { canonical_name: { in: artistNames } },
    select: { id: true, canonical_name: true, aliases: true },
  });
  const existingArtistNames = new Set(existingArtists.map((a) => a.canonical_name));

  // Créations : artistes absents (canonical_name @unique → skipDuplicates safe).
  const artistsToCreate = artistNames
    .filter((name) => !existingArtistNames.has(name))
    .map((name) => {
      const official = [...(artistOfficialAliases.get(name) ?? [])];
      const aliases = Array.from(new Set([...generateAliases(name, 'artist'), ...official]));
      return { canonical_name: name, aliases };
    });
  if (artistsToCreate.length > 0) {
    await prisma.artist.createMany({ data: artistsToCreate, skipDuplicates: true });
  }

  // Mises à jour : artistes existants dont le set d'aliases grandit (merge
  // official). En parallèle (Promise.all) — pas séquentiel.
  const artistUpdates = existingArtists.flatMap((a) => {
    const official = [...(artistOfficialAliases.get(a.canonical_name) ?? [])];
    const merged = Array.from(new Set([...a.aliases, ...official]));
    return merged.length !== a.aliases.length
      ? [prisma.artist.update({ where: { id: a.id }, data: { aliases: merged } })]
      : [];
  });
  if (artistUpdates.length > 0) await Promise.all(artistUpdates);

  // Re-fetch ids (créés + existants) — autoritaire (gère une création concurrente).
  const allArtists = await prisma.artist.findMany({
    where: { canonical_name: { in: artistNames } },
    select: { id: true, canonical_name: true },
  });
  const artistIdByName = new Map(allArtists.map((a) => [a.canonical_name, a.id]));

  // ── Tracks ───────────────────────────────────────────────────────────
  const trackKey = (provider: string, id: string): string => `${provider} ${id}`;
  interface TrackAgg {
    provider: PlayProvider;
    provider_track_id: string;
    title: string;
    artist: string;
    year: number | null;
    cover_url: string | null;
    official: Set<string>;
  }
  // Dédup `chosen` par (provider, provider_track_id) + union aliases officiels.
  const trackAggByKey = new Map<string, TrackAgg>();
  for (const c of chosen) {
    const k = trackKey(c.provider, c.provider_track_id);
    const agg =
      trackAggByKey.get(k) ??
      ({
        provider: c.provider,
        provider_track_id: c.provider_track_id,
        title: c.title,
        artist: c.artist,
        year: c.year,
        cover_url: c.cover_url,
        official: new Set<string>(),
      } satisfies TrackAgg);
    c.official_title_aliases.forEach((a) => agg.official.add(a));
    trackAggByKey.set(k, agg);
  }
  const providerTrackIds = [...trackAggByKey.values()].map((t) => t.provider_track_id);

  const existingTracks = await prisma.track.findMany({
    where: { provider_track_id: { in: providerTrackIds } },
    select: { id: true, provider: true, provider_track_id: true, cover_url: true, aliases: true },
  });
  const existingTrackKeys = new Set(
    existingTracks.map((t) => trackKey(t.provider, t.provider_track_id)),
  );

  // Créations : tracks absentes. Dédup APP (pas de contrainte unique sur
  // (provider, provider_track_id) → skipDuplicates inopérant ici ; même
  // fenêtre de course que l'ancien findFirst+create).
  const tracksToCreate = [...trackAggByKey.values()]
    .filter((t) => !existingTrackKeys.has(trackKey(t.provider, t.provider_track_id)))
    .map((t) => ({
      artist_id: artistIdByName.get(t.artist)!,
      canonical_title: t.title,
      aliases: Array.from(new Set([...generateAliases(t.title), ...t.official])),
      year: t.year,
      provider: t.provider,
      provider_track_id: t.provider_track_id,
      cover_url: t.cover_url,
    }));
  if (tracksToCreate.length > 0) {
    await prisma.track.createMany({ data: tracksToCreate });
  }

  // Mises à jour : tracks existantes — backfill cover_url + merge aliases. Parallèle.
  const trackUpdates = existingTracks.flatMap((t) => {
    const agg = trackAggByKey.get(trackKey(t.provider, t.provider_track_id));
    if (!agg) return [];
    const merged = Array.from(new Set([...t.aliases, ...agg.official]));
    const data: { cover_url?: string | null; aliases?: string[] } = {};
    if (!t.cover_url && agg.cover_url) data.cover_url = agg.cover_url;
    if (merged.length !== t.aliases.length) data.aliases = merged;
    return Object.keys(data).length > 0 ? [prisma.track.update({ where: { id: t.id }, data })] : [];
  });
  if (trackUpdates.length > 0) await Promise.all(trackUpdates);

  // Re-fetch ids (créés + existants).
  const allTracks = await prisma.track.findMany({
    where: { provider_track_id: { in: providerTrackIds } },
    select: { id: true, provider: true, provider_track_id: true },
  });
  const trackIdByKey = new Map(
    allTracks.map((t) => [trackKey(t.provider, t.provider_track_id), t.id]),
  );

  // Ordre + doublons préservés : 1 entrée par `chosen` (positions playlist).
  const trackIds: string[] = chosen.map(
    (c) => trackIdByKey.get(trackKey(c.provider, c.provider_track_id))!,
  );

  // feat/thematic-level-cumulative-weighted — map trackId cloné → tier
  // catalogue (pour la pondération au tirage). Même track = même tier.
  const tierByTrackId = new Map<string, Tier>();
  chosen.forEach((c, i) => {
    const tid = trackIds[i];
    if (tid) tierByTrackId.set(tid, c.tier);
  });

  // Mesure perf (avant : N+1 séquentiel 160-320 RT ≈ 1-2 min ; après : ~8 RT).
  console.info(
    `[Launch] clone-batch done in ${Date.now() - cloneStartedAt}ms | tracks=${chosen.length} ` +
      `artists(new=${artistsToCreate.length},upd=${artistUpdates.length}) ` +
      `tracks(new=${tracksToCreate.length},upd=${trackUpdates.length})`,
  );

  // 5. Créer Playlist clone (is_official_tutti=true → caché de "Mes playlists")
  const playlist = await prisma.playlist.create({
    data: {
      establishment_id: establishmentId,
      name: detail.name_fr,
      is_published: true,
      is_official_tutti: true,
      is_express: false,
      language: detail.locale_primary.startsWith('fr') ? 'fr' : 'en',
    },
    select: { id: true, default_session_size: true },
  });
  await prisma.playlistTrack.createMany({
    data: trackIds.map((trackId, idx) => ({
      playlist_id: playlist.id,
      track_id: trackId,
      position: idx + 1,
    })),
  });

  // 6. Créer SessionRound
  //    fix/session-pick-respect-default-size — random pick depuis le pool
  //    (playlist enrichie peut avoir 80 tracks, on n'en joue que 15).
  //    Avant ce fix, ce path créait des rounds avec selected_track_ids
  //    vide → gameplayCore fallback sur full playlist → 80 tracks joués.
  const sessionSize = playlist.default_session_size ?? DEFAULT_SESSION_SIZE;
  // feat/thematic-level-cumulative-weighted — niveau choisi (≠ Mix) → tirage
  // PONDÉRÉ par tier (proportions LEVEL_WEIGHTS) ; Mix / décennies / perso →
  // tirage plat historique. Anti-répétition conservée dans les deux cas.
  const pick = effectiveDifficulty
    ? await pickWeightedTrackIdsForRound(
        sessionId,
        playlist.id,
        sessionSize,
        tierByTrackId,
        LEVEL_WEIGHTS[effectiveDifficulty],
      )
    : await pickRandomTrackIdsForRound(sessionId, playlist.id, sessionSize);
  console.info(
    `[POST /library/launch] session=${sessionId} playlist=${playlist.id} | ` +
      `mode=${effectiveDifficulty ? `weighted:${effectiveDifficulty}` : 'flat'} ` +
      `pool=${pick.poolSize} played=${pick.playedSize} eligible=${pick.eligibleSize} ` +
      `session_size=${sessionSize} → selected=${pick.selectedTrackIds.length}`,
  );

  const existingRoundsCount = await prisma.sessionRound.count({
    where: { session_id: sessionId },
  });
  const round = await prisma.sessionRound.create({
    data: {
      session_id: sessionId,
      playlist_id: playlist.id,
      position: existingRoundsCount + 1,
      status: 'PENDING',
      current_track_index: 0,
      selected_track_ids: pick.selectedTrackIds,
    },
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
  });

  // 7. Broadcast round:created (Issue 1 fix : sans ce broadcast, le HostPage
  // socket listener ne met pas à jour session.rounds → derived phase reste
  // 'roundSelection' → host coincé sur l'écran de sélection alors que la
  // session est active backend-side. Symétrie avec POST /sessions/:id/rounds.
  const enriched = {
    id: round.id,
    session_id: round.session_id,
    playlist_id: round.playlist_id,
    position: round.position,
    status: round.status,
    current_track_index: round.current_track_index,
    selected_track_ids: round.selected_track_ids,
    started_at: round.started_at,
    ended_at: round.ended_at,
    created_at: round.created_at,
    playlist: {
      id: round.playlist.id,
      name: round.playlist.name,
      level: round.playlist.level,
      tracks_count: getEffectiveRoundTrackCount(round),
      selected_tracks_count: pick.selectedTrackIds.length,
    },
  };
  broadcastToSession(sessionId, 'round:created', { round: enriched });

  return {
    round: enriched,
    state: null,
    playable_count: chosen.length,
    total_count: detail.tracks.length,
    provider_used: preferProvider,
  };
}
