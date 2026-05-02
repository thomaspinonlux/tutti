/**
 * SpotifyProvider — implémentation MusicProvider via Spotify Web API.
 *
 * Détails :
 *   - Recherche : GET /v1/search?q=...&type=track
 *   - Track : GET /v1/tracks/:id
 *   - Auto-refresh des access tokens à 60s avant expiration
 *   - Persiste les nouveaux tokens dans music_provider_credentials
 *
 * Drop-in : aucune modification d'autres fichiers requise — il a suffi
 * d'un case dans registry.ts pour l'activer.
 */

import type { ProviderCapabilities, TrackResult } from '@tutti/shared';
import type { MusicProvider, SearchOptions } from '../types.js';
import { prisma } from '../../lib/prisma.js';

const SPOTIFY_API = 'https://api.spotify.com/v1';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const REFRESH_BUFFER_SEC = 60; // refresh quand il reste < 60s

const CAPABILITIES: ProviderCapabilities = {
  requires_oauth: true,
  supports_full_playback: true, // via Web Playback SDK (étape 9-10)
  supports_preview: true,
  max_results: 50,
};

interface SpotifyCredentials {
  access_token: string;
  refresh_token: string | null;
  expires_at: Date | null;
}

interface SpotifyTrackApi {
  id: string;
  name: string;
  artists: Array<{ name: string }>;
  album: {
    name: string;
    release_date?: string;
    images: Array<{ url: string; width: number; height: number }>;
  };
  duration_ms: number;
  /** Restricted en Development Mode (mai 2024) — peut être absent. */
  popularity?: number;
  /** Restricted en Development Mode — peut être absent. */
  preview_url?: string | null;
  explicit?: boolean;
  is_local?: boolean;
}

interface SpotifySearchResponse {
  tracks: { items: SpotifyTrackApi[]; total?: number; next?: string | null };
}

interface SpotifyPlaylistApi {
  id: string;
  name: string;
  description?: string | null;
  public?: boolean | null;
  collaborative?: boolean;
  images?: Array<{ url: string; width: number | null; height: number | null }>;
  owner: { id: string; display_name?: string | null };
  tracks: { total: number };
  followers?: { total: number };
}

export interface SpotifyPlaylistSummary {
  id: string;
  name: string;
  description: string | null;
  cover_url: string | null;
  owner_name: string;
  owner_id: string;
  tracks_count: number;
  is_public: boolean;
  is_collaborative: boolean;
  followers_count: number | null;
  /** true si playlist éditoriale Spotify (owner.id === 'spotify') —
   *  l'API Spotify a restreint l'accès aux tracks de ces playlists pour les
   *  apps en Development Mode (depuis nov 2024). À filtrer côté UI. */
  is_spotify_owned: boolean;
}

/**
 * Détecte si une playlist est éditoriale Spotify (inaccessible via API depuis
 * nov 2024). Spotify utilise plusieurs IDs/noms pour ses playlists curées :
 *   - owner.id = 'spotify' (le plus courant)
 *   - owner.id commence par 'spotify' (spotifycharts, spotifyfrance…)
 *   - owner.display_name === 'Spotify'
 */
function detectSpotifyOwned(ownerId: string, ownerName: string): boolean {
  const id = ownerId.toLowerCase();
  const name = ownerName.toLowerCase();
  if (id === 'spotify') return true;
  if (id.startsWith('spotify')) return true;
  if (name === 'spotify') return true;
  return false;
}

function toPlaylistSummary(p: SpotifyPlaylistApi): SpotifyPlaylistSummary {
  // Defensive : Spotify peut renvoyer tracks/owner/images partiellement null
  // sur certaines playlists "edge case" (collaboratives folder, partagées,
  // dossiers internes). On évite tout crash via fallback.
  const cover = p.images?.[0]?.url ?? null;
  const ownerName = p.owner?.display_name ?? p.owner?.id ?? '?';
  const ownerId = p.owner?.id ?? '?';
  const tracksCount = p.tracks?.total ?? 0;
  return {
    id: p.id,
    name: p.name ?? '(sans titre)',
    description: p.description ?? null,
    cover_url: cover,
    owner_name: ownerName,
    owner_id: ownerId,
    tracks_count: tracksCount,
    is_public: p.public ?? false,
    is_collaborative: p.collaborative ?? false,
    followers_count: p.followers?.total ?? null,
    is_spotify_owned: detectSpotifyOwned(ownerId, ownerName),
  };
}

