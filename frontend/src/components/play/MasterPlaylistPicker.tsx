/**
 * MasterPlaylistPicker — modale plein écran sur le tel de l'animateur (master)
 * pour choisir + lancer la manche suivante. feat/animator-full-control :
 *
 *   Onglet « Mes playlists »   → playlists perso publiées (masterPickRound).
 *   Onglet « Bibliothèque »    → bibliothèque officielle Tutti : source
 *                                 (YouTube/Spotify) + recherche + niveau
 *                                 (N1/N2/N3/Mix) → masterLaunchOfficial.
 *
 * Le son reste sur la console : ici on n'émet QUE des commandes serveur.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  masterListOfficialPlaylists,
  masterListPlaylists,
  masterSetScreenFocus,
  type MasterPlaylistEntry,
} from '../../lib/sessions.js';
import type { LibraryPlaylistSummary } from '../../lib/library.js';
import { Badge, Button, Card } from '../ui/index.js';

interface Props {
  open: boolean;
  sessionId: string;
  token: string;
  onClose: () => void;
  /** Lance une playlist PERSO (par id). */
  onPick: (playlistId: string) => void | Promise<void>;
  /** Lance une playlist OFFICIELLE (source + niveau). */
  onPickOfficial: (
    playlistId: string,
    provider: 'youtube' | 'spotify',
    difficulty?: 'EASY' | 'MEDIUM' | 'EXPERT',
  ) => void | Promise<void>;
}

type Tab = 'perso' | 'official';
type Provider = 'youtube' | 'spotify';

