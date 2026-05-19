/**
 * youtubeValidation.ts — feat/playlist-cache-and-availability-check
 *
 * Logique réutilisable de validation YouTube ID extraite de
 * scripts/validate-youtube-ids.ts. Utilisée par :
 *   - scripts/validate-youtube-ids.ts (batch nightly officiel)
 *   - routes/playlists.ts POST /:id/check-availability (workspace, on-demand)
 *   - routes/library.ts POST /:id/check-availability (lib, on-demand admin)
 *
 * Critères de jouabilité (pour les marchés FR/LU) :
 *   - vidéo trouvée (non supprimée par l'owner)
 *   - status.privacyStatus === 'public' (pas 'unlisted'/'private')
 *   - status.embeddable === true
 *   - contentDetails.regionRestriction.blocked NE contient PAS 'FR' ni 'LU'
 *   - si contentDetails.regionRestriction.allowed défini → contient 'FR' OU 'LU'
 */

const BLOCKED_REGIONS = ['FR', 'LU'] as const;
const YT_VIDEOS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/videos';

interface YtVideoItem {
  id: string;
  status?: {
    embeddable?: boolean;
    privacyStatus?: 'public' | 'unlisted' | 'private';
    uploadStatus?: string;
  };
  contentDetails?: {
    regionRestriction?: {
      allowed?: string[];
      blocked?: string[];
    };
  };
}

interface YtVideoResponse {
  items?: YtVideoItem[];
}

export interface PlayabilityVerdict {
  is_playable: boolean;
  /** Code de raison court pour la DB (snake_case). Null si is_playable=true. */
  reason: string | null;
}

/**
 * Classe une vidéo YouTube en is_playable + raison structurée. Si `item`
 * est absent (vidéo introuvable côté API), retourne `video_removed`.
 */
export function classifyYtVideo(item: YtVideoItem | undefined): PlayabilityVerdict {
  if (!item) return { is_playable: false, reason: 'video_removed' };
  if (item.status?.privacyStatus === 'private') {
    return { is_playable: false, reason: 'private_video' };
  }
  if (item.status?.embeddable !== true) {
    return { is_playable: false, reason: 'not_embeddable' };
  }
  const blocked = item.contentDetails?.regionRestriction?.blocked ?? [];
  for (const region of BLOCKED_REGIONS) {
    if (blocked.includes(region)) {
      return { is_playable: false, reason: `blocked_${region}` };
    }
  }
  const allowed = item.contentDetails?.regionRestriction?.allowed;
  if (allowed && allowed.length > 0) {
    const okFr = allowed.includes('FR');
    const okLu = allowed.includes('LU');
    if (!okFr && !okLu) {
      return { is_playable: false, reason: 'not_in_allowed_regions' };
    }
  }
  return { is_playable: true, reason: null };
}

/**
 * Fetch un batch (max 50 IDs) de vidéos YouTube via Data API v3. Retourne
 * une Map ytId → YtVideoItem. Les IDs non retournés par l'API (absents
 * de `items[]`) sont considérés comme supprimés/inaccessibles → seront
 * classifiés `video_removed` côté caller.
 */
export async function fetchYtVideosBatch(
  apiKey: string,
  ids: readonly string[],
): Promise<Map<string, YtVideoItem>> {
  if (ids.length === 0) return new Map();
  if (ids.length > 50) {
    throw new Error(`fetchYtVideosBatch: max 50 IDs par appel, reçu ${ids.length}`);
  }
  const params = new URLSearchParams({
    part: 'status,contentDetails',
    id: ids.join(','),
    key: apiKey,
  });
  const res = await fetch(`${YT_VIDEOS_ENDPOINT}?${params.toString()}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`YouTube API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as YtVideoResponse;
  const map = new Map<string, YtVideoItem>();
  for (const item of data.items ?? []) {
    map.set(item.id, item);
  }
  return map;
}

/**
 * Classe N youtube_ids en un seul appel (paginé en batches de 50). Retourne
 * Map ytId → verdict. Useful pour `/check-availability` qui doit valider
 * tous les morceaux d'une playlist d'un coup.
 *
 * Quota YouTube Data API : `videos.list` = 1 unit/call. 1 playlist de 50
 * tracks = 1 call. Quota défaut 10k/jour → ~10k playlists check/jour.
 */
export async function classifyYoutubeIds(
  apiKey: string,
  ids: readonly string[],
): Promise<Map<string, PlayabilityVerdict>> {
  const verdicts = new Map<string, PlayabilityVerdict>();
  if (ids.length === 0) return verdicts;
  const dedup = Array.from(new Set(ids));
  const BATCH_SIZE = 50;
  for (let i = 0; i < dedup.length; i += BATCH_SIZE) {
    const slice = dedup.slice(i, i + BATCH_SIZE);
    const items = await fetchYtVideosBatch(apiKey, slice);
    for (const id of slice) {
      verdicts.set(id, classifyYtVideo(items.get(id)));
    }
  }
  return verdicts;
}