export class SpotifyProvider implements MusicProvider {
  readonly id = 'spotify' as const;
  readonly capabilities = CAPABILITIES;

  private credentials: SpotifyCredentials;

  constructor(
    private readonly workspaceId: string,
    initialCredentials: SpotifyCredentials,
  ) {
    this.credentials = { ...initialCredentials };
  }

  async search(query: string, opts: SearchOptions = {}): Promise<TrackResult[]> {
    const limit = Math.min(opts.limit ?? 20, this.capabilities.max_results);
    const params = new URLSearchParams({
      q: query,
      type: 'track',
      limit: String(limit),
    });
    if (opts.market) params.set('market', opts.market);

    const data = await this.spotifyFetch<SpotifySearchResponse>(`/search?${params.toString()}`);
    return data.tracks.items.map(toTrackResult);
  }

  /**
   * Recherche tracks avancée — combine artist, track, year_min/max, genre via
   * les query operators Spotify (artist:"x" track:"y" year:1990-1999 genre:rock).
   *
   * Spotify cap : limit ∈ [1, 50], offset ∈ [0, 1000].
   */
  async searchTracksAdvanced(opts: {
    artist?: string;
    track?: string;
    year_min?: number;
    year_max?: number;
    genre?: string;
    market?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: TrackResult[]; total: number; next: string | null }> {
    console.info('[searchTracks] input opts:', JSON.stringify(opts));
    // Stratégie : utiliser les opérateurs Spotify SI au moins 2 critères
    // sont fournis (artist+track, ou artist+year). Sinon, fallback en
    // recherche plain text pour avoir plus de résultats (les opérateurs
    // sont stricts et limitent souvent à <10 résultats).
    const hasArtist = !!opts.artist?.trim();
    const hasTrack = !!opts.track?.trim();
    const hasYear = opts.year_min || opts.year_max;
    const useOperators = (hasArtist && hasTrack) || (hasArtist && hasYear) || (hasTrack && hasYear);

    let q = '';
    if (useOperators) {
      const parts: string[] = [];
      if (opts.artist) parts.push(`artist:"${opts.artist.replace(/"/g, '')}"`);
      if (opts.track) parts.push(`track:"${opts.track.replace(/"/g, '')}"`);
      if (opts.genre) parts.push(`genre:"${opts.genre.replace(/"/g, '')}"`);
      if (opts.year_min && opts.year_max) {
        parts.push(`year:${opts.year_min}-${opts.year_max}`);
      } else if (opts.year_min) {
        parts.push(`year:${opts.year_min}-${new Date().getFullYear()}`);
      } else if (opts.year_max) {
        parts.push(`year:1900-${opts.year_max}`);
      }
      q = parts.join(' ').trim();
    } else {
      // Recherche plain text — Spotify renvoie plus de résultats avec un mot
      // simple qu'avec un opérateur strict (artist:"x" ne retourne souvent
      // que ~5 tracks alors que x retourne >100).
      q = (opts.artist ?? '').trim() || (opts.track ?? '').trim();
    }
    console.info(
      '[searchTracks] strategy:',
      useOperators ? 'operators' : 'plain_text',
      '| query:',
      q,
    );
    if (!q) return { items: [], total: 0, next: null };

    const limit = clampInt(opts.limit, SPOTIFY_MAX_LIMIT, 1, SPOTIFY_MAX_LIMIT);
    const offset = clampInt(opts.offset, 0, 0, 1000);
    console.info('[searchTracks] limit input:', opts.limit, 'limit clamped:', limit);
    const params = new URLSearchParams({
      q,
      type: 'track',
      limit: String(limit),
      offset: String(offset),
    });
    if (opts.market) params.set('market', opts.market);

    const data = await this.spotifyFetch<SpotifySearchResponse>(`/search?${params.toString()}`);
    console.info(
      '[searchTracks] Spotify returned:',
      data.tracks.items.length,
      'items | total:',
      data.tracks.total,
      '| next:',
      data.tracks.next ? 'present' : 'null',
    );
    return {
      items: data.tracks.items.map(toTrackResult),
      total: data.tracks.total ?? 0,
      next: data.tracks.next ?? null,
    };
  }

  /** Récupère les playlists de l'utilisateur connecté (paginé).
   *  Spotify cap : limit ∈ [1, 50], offset ∈ [0, 100000]. */
  async getMyPlaylists(opts: { limit?: number; offset?: number } = {}): Promise<{
    items: SpotifyPlaylistSummary[];
    total: number;
    next: string | null;
  }> {
    const limit = clampInt(opts.limit, SPOTIFY_MAX_LIMIT, 1, SPOTIFY_MAX_LIMIT);
    const offset = clampInt(opts.offset, 0, 0, 100000);
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    const data = await this.spotifyFetch<{
      items: SpotifyPlaylistApi[];
      total: number;
      next: string | null;
    }>(`/me/playlists?${params.toString()}`);
    return {
      items: data.items.map(toPlaylistSummary),
      total: data.total,
      next: data.next,
    };
  }

  /** Recherche de playlists publiques.
   *  Spotify cap : limit ∈ [1, 50], offset ∈ [0, 1000]. */
  async searchPlaylists(opts: {
    query: string;
    market?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: SpotifyPlaylistSummary[]; total: number; next: string | null }> {
    if (!opts.query.trim()) return { items: [], total: 0, next: null };
    const limit = clampInt(opts.limit, SPOTIFY_MAX_LIMIT, 1, SPOTIFY_MAX_LIMIT);
    const offset = clampInt(opts.offset, 0, 0, 1000);
    const params = new URLSearchParams({
      q: opts.query,
      type: 'playlist',
      limit: String(limit),
      offset: String(offset),
    });
    if (opts.market) params.set('market', opts.market);
    const data = await this.spotifyFetch<{
      playlists: { items: Array<SpotifyPlaylistApi | null>; total: number; next: string | null };
    }>(`/search?${params.toString()}`);
    // Spotify peut renvoyer des null dans items (algorithmes internes) — filtre.
    const validItems = data.playlists.items.filter(
      (p): p is SpotifyPlaylistApi => p !== null && p !== undefined,
    );
    return {
      items: validItems.map(toPlaylistSummary),
      total: data.playlists.total,
      next: data.playlists.next,
    };
  }

  /** Récupère les tracks d'une playlist Spotify (paginé).
   *  Spotify cap : limit ∈ [1, 50] sur cet endpoint. */
  async getPlaylistTracks(
    playlistId: string,
    opts: { limit?: number; offset?: number; market?: string } = {},
  ): Promise<{ items: TrackResult[]; total: number; next: string | null }> {
    const limit = clampInt(opts.limit, SPOTIFY_MAX_LIMIT, 1, SPOTIFY_MAX_LIMIT);
    const offset = clampInt(opts.offset, 0, 0, 100000);
    // Spotify a restreint certains champs en Development Mode (mai 2024 :
    // popularity, audio features, related artists, etc.). On retire
    // complètement le paramètre `fields` pour laisser Spotify renvoyer la
    // structure par défaut. Trade-off : payload plus lourd, mais évite 403.
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    if (opts.market) params.set('market', opts.market);
    const data = await this.spotifyFetch<{
      items: Array<{ track: SpotifyTrackApi | null }>;
      total: number;
      next: string | null;
    }>(`/playlists/${encodeURIComponent(playlistId)}/tracks?${params.toString()}`);
    const items = data.items
      .map((it) => it.track)
      .filter((t): t is SpotifyTrackApi => t !== null && !t.is_local)
      .map(toTrackResult);
    return { items, total: data.total, next: data.next };
  }

  async getTrack(providerTrackId: string): Promise<TrackResult | null> {
    try {
      const track = await this.spotifyFetch<SpotifyTrackApi>(
        `/tracks/${encodeURIComponent(providerTrackId)}`,
      );
      return toTrackResult(track);
    } catch (err: unknown) {
      if (err instanceof SpotifyError && err.status === 404) return null;
      throw err;
    }
  }

  // ─── HTTP helpers ───────────────────────────────────────────────────────

  private async spotifyFetch<T>(path: string): Promise<T> {
    const token = await this.getValidAccessToken();
    const fullUrl = `${SPOTIFY_API}${path}`;
    // Trim any whitespace/newline qui aurait pu se glisser dans le token DB
    const cleanToken = token.trim();
    const tokenPreview = `Bearer ${cleanToken.substring(0, 10)}…(${cleanToken.length} chars)`;
    // Options minimales : GET explicite, AUCUN body, AUCUN Content-Type,
    // AUCUN custom header. Spotify renvoie parfois "Invalid limit" trompeur
    // sur des requêtes qui contiennent des choses en trop.
    const fetchOpts: RequestInit = {
      method: 'GET',
      headers: { Authorization: `Bearer ${cleanToken}` },
    };
    console.info('[Spotify Fetch] URL:', fullUrl);
    console.info('[Spotify Fetch] Authorization:', tokenPreview);
    console.info('[Spotify Fetch] Token has whitespace?', token !== cleanToken);
    console.info(
      '[Spotify Fetch] Options:',
      JSON.stringify({
        method: fetchOpts.method,
        headers: { Authorization: tokenPreview },
        body: 'body' in fetchOpts ? 'PRESENT (BUG)' : 'absent',
      }),
    );
    const res = await fetch(fullUrl, fetchOpts);
    console.info('[Spotify Fetch] Response status:', res.status);
    // Log tous les headers de réponse pour debug
    const respHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      respHeaders[k] = v;
    });
    console.info('[Spotify Fetch] Response headers:', JSON.stringify(respHeaders));

    if (res.status === 401) {
      // Token rejeté malgré check d'expiration : refresh forcé puis retry une fois.
      console.info('[Spotify Fetch] 401 — refresh token + retry');
      await this.refreshAccessToken();
      const retry = await fetch(fullUrl, {
        headers: { Authorization: `Bearer ${this.credentials.access_token}` },
      });
      console.info('[Spotify Fetch] Retry status:', retry.status);
      if (!retry.ok) {
        const err = await spotifyErrorFrom(retry, fullUrl);
        throw err;
      }
      const retryText = await retry.text();
      console.info('[Spotify Fetch] Retry body (first 1000):', retryText.substring(0, 1000));
      return JSON.parse(retryText) as T;
    }

    if (!res.ok) {
      const err = await spotifyErrorFrom(res, fullUrl);
      throw err;
    }
    // Log raw body pour debug structure inattendue (200 mais parsing crash)
    const bodyText = await res.text();
    console.info('[Spotify Fetch] Response body (first 1000):', bodyText.substring(0, 1000));
    return JSON.parse(bodyText) as T;
  }

