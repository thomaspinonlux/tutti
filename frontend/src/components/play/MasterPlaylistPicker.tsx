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

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  masterListOfficialPlaylists,
  masterListPlaylists,
  masterSetScreenFocus,
  type MasterPlaylistEntry,
} from '../../lib/sessions.js';
import type { LibraryPlaylistSummary } from '../../lib/library.js';
import { playlistMatchesSource } from '../../lib/providerSelection.js';
// feat/telephone-au-style-tv — le selecteur de playlist de l animateur
// reprend les codes de la TV, comme le reste du telephone. Les composants
// generiques Card / Badge / Button restent intacts pour le back-office.
const CORAIL = '#FF5C4D';

function Carte({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/[0.05] p-4 transition-colors ${className}`}
    >
      {children}
    </div>
  );
}

function Puce({ children }: { children: React.ReactNode; tone?: string; tilt?: number }): JSX.Element {
  return (
    <span className="inline-block rounded-full border border-white/15 bg-white/[0.07] px-2.5 py-0.5 font-mono text-[11px] text-white/75">
      {children}
    </span>
  );
}

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
    provider: 'youtube' | 'spotify' | 'apple_music',
    difficulty?: 'EASY' | 'MEDIUM' | 'EXPERT' | 'MIX_EM',
  ) => void | Promise<void>;
}

type Tab = 'perso' | 'official';
type Provider = 'youtube' | 'spotify' | 'apple_music';

const LEVELS: {
  key: string;
  label: string;
  difficulty?: 'EASY' | 'MEDIUM' | 'EXPERT' | 'MIX_EM';
}[] = [
  { key: 'mix', label: 'Mix' },
  { key: 'n1', label: 'N1 · Facile', difficulty: 'EASY' },
  { key: 'n2', label: 'N2 · Moyen', difficulty: 'MEDIUM' },
  { key: 'n3', label: 'N3 · Difficile', difficulty: 'EXPERT' },
  // feat/two-mix-options — mix explicite Facile+Moyen, tirage plat backend.
  { key: 'mix_em', label: 'Mix Facile/Moyen', difficulty: 'MIX_EM' },
];

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function MasterPlaylistPicker(props: Props): JSX.Element | null {
  const { t } = useTranslation();
  // feat/animator-tv-library — ouvre sur la Bibliothèque (Tutti est library-first)
  // → la grille + le miroir TV s'activent dès l'ouverture du picker.
  const [tab, setTab] = useState<Tab>('official');

  // Perso
  const [perso, setPerso] = useState<MasterPlaylistEntry[] | null>(null);
  // Officiel — ordre de source par défaut : apple_music → youtube → spotify.
  // On démarre sur youtube puis on bascule sur Apple Music dès qu'une couverture
  // Apple est détectée (cf. effet plus bas), tant que l'animateur n'a pas choisi
  // lui-même. Sans couverture Apple → on reste sur youtube (repli propre).
  const [provider, setProvider] = useState<Provider>('youtube');
  const providerTouchedRef = useRef(false);
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

  // Défaut Apple Music : dès qu'au moins une playlist officielle a une couverture
  // Apple, on met Apple Music en source par défaut (tant que l'animateur n'a pas
  // choisi). Sinon on reste sur youtube. Miroir du comportement de la console.
  useEffect(() => {
    if (providerTouchedRef.current || provider !== 'youtube') return;
    if (official && official.some((p) => (p.apple_music_count ?? 0) > 0)) {
      setProvider('apple_music');
    }
  }, [official, provider]);

  // Reset à la fermeture.
  useEffect(() => {
    if (!props.open) {
      setTab('official');
      setSelected(null);
      setQ('');
    }
  }, [props.open]);

  const filteredOfficial = useMemo(() => {
    if (!official) return null;
    const nq = norm(q.trim());
    return official
      .filter((p) => playlistMatchesSource(p, provider))
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
  // fix/tv-ne-suit-pas-le-telephone — LA TV SUIT LE DÉFILEMENT DU TÉLÉPHONE.
  //
  // Avant : tant qu'aucune playlist n'était TOUCHÉE, on poussait toujours la
  // PREMIÈRE de la liste. L'animateur faisait défiler son téléphone et la salle
  // voyait la même carte figée — « la TV ne suit pas ». La console iPad, elle,
  // avait bien ce suivi (useFocusedPlaylistSync) ; le téléphone ne l'a jamais eu.
  //
  // Désormais on repère la carte la plus proche du CENTRE de l'écran du
  // téléphone (critère net sur une liste verticale, là où « la plus visible »
  // donne des ex æquo dès que trois cartes tiennent à l'écran) et c'est elle
  // qu'on envoie, au plus une fois toutes les 150 ms.
  const conteneurRef = useRef<HTMLDivElement | null>(null);
  const [idCentre, setIdCentre] = useState<string | null>(null);
  useEffect(() => {
    const boite = conteneurRef.current;
    if (!props.open || !boite || tab !== 'official' || selected) return;
    let dernier = 0;
    let differe: number | null = null;
    const calculer = (): void => {
      const r = boite.getBoundingClientRect();
      const centre = r.top + r.height / 2;
      let meilleur: string | null = null;
      let ecartMin = Number.POSITIVE_INFINITY;
      boite.querySelectorAll<HTMLElement>('[data-focus-playlist-id]').forEach((el) => {
        const b = el.getBoundingClientRect();
        if (b.bottom < r.top || b.top > r.bottom) return; // hors écran
        const ecart = Math.abs(b.top + b.height / 2 - centre);
        if (ecart < ecartMin) {
          ecartMin = ecart;
          meilleur = el.getAttribute('data-focus-playlist-id');
        }
      });
      if (meilleur) setIdCentre(meilleur);
    };
    const surDefilement = (): void => {
      const attendu = Date.now() - dernier;
      if (attendu >= 150) {
        dernier = Date.now();
        calculer();
        return;
      }
      if (differe !== null) return;
      differe = window.setTimeout(() => {
        differe = null;
        dernier = Date.now();
        calculer();
      }, 150 - attendu);
    };
    calculer();
    boite.addEventListener('scroll', surDefilement, { passive: true });
    return () => {
      boite.removeEventListener('scroll', surDefilement);
      if (differe !== null) window.clearTimeout(differe);
    };
  }, [props.open, tab, selected, filteredOfficial]);

  const tvFocusId =
    tab === 'official'
      ? (selected?.id ?? idCentre ?? filteredOfficial?.[0]?.id ?? null)
      : null;
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

  const launchOfficial = (difficulty?: 'EASY' | 'MEDIUM' | 'EXPERT' | 'MIX_EM'): void => {
    if (!selected) return;
    setLaunching(true);
    void Promise.resolve(props.onPickOfficial(selected.id, provider, difficulty)).finally(() =>
      setLaunching(false),
    );
  };

  return (
    <div
      ref={conteneurRef}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 overflow-y-auto bg-[#0B0B0F] text-white"
    >
      <div className="max-w-[500px] mx-auto p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="font-display text-2xl text-white">{t('play.masterPickRoundTitle')}</p>
          <button
            type="button"
            onClick={props.onClose}
            aria-label={t('common.cancel')}
            className="text-2xl text-white/50 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Onglets — masqués : un seul onglet (bibliothèque officielle) pour le moment. */}
        <div className="hidden gap-2 mb-3">
          {// fix/playlists-personnelles-retirees — seule la bibliothèque
          // officielle est proposée pour le moment (demande de Thomas 03/09).
          ([{ k: 'official' as Tab, label: 'Bibliothèque officielle' }] as const).map((o) => (
            <button
              key={o.k}
              type="button"
              onClick={() => {
                setTab(o.k);
                setSelected(null);
              }}
              className={`flex-1 py-2 rounded-lg border-2 text-sm font-medium transition-colors ${
                tab === o.k
                  ? 'border-white/25 bg-white/[0.12] text-white'
                  : 'border-white/12 text-white/60 hover:bg-white/[0.08]'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        {/* Onglet officiel : source + recherche (masqué pendant le choix de niveau) */}
        {tab === 'official' && !selected && (
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <div className="inline-flex border-2 border-white/15 rounded-lg overflow-hidden">
              {(['apple_music', 'youtube', 'spotify'] as const).map((pv) => {
                // fix/source-tabs-forced-source — Spotify est hors du flow
                // officiel (cf. preferredProvider) : onglet grisé, non cliquable.
                const locked = pv === 'spotify';
                return (
                  <button
                    key={pv}
                    type="button"
                    disabled={locked}
                    aria-disabled={locked}
                    title={locked ? t('playlists.sourceSpotifyDisabled') : undefined}
                    onClick={() => {
                      if (locked) return;
                      providerTouchedRef.current = true;
                      setProvider(pv);
                    }}
                    className={`px-3 py-1.5 text-xs font-medium ${
                      locked
                        ? 'cursor-not-allowed bg-transparent text-white/25'
                        : provider === pv
                          ? 'bg-white/[0.14] text-white'
                          : 'bg-transparent text-white/55'
                    }`}
                  >
                    {pv === 'youtube'
                      ? '▶ YouTube'
                      : pv === 'spotify'
                        ? '♪ Spotify'
                        : ' Apple Music'}
                  </button>
                );
              })}
            </div>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher…"
              className="flex-1 min-w-[120px] text-sm border-2 border-white/15 rounded-2xl px-3 py-1.5 bg-white/[0.07] text-white"
            />
          </div>
        )}

        {tab === 'perso' && (
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher…"
            className="w-full text-sm border-2 border-white/15 rounded-2xl px-3 py-1.5 bg-white/[0.07] text-white mb-3"
          />
        )}

        {loading && (
          <p className="font-editorial italic text-white/50 py-8 text-center">
            {t('common.loading')}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-[#FF5C4D] mb-4">
            {error}
          </p>
        )}

        {/* ── Choix de niveau (playlist officielle sélectionnée) ─────────── */}
        {tab === 'official' && selected && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-sm text-[#FF5C4D] hover:underline"
            >
              ← Retour
            </button>
            <Carte>
              <p className="font-display text-lg text-white">{selected.name_fr}</p>
              <p className="font-mono text-xs text-white/50 mt-1">
                Source :{' '}
                {provider === 'youtube'
                  ? 'YouTube'
                  : provider === 'spotify'
                    ? 'Spotify'
                    : 'Apple Music'}{' '}
                · niveau ?
              </p>
            </Carte>
            <div className="grid grid-cols-2 gap-2">
              {LEVELS.map((lvl) => {
                const dc = selected.difficulty_counts;
                // Défensif : sans compteurs → tout activé (le backend retombe sur Mix
                // si le pool choisi < 15).
                const enabled =
                  !dc ||
                  lvl.difficulty === undefined ||
                  (lvl.difficulty === 'EASY' && dc.EASY >= 15) ||
                  (lvl.difficulty === 'MIX_EM' && dc.EASY >= 15 && dc.MEDIUM >= 15) ||
                  (lvl.difficulty === 'MEDIUM' && dc.EASY + dc.MEDIUM >= 15) ||
                  (lvl.difficulty === 'EXPERT' && dc.EASY + dc.MEDIUM + dc.EXPERT >= 15);
                return (
                  <button
                    key={lvl.key}
                    type="button"
                    disabled={launching || !enabled}
                    onClick={() => launchOfficial(lvl.difficulty)}
                    className={`rounded-2xl px-4 py-3 text-sm font-bold transition-transform active:scale-[0.98] disabled:opacity-35 ${
                      lvl.difficulty === undefined
                        ? 'text-[#0B0B0F]'
                        : 'border border-white/15 bg-white/[0.07] text-white'
                    }`}
                    style={lvl.difficulty === undefined ? { backgroundColor: CORAIL } : undefined}
                  >
                    {lvl.label}
                  </button>
                );
              })}
            </div>
            {launching && (
              <p className="font-editorial italic text-white/50 text-center text-sm">Lancement…</p>
            )}
          </div>
        )}

        {/* ── Liste officielle ───────────────────────────────────────────── */}
        {tab === 'official' && !selected && filteredOfficial && (
          <ul className="space-y-2">
            {filteredOfficial.length === 0 && (
              <p className="font-editorial italic text-white/50 py-8 text-center">
                Aucune playlist pour cette source.
              </p>
            )}
            {filteredOfficial.map((p) => (
              /* fix/tv-ne-suit-pas-le-telephone — ancre lue pour savoir quelle
                 carte est au centre de l'écran du téléphone. */
              <li key={p.id} data-focus-playlist-id={p.id}>
                <button
                  type="button"
                  disabled={p.locked}
                  onClick={() => setSelected(p)}
                  className="w-full text-left disabled:opacity-50"
                >
                  <Carte className="hover:bg-white/[0.1]">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-display text-base text-white">{p.name_fr}</p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <Puce>
                            {provider === 'youtube'
                              ? p.youtube_count
                              : provider === 'spotify'
                                ? p.spotify_count
                                : (p.apple_music_count ?? 0)}{' '}
                            {t('playlists.tracksCount')}
                          </Puce>
                          {p.locked && <Puce>🔒</Puce>}
                        </div>
                      </div>
                      <span aria-hidden className="text-white/50">
                        ›
                      </span>
                    </div>
                  </Carte>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* ── Liste perso ────────────────────────────────────────────────── */}
        {tab === 'perso' && filteredPerso && (
          <ul className="space-y-2">
            {filteredPerso.length === 0 && (
              <p className="font-editorial italic text-white/50 py-8 text-center">
                {t('host.noPlaylistsHint')}
              </p>
            )}
            {filteredPerso.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={launching}
                  onClick={() => {
                    // fix/lancement-sans-retour — on verrouille et on le montre.
                    // Rien ne changeait tant que la fenêtre ne se fermait pas :
                    // l'animateur tapait plusieurs fois la même playlist.
                    setLaunching(true);
                    void Promise.resolve(props.onPick(p.id)).finally(() => setLaunching(false));
                  }}
                  className="w-full text-left"
                >
                  <Carte className="hover:bg-white/[0.1]">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-base text-white">{p.name}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Puce>
                          {p.tracks_count} {t('playlists.tracksCount')}
                        </Puce>
                        <Puce>{p.level}</Puce>
                        {p.is_express && <Puce>{t('host.expressBadge')}</Puce>}
                        {p.is_official_tutti && <Puce>Tutti</Puce>}
                      </div>
                    </div>
                  </Carte>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 mb-4">
          <button
            type="button"
            onClick={props.onClose}
            className="w-full rounded-2xl border border-white/15 px-4 py-2.5 text-sm text-white/70 transition-colors hover:bg-white/[0.06]"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
