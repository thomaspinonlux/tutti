/**
 * <ThemeLevelCards /> — feat/host-tv-level-mirror
 *
 * Étape NIVEAU partagée host ⇄ TV : cartes Facile / Moyen / Difficile / Mix d'un
 * thème multi-niveaux. MÊME composant des deux côtés (source unique de layout) :
 *   - host (RoundSelectionScreen) : interactif (onBack → retour thèmes,
 *     onPickLevel → lance la playlist) ;
 *   - mirror TV (ScreenPlaylistGridView) : readOnly + highlightId (carte centrée
 *     côté host mise en surbrillance).
 *
 * Ancre scroll/focus : `data-focus-playlist-id` sur chaque carte de niveau →
 * lue par l'IntersectionObserver unique de useFocusedPlaylistSync (host) et
 * highlightée côté TV. Render léger (transitions CSS pures, pas de framer-motion).
 */
import { useTranslation } from 'react-i18next';
import type { LibraryPlaylistSummary } from '../../../lib/library.js';
import type { ThemeGroup } from '../../../lib/officialThemes.js';

interface Props {
  theme: ThemeGroup;
  /** Carte à mettre en surbrillance (variant.playlist.id reçu via screen-state). */
  highlightId?: string | null;
  /** TV : non-interactif. */
  readOnly?: boolean;
  disabled?: boolean;
  /** Host : retour à l'étape thèmes. */
  onBack?: () => void;
  /**
   * Host : pick d'un niveau → lance la playlist. `difficulty` est défini pour
   * les sous-cartes d'une thématique éclatée (clone-filtré au launch) ;
   * undefined pour Mix et les décennies (niveau = playlist séparée).
   */
  onPickLevel?: (
    playlist: LibraryPlaylistSummary,
    difficulty?: 'EASY' | 'MEDIUM' | 'EXPERT',
  ) => void;
}

export function ThemeLevelCards({
  theme,
  highlightId,
  readOnly,
  disabled,
  onBack,
  onPickLevel,
}: Props): JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="mb-4">
      {!readOnly && onBack && (
        <button
          type="button"
          onClick={onBack}
          className="font-mono text-xs uppercase tracking-wider text-ink-soft hover:text-ink mb-3 inline-flex items-center gap-1"
        >
          ← {t('host.session.backToThemes')}
        </button>
      )}
      <p className="font-display text-3xl">{theme.name}</p>
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-4">
        {t('host.session.chooseLevel')}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {theme.variants.map((v) => {
          const tone =
            v.level === 'easy'
              ? 'bg-basil text-cream'
              : v.level === 'medium'
                ? 'bg-lemon text-ink'
                : v.level === 'hard'
                  ? 'bg-raspberry text-cream'
                  : 'bg-spritz text-cream';
          // feat/thematic-level-filter — ancre/key = variantId (= playlist.id
          // pour les décennies → mirror #121 inchangé ; `${id}::${level}` pour
          // une thématique éclatée → cartes uniques malgré la même playlist).
          const highlighted = !!highlightId && highlightId === v.variantId;
          return (
            <div key={v.variantId} data-focus-playlist-id={v.variantId}>
              <button
                type="button"
                disabled={disabled || readOnly}
                onClick={() => {
                  if (readOnly) return;
                  onPickLevel?.(v.playlist, v.difficulty);
                }}
                className={`w-full h-32 rounded-xl border-2 border-ink shadow-pop flex flex-col items-center justify-center gap-1 transition-transform ${
                  readOnly ? '' : 'hover:-translate-y-0.5 hover:shadow-pop-lg'
                } disabled:opacity-100 ${tone} ${
                  highlighted
                    ? 'ring-4 ring-raspberry ring-offset-2 ring-offset-cream scale-[1.03]'
                    : ''
                }`}
              >
                <span
                  className="font-display font-bold uppercase text-center px-2 leading-tight"
                  style={{ fontFamily: 'Fraunces, serif', fontSize: 22 }}
                >
                  {v.level ? t(`host.session.lvl_${v.level}`) : theme.name}
                </span>
                <span className="font-mono text-xs opacity-80">
                  {v.count ?? v.playlist.track_count ?? 0} {t('playlists.tracksCount')}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
