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

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Playlist } from '@tutti/shared';
import { listPlaylists } from '../../lib/playlists.js';
import { listLibraryPlaylists, type LibraryPlaylistSummary } from '../../lib/library.js';
import { Badge, Button, Card, TitleHandwritten, Underline } from '../ui/index.js';
import { OfficialPlaylistCard } from './library/OfficialPlaylistCard.js';

type Tab = 'mine' | 'library';

interface Props {
  isFirstRound: boolean;
  /** Pick playlist perso (existante). Reçoit l'objet complet pour afficher
   *  le PreGameStartScreen avec name + tracks_count sans re-fetch. */
  onPickPlaylist: (playlist: Playlist) => void | Promise<void>;
  /** Pick playlist officielle Tutti — déclenche flow validation + clone. */
  onPickOfficial: (playlist: LibraryPlaylistSummary) => void | Promise<void>;
  onCreateExpress: () => void;
  onEndSession: () => void | Promise<void>;
  loading?: boolean;
}

export function RoundSelectionScreen({
  isFirstRound,
  onPickPlaylist,
  onPickOfficial,
  onCreateExpress,
  onEndSession,
  loading,
}: Props): JSX.Element {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('mine');
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [official, setOfficial] = useState<LibraryPlaylistSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listPlaylists()
      .then((all) => setPlaylists(all))
      .catch((err: unknown) => setError((err as Error).message));
  }, []);

  // Lazy-load la bibliothèque officielle quand l'onglet est ouvert.
  useEffect(() => {
    if (tab !== 'library' || official !== null) return;
    listLibraryPlaylists()
      .then((all) => setOfficial(all))
      .catch((err: unknown) => setError((err as Error).message));
  }, [tab, official]);

  const usable = playlists?.filter((p) => (p.tracks_count ?? 0) > 0) ?? [];

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
          {/* Express card en 1ʳᵉ position */}
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

          {/* Cards des playlists existantes */}
          {usable.map((p, idx) => (
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
          {official === null ? (
            <p className="font-mono text-ink-soft animate-fade-in">{t('common.loading')}</p>
          ) : official.length === 0 ? (
            <Card tone="cream" size="md" className="text-center">
              <p className="font-editorial italic text-ink-soft">
                {t('host.session.empty.officialLibrary')}
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
              {official.map((p) => (
                <OfficialPlaylistCard
                  key={p.id}
                  playlist={p}
                  onPick={() => void onPickOfficial(p)}
                  onLockedClick={() => alert(t('host.session.premiumRequired'))}
                  disabled={loading}
                />
              ))}
            </div>
          )}
        </div>
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
