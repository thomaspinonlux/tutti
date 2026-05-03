/**
 * <TrackSearch /> — autocomplete musical réutilisable.
 *
 * - Debounce 300 ms
 * - Annule la requête précédente via AbortController
 * - Callback `onSelect(track)` quand l'utilisateur clique sur un résultat
 *
 * Sera réutilisé en étape 8 (création de playlist) et en étape 15 (Quizz audio).
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MusicProviderId, TrackResult } from '@tutti/shared';
import { searchTracks } from '../../lib/music.js';
import { Input } from '../ui/index.js';

interface Props {
  /** Appelé quand l'utilisateur clique sur un résultat. */
  onSelect?: (track: TrackResult) => void;
  /** Placeholder personnalisé du champ de recherche. */
  placeholder?: string;
  /** Limite de résultats (default 10). */
  limit?: number;
  /** Affichage compact (résultats inline) ou large (carte par résultat). */
  variant?: 'compact' | 'detailed';
  /**
   * Phase 3c — providers proposés en toggle. Si non fourni, on utilise
   * le provider actif du workspace (comportement historique). Si fourni
   * avec ≥2 valeurs, un sélecteur visuel est affiché au-dessus du champ.
   */
  providers?: MusicProviderId[];
}

type SearchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'results'; results: TrackResult[] }
  | { kind: 'error'; message: string };

export function TrackSearch({
  onSelect,
  placeholder,
  limit = 10,
  variant = 'detailed',
  providers,
}: Props): JSX.Element {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [activeProvider, setActiveProvider] = useState<MusicProviderId | undefined>(providers?.[0]);
  const [state, setState] = useState<SearchState>({ kind: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setState({ kind: 'idle' });
      return;
    }

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    const timer = window.setTimeout(() => {
      setState({ kind: 'loading' });
      searchTracks(trimmed, { limit, signal: controller.signal, provider: activeProvider })
        .then(({ results }) => {
          if (controller.signal.aborted) return;
          setState({ kind: 'results', results });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          if (err instanceof Error && err.name === 'AbortError') return;
          setState({
            kind: 'error',
            message: err instanceof Error ? err.message : 'Erreur',
          });
        });
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, limit, activeProvider]);

  const showToggle = providers && providers.length >= 2;

  return (
    <div>
      {showToggle && (
        <div className="flex gap-2 mb-2" role="tablist" aria-label={t('tracks.providerLabel')}>
          {providers!.map((p) => {
            const selected = activeProvider === p;
            return (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveProvider(p)}
                className={`px-3 py-1 border-2 border-ink rounded font-mono text-xs uppercase tracking-wider transition-colors ${
                  selected ? 'bg-spritz-deep text-cream' : 'bg-cream-2 text-ink hover:bg-cream-3'
                }`}
              >
                {p}
              </button>
            );
          })}
        </div>
      )}

      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder ?? t('tracks.searchPlaceholder')}
        autoComplete="off"
      />

      <div className="mt-3" aria-live="polite">
        {state.kind === 'loading' && (
          <p className="font-mono text-xs text-ink-soft">{t('common.loading')}</p>
        )}
        {state.kind === 'error' && (
          <p role="alert" className="text-sm text-raspberry">
            {t('common.error')} : {state.message}
          </p>
        )}
        {state.kind === 'results' && state.results.length === 0 && (
          <p className="font-editorial italic text-sm text-ink-soft">{t('tracks.noResults')}</p>
        )}
        {state.kind === 'results' && state.results.length > 0 && (
          <ul className="space-y-2">
            {state.results.map((track) => (
              <li key={`${track.provider}:${track.provider_track_id}`}>
                <ResultRow track={track} onSelect={onSelect} variant={variant} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ResultRow({
  track,
  onSelect,
  variant,
}: {
  track: TrackResult;
  onSelect?: (t: TrackResult) => void;
  variant: 'compact' | 'detailed';
}): JSX.Element {
  const handleClick = (): void => {
    onSelect?.(track);
  };

  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={handleClick}
        className="w-full text-left px-3 py-2 border-2 border-ink rounded bg-cream/40 hover:bg-cream-2 transition-colors flex items-center justify-between gap-3"
      >
        <span>
          <span className="font-medium">{track.artist}</span>
          <span className="text-ink-soft"> — {track.title}</span>
        </span>
        {track.year && (
          <span className="font-mono text-xs text-ink-soft shrink-0">{track.year}</span>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="group w-full text-left p-3 border-2 border-ink rounded bg-white hover:bg-cream-2 transition-colors flex items-center gap-3 shadow-pop-sm hover:shadow-none hover:translate-x-0.5 hover:translate-y-0.5"
    >
      <div className="w-12 h-12 shrink-0 border-2 border-ink rounded bg-cream-3 flex items-center justify-center">
        {track.cover_url ? (
          <img src={track.cover_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="font-display text-lg text-ink-soft">♪</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{track.title}</p>
        <p className="text-sm text-ink-soft truncate">
          {track.artist}
          {track.album ? ` · ${track.album}` : ''}
          {track.year ? ` · ${track.year}` : ''}
        </p>
      </div>
      <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-ink/10 text-ink-soft shrink-0">
        {track.provider}
      </span>
      {typeof track.popularity === 'number' && (
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-soft shrink-0">
          {track.popularity}
        </span>
      )}
    </button>
  );
}
