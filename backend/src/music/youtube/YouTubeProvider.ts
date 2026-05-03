/**
 * YouTubeProvider — implémentation MusicProvider via YouTube Data API v3.
 *
 * Phase 3 — multi-source. Permet aux animateurs de chercher des morceaux
 * sur YouTube quand un track n'est pas dispo sur Spotify (ou pour des
 * morceaux de niche/jingles/extraits).
 *
 * Auth : API key statique (pas d'OAuth) via process.env.YOUTUBE_API_KEY.
 *
 * Quotas : 10 000 unités/jour par projet GCP.
 *   - search.list = 100 unités par appel
 *   - videos.list = 1 unité par appel (jusqu'à 50 IDs en batch)
 *   → ~100 recherches/jour. Largement suffisant V1 B2C.
 *
 * Anti-pub : la lecture côté client utilise les paramètres start/end de
 * l'IFrame Player. Cf. useYouTubePlayer.ts dans le frontend.
 */

import type { ProviderCapabilities, TrackResult } from '@tutti/shared';
import type { MusicProvider, SearchOptions } from '../types.js';

const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3';

export const YOUTUBE_CAPABILITIES: ProviderCapabilities = {
  requires_oauth: false, // API key serveur
  supports_full_playback: true, // via IFrame Player API
  supports_preview: false,
  max_results: 25,
};

interface YTSearchItem {
  id: { kind: string; videoId: string };
  snippet: {
    title: string;
    channelTitle: string;
    publishedAt: string; // ISO date — fallback pour year
    thumbnails: {
      default?: { url: string };
      medium?: { url: string };
      high?: { url: string };
    };
  };
}

interface YTSearchResponse {
  items: YTSearchItem[];
}

interface YTVideoItem {
  id: string;
  snippet: {
    title: string;
    channelTitle: string;
    publishedAt: string;
    thumbnails: {
      default?: { url: string };
      medium?: { url: string };
      high?: { url: string };
    };
  };
  contentDetails: {
    duration: string; // ISO 8601 PT...M...S
  };
}

interface YTVideoResponse {
  items: YTVideoItem[];
}

/**
 * Parse une durée ISO 8601 (ex: "PT3M47S") en millisecondes.
 * YouTube retourne ce format dans contentDetails.duration.
 */
function parseDurationMs(iso: string): number {
  const match = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso);
  if (!match) return 0;
  const h = parseInt(match[1] ?? '0', 10);
  const m = parseInt(match[2] ?? '0', 10);
  const s = parseInt(match[3] ?? '0', 10);
  return ((h * 60 + m) * 60 + s) * 1000;
}

/**
 * Tente de splitter un titre YouTube en (artist, title).
 * Patterns gérés :
 *  - "Artist - Title"
 *  - "Artist – Title" (en-dash)
 *  - "Artist — Title" (em-dash)
 *  - "Artist : Title"
 * Sinon fallback : artist = channelTitle, title = full snippet.title nettoyé.
 */
function splitArtistTitle(
  snippetTitle: string,
  channelTitle: string,
): {
  artist: string;
  title: string;
} {
  // Supprime les suffixes parasites (Official Video, Lyrics, HD, Audio, etc.)
  const cleaned = snippetTitle
    .replace(/\s*\(Official\s*(Music\s*)?(Video|Audio|Lyric[s]?)\)\s*/gi, '')
    .replace(/\s*\[Official\s*(Music\s*)?(Video|Audio|Lyric[s]?)\]\s*/gi, '')
    .replace(/\s*\((HD|HQ|4K|Lyric[s]?|Audio)\)\s*/gi, '')
    .replace(/\s*\[(HD|HQ|4K|Lyric[s]?|Audio)\]\s*/gi, '')
    .trim();

  // Cherche un séparateur dans la chaîne nettoyée
  const sepRegex = /\s*[-–—:]\s+/;
  const parts = cleaned.split(sepRegex);
  if (parts.length >= 2 && parts[0]) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  }
  // Fallback : channel = artist, full title
  return { artist: channelTitle.trim(), title: cleaned };
}

function bestThumbnail(thumbs: YTSearchItem['snippet']['thumbnails']): string | null {
  return thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default?.url ?? null;
}

export class YouTubeProvider implements MusicProvider {
  readonly id = 'youtube' as const;
  readonly capabilities = YOUTUBE_CAPABILITIES;

  private readonly apiKey: string;

  constructor() {
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) {
      throw new Error('YOUTUBE_API_KEY manquante — provider youtube indisponible');
    }
    this.apiKey = key;
  }

  async search(query: string, opts?: SearchOptions): Promise<TrackResult[]> {
    const limit = Math.min(opts?.limit ?? 10, this.capabilities.max_results);

    // Étape 1 : search.list (100 unités quota) — récupère les IDs vidéo
    const searchUrl = new URL(`${YOUTUBE_API}/search`);
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('q', query);
    searchUrl.searchParams.set('type', 'video');
    searchUrl.searchParams.set('videoCategoryId', '10'); // Music
    searchUrl.searchParams.set('maxResults', String(limit));
    searchUrl.searchParams.set('key', this.apiKey);

    const searchRes = await fetch(searchUrl.toString());
    if (!searchRes.ok) {
      const body = await searchRes.text();
      throw new Error(`YouTube search failed: ${searchRes.status} ${body.slice(0, 200)}`);
    }
    const searchData = (await searchRes.json()) as YTSearchResponse;
    const ids = searchData.items
      .filter((it) => it.id.kind === 'youtube#video')
      .map((it) => it.id.videoId);
    if (ids.length === 0) return [];

    // Étape 2 : videos.list (1 unité quota) — enrichit avec contentDetails
    // pour avoir duration_ms.
    const videosUrl = new URL(`${YOUTUBE_API}/videos`);
    videosUrl.searchParams.set('part', 'snippet,contentDetails');
    videosUrl.searchParams.set('id', ids.join(','));
    videosUrl.searchParams.set('key', this.apiKey);

    const videosRes = await fetch(videosUrl.toString());
    if (!videosRes.ok) {
      const body = await videosRes.text();
      throw new Error(`YouTube videos.list failed: ${videosRes.status} ${body.slice(0, 200)}`);
    }
    const videosData = (await videosRes.json()) as YTVideoResponse;

    return videosData.items.map((v) => this.mapVideoToTrack(v));
  }

  async getTrack(providerTrackId: string): Promise<TrackResult | null> {
    const url = new URL(`${YOUTUBE_API}/videos`);
    url.searchParams.set('part', 'snippet,contentDetails');
    url.searchParams.set('id', providerTrackId);
    url.searchParams.set('key', this.apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) {
      if (res.status === 404) return null;
      const body = await res.text();
      throw new Error(`YouTube getTrack failed: ${res.status} ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as YTVideoResponse;
    const first = data.items[0];
    if (!first) return null;
    return this.mapVideoToTrack(first);
  }

  private mapVideoToTrack(v: YTVideoItem): TrackResult {
    const { artist, title } = splitArtistTitle(v.snippet.title, v.snippet.channelTitle);
    const year = parseInt(v.snippet.publishedAt.slice(0, 4), 10);
    return {
      provider: 'youtube',
      provider_track_id: v.id,
      artist,
      title,
      year: Number.isFinite(year) ? year : undefined,
      duration_ms: parseDurationMs(v.contentDetails.duration),
      cover_url: bestThumbnail(v.snippet.thumbnails) ?? undefined,
      preview_url: null,
    };
  }
}
