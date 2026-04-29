import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TrackResult } from '@tutti/shared';
import { Card, TitleHandwritten, Underline, Badge } from '../../components/ui/index.js';
import { TrackSearch } from '../../components/admin/TrackSearch.js';

export function TracksPage(): JSX.Element {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<TrackResult[]>([]);

  return (
    <div className="max-w-4xl mx-auto">
      <TitleHandwritten as="h1" className="mb-3">
        <Underline>{t('tracks.title')}</Underline>
      </TitleHandwritten>
      <p className="font-editorial italic text-ink-2 mb-8">{t('tracks.searchHelp')}</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card size="lg">
          <h2 className="font-display text-xl mb-4">{t('tracks.searchSection')}</h2>
          <TrackSearch
            onSelect={(track) =>
              setPicked((prev) =>
                prev.some((p) => p.provider_track_id === track.provider_track_id)
                  ? prev
                  : [...prev, track],
              )
            }
          />
        </Card>

        <Card size="lg" tone={picked.length > 0 ? 'spritz' : 'default'}>
          <h2 className="font-display text-xl mb-4">{t('tracks.pickedSection')}</h2>
          {picked.length === 0 ? (
            <p className="font-editorial italic text-sm text-ink-soft">{t('tracks.pickedEmpty')}</p>
          ) : (
            <ul className="space-y-2">
              {picked.map((track) => (
                <li
                  key={`${track.provider}:${track.provider_track_id}`}
                  className="flex items-center justify-between gap-3 px-3 py-2 border-2 border-ink rounded bg-white"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{track.title}</p>
                    <p className="text-sm text-ink-soft truncate">{track.artist}</p>
                  </div>
                  <Badge tone="cream" tilt={-1}>
                    {track.provider}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <p className="font-editorial italic text-sm text-ink-soft mt-8 border-l-2 border-cream-4 pl-3">
        {t('tracks.comingSoon')}
      </p>
    </div>
  );
}
