/**
 * Card playlist officielle Tutti (Sujet 1 + Sujet 6 brief).
 *
 *   - Affichage name selon UI lang (FR/EN)
 *   - Badge "Officiel Tutti" pastille discrète top-right
 *   - SourceBadge (Spotify/YouTube/Both/partial)
 *   - Si locked (premium_only sans accès) : opacity 60% + cadenas overlay
 *     + label "Premium Tutti requis", click → modal informatif
 *   - Sinon : click → onPick handler
 */

import { useTranslation } from 'react-i18next';
import type { LibraryPlaylistSummary } from '../../../lib/library.js';
import { Badge, Card } from '../../ui/index.js';
import { SourceBadge } from './SourceBadge.js';

interface Props {
  playlist: LibraryPlaylistSummary;
  onPick: () => void;
  onLockedClick?: () => void;
  disabled?: boolean;
}

export function OfficialPlaylistCard({
  playlist,
  onPick,
  onLockedClick,
  disabled,
}: Props): JSX.Element {
  const { i18n, t } = useTranslation();
  const lang = i18n.language?.startsWith('en') ? 'en' : 'fr';
  const name = lang === 'en' ? playlist.name_en : playlist.name_fr;

  const handleClick = (): void => {
    if (playlist.locked) {
      onLockedClick?.();
      return;
    }
    onPick();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className="group text-left disabled:opacity-50 relative"
    >
      <Card
        size="sm"
        className={`h-full transition-transform group-hover:-translate-y-0.5 group-hover:shadow-pop-lg relative ${
          playlist.locked ? 'opacity-60' : ''
        }`}
      >
        {/* Badge "Officiel Tutti" en haut-droite */}
        <span
          className="absolute top-2 right-2 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider bg-spritz/20 border border-spritz text-spritz-deep rounded-full"
          aria-label={t('host.session.officialBadge')}
        >
          ⭐ {t('host.session.officialBadge')}
        </span>

        <div className="flex items-start gap-2 mb-2 pr-20">
          <Badge
            tone={
              playlist.difficulty === 'EASY'
                ? 'basil'
                : playlist.difficulty === 'MEDIUM'
                  ? 'lemon'
                  : 'plum'
            }
            tilt={-1}
          >
            {playlist.difficulty}
          </Badge>
        </div>

        <p className="font-display text-lg mb-1 truncate">{name}</p>

        <p className="font-mono text-xs text-ink-soft mb-2">
          {playlist.track_count} {t('playlists.tracksCount')} · {playlist.locale_primary}
          {playlist.theme ? ` · ${playlist.theme}` : ''}
        </p>

        <SourceBadge
          total={playlist.track_count}
          spotifyCount={playlist.spotify_count}
          youtubeCount={playlist.youtube_count}
        />

        {/* Cadenas overlay si locked */}
        {playlist.locked && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-cream/90 border-2 border-ink rounded-lg px-3 py-2 text-center shadow-pop">
              <span className="text-3xl block mb-1" aria-hidden>
                🔒
              </span>
              <p className="font-mono text-[10px] uppercase tracking-wider">
                {t('host.session.premiumRequired')}
              </p>
            </div>
          </div>
        )}
      </Card>
    </button>
  );
}
