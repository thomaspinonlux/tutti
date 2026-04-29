/**
 * <TrackDetailsPanel /> — colonne droite de la page d'édition de playlist.
 *
 * 2 onglets :
 *   - "Recherche" : <TrackSearch /> avec auto-add à la playlist
 *   - "Détails" : metadata du track sélectionné + éditeur d'aliases
 */

import { useState, useEffect, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Track, TrackResult } from '@tutti/shared';
import { Card, Pill, Badge } from '../../ui/index.js';
import { TrackSearch } from '../TrackSearch.js';

interface Props {
  selected: Track | null;
  onAddTrack: (track: TrackResult) => Promise<void> | void;
  onUpdateAliases: (
    trackId: string,
    patch: { artist_aliases?: string[]; title_aliases?: string[] },
  ) => Promise<void>;
}

type Tab = 'search' | 'details';

export function TrackDetailsPanel({ selected, onAddTrack, onUpdateAliases }: Props): JSX.Element {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('search');

  // Auto-switch vers "details" quand un track est sélectionné
  useEffect(() => {
    if (selected) setTab('details');
  }, [selected?.id]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Pill active={tab === 'search'} onClick={() => setTab('search')}>
          {t('playlists.tabSearch')}
        </Pill>
        <Pill active={tab === 'details'} onClick={() => setTab('details')}>
          {t('playlists.tabDetails')}
        </Pill>
      </div>

      {tab === 'search' && (
        <Card size="sm">
          <TrackSearch onSelect={(track) => void onAddTrack(track)} variant="compact" />
        </Card>
      )}

      {tab === 'details' && <DetailsTab selected={selected} onUpdateAliases={onUpdateAliases} />}
    </div>
  );
}

function DetailsTab({
  selected,
  onUpdateAliases,
}: {
  selected: Track | null;
  onUpdateAliases: Props['onUpdateAliases'];
}): JSX.Element {
  const { t } = useTranslation();
  if (!selected) {
    return (
      <Card size="sm">
        <p className="font-editorial italic text-sm text-ink-soft">{t('playlists.detailsEmpty')}</p>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      <Card size="sm">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-16 h-16 shrink-0 border-2 border-ink rounded bg-cream-3 overflow-hidden">
            {selected.cover_url ? (
              <img src={selected.cover_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center font-display text-2xl text-ink-soft">
                ♪
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg truncate">{selected.title}</p>
            <p className="text-sm text-ink-soft truncate">{selected.artist}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              <Badge tone="cream">{selected.provider}</Badge>
              {selected.year && <Badge tone="cream">{selected.year}</Badge>}
              {typeof selected.popularity === 'number' && (
                <Badge
                  tone={
                    selected.popularity >= 70
                      ? 'basil'
                      : selected.popularity >= 45
                        ? 'lemon'
                        : 'plum'
                  }
                >
                  pop {selected.popularity}
                </Badge>
              )}
            </div>
          </div>
        </div>
        {selected.album && (
          <p className="text-xs font-mono text-ink-soft truncate">{selected.album}</p>
        )}
      </Card>

      <Card size="sm">
        <AliasEditor
          label={t('playlists.aliasArtistLabel')}
          hint={t('playlists.aliasArtistHint')}
          values={selected.artist_aliases}
          onChange={(next) => void onUpdateAliases(selected.id, { artist_aliases: next })}
        />
      </Card>

      <Card size="sm">
        <AliasEditor
          label={t('playlists.aliasTitleLabel')}
          hint={t('playlists.aliasTitleHint')}
          values={selected.title_aliases}
          onChange={(next) => void onUpdateAliases(selected.id, { title_aliases: next })}
        />
      </Card>
    </div>
  );
}

function AliasEditor({
  label,
  hint,
  values,
  onChange,
}: {
  label: string;
  hint: string;
  values: string[];
  onChange: (next: string[]) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');

  const add = (): void => {
    const v = draft.trim();
    if (!v) return;
    if (values.includes(v)) {
      setDraft('');
      return;
    }
    onChange([...values, v]);
    setDraft('');
  };

  const remove = (alias: string): void => {
    onChange(values.filter((v) => v !== alias));
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  };

  return (
    <div>
      <label className="block">
        <span className="block text-xs font-mono uppercase tracking-wider text-ink/70 mb-1">
          {label}
        </span>
        <div className="flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKey}
            placeholder={t('playlists.aliasPlaceholder')}
            className="flex-1 px-2 py-1 border-2 border-ink rounded bg-cream/30 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-spritz"
          />
          <button
            type="button"
            onClick={add}
            className="px-3 py-1 text-sm bg-cream text-ink border-2 border-ink rounded font-bold shadow-pop-sm hover:shadow-none hover:translate-x-0.5 hover:translate-y-0.5"
          >
            +
          </button>
        </div>
      </label>
      <span className="block text-xs text-ink-soft mt-1 italic">{hint}</span>
      {values.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1">
          {values.map((alias) => (
            <li key={alias}>
              <button
                type="button"
                onClick={() => remove(alias)}
                className="px-2 py-0.5 text-xs font-mono border-2 border-ink rounded bg-cream-2 hover:bg-raspberry hover:text-cream transition-colors"
                title={t('playlists.aliasRemove')}
              >
                {alias} <span className="ml-1 opacity-60">✕</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
