/**
 * MasterPlaylistPicker — modale plein écran sur tel pour que le master
 * choisisse la playlist de la manche suivante.
 *
 * Liste les playlists publiées de l'établissement de la session.
 * Tap sur une carte → callback onPick(playlistId), la modale se ferme.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { masterListPlaylists, type MasterPlaylistEntry } from '../../lib/sessions.js';
import { Badge, Button, Card } from '../ui/index.js';

interface Props {
  open: boolean;
  sessionId: string;
  token: string;
  onClose: () => void;
  onPick: (playlistId: string) => void | Promise<void>;
}

export function MasterPlaylistPicker(props: Props): JSX.Element | null {
  const { t } = useTranslation();
  const [playlists, setPlaylists] = useState<MasterPlaylistEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setLoading(true);
    setError(null);
    masterListPlaylists(props.sessionId, props.token)
      .then((list) => setPlaylists(list))
      .catch((err: unknown) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [props.open, props.sessionId, props.token]);

  if (!props.open) return null;

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 bg-cream overflow-y-auto">
      <div className="max-w-[500px] mx-auto p-4">
        <div className="flex items-center justify-between mb-4">
          <p className="font-display text-2xl">{t('play.masterPickRoundTitle')}</p>
          <button
            type="button"
            onClick={props.onClose}
            aria-label={t('common.cancel')}
            className="text-2xl text-ink-soft hover:text-ink"
          >
            ✕
          </button>
        </div>

        {loading && (
          <p className="font-editorial italic text-ink-soft py-8 text-center">
            {t('common.loading')}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-raspberry mb-4">
            {error}
          </p>
        )}

        {playlists && playlists.length === 0 && (
          <p className="font-editorial italic text-ink-soft py-8 text-center">
            {t('host.noPlaylistsHint')}
          </p>
        )}

        {playlists && playlists.length > 0 && (
          <ul className="space-y-3">
            {playlists.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => void props.onPick(p.id)}
                  className="w-full text-left"
                >
                  <Card className="hover:bg-cream-2 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-display text-lg truncate">{p.name}</p>
                        {p.description && (
                          <p className="font-editorial italic text-xs text-ink-2 line-clamp-2 mt-1">
                            {p.description}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <Badge tone="ink" tilt={-1}>
                            {p.tracks_count} {t('playlists.tracksCount')}
                          </Badge>
                          <Badge tone="cream">{p.level}</Badge>
                          {p.is_express && <Badge tone="lemon">{t('host.expressBadge')}</Badge>}
                          {p.is_official_tutti && <Badge tone="basil">Tutti</Badge>}
                        </div>
                      </div>
                    </div>
                  </Card>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 mb-4">
          <Button variant="ghost" size="sm" onClick={props.onClose} className="w-full">
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    </div>
  );
}
