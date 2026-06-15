/**
 * <CategoryRow /> — feat/host-playlist-selection-redesign (PR 2/4)
 *
 * Section catégorie horizontale (inspiration This Is Blind Test) :
 *   - Gauche  : label CAPITALES (Fraunces 900 22px) + description (DM Sans 13px gris)
 *               25% desktop / 30% tablet / au-dessus mobile
 *   - Droite  : scroll horizontal avec snap-mandatory + cards 280x180
 *               Boutons "<" ">" desktop (md+), auto-hidden mobile (swipe natif)
 *
 * Empty : si playlists.length === 0 → ne rend rien (le parent ne devrait pas
 * passer une catégorie vide, sauf race condition lazy-load).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LibraryCategoryWithPlaylists, LibraryPlaylistSummary } from '../../../lib/library.js';
import { PlaylistCardLarge } from './PlaylistCardLarge.js';

interface Props {
  category: LibraryCategoryWithPlaylists;
  onPick: (playlist: LibraryPlaylistSummary) => void;
  onLockedClick?: (playlist: LibraryPlaylistSummary) => void;
  disabled?: boolean;
  /** feat/tv-grid-mirror — id de la playlist à highlighter (carte centrée
   *  côté animateur). Ajoute un ring autour de la card correspondante. */
  highlightId?: string | null;
  /** feat/tv-grid-mirror — mode TV : aucune interaction (pointer-events-none),
   *  flèches de scroll masquées. Affichage seul. */
  readOnly?: boolean;
}

/** Distance scrollée par click sur les flèches (≈ 2 cards + gap). */
const SCROLL_STEP_PX = 600;

export function CategoryRow({
  category,
  onPick,
  onLockedClick,
  disabled,
  highlightId,
  readOnly,
}: Props): JSX.Element | null {
  const { i18n, t } = useTranslation();
  const lang = i18n.language?.startsWith('en') ? 'en' : 'fr';
  const label = lang === 'en' ? category.label_en : category.label_fr;
  const description = lang === 'en' ? category.description_en : category.description_fr;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateButtons = useCallback((): void => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft < maxScroll - 4);
  }, []);

  useEffect(() => {
    updateButtons();
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = (): void => updateButtons();
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', updateButtons);
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', updateButtons);
    };
  }, [updateButtons, category.playlists.length]);

  const scrollBy = (dir: -1 | 1): void => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * SCROLL_STEP_PX, behavior: 'smooth' });
  };

  if (category.playlists.length === 0) return null;

  return (
    <section
      className={`mb-8${readOnly ? ' pointer-events-none select-none' : ''}`}
      aria-labelledby={`cat-${category.slug}-label`}
      data-category-slug={category.slug}
    >
      <div className="flex flex-col md:flex-row gap-3 md:gap-4 items-stretch">
        {/* ─── Label colonne (gauche) ─── */}
        <div className="md:basis-[30%] lg:basis-1/4 md:shrink-0 flex flex-col md:justify-center md:pr-2">
          <h3
            id={`cat-${category.slug}-label`}
            className="text-ink leading-tight"
            style={{
              fontFamily: 'Fraunces, serif',
              fontWeight: 900,
              fontSize: 22,
              letterSpacing: '0.01em',
            }}
          >
            {label}
          </h3>
          {description && (
            <p
              className="mt-1 text-ink-soft"
              style={{ fontFamily: '"DM Sans", sans-serif', fontSize: 13 }}
            >
              {description}
            </p>
          )}
        </div>

        {/* ─── Scroll horizontal (droite) ─── */}
        <div className="md:basis-[70%] lg:basis-3/4 relative min-w-0">
          {/* Flèches de scroll — desktop only, masquées en mode TV (readOnly) */}
          {!readOnly && (
            <>
              <button
                type="button"
                onClick={() => scrollBy(-1)}
                disabled={!canLeft}
                aria-label={t('host.session.scrollLeft')}
                className={`hidden md:flex absolute -left-3 top-1/2 -translate-y-1/2 z-10 w-9 h-9 items-center justify-center rounded-full bg-cream border-2 border-ink shadow-pop transition-opacity ${
                  canLeft ? 'opacity-100 hover:bg-cream-2' : 'opacity-0 pointer-events-none'
                }`}
              >
                <span aria-hidden className="font-display text-xl leading-none">
                  ‹
                </span>
              </button>

              <button
                type="button"
                onClick={() => scrollBy(1)}
                disabled={!canRight}
                aria-label={t('host.session.scrollRight')}
                className={`hidden md:flex absolute -right-3 top-1/2 -translate-y-1/2 z-10 w-9 h-9 items-center justify-center rounded-full bg-cream border-2 border-ink shadow-pop transition-opacity ${
                  canRight ? 'opacity-100 hover:bg-cream-2' : 'opacity-0 pointer-events-none'
                }`}
              >
                <span aria-hidden className="font-display text-xl leading-none">
                  ›
                </span>
              </button>
            </>
          )}

          <div
            ref={scrollRef}
            // feat/tv-h-scroll — marqueur stable pour le scroll-sync horizontal :
            // host lit scrollLeft de ce carrousel, TV l'applique au même slug.
            data-carousel-cat={category.slug}
            className="flex gap-3 overflow-x-auto pb-2 scroll-smooth"
            style={{
              scrollSnapType: 'x mandatory',
              // Masque scrollbar iOS/macOS overlay mais garde le scroll
              scrollbarWidth: 'thin',
            }}
            role="list"
          >
            {category.playlists.map((p) => (
              <div
                key={p.id}
                role="listitem"
                data-focus-playlist-id={p.id}
                className={`rounded-2xl transition-all duration-200 ${
                  highlightId === p.id
                    ? 'ring-4 ring-spritz ring-offset-2 ring-offset-cream scale-[1.02]'
                    : ''
                }`}
              >
                <PlaylistCardLarge
                  playlist={p}
                  onPick={() => onPick(p)}
                  onLockedClick={onLockedClick ? () => onLockedClick(p) : undefined}
                  disabled={disabled}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
