/**
 * <RoundSelectionScreen /> — écran de sélection d'une playlist pour la manche
 * suivante. Affiché au démarrage du blind test ET entre chaque manche.
 *
 * Layout :
 *   - Liste des playlists publiées (cards) + filtre rapide
 *   - Card "Créer une playlist express" qui ouvre la modale
 *   - Si ce n'est pas la 1ʳᵉ manche : bouton "Terminer le blind test"
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Playlist } from '@tutti/shared';
import { listPlaylists } from '../../lib/playlists.js';
import { Badge, Button, Card, TitleHandwritten, Underline } from '../ui/index.js';

interface Props {
  isFirstRound: boolean;
  onPickPlaylist: (playlistId: string) => void | Promise<void>;
  onCreateExpress: () => void;
  onEndSession: () => void | Promise<void>;
  loading?: boolean;
}

export function RoundSelectionScreen({
  isFirstRound,
  onPickPlaylist,
  onCreateExpress,
  onEndSession,
  loading,
}: Props): JSX.Element {
  const { t } = useTranslation();
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listPlaylists()
      .then((all) => setPlaylists(all))
      .catch((err: unknown) => setError((err as Error).message));
  }, []);

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
            onClick={() => void onPickPlaylist(p.id)}
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

      {error && (
        <p role="alert" className="text-sm text-raspberry">
          {error}
        </p>
      )}
      {playlists !== null && usable.length === 0 && (
        <p className="font-editorial italic text-sm text-ink-soft">{t('host.noPlaylistsHint')}</p>
      )}
    </div>
  );
}
