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
  popularity: number;
  preview_url: string | null;
}

interface SpotifySearchResponse {
  tracks: { items: SpotifyTrackApi[] };
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
    const res = await fetch(`${SPOTIFY_API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401) {
      // Token rejeté malgré check d'expiration : refresh forcé puis retry une fois.
      await this.refreshAccessToken();
      const retry = await fetch(`${SPOTIFY_API}${path}`, {
        headers: { Authorization: `Bearer ${this.credentials.access_token}` },
      });
      if (!retry.ok) throw await spotifyErrorFrom(retry);
      return (await retry.json()) as T;
    }

    if (!res.ok) throw await spotifyErrorFrom(res);
    return (await res.json()) as T;
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

// ─── Mapping Spotify → TrackResult ────────────────────────────────────────

function toTrackResult(t: SpotifyTrackApi): TrackResult {
  const year = t.album.release_date
    ? Number.parseInt(t.album.release_date.slice(0, 4), 10)
    : undefined;
  const cover =
    t.album.images.find((img) => img.width >= 200 && img.width <= 400) ?? t.album.images[0];
  return {
    provider: 'spotify',
    provider_track_id: t.id,
    artist: t.artists.map((a) => a.name).join(', ') || 'Inconnu',
    title: t.name,
    album: t.album.name,
    year: Number.isFinite(year) ? year : undefined,
    duration_ms: t.duration_ms,
    cover_url: cover?.url,
    preview_url: t.preview_url,
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

async function spotifyErrorFrom(res: Response): Promise<SpotifyError> {
  let message = `HTTP ${res.status}`;
  try {
    const json = (await res.json()) as { error?: { message?: string } | string };
    if (typeof json.error === 'string') message = json.error;
    else if (json.error?.message) message = json.error.message;
  } catch {
    // body non-JSON, on garde le message par défaut
  }
  return new SpotifyError(res.status, `Spotify: ${message}`);
}

// ─── Capacités exposées au registry (sans avoir à instancier) ─────────────
export const SPOTIFY_CAPABILITIES = CAPABILITIES;
