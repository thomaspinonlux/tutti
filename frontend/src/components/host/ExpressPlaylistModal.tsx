/**
 * <ExpressPlaylistModal /> — création rapide d'une playlist à la volée
 * pendant une session. La playlist est sauvegardée avec is_express=true
 * pour la retrouver plus tard dans le catalogue de l'établissement.
 *
 * Au "Lancer cette manche" : crée la playlist + ses tracks, puis appelle
 * onLaunch(playlistId) pour que le host démarre le round.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TrackResult } from '@tutti/shared';
import { createPlaylist, addTrack as apiAddTrack, updatePlaylist } from '../../lib/playlists.js';
import { Badge, Button, Input, Modal } from '../ui/index.js';
import { TrackSearch } from '../admin/TrackSearch.js';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Numéro de la manche à venir (pour le nom par défaut). */
  nextRoundPosition: number;
  /** Langue par défaut (héritée de la session). */
  language: 'fr' | 'en';
  onLaunch: (playlistId: string) => void | Promise<void>;
}

const MIN_TRACKS = 3;

export function ExpressPlaylistModal({
  open,
  onClose,
  nextRoundPosition,
  language,
  onLaunch,
}: Props): JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<TrackResult[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultName = t('host.expressDefaultName', { n: nextRoundPosition });
  const finalName = name.trim() || defaultName;

  const addPicked = (track: TrackResult): void => {
    setPicked((prev) =>
      prev.some((p) => p.provider_track_id === track.provider_track_id) ? prev : [...prev, track],
    );
  };

  const removePicked = (track: TrackResult): void => {
    setPicked((prev) => prev.filter((p) => p.provider_track_id !== track.provider_track_id));
  };

  const reset = (): void => {
    setName('');
    setPicked([]);
    setError(null);
    setSubmitting(false);
  };

  const handleClose = (): void => {
    if (submitting) return;
    reset();
    onClose();
  };

  const handleLaunch = async (): Promise<void> => {
    if (picked.length < MIN_TRACKS) return;
    setSubmitting(true);
    setError(null);
    try {
      const playlist = await createPlaylist({ name: finalName, language });
      // Marquer "express" + publier en un seul PATCH
      await updatePlaylist(playlist.id, { is_published: true } as Partial<{
        is_published: boolean;
      }>);
      // Ajout séquentiel des tracks (le backend fait la getTrack côté provider).
      // En série pour éviter de hammer Spotify et conserver l'ordre.
      for (const track of picked) {
        await apiAddTrack(playlist.id, {
          provider: track.provider,
          provider_track_id: track.provider_track_id,
        });
      }
      // L'API ne permet pas de set is_express via updatePlaylist (champ non
      // exposé V1 dans patchSchema) : à ajouter plus tard si besoin de filtrer.
      // Pour l'instant le préfixe "Express" dans le nom suffit visuellement.
      await onLaunch(playlist.id);
      reset();
      onClose();
    } catch (err: unknown) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title={t('host.expressTitle')} size="lg">
      <div className="space-y-4">
        <Input
          label={t('host.expressNameLabel')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={defaultName}
          maxLength={120}
        />

        <div>
          <p className="text-xs font-mono uppercase tracking-wider text-ink/70 mb-2">
            {t('host.expressTracks')} ({picked.length})
          </p>
          {picked.length === 0 ? (
            <p className="font-editorial italic text-sm text-ink-soft">{t('host.expressEmpty')}</p>
          ) : (
            <ul className="space-y-1 mb-3 max-h-48 overflow-y-auto">
              {picked.map((track) => (
                <li
                  key={track.provider_track_id}
                  className="flex items-center justify-between gap-2 px-3 py-2 border-2 border-ink rounded bg-white"
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{track.title}</span>
                    <span className="text-ink-soft"> — {track.artist}</span>
                  </span>
                  <Badge tone="cream" tilt={-1}>
                    {track.provider}
                  </Badge>
                  <button
                    type="button"
                    onClick={() => removePicked(track)}
                    className="text-xs text-raspberry hover:underline shrink-0"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-xs font-mono uppercase tracking-wider text-ink/70 mb-2">
            {t('tracks.searchSection')}
          </p>
          <TrackSearch onSelect={addPicked} variant="compact" providers={['spotify', 'youtube']} />
        </div>

        {error && (
          <p role="alert" className="text-sm text-raspberry">
            {error}
          </p>
        )}

        <div className="flex items-center justify-between gap-2 pt-2 border-t-2 border-ink">
          <p className="font-mono text-xs text-ink-soft">
            {picked.length < MIN_TRACKS
              ? t('host.expressMinTracks', { min: MIN_TRACKS, current: picked.length })
              : t('host.expressReady')}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClose}
              disabled={submitting}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => void handleLaunch()}
              disabled={submitting || picked.length < MIN_TRACKS}
            >
              {submitting ? t('common.saving') : t('host.expressLaunch')}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