  private async getValidAccessToken(): Promise<string> {
    const expiresAt = this.credentials.expires_at;
    if (!expiresAt) return this.credentials.access_token;

    const expiresIn = (expiresAt.getTime() - Date.now()) / 1000;
    if (expiresIn > REFRESH_BUFFER_SEC) {
      return this.credentials.access_token;
    }
    await this.refreshAccessToken();
    return this.credentials.access_token;
  }

  private async refreshAccessToken(): Promise<void> {
    const refreshToken = this.credentials.refresh_token;
    if (!refreshToken) {
      throw new SpotifyError(401, 'Aucun refresh_token Spotify — reconnexion requise');
    }

    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET manquants');
    }

    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    const res = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!res.ok) throw await spotifyErrorFrom(res);

    const json = (await res.json()) as {
      access_token: string;
      expires_in: number;
      refresh_token?: string; // Spotify ne le re-renvoie pas toujours
    };

    this.credentials = {
      access_token: json.access_token,
      refresh_token: json.refresh_token ?? this.credentials.refresh_token,
      expires_at: new Date(Date.now() + json.expires_in * 1000),
    };

    // Persister immédiatement pour les prochaines requêtes (autres workers).
    await prisma.musicProviderCredential.update({
      where: {
        workspace_id_provider: {
          workspace_id: this.workspaceId,
          provider: 'spotify',
        },
      },
      data: {
        access_token: this.credentials.access_token,
        refresh_token: this.credentials.refresh_token,
        expires_at: this.credentials.expires_at,
      },
    });
  }
}

