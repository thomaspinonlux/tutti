/**
 * AppleMusicProvider — implémentation MusicProvider via l'Apple Music API.
 *
 * Recherche + lookup catalogue (storefront FR par défaut) avec le developer
 * token MusicKit (app-level, cf. appleDeveloperToken). La RECHERCHE ne requiert
 * PAS le compte utilisateur — seul le developer token suffit. Le Music User
 * Token n'est nécessaire que pour la LECTURE (étape 4, côté MusicKit JS).
 *
 * Doc : GET /v1/catalog/{storefront}/search?term=...&types=songs
 *       GET /v1/catalog/{storefront}/songs/{id}
 */

import type { ProviderCapabilities, TrackResult } from '@tutti/shared';
import type { MusicProvider, SearchOptions } from '../types.js';
import { getAppleDeveloperToken } from '../../lib/appleDeveloperToken.js';

const APPLE_API = 'https://api.music.apple.com/v1';
const DEFAULT_STOREFRONT = 'fr';

const CAPABILITIES: ProviderCapabilities = {
  requires_oauth: true, // compte Apple Music abonné requis POUR LA LECTURE
  supports_full_playback: true, // via MusicKit JS (étape 4)
  supports_preview: true,
  max_results: 25,
};

interface AppleSong {
  id: string;
  type?: string;
  attributes?: {
    name?: string;
    artistName?: string;
    albumName?: string;
    durationInMillis?: number;
    releaseDate?: string;
    artwork?: { url?: string; width?: number; height?: number };
    previews?: Array<{ url?: string }>;
  };
}

/** Remplit le template d'artwork Apple ({w}x{h}) en 300x300. */
function artworkUrl(a: AppleSong['attributes']): string | undefined {
  const url = a?.artwork?.url;
  if (!url) return undefined;
  return url.replace('{w}', '300').replace('{h}', '300');
}

function toTrackResult(s: AppleSong): TrackResult {
  const a = s.attributes;
  const releaseYear = a?.releaseDate ? Number.parseInt(a.releaseDate.slice(0, 4), 10) : undefined;
  return {
    provider: 'apple_music',
    provider_track_id: s.id,
    artist: a?.artistName ?? 'Inconnu',
    title: a?.name ?? '',
    album: a?.albumName ?? undefined,
    year: Number.isFinite(releaseYear) ? releaseYear : undefined,
    duration_ms: a?.durationInMillis ?? 0,
    cover_url: artworkUrl(a),
    preview_url: a?.previews?.[0]?.url ?? null,
  };
}

export class AppleMusicProvider implements MusicProvider {
  readonly id = 'apple_music' as const;
  readonly capabilities = CAPABILITIES;

  constructor(private readonly storefront: string = DEFAULT_STOREFRONT) {}

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${getAppleDeveloperToken().token}` };
  }

  async search(query: string, opts: SearchOptions = {}): Promise<TrackResult[]> {
    const q = query.trim();
    if (!q) return [];
    const limit = Math.min(
      opts.limit ?? this.capabilities.max_results,
      this.capabilities.max_results,
    );
    const params = new URLSearchParams({
      term: q,
      types: 'songs',
      limit: String(limit),
    });
    const url = `${APPLE_API}/catalog/${this.storefront}/search?${params.toString()}`;
    const res = await fetch(url, { headers: this.authHeaders() });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Apple Music: HTTP ${res.status} ${body.slice(0, 160)}`.trim());
    }
    const data = (await res.json()) as { results?: { songs?: { data?: AppleSong[] } } };
    return (data.results?.songs?.data ?? []).map(toTrackResult);
  }

  async getTrack(providerTrackId: string): Promise<TrackResult | null> {
    const url = `${APPLE_API}/catalog/${this.storefront}/songs/${encodeURIComponent(providerTrackId)}`;
    const res = await fetch(url, { headers: this.authHeaders() });
    if (res.status === 404) return null;
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Apple Music: HTTP ${res.status} ${body.slice(0, 160)}`.trim());
    }
    const data = (await res.json()) as { data?: AppleSong[] };
    const song = data.data?.[0];
    return song ? toTrackResult(song) : null;
  }
}

export const APPLE_MUSIC_CAPABILITIES = CAPABILITIES;