const LEVELS: { key: string; label: string; difficulty?: 'EASY' | 'MEDIUM' | 'EXPERT' }[] = [
  { key: 'mix', label: 'Mix' },
  { key: 'n1', label: 'N1 · Facile', difficulty: 'EASY' },
  { key: 'n2', label: 'N2 · Moyen', difficulty: 'MEDIUM' },
  { key: 'n3', label: 'N3 · Difficile', difficulty: 'EXPERT' },
];

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function MasterPlaylistPicker(props: Props): JSX.Element | null {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('perso');

  // Perso
  const [perso, setPerso] = useState<MasterPlaylistEntry[] | null>(null);
  // Officiel
  const [provider, setProvider] = useState<Provider>('youtube');
  const [official, setOfficial] = useState<LibraryPlaylistSummary[] | null>(null);
  const [selected, setSelected] = useState<LibraryPlaylistSummary | null>(null);

  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);

  // Charge perso à l'ouverture.
  useEffect(() => {
    if (!props.open) return;
    setLoading(true);
    setError(null);
    masterListPlaylists(props.sessionId, props.token)
      .then(setPerso)
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [props.open, props.sessionId, props.token]);

  // Charge la bibliothèque officielle quand on ouvre l'onglet / change de source.
  useEffect(() => {
    if (!props.open || tab !== 'official') return;
    setLoading(true);
    setError(null);
    setSelected(null);
    masterListOfficialPlaylists(props.sessionId, props.token, provider)
      .then(setOfficial)
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [props.open, tab, provider, props.sessionId, props.token]);

  // Reset à la fermeture.
  useEffect(() => {
    if (!props.open) {
      setTab('perso');
      setSelected(null);
      setQ('');
    }
  }, [props.open]);

  const filteredOfficial = useMemo(() => {
    if (!official) return null;
    const nq = norm(q.trim());
    return official
      .filter((p) => (provider === 'youtube' ? p.youtube_count > 0 : p.spotify_count > 0))
      .filter((p) => !nq || norm(p.name_fr).includes(nq) || norm(p.name_en).includes(nq));
  }, [official, q, provider]);

  const filteredPerso = useMemo(() => {
    if (!perso) return null;
    const nq = norm(q.trim());
    return nq ? perso.filter((p) => norm(p.name).includes(nq)) : perso;
  }, [perso, q]);

  // feat/animator-tv-library — pousse vers la TV la playlist officielle regardée
  // (celle sélectionnée pour le niveau, sinon la 1ʳᵉ de la liste filtrée) → la TV
  // affiche la grille catalogue + la surligne. Heartbeat 15s (TTL store = 30s).
  // Fermeture → sort de la sélection (playlist_id null).
  const tvFocusId = tab === 'official' ? (selected?.id ?? filteredOfficial?.[0]?.id ?? null) : null;
  useEffect(() => {
    if (!props.open) {
      void masterSetScreenFocus(props.sessionId, props.token, null).catch(() => {});
      return;
    }
    const push = (): void => {
      void masterSetScreenFocus(props.sessionId, props.token, tvFocusId).catch(() => {});
    };
    push();
    const id = tvFocusId ? window.setInterval(push, 15000) : undefined;
    return () => {
      if (id) window.clearInterval(id);
    };
  }, [props.open, props.sessionId, props.token, tvFocusId]);

  if (!props.open) return null;

  const launchOfficial = (difficulty?: 'EASY' | 'MEDIUM' | 'EXPERT'): void => {
    if (!selected) return;
    setLaunching(true);
    void Promise.resolve(props.onPickOfficial(selected.id, provider, difficulty)).finally(() =>
      setLaunching(false),
    );
  };

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 bg-cream overflow-y-auto">
      <div className="max-w-[500px] mx-auto p-4">
        <div className="flex items-center justify-between mb-3">
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

        {/* Onglets */}
        <div className="flex gap-2 mb-3">
          {(
            [
              { k: 'perso' as Tab, label: 'Mes playlists' },
              { k: 'official' as Tab, label: 'Bibliothèque' },
            ] as const
          ).map((o) => (
            <button
              key={o.k}
              type="button"
              onClick={() => {
                setTab(o.k);
                setSelected(null);
              }}
              className={`flex-1 py-2 rounded-lg border-2 text-sm font-medium transition-colors ${
                tab === o.k
                  ? 'border-ink bg-ink text-cream'
                  : 'border-ink/20 text-ink-soft hover:bg-cream-2'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        {/* Onglet officiel : source + recherche (masqué pendant le choix de niveau) */}
        {tab === 'official' && !selected && (
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <div className="inline-flex border-2 border-ink/20 rounded-lg overflow-hidden">
              {(['youtube', 'spotify'] as const).map((pv) => (
                <button
                  key={pv}
                  type="button"
                  onClick={() => setProvider(pv)}
                  className={`px-3 py-1.5 text-xs font-medium ${
                    provider === pv ? 'bg-ink text-cream' : 'bg-transparent text-ink-soft'
                  }`}
                >
                  {pv === 'youtube' ? '▶ YouTube' : '♪ Spotify'}
                </button>
              ))}
            </div>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher…"
              className="flex-1 min-w-[120px] text-sm border-2 border-ink/20 rounded-lg px-3 py-1.5 bg-white"
            />
          </div>
        )}

        {tab === 'perso' && (
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher…"
            className="w-full text-sm border-2 border-ink/20 rounded-lg px-3 py-1.5 bg-white mb-3"
          />
        )}

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

        {/* ── Choix de niveau (playlist officielle sélectionnée) ─────────── */}
        {tab === 'official' && selected && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-sm text-spritz-deep hover:underline"
            >
              ← Retour
            </button>
            <Card tone="cream">
              <p className="font-display text-lg">{selected.name_fr}</p>
              <p className="font-mono text-xs text-ink-soft mt-1">
                Source : {provider === 'youtube' ? 'YouTube' : 'Spotify'} · niveau ?
              </p>
            </Card>
            <div className="grid grid-cols-2 gap-2">
              {LEVELS.map((lvl) => {
                const dc = selected.difficulty_counts;
                // Défensif : sans compteurs → tout activé (le backend retombe sur Mix
                // si le pool choisi < 15).
                const enabled =
                  !dc ||
                  lvl.difficulty === undefined ||
                  (lvl.difficulty === 'EASY' && dc.EASY >= 15) ||
                  (lvl.difficulty === 'MEDIUM' && dc.EASY + dc.MEDIUM >= 15) ||
                  (lvl.difficulty === 'EXPERT' && dc.EASY + dc.MEDIUM + dc.EXPERT >= 15);
                return (
                  <Button
                    key={lvl.key}
                    variant={lvl.difficulty === undefined ? 'primary' : 'secondary'}
                    size="md"
                    disabled={launching || !enabled}
                    onClick={() => launchOfficial(lvl.difficulty)}
                  >
                    {lvl.label}
                  </Button>
                );
              })}
            </div>
            {launching && (
              <p className="font-editorial italic text-ink-soft text-center text-sm">Lancement…</p>
            )}
          </div>
        )}

        {/* ── Liste officielle ───────────────────────────────────────────── */}
        {tab === 'official' && !selected && filteredOfficial && (
          <ul className="space-y-2">
            {filteredOfficial.length === 0 && (
              <p className="font-editorial italic text-ink-soft py-8 text-center">
                Aucune playlist pour cette source.
              </p>
            )}
            {filteredOfficial.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={p.locked}
                  onClick={() => setSelected(p)}
                  className="w-full text-left disabled:opacity-50"
                >
                  <Card className="hover:bg-cream-2 transition-colors">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-display text-base truncate">{p.name_fr}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <Badge tone="ink" tilt={-1}>
                            {provider === 'youtube' ? p.youtube_count : p.spotify_count}{' '}
                            {t('playlists.tracksCount')}
                          </Badge>
                          {p.locked && <Badge tone="raspberry">🔒</Badge>}
                        </div>
                      </div>
                      <span aria-hidden className="text-ink-soft">
                        ›
                      </span>
                    </div>
                  </Card>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* ── Liste perso ────────────────────────────────────────────────── */}
        {tab === 'perso' && filteredPerso && (
          <ul className="space-y-2">
            {filteredPerso.length === 0 && (
              <p className="font-editorial italic text-ink-soft py-8 text-center">
                {t('host.noPlaylistsHint')}
              </p>
            )}
            {filteredPerso.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => void props.onPick(p.id)}
                  className="w-full text-left"
                >
                  <Card className="hover:bg-cream-2 transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="font-display text-base truncate">{p.name}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge tone="ink" tilt={-1}>
                          {p.tracks_count} {t('playlists.tracksCount')}
                        </Badge>
                        <Badge tone="cream">{p.level}</Badge>
                        {p.is_express && <Badge tone="lemon">{t('host.expressBadge')}</Badge>}
                        {p.is_official_tutti && <Badge tone="basil">Tutti</Badge>}
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