/**
 * Clamp un entier optionnel dans [min, max], ou retourne fallback si invalide
 * (NaN, undefined, null, non entier). Utilisé pour les params Spotify limit/
 * offset où passer une mauvaise valeur fait crasher l'API avec
 * "Invalid limit" / "Invalid offset".
 */
function clampInt(
  value: number | undefined | null,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || value === null) return fallback;
  if (!Number.isFinite(value)) return fallback;
  const n = Math.trunc(value);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/**
 * Cap limit Spotify à 10 — restriction silencieuse découverte sur cet
 * account (limit > 10 retourne 400 "Invalid limit"). Doc officielle dit
 * 1-50 mais en pratique Spotify rejette > 10 sur ce client.
 * À ré-évaluer si la politique Spotify change.
 */
const SPOTIFY_MAX_LIMIT = 10;

// ─── Mapping Spotify → TrackResult ────────────────────────────────────────

function toTrackResult(t: SpotifyTrackApi): TrackResult {
  // Defensive : album peut manquer dans certaines réponses (rare). Spotify
  // peut aussi retirer popularity / preview_url en Development Mode.
  const releaseDate = t.album?.release_date;
  const year = releaseDate ? Number.parseInt(releaseDate.slice(0, 4), 10) : undefined;
  const images = t.album?.images ?? [];
  const cover = images.find((img) => img.width >= 200 && img.width <= 400) ?? images[0];
  return {
    provider: 'spotify',
    provider_track_id: t.id,
    artist: t.artists.map((a) => a.name).join(', ') || 'Inconnu',
    title: t.name,
    album: t.album?.name ?? null,
    year: Number.isFinite(year) ? year : undefined,
    duration_ms: t.duration_ms,
    cover_url: cover?.url,
    preview_url: t.preview_url ?? null,
    popularity: t.popularity,
  };
}

