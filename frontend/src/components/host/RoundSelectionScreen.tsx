/**
 * <RoundSelectionScreen /> — écran de sélection d'une playlist pour la manche
 * suivante. Affiché au démarrage du blind test ET entre chaque manche.
 *
 * Layout (Sujet 1 brief feat/library-host-integration) :
 *   - 2 onglets : "Mes playlists" (défaut) | "Bibliothèque officielle" ⭐
 *   - Onglet "Mes playlists" : cards perso + Express card
 *   - Onglet "Bibliothèque officielle" : cards officielles avec SourceBadge
 *     et opacity 60% + cadenas si premium_only sans accès
 *   - Si ce n'est pas la 1ʳᵉ manche : bouton "Terminer le blind test"
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Playlist } from '@tutti/shared';
import { listPlaylists } from '../../lib/playlists.js';
import {
  getPlaylistsByCategory,
  listLibraryQuizPacks,
  type LibraryCategoryWithPlaylists,
  type LibraryPlaylistSummary,
  type LibraryQuizPackSummary,
} from '../../lib/library.js';
import { Badge, Button, Card, Input, TitleHandwritten, Underline } from '../ui/index.js';
import { CategoryRow } from './library/CategoryRow.js';
import { OfficialQuizPackCard } from './library/OfficialQuizPackCard.js';

// F1 (feat/playlist-search-and-host-improvements) — normalize pour
// matcher insensible casse + accents. "été" → "ete", "Été" → "ete".
function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function matchesQuery(query: string, ...haystacks: (string | null | undefined)[]): boolean {
  if (!query) return true;
  const needle = normalize(query);
  for (const h of haystacks) {
    if (h && normalize(h).includes(needle)) return true;
  }
  return false;
}

type Tab = 'mine' | 'library';
type LibrarySubTab = 'tracks' | 'quizz';

interface Props {
  isFirstRound: boolean;
  /** Pick playlist perso (existante). Reçoit l'objet complet pour afficher
   *  le PreGameStartScreen avec name + tracks_count sans re-fetch. */
  onPickPlaylist: (playlist: Playlist) => void | Promise<void>;
  /** Pick playlist officielle Tutti — déclenche flow validation + clone. */
  onPickOfficial: (playlist: LibraryPlaylistSummary) => void | Promise<void>;
  /** Pick pack quizz officiel Tutti — clone + crée session game_type=QUIZZ
   *  + redirige vers /host?session=<short_code>. Optionnel : visible seulement
   *  si user.can_use_quizz === true (gating WorkspaceMember). */
  onPickQuizOfficial?: (pack: LibraryQuizPackSummary) => void | Promise<void>;
  /** Active le sub-onglet "Quizz" dans la bibliothèque officielle. Reflète
   *  WorkspaceMember.can_use_quizz, lu côté HostPage via getMe(). */
  canUseQuizz?: boolean;
  onCreateExpress: () => void;
  onEndSession: () => void | Promise<void>;
  loading?: boolean;
}

