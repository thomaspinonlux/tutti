/**
 * <ThemeCard /> — feat/theme-picker-design
 *
 * Carte "thème" pour l'étape 1 du picker thème→niveau. Même langage visuel que
 * PlaylistCardLarge (cover 280×180 + overlay + titre), mais affiche un THÈME
 * (nom + sous-titre type "4 niveaux") et non une playlist. La cover est dérivée
 * de la playlist représentative du thème (slug → mosaïque /api/library-cover).
 */
import { motion } from 'framer-motion';
import { useState } from 'react';
import type { LibraryPlaylistSummary } from '../../../lib/library.js';

interface Props {
  /** Playlist représentative (pour la cover : slug + fallbacks). */
  cover: LibraryPlaylistSummary;
  title: string;
  subtitle: string;
  onClick: () => void;
  disabled?: boolean;
}

function slugToHue(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) % 360;
  return h;
}

export function ThemeCard({ cover, title, subtitle, onClick, disabled }: Props): JSX.Element {
  // Même chaîne de fallback que PlaylistCardLarge : mosaïque → spotify → yt → gradient.
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const hue = slugToHue(cover.slug);
  const gradient = `linear-gradient(135deg, hsl(${hue}, 55%, 35%) 0%, hsl(${(hue + 40) % 360}, 60%, 22%) 100%)`;
  const ytFallback = cover.cover_fallback_youtube_id
    ? `https://img.youtube.com/vi/${cover.cover_fallback_youtube_id}/hqdefault.jpg`
    : null;
  const url =
    step === 0
      ? `/api/library-cover/${encodeURIComponent(cover.slug)}.jpg`
      : step === 1
        ? (cover.cover_fallback_url ?? null)
        : step === 2
          ? ytFallback
          : null;

  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      whileHover={disabled ? undefined : { scale: 1.05 }}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      className="group relative shrink-0 text-left rounded-lg overflow-hidden border-2 border-ink shadow-pop disabled:opacity-50 w-full"
      style={{ height: 180, background: gradient }}
      aria-label={title}
    >
      {url && (
        <img
          src={url}
          alt=""
          aria-hidden
          onError={() => setStep((s) => (s < 3 ? ((s + 1) as 0 | 1 | 2 | 3) : 3))}
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
        />
      )}
      <div
        className="absolute inset-0 pointer-events-none transition-opacity duration-200 group-hover:opacity-90"
        style={{
          background:
            'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.15) 75%, rgba(0,0,0,0) 100%)',
        }}
      />
      <div className="absolute bottom-0 left-0 right-0 p-3">
        <p
          className="font-display font-bold uppercase leading-tight text-cream line-clamp-2"
          style={{ fontFamily: 'Fraunces, serif', fontSize: 18, letterSpacing: '0.01em' }}
        >
          {title}
        </p>
        <p
          className="mt-1 line-clamp-1 text-cream/85"
          style={{ fontFamily: '"DM Sans", sans-serif', fontSize: 12 }}
        >
          {subtitle}
        </p>
      </div>
    </motion.button>
  );
}
