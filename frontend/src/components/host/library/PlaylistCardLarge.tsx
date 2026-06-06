/**
 * <PlaylistCardLarge /> — feat/host-playlist-selection-redesign (PR 2/4)
 *
 * Card "paysage" 280x180 inspirée This Is Blind Test :
 *   - Cover background : tente `/api/library-cover/:slug.jpg` (mosaïque PR #56),
 *     fallback gradient déterministe dérivé du slug (hash → hue).
 *   - Gradient overlay sombre du bas vers transparent (lisibilité titre).
 *   - Titre playlist en CAPITALES blanc (Fraunces 700, ~18px).
 *   - Subtitle DM Sans 12px blanc opacity 0.85 (sous-titre i18n ou theme).
 *   - Badge difficulté top-right (EASY/MEDIUM/EXPERT, petit pill coloré).
 *   - Hover : scale 1.05 via framer-motion + overlay plus opaque.
 *   - Locked (premium_only sans accès) : opacity 60% + cadenas overlay.
 *
 * Layout figé en width/height inline pour permettre le scroll-snap horizontal
 * dans CategoryRow (snap-start sur chaque card).
 */

import { motion } from 'framer-motion';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LibraryPlaylistSummary } from '../../../lib/library.js';

interface Props {
  playlist: LibraryPlaylistSummary;
  onPick: () => void;
  onLockedClick?: () => void;
  disabled?: boolean;
}

/** Hash stable slug → hue (0-360) pour fallback gradient cohérent par playlist. */
function slugToHue(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) {
    h = (h * 31 + slug.charCodeAt(i)) % 360;
  }
  return h;
}

/** Couleur pill difficulté (cohérence avec OfficialPlaylistCard). */
function difficultyTone(d: LibraryPlaylistSummary['difficulty']): {
  bg: string;
  fg: string;
  label: string;
} {
  switch (d) {
    case 'EASY':
      return { bg: '#A8D8A8', fg: '#0F1722', label: 'EASY' };
    case 'MEDIUM':
      return { bg: '#FFD166', fg: '#0F1722', label: 'MEDIUM' };
    case 'EXPERT':
      return { bg: '#D6336C', fg: '#FAF7F2', label: 'EXPERT' };
    default:
      return { bg: '#CCC', fg: '#0F1722', label: String(d) };
  }
}

export function PlaylistCardLarge({
  playlist,
  onPick,
  onLockedClick,
  disabled,
}: Props): JSX.Element {
  const { i18n, t } = useTranslation();
  const lang = i18n.language?.startsWith('en') ? 'en' : 'fr';
  const name = lang === 'en' ? playlist.name_en : playlist.name_fr;
  const subtitle =
    (lang === 'en' ? playlist.subtitle_en : playlist.subtitle_fr) ?? playlist.theme ?? null;

  const [coverFailed, setCoverFailed] = useState(false);
  const hue = slugToHue(playlist.slug);
  const fallbackGradient = `linear-gradient(135deg, hsl(${hue}, 55%, 35%) 0%, hsl(${(hue + 40) % 360}, 60%, 22%) 100%)`;
  const coverUrl = `/api/library-cover/${encodeURIComponent(playlist.slug)}.jpg`;

  const tone = difficultyTone(playlist.difficulty);

  const handleClick = (): void => {
    if (playlist.locked) {
      onLockedClick?.();
      return;
    }
    onPick();
  };

  return (
    <motion.button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      whileHover={disabled || playlist.locked ? undefined : { scale: 1.05 }}
      whileTap={disabled || playlist.locked ? undefined : { scale: 0.98 }}
      className={`group relative shrink-0 snap-start text-left rounded-lg overflow-hidden border-2 border-ink shadow-pop disabled:opacity-50 ${
        playlist.locked ? 'opacity-60' : ''
      }`}
      style={{
        width: 280,
        height: 180,
        background: fallbackGradient,
      }}
      aria-label={name}
    >
      {/* Cover image absolute (cache l'erreur via state) */}
      {!coverFailed && (
        <img
          src={coverUrl}
          alt=""
          aria-hidden
          onError={() => setCoverFailed(true)}
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
        />
      )}

      {/* Overlay gradient bas → transparent (lisibilité titre) */}
      <div
        className="absolute inset-0 pointer-events-none transition-opacity duration-200 group-hover:opacity-90"
        style={{
          background:
            'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.15) 75%, rgba(0,0,0,0) 100%)',
        }}
      />

      {/* Pill difficulté top-right */}
      <span
        className="absolute top-2 right-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider rounded-full border border-ink/40"
        style={{ backgroundColor: tone.bg, color: tone.fg }}
      >
        {tone.label}
      </span>

      {/* Badge "Officiel" discret top-left */}
      <span
        className="absolute top-2 left-2 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider bg-black/40 text-cream rounded-full backdrop-blur-sm"
        aria-hidden
      >
        ⭐ {t('host.session.officialBadge')}
      </span>

      {/* Titre + subtitle bas */}
      <div className="absolute bottom-0 left-0 right-0 p-3">
        <p
          className="font-display font-bold uppercase leading-tight text-cream line-clamp-2"
          style={{ fontFamily: 'Fraunces, serif', fontSize: 18, letterSpacing: '0.01em' }}
        >
          {name}
        </p>
        {subtitle && (
          <p
            className="mt-1 line-clamp-1 text-cream/85"
            style={{ fontFamily: '"DM Sans", sans-serif', fontSize: 12 }}
          >
            {subtitle}
          </p>
        )}
        <p
          className="mt-1 text-cream/70"
          style={{ fontFamily: '"DM Sans", sans-serif', fontSize: 11 }}
        >
          {playlist.track_count} {t('playlists.tracksCount')}
        </p>
      </div>

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
    </motion.button>
  );
}
