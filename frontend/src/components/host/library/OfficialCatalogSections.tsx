/**
 * <OfficialCatalogSections /> — feat/tv-host-catalog-parity
 *
 * Rendu PARTAGÉ du catalogue officiel, en SECTIONS par catégorie, chacune une
 * RANGÉE HORIZONTALE de cartes thème. Source unique de layout host ⇄ TV :
 *   - host (RoundSelectionScreen) : interactif (onPickTheme → niveaux ou pick) ;
 *   - mirror TV (ScreenPlaylistGridView) : readOnly + highlightId.
 *
 * Ancres de scroll-sync (lues par useFocusedPlaylistSync côté host, appliquées
 * côté TV) :
 *   - `data-carousel-cat="<slug>"` sur chaque rangée → scroll-sync HORIZONTAL ;
 *   - `data-focus-playlist-id="<coverId>"` sur chaque carte → focus + highlight.
 * Le conteneur vertical (sections empilées) porte le scroll-sync VERTICAL.
 */
import { useTranslation } from 'react-i18next';
import type { CategoryThemeSection, ThemeGroup } from '../../../lib/officialThemes.js';
import { ThemeCard } from './ThemeCard.js';

interface Props {
  sections: CategoryThemeSection[];
  /** Carte à mettre en surbrillance (cover.id reçu via screen-state côté TV). */
  highlightId?: string | null;
  /** Host : clic sur un thème (→ étape niveaux si multi, sinon pick direct). */
  onPickTheme?: (theme: ThemeGroup) => void;
  /** TV : non-interactif. */
  readOnly?: boolean;
  disabled?: boolean;
}

export function OfficialCatalogSections({
  sections,
  highlightId,
  onPickTheme,
  readOnly,
  disabled,
}: Props): JSX.Element {
  const { t, i18n } = useTranslation();
  const isFr = (i18n.language ?? 'fr').toLowerCase().startsWith('fr');

  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <section key={section.slug}>
          <h3 className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-2 px-0.5">
            {isFr ? section.label_fr : section.label_en}
          </h3>
          {/* Rangée horizontale — ancre H-sync. Scrollbar fine, snap doux. */}
          <div
            data-carousel-cat={section.slug}
            className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scroll-smooth snap-x"
            style={{ scrollbarWidth: 'thin' }}
          >
            {section.themes.map((th) => {
              const single = th.variants.length === 1 ? th.variants[0]! : null;
              const subtitle = single
                ? `${single.playlist.track_count ?? 0} ${t('playlists.tracksCount')}`
                : t('host.session.themeLevels', { count: th.variants.length });
              return (
                <div
                  key={th.key}
                  data-focus-playlist-id={th.cover.id}
                  className="shrink-0 w-[230px] snap-start"
                >
                  <ThemeCard
                    cover={th.cover}
                    title={th.name}
                    subtitle={subtitle}
                    highlighted={!!highlightId && highlightId === th.cover.id}
                    disabled={disabled}
                    onClick={() => {
                      if (readOnly) return;
                      onPickTheme?.(th);
                    }}
                  />
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
