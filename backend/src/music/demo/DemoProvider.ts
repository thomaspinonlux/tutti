/**
 * DemoProvider — implémentation MusicProvider sur catalogue local statique.
 *
 * Sert pour les démos en environnement contrôlé (Komptoir test, démos
 * commerciales, dev local sans clé Spotify). Pas d'OAuth, pas de réseau,
 * réponses instantanées.
 *
 * Le `preview_url` est null pour V1 — la lecture audio est implémentée
 * en étape 9 (catalog audio hosté sur Supabase Storage). L'objectif de
 * l'étape 7 est de valider l'abstraction `MusicProvider`.
 */

import type { ProviderCapabilities, TrackResult } from '@tutti/shared';
import type { MusicProvider, SearchOptions } from '../types.js';
import { normalize, scoreMatch } from './normalize.js';
import catalogRaw from './catalog.json' with { type: 'json' };

interface RawCatalogEntry {
  id: string;
  artist: string;
  title: string;
  album?: string;
  year?: number;
  duration_ms?: number;
  popularity?: number;
  cover_url?: string;
  preview_url?: string | null;
}

interface IndexedEntry extends RawCatalogEntry {
  /** Concaténation normalisée artiste + titre + album, pour le scoring. */
  haystack: string;
}

const CATALOG: IndexedEntry[] = (catalogRaw as RawCatalogEntry[]).map((e) => ({
  ...e,
  haystack: normalize([e.artist, e.title, e.album].filter(Boolean).join(' ')),
}));

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const CAPABILITIES: ProviderCapabilities = {
  requires_oauth: false,
  supports_full_playback: false, // V1 : preview only
  supports_preview: true, // V1.1 : audio Storage hosté (étape 9)
  max_results: MAX_LIMIT,
};

export class DemoProvider implements MusicProvider {
  readonly id = 'demo' as const;
  readonly capabilities = CAPABILITIES;

  async search(query: string, opts: SearchOptions = {}): Promise<TrackResult[]> {
    const normalized = normalize(query);
    if (normalized.length === 0) return [];

    const tokens = normalized.split(' ').filter((t) => t.length > 0);
    const limit = clamp(opts.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT);

    const scored = CATALOG.map((entry) => ({
      entry,
      score: scoreMatch(entry.haystack, tokens) + (entry.popularity ?? 0) * 0.05,
    }))
      .filter((r) => r.score > 30) // seuil minimal pour exclure les non-matches
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored.map((r) => entryToResult(r.entry));
  }

  async getTrack(providerTrackId: string): Promise<TrackResult | null> {
    const entry = CATALOG.find((e) => e.id === providerTrackId);
    return entry ? entryToResult(entry) : null;
  }
}

function entryToResult(entry: IndexedEntry): TrackResult {
  return {
    provider: 'demo',
    provider_track_id: entry.id,
    artist: entry.artist,
    title: entry.title,
    album: entry.album,
    year: entry.year,
    duration_ms: entry.duration_ms,
    cover_url: entry.cover_url,
    preview_url: entry.preview_url ?? null,
    popularity: entry.popularity,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
