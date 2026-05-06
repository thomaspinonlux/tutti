/**
 * Badge "source" affiché sur chaque card de playlist officielle (Sujet 2 brief).
 *
 *   spotify_count = total ET youtube_count = total → "Spotify + YouTube" (vert)
 *   spotify_count = total seul                     → "Spotify" (vert spotify)
 *   youtube_count = total seul                     → "YouTube" (rouge)
 *   sinon                                          → "Spotify (s/t) · YouTube (y/t)"
 */

import { useTranslation } from 'react-i18next';

interface Props {
  total: number;
  spotifyCount: number;
  youtubeCount: number;
}

export function SourceBadge({ total, spotifyCount, youtubeCount }: Props): JSX.Element {
  const { t } = useTranslation();
  const fullSpotify = spotifyCount === total && total > 0;
  const fullYoutube = youtubeCount === total && total > 0;

  const baseClass =
    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wide border';

  if (fullSpotify && fullYoutube) {
    return (
      <span className={`${baseClass} bg-basil/15 border-basil text-basil-deep`}>
        {t('host.session.source.both')}
      </span>
    );
  }
  if (fullSpotify) {
    return (
      <span className={`${baseClass} bg-basil/15 border-basil text-basil-deep`}>
        {t('host.session.source.spotify')}
      </span>
    );
  }
  if (fullYoutube) {
    return (
      <span className={`${baseClass} bg-raspberry/15 border-raspberry text-raspberry-deep`}>
        {t('host.session.source.youtube')}
      </span>
    );
  }
  return (
    <span className={`${baseClass} bg-cream-2 border-ink/30 text-ink-soft`}>
      {t('host.session.source.partial', { s: spotifyCount, y: youtubeCount, t: total })}
    </span>
  );
}
