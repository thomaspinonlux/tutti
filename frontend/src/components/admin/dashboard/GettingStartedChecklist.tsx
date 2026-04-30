/**
 * <GettingStartedChecklist /> — checklist d'onboarding sur le dashboard.
 *
 * Affichée tant que toutes les étapes ne sont pas complétées. Disparaît
 * automatiquement quand le workspace est "prêt à jouer".
 *
 * Étapes :
 *   ✓ Compte créé (toujours OK)
 *   ☐ Connecter Spotify (si provider non-demo + pas connecté)
 *   ☐ Créer 1ère playlist Tutti Tracks
 *   ☐ Créer 1er pack Tutti Quizz
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { listPlaylists } from '../../../lib/playlists.js';
import { listQuestionSets } from '../../../lib/questionSets.js';
import { getSpotifyStatus } from '../../../lib/music.js';
import { Card } from '../../ui/index.js';

interface ChecklistStatus {
  spotifyConnected: boolean;
  hasPlaylist: boolean;
  hasPack: boolean;
  loaded: boolean;
}

export function GettingStartedChecklist(): JSX.Element | null {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ChecklistStatus>({
    spotifyConnected: false,
    hasPlaylist: false,
    hasPack: false,
    loaded: false,
  });

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([listPlaylists(), listQuestionSets(), getSpotifyStatus()]).then(
      ([pls, qs, sp]) => {
        if (cancelled) return;
        setStatus({
          spotifyConnected: sp.status === 'fulfilled' ? sp.value.connected : false,
          hasPlaylist: pls.status === 'fulfilled' ? pls.value.length > 0 : false,
          hasPack: qs.status === 'fulfilled' ? qs.value.length > 0 : false,
          loaded: true,
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status.loaded) return null;
  // Si tout est fait → disparait
  if (status.spotifyConnected && status.hasPlaylist && status.hasPack) return null;

  const items = [
    {
      key: 'account',
      label: t('gettingStarted.stepAccount'),
      done: true,
      href: null,
    },
    {
      key: 'spotify',
      label: t('gettingStarted.stepSpotify'),
      done: status.spotifyConnected,
      href: '/admin/settings',
    },
    {
      key: 'playlist',
      label: t('gettingStarted.stepPlaylist'),
      done: status.hasPlaylist,
      href: '/admin/tracks',
    },
    {
      key: 'pack',
      label: t('gettingStarted.stepPack'),
      done: status.hasPack,
      href: '/admin/quizz',
    },
  ];

  const completed = items.filter((i) => i.done).length;
  const pct = Math.round((completed / items.length) * 100);

  return (
    <Card tone="cream" size="lg" className="mb-8">
      <div className="flex items-center justify-between mb-3 gap-3">
        <h3 className="font-display text-2xl">🎯 {t('gettingStarted.title')}</h3>
        <span className="font-mono text-sm text-ink-soft">
          {completed} / {items.length}
        </span>
      </div>
      <div className="w-full h-2 border-2 border-ink rounded overflow-hidden bg-cream-2 mb-4">
        <div className="h-full bg-spritz transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <ul className="space-y-2">
        {items.map((item) => {
          const content = (
            <span className="flex items-center gap-3 px-3 py-2 border-2 border-ink rounded text-sm bg-cream">
              <span
                className={`shrink-0 w-6 h-6 border-2 border-ink rounded-full flex items-center justify-center text-xs font-bold ${
                  item.done ? 'bg-basil text-ink' : 'bg-cream'
                }`}
              >
                {item.done ? '✓' : ''}
              </span>
              <span className={`flex-1 ${item.done ? 'line-through text-ink-soft' : ''}`}>
                {item.label}
              </span>
              {!item.done && item.href && (
                <span className="font-mono text-[10px] uppercase tracking-wider text-spritz-deep">
                  {t('gettingStarted.go')} →
                </span>
              )}
            </span>
          );
          return (
            <li key={item.key}>
              {item.href && !item.done ? (
                <Link to={item.href} className="block hover:translate-x-0.5 transition-transform">
                  {content}
                </Link>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