export function RoundSelectionScreen({
  isFirstRound,
  onPickPlaylist,
  onPickOfficial,
  onPickQuizOfficial,
  canUseQuizz,
  onCreateExpress,
  onEndSession,
  loading,
}: Props): JSX.Element {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('mine');
  const [librarySubTab, setLibrarySubTab] = useState<LibrarySubTab>('tracks');
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  // feat/host-playlist-selection-redesign — playlists groupées par catégorie
  // (PR 2/4 #59 + PR 2/4). Remplace l'ancien grid `official` plat.
  const [categorized, setCategorized] = useState<LibraryCategoryWithPlaylists[] | null>(null);
  const [quizPacks, setQuizPacks] = useState<LibraryQuizPackSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // F1 — query partagé entre les 2 onglets pour cohérence UX (un seul
  // input visible au-dessus des 2 onglets).
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    listPlaylists()
      .then((all) => setPlaylists(all))
      .catch((err: unknown) => setError((err as Error).message));
  }, []);

  // Lazy-load la bibliothèque officielle Tracks groupée par catégorie quand
  // l'onglet est ouvert (feat/host-playlist-selection-redesign PR 2/4).
  useEffect(() => {
    if (tab !== 'library' || librarySubTab !== 'tracks' || categorized !== null) return;
    getPlaylistsByCategory()
      .then((cats) => setCategorized(cats))
      .catch((err: unknown) => setError((err as Error).message));
  }, [tab, librarySubTab, categorized]);

  // Lazy-load la bibliothèque officielle Quizz quand sub-onglet ouvert.
  // fix/quiz-library-host-access — `canUseQuizz === false` (explicite) au
  // lieu de `!canUseQuizz` pour ne pas bloquer pendant la race condition où
  // le prop arrive en undefined avant le fetch /api/me côté HostPage.
  useEffect(() => {
    if (tab !== 'library' || librarySubTab !== 'quizz' || quizPacks !== null) return;
    if (canUseQuizz === false) return;
    listLibraryQuizPacks()
      .then((all) => setQuizPacks(all))
      .catch((err: unknown) => setError((err as Error).message));
  }, [tab, librarySubTab, quizPacks, canUseQuizz]);

  const usable = playlists?.filter((p) => (p.tracks_count ?? 0) > 0) ?? [];

  // F1 — filtrage côté client. Mes playlists : name + language. Officielles :
  // name_fr + name_en + slug + theme + locale_primary + difficulty.
  const filteredUsable = useMemo(
    () => usable.filter((p) => matchesQuery(searchQuery, p.name, p.language)),
    [usable, searchQuery],
  );
  // Filtre les playlists DANS chaque catégorie + drop les catégories vides.
  // Conserve l'ordre canonique défini côté backend (PLAYLIST_CATEGORIES.order).
  const filteredCategorized = useMemo<LibraryCategoryWithPlaylists[]>(() => {
    if (categorized === null) return [];
    return categorized
      .map((cat) => ({
        ...cat,
        playlists: cat.playlists.filter((p) =>
          matchesQuery(
            searchQuery,
            p.name_fr,
            p.name_en,
            p.slug,
            p.theme,
            p.subtitle_fr,
            p.subtitle_en,
            p.locale_primary,
            p.difficulty,
          ),
        ),
      }))
      .filter((cat) => cat.playlists.length > 0);
  }, [categorized, searchQuery]);

  /** Total playlists officielles toutes catégories confondues (pré-filtre). */
  const totalOfficialCount = useMemo(
    () => (categorized ?? []).reduce((acc, c) => acc + c.playlists.length, 0),
    [categorized],
  );
  const filteredQuizPacks = useMemo(
    () =>
      (quizPacks ?? []).filter((p) =>
        matchesQuery(
          searchQuery,
          p.name_fr,
          p.name_en,
          p.slug,
          p.category,
          p.locale_primary,
          p.difficulty,
        ),
      ),
    [quizPacks, searchQuery],
  );

  return (
    <div>
      <header className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <TitleHandwritten as="h2">
          <Underline>{isFirstRound ? t('host.pickFirstRound') : t('host.pickNextRound')}</Underline>
        </TitleHandwritten>
        {!isFirstRound && (
          <Button variant="ghost" size="sm" onClick={() => void onEndSession()} disabled={loading}>
            {t('host.endBlindTest')}
          </Button>
        )}
      </header>

      {/* F1 — search input partagé entre les 2 onglets */}
      <div className="mb-3">
        <Input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('host.session.searchPlaceholder')}
          className="!text-base"
          aria-label={t('host.session.searchPlaceholder')}
        />
      </div>

      {/* Onglets Mes playlists | Bibliothèque officielle */}
      <div className="flex gap-2 border-b-2 border-ink mb-4">
        <button
          type="button"
          onClick={() => setTab('mine')}
          className={`px-3 py-1.5 font-display text-base border-2 border-ink border-b-0 rounded-t-md transition-colors ${
            tab === 'mine'
              ? 'bg-cream text-ink shadow-pop-sm'
              : 'bg-cream-2 text-ink-soft hover:bg-cream'
          }`}
        >
          📁 {t('host.session.tabs.myPlaylists')}
        </button>
        <button
          type="button"
          onClick={() => setTab('library')}
          className={`px-3 py-1.5 font-display text-base border-2 border-ink border-b-0 rounded-t-md transition-colors ${
            tab === 'library'
              ? 'bg-cream text-ink shadow-pop-sm'
              : 'bg-cream-2 text-ink-soft hover:bg-cream'
          }`}
        >
          ⭐ {t('host.session.tabs.officialLibrary')}
        </button>
      </div>

      {tab === 'mine' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
          {/* Express card en 1ʳᵉ position — toujours visible, ne dépend
              pas de la recherche (action de création de playlist). */}
          <button
            type="button"
            onClick={onCreateExpress}
            disabled={loading}
            className="group text-left disabled:opacity-50"
          >
            <Card
              tone="lemon"
              size="sm"
              className="h-full transition-transform group-hover:-translate-y-0.5 group-hover:shadow-pop-lg border-dashed"
            >
              <Badge tone="ink" tilt={-2}>
                {t('host.expressBadge')}
              </Badge>
              <p className="font-display text-xl mt-3 mb-1">+ {t('host.createExpress')}</p>
              <p className="font-editorial italic text-xs text-ink-soft">{t('host.expressHint')}</p>
            </Card>
          </button>

          {/* Cards des playlists existantes — filtrées par recherche */}
          {filteredUsable.map((p, idx) => (
            <button
              key={p.id}
              type="button"
              onClick={() => void onPickPlaylist(p)}
              disabled={loading}
              className="group text-left disabled:opacity-50"
            >
              <Card
                size="sm"
                className="h-full transition-transform group-hover:-translate-y-0.5 group-hover:shadow-pop-lg"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <Badge
                    tone={p.level === 'EASY' ? 'basil' : p.level === 'MEDIUM' ? 'lemon' : 'plum'}
                    tilt={idx % 2 === 0 ? -1 : 1}
                  >
                    {p.level}
                  </Badge>
                  {p.is_express && (
                    <Badge tone="cream" tilt={1}>
                      Express
                    </Badge>
                  )}
                </div>
                <p className="font-display text-lg mb-1 truncate">{p.name}</p>
                <p className="font-mono text-xs text-ink-soft">
                  {p.tracks_count ?? 0} {t('playlists.tracksCount')} · {p.language.toUpperCase()}
                </p>
              </Card>
            </button>
          ))}
        </div>
      ) : (
        // Onglet Bibliothèque officielle
        <div>
          {/* Sub-onglets Tracks / Quizz — visible sauf si canUseQuizz===false
              explicite (fix/quiz-library-host-access — défaut visible pour
              éviter race condition pendant fetch /api/me côté HostPage). */}
          {canUseQuizz !== false && (
            <div className="flex gap-2 mb-3" role="tablist" aria-label="library sub-tabs">
              <button
                type="button"
                role="tab"
                aria-selected={librarySubTab === 'tracks'}
                onClick={() => setLibrarySubTab('tracks')}
                className={`px-3 py-1 font-mono text-xs uppercase tracking-wider border-2 border-ink rounded-full transition-colors ${
                  librarySubTab === 'tracks'
                    ? 'bg-spritz text-ink shadow-pop-sm'
                    : 'bg-cream text-ink-soft hover:bg-cream-2'
                }`}
              >
                🎵 {t('host.session.subTabTracks')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={librarySubTab === 'quizz'}
                onClick={() => setLibrarySubTab('quizz')}
                className={`px-3 py-1 font-mono text-xs uppercase tracking-wider border-2 border-ink rounded-full transition-colors ${
                  librarySubTab === 'quizz'
                    ? 'bg-raspberry text-cream shadow-pop-sm'
                    : 'bg-cream text-ink-soft hover:bg-cream-2'
                }`}
              >
                🎯 {t('host.session.subTabQuizz')}
              </button>
            </div>
          )}

          {librarySubTab === 'tracks' ? (
            categorized === null ? (
              <p className="font-mono text-ink-soft animate-fade-in">{t('common.loading')}</p>
            ) : totalOfficialCount === 0 ? (
              <Card tone="cream" size="md" className="text-center">
                <p className="font-editorial italic text-ink-soft">
                  {t('host.session.empty.officialLibrary')}
                </p>
              </Card>
            ) : filteredCategorized.length === 0 ? (
              <Card tone="cream" size="md" className="text-center">
                <p className="font-editorial italic text-ink-soft">
                  {t('host.session.searchNoResults', { query: searchQuery })}
                </p>
              </Card>
            ) : (
              <div className="mb-4">
                {filteredCategorized.map((cat) => (
                  <CategoryRow
                    key={cat.slug}
                    category={cat}
                    onPick={(p) => void onPickOfficial(p)}
                    onLockedClick={() => alert(t('host.session.premiumRequired'))}
                    disabled={loading}
                  />
                ))}
              </div>
            )
          ) : quizPacks === null ? (
            <p className="font-mono text-ink-soft animate-fade-in">{t('common.loading')}</p>
          ) : quizPacks.length === 0 ? (
            <Card tone="cream" size="md" className="text-center">
              <p className="font-editorial italic text-ink-soft">
                {t('host.session.empty.officialQuizLibrary')}
              </p>
            </Card>
          ) : filteredQuizPacks.length === 0 ? (
            <Card tone="cream" size="md" className="text-center">
              <p className="font-editorial italic text-ink-soft">
                {t('host.session.searchNoResults', { query: searchQuery })}
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
              {filteredQuizPacks.map((p) => (
                <OfficialQuizPackCard
                  key={p.id}
                  pack={p}
                  onPick={() => void onPickQuizOfficial?.(p)}
                  onLockedClick={() => alert(t('host.session.premiumRequired'))}
                  disabled={loading}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* F1 — message "0 résultat" pour onglet Mes playlists si recherche
          ne matche rien (mais des playlists existent). */}
      {tab === 'mine' &&
        playlists !== null &&
        usable.length > 0 &&
        filteredUsable.length === 0 &&
        searchQuery.trim() !== '' && (
          <Card tone="cream" size="md" className="text-center">
            <p className="font-editorial italic text-ink-soft">
              {t('host.session.searchNoResults', { query: searchQuery })}
            </p>
          </Card>
        )}

      {error && (
        <p role="alert" className="text-sm text-raspberry">
          {error}
        </p>
      )}
      {tab === 'mine' && playlists !== null && usable.length === 0 && (
        <p className="font-editorial italic text-sm text-ink-soft">{t('host.noPlaylistsHint')}</p>
      )}
    </div>
  );
}
