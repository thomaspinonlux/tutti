/**
 * <AddTracksTabs /> — onglets pour ajouter des morceaux à une playlist Tutti.
 * 3 modes : recherche avancée, mes playlists Spotify, recherche playlists
 * publiques.
 */

import { useState } from 'react';
import { Card } from '../../../ui/index.js';
import { AdvancedTrackSearch } from './AdvancedTrackSearch.js';
import { SpotifyPlaylistsBrowser } from './SpotifyPlaylistsBrowser.js';
import { BulkPasteImport } from './BulkPasteImport.js';

interface Props {
  playlistId: string;
  onImported: (count: number) => void;
}

type TabId = 'search' | 'paste' | 'my' | 'public';

const TABS: Array<{ id: TabId; label: string; icon: string }> = [
  { id: 'search', label: 'Recherche', icon: '🔍' },
  { id: 'paste', label: 'Coller une liste', icon: '📋' },
  { id: 'my', label: 'Mes playlists', icon: '📁' },
  { id: 'public', label: 'Publiques', icon: '🌐' },
];

export function AddTracksTabs({ playlistId, onImported }: Props): JSX.Element {
  const [active, setActive] = useState<TabId>('search');

  return (
    <Card size="sm" className="space-y-3">
      <div className="flex gap-1 border-b-2 border-ink/20 -mt-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActive(t.id)}
            aria-pressed={active === t.id}
            className={`flex-1 px-3 py-2 font-mono text-xs uppercase tracking-wider border-b-4 transition-colors ${
              active === t.id
                ? 'border-spritz text-ink font-bold'
                : 'border-transparent text-ink-soft hover:text-ink'
            }`}
          >
            <span className="mr-1">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      <div>
        {active === 'search' && (
          <AdvancedTrackSearch playlistId={playlistId} onImported={onImported} />
        )}
        {active === 'paste' && <BulkPasteImport playlistId={playlistId} onImported={onImported} />}
        {active === 'my' && (
          <SpotifyPlaylistsBrowser mode="my" playlistId={playlistId} onImported={onImported} />
        )}
        {active === 'public' && (
          <SpotifyPlaylistsBrowser mode="public" playlistId={playlistId} onImported={onImported} />
        )}
      </div>
    </Card>
  );
}