// ─── Erreurs ──────────────────────────────────────────────────────────────

export class SpotifyError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'SpotifyError';
  }
}

async function spotifyErrorFrom(res: Response, url?: string): Promise<SpotifyError> {
  let message = `HTTP ${res.status}`;
  let bodyRaw = '';
  try {
    bodyRaw = await res.text();
    const json = JSON.parse(bodyRaw) as { error?: { message?: string } | string };
    if (typeof json.error === 'string') message = json.error;
    else if (json.error?.message) message = json.error.message;
  } catch {
    // body non-JSON, on garde le message par défaut
  }
  console.error('[Spotify Error]', url ?? '', '→', res.status, bodyRaw.slice(0, 500));
  // Warn explicite si politique de quota Spotify a changé (limit > N rejeté)
  if (message.toLowerCase().includes('invalid limit')) {
    console.warn(
      '[Spotify Warn] "Invalid limit" reçu — Spotify cap actuel = ' +
        String(SPOTIFY_MAX_LIMIT) +
        ". Si l'erreur persiste, baisser SPOTIFY_MAX_LIMIT dans SpotifyProvider.ts",
    );
  }
  return new SpotifyError(res.status, `Spotify: ${message}`);
}

// ─── Capacités exposées au registry (sans avoir à instancier) ─────────────
export const SPOTIFY_CAPABILITIES = CAPABILITIES;
