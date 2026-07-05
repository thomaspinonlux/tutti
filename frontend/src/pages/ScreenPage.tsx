/**
 * /screen?workspace=UUID — Écran TV V2 (réécriture from scratch).
 *
 * Source unique de vérité : GET /api/workspace/screen-state(/[:wsId])
 * Polling 2s, no Socket.IO, no cache. Backend calcule l'état from scratch
 * en lisant la DB à chaque appel.
 *
 * États rendus :
 *   IDLE         → page d'attente Tutti animée (vinyles + notes)
 *   LOBBY        → QR code + code session + liste joueurs
 *   PLAYING      → MainScreenView phase rendering
 *   PAUSED       → MainScreenView avec overlay pause
 *   ROUND_PODIUM → podium intermédiaire
 *   FINAL_PODIUM → podium final + QR rejouer
 *
 * WorkspaceId source :
 *   - ?workspace=UUID dans l'URL (priorité — admin partage)
 *   - sinon auto-detect via cookies Supabase (getMe) — same-browser only
 *
 * Polling adaptatif :
 *   - 2s par défaut
 *   - Ralenti à 5s après 10 lectures IDLE consécutives (économie requêtes)
 *
 * NOTE — l'ancienne implémentation socket spectator + snapshot REST est
 * conservée dans ScreenPage.legacy.tsx pour réintégration future comme
 * optimisation au-dessus du polling (V3).
 */

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Input,
  MultiColorBar,
  TitleHandwritten,
  Underline,
} from '../components/ui/index.js';
import { QRCode } from '../components/host/QRCode.js';
import { getScreenState, type ScreenState } from '../lib/screenState.js';
import type { RoundRankingEntry, FastestPlayer } from '../lib/sessions.js';
import { getMe } from '../lib/me.js';
import { connectAsSpectator } from '../lib/socket.js';
import { TvScreenView } from './screen/TvScreenView.js';
import { screenStateToMainScreenProps } from './screen/adapters/screenStateToMainScreenProps.js';
import { getPublicCatalog, type LibraryCategoryWithPlaylists } from '../lib/library.js';
import { OfficialCatalogSections } from '../components/host/library/OfficialCatalogSections.js';
import { ThemeLevelCards } from '../components/host/library/ThemeLevelCards.js';
import { buildThemeSections, flattenThemes } from '../lib/officialThemes.js';
import { JoinQrCorner } from '../components/host/JoinQrCorner.js';

const POLL_FAST_MS = 2000;
const POLL_SLOW_MS = 5000;
const SLOW_THRESHOLD_IDLE_TICKS = 10;

export function ScreenPage(): JSX.Element {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const workspaceParam = params.get('workspace') ?? '';
  const [autoWorkspaceId, setAutoWorkspaceId] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const [screenState, setScreenState] = useState<ScreenState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idleStreakRef = useRef(0);

  // Auto-detect workspaceId via cookies Supabase si pas en param URL
  useEffect(() => {
    if (workspaceParam) return;
    void getMe()
      .then((me) => {
        if (me.workspace?.id) setAutoWorkspaceId(me.workspace.id);
      })
      .catch(() => {
        /* pas logged in admin — fallback saisie manuelle */
      });
  }, [workspaceParam]);

  const workspaceId = workspaceParam || autoWorkspaceId;

  // Trigger ref : permet aux events socket de demander un re-poll immédiat
  // (cf. useEffect socket plus bas). Le polling 2s reste actif en parallèle
  // comme filet de sécurité si le socket meurt.
  const triggerPollRef = useRef<(() => void) | null>(null);

  // Polling state machine
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    let timeoutId: number | null = null;
    let inFlight = false;
    // fix/tv-mirror — un trigger (event socket) arrivé pendant un poll in-flight
    // était DROPPÉ sans rejouer → en plein scroll-sync, la TV ne se mettait à
    // jour qu'au tick 2s au lieu de chaque POST scroll (~100ms) = "scroll suit
    // pas". On mémorise le trigger et on re-poll immédiatement au finally.
    let pendingTrigger = false;

    const poll = async (): Promise<void> => {
      if (inFlight) {
        pendingTrigger = true; // sera consommé au finally du poll en cours
        return;
      }
      inFlight = true;
      try {
        const next = await getScreenState(workspaceId);
        if (cancelled) return;
        setScreenState(next);
        setError(null);
        // Polling adaptatif : ralenti après 10 IDLE consécutifs
        idleStreakRef.current = next.state === 'IDLE' ? idleStreakRef.current + 1 : 0;
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message);
      } finally {
        inFlight = false;
        if (!cancelled) {
          if (timeoutId !== null) window.clearTimeout(timeoutId);
          if (pendingTrigger) {
            // Un event est arrivé pendant le fetch → re-poll tout de suite pour
            // récupérer le dernier scroll_ratio (latence ≈ 1 RTT, pas 2s).
            pendingTrigger = false;
            timeoutId = null;
            void poll();
          } else {
            const interval =
              idleStreakRef.current >= SLOW_THRESHOLD_IDLE_TICKS ? POLL_SLOW_MS : POLL_FAST_MS;
            timeoutId = window.setTimeout(() => void poll(), interval);
          }
        }
      }
    };

    triggerPollRef.current = () => {
      // Annule le timeout en cours et déclenche un poll immédiat. Si un poll est
      // déjà in-flight, poll() mémorise pendingTrigger et rejoue au finally.
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
      void poll();
    };

    void poll();
    return () => {
      cancelled = true;
      triggerPollRef.current = null;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [workspaceId]);

  // Socket spectator : trigger re-poll immédiat sur events critiques.
  // Best-effort overlay au-dessus du polling 2s (qui reste source de vérité).
  // Si le socket meurt → polling rattrape au prochain tick.
  const joinCode = screenState && 'joinCode' in screenState ? screenState.joinCode : null;
  useEffect(() => {
    if (!joinCode) return;
    const socket = connectAsSpectator(joinCode);
    const trigger = (): void => {
      console.info('[Screen socket] event reçu → re-poll immédiat');
      triggerPollRef.current?.();
    };
    const events = [
      'session:paused',
      'session:resumed',
      'session:ended',
      'session:started',
      'track:start',
      'track:phase',
      'track:correct_answer',
      'track:reveal',
      'round:created',
      'round:started',
      'round:ended',
      // feat/tv-playlist-selection-sync — re-poll quand l'host change la
      // playlist focused dans le carrousel.
      'screen-state:focus-changed',
    ];
    events.forEach((ev) => socket.on(ev, trigger));
    return () => {
      events.forEach((ev) => socket.off(ev, trigger));
      socket.disconnect();
    };
  }, [joinCode]);

  // ── Pas de workspaceId encore : saisie manuelle code ou loading auto ────
  if (!workspaceId) {
    const submit = (e: FormEvent): void => {
      e.preventDefault();
      const v = codeInput.trim();
      if (!v) return;
      // Le code session ne donne pas le workspaceId direct — fallback : on
      // utilise la legacy route (snapshot par code) en passant ?session=CODE
      setParams({ session: v.toUpperCase() });
    };
    return (
      <div className="min-h-screen flex flex-col bg-gradient-to-b from-[#0B0B0F] to-[#14141C] text-white relative overflow-hidden">
        <MultiColorBar height="md" />
        <main className="flex-1 flex items-center justify-center p-8 relative z-10">
          <div className="max-w-2xl w-full text-center">
            <p className="font-mono text-sm uppercase tracking-[0.3em] mb-4 text-[#FF5C4D]">
              {t('common.brand')}
            </p>
            <h1 className="font-display text-7xl lg:text-8xl leading-none mb-4 text-white">
              {t('screen.castTitle')}
            </h1>
            <p className="font-editorial italic text-2xl text-[#B8B8C4] mb-12">
              {t('screen.taglineWaiting')}
            </p>
            <Card size="md" tone="cream" className="max-w-md mx-auto">
              <p className="font-editorial italic text-ink-soft mb-3 text-sm">
                {t('screen.castSubtitle')}
              </p>
              <form onSubmit={submit} className="space-y-3">
                <Input
                  label={t('screen.codeLabel')}
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  placeholder="KOMP-XXXX"
                  autoFocus
                  maxLength={20}
                  className="text-center font-mono uppercase tracking-widest"
                />
                <Button type="submit" size="lg" className="w-full" disabled={!codeInput.trim()}>
                  {t('screen.castButton')}
                </Button>
              </form>
            </Card>
          </div>
        </main>
        <MultiColorBar height="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <Card size="lg" className="max-w-md text-center">
          <p className="text-raspberry font-medium mb-3">{error}</p>
        </Card>
      </div>
    );
  }

  if (!screenState) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="font-mono text-ink-soft">{t('common.loading')}</p>
      </div>
    );
  }

  // ── Switch render selon state ───────────────────────────────────────────
  switch (screenState.state) {
    case 'IDLE':
      return <ScreenIdleView />;
    case 'LOBBY':
      return (
        <ScreenLobbyView
          joinCode={screenState.joinCode}
          sessionName={screenState.sessionName}
          players={screenState.players}
        />
      );
    case 'PLAYING':
      // Rebranchement MainScreenView via adapter — récupère confettis,
      // countdown phase 2, vinyl rotation, dance pulse, reveal cover, phase
      // eyebrow, toasts firstFound, etc. (cf. PR fix/tv-screen-regressions).
      // feat/tv-join-qr-codes (D) — overlay QR géant si l'animateur l'a toggle.
      return (
        <ScreenWithQrOverlay joinCode={screenState.joinCode} show={screenState.qr_overlay}>
          <TvScreenView {...screenStateToMainScreenProps(screenState)} />
        </ScreenWithQrOverlay>
      );
    case 'PAUSED':
      return (
        <ScreenWithQrOverlay joinCode={screenState.joinCode} show={screenState.qr_overlay}>
          <TvScreenView {...screenStateToMainScreenProps(screenState)} />
        </ScreenWithQrOverlay>
      );
    case 'ROUND_PODIUM':
      return (
        <ScreenRoundPodiumView
          joinCode={screenState.joinCode}
          cumulative={screenState.cumulative}
          roundRanking={screenState.roundRanking}
          fastest={screenState.fastestPlayer}
          roundPosition={screenState.lastEndedRoundPosition}
        />
      );
    case 'FINAL_PODIUM':
      return (
        <ScreenFinalPodiumView
          joinCode={screenState.joinCode}
          finalScores={screenState.finalScores}
        />
      );
    case 'PLAYLIST_SELECTION':
      return (
        <ScreenPlaylistGridView
          focusedId={screenState.focused_playlist_id}
          scrollRatio={screenState.scroll_ratio}
          hRatios={screenState.h_ratios}
          selectedThemeKey={screenState.selected_theme_key}
          joinCode={screenState.joinCode}
        />
      );
    default:
      return <ScreenIdleView />;
  }
}

// ── Views par état ────────────────────────────────────────────────────────

function ScreenIdleView(): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-[#0B0B0F] to-[#14141C] text-white relative overflow-hidden">
      <MultiColorBar height="md" />
      <div aria-hidden className="absolute inset-0 pointer-events-none overflow-hidden opacity-70">
        <FloatingVinyl size={140} top="12%" left="8%" delay="0s" />
        <FloatingVinyl size={100} top="65%" left="6%" delay="2s" />
        <FloatingVinyl size={120} top="20%" right="10%" delay="1s" />
        <FloatingVinyl size={90} top="70%" right="14%" delay="3s" />
        <FloatingNote size={48} top="35%" left="20%" delay="0.5s">
          ♪
        </FloatingNote>
        <FloatingNote size={56} top="50%" right="22%" delay="2.5s">
          ♫
        </FloatingNote>
        <FloatingNote size={40} top="78%" left="40%" delay="1.5s">
          ♩
        </FloatingNote>
      </div>
      <main className="flex-1 flex items-center justify-center p-8 relative z-10">
        <div className="max-w-2xl w-full text-center">
          <p className="font-mono text-sm uppercase tracking-[0.3em] mb-4 text-[#FF5C4D]">
            {t('common.brand')}
          </p>
          <h1 className="font-display text-7xl lg:text-8xl leading-none mb-5 text-white">
            {t('screen.castTitle')}
          </h1>
          <p className="font-editorial italic text-2xl text-[#B8B8C4]">
            {t('screen.taglineWaiting')}
          </p>
        </div>
      </main>
      <MultiColorBar height="md" />
    </div>
  );
}

function ScreenLobbyView({
  joinCode,
  sessionName,
  players,
}: {
  joinCode: string;
  sessionName: string | null;
  players: Array<{ id: string; pseudo: string; team_id: string | null }>;
}): JSX.Element {
  const { t } = useTranslation();
  const url = `${window.location.origin}/play?session=${joinCode}`;
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-[#0B0B0F] to-[#14141C] text-white">
      <MultiColorBar height="md" />
      <main className="flex-1 grid lg:grid-cols-2 gap-10 p-10 items-center max-w-7xl mx-auto w-full">
        <div className="text-center">
          <p className="font-mono text-sm uppercase tracking-[0.3em] mb-3 text-[#FF5C4D]">
            {t('screen.lobbyEyebrow')}
          </p>
          <h1 className="font-display text-6xl lg:text-7xl leading-none mb-8 text-white">
            {sessionName ?? t('common.brand')}
          </h1>
          <div className="inline-block rounded-3xl bg-[#1C1C26] border border-white/10 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-[#B8B8C4] mb-3">
              {t('screen.scanToJoin')}
            </p>
            <div className="rounded-2xl bg-white p-3 inline-block">
              <QRCode value={url} size={240} />
            </div>
            <p className="font-mono text-4xl font-bold tracking-[0.3em] text-white mt-4">
              {joinCode}
            </p>
          </div>
        </div>
        <div className="text-center">
          <p className="font-mono text-sm uppercase tracking-[0.25em] text-[#B8B8C4] mb-4">
            {t('screen.playersConnected', { count: players.length })}
          </p>
          {players.length === 0 ? (
            <p className="font-editorial italic text-2xl text-[#B8B8C4]/80">
              {t('screen.lobbyWaiting')}
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 max-w-xl mx-auto">
              {players.map((p) => (
                <li
                  key={p.id}
                  className="px-4 py-3 rounded-2xl bg-white/[0.06] border border-white/10 font-bold text-xl lg:text-2xl text-white animate-pop-in flex items-center gap-3"
                >
                  <span
                    aria-hidden
                    className="w-9 h-9 rounded-full flex items-center justify-center font-display text-base shrink-0 text-[#0B0B0F]"
                    style={{ backgroundColor: '#FF5C4D' }}
                  >
                    {p.pseudo.charAt(0).toUpperCase()}
                  </span>
                  <span className="truncate">{p.pseudo}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
      {/* feat/tv-playlist-carousel — carrousel des playlists disponibles
          en lobby. Auto-rotation 6s, fait découvrir le catalogue aux
          joueurs avant le lancement. Charge via session.short_code (public,
          pas d'auth requise). */}
      <LobbyPlaylistCarousel shortCode={joinCode} />
      <MultiColorBar height="md" />
    </div>
  );
}

// ScreenPlayingView et ScreenPausedView inline retirés — remplacés par
// MainScreenView via screenStateToMainScreenProps adapter (cf. switch render
// + import en haut). Récupère vinyl rotation, confettis, countdown 15s,
// dance pulse, reveal cover, phase eyebrow, etc. d'un coup.

/**
 * feat/host-tv-catalog-parity-v2 — vue TV pendant la sélection de playlist.
 * Mirror READ-ONLY de l'écran de sélection de l'animateur :
 *   - MÊMES sections/cartes que le host via <OfficialCatalogSections> (source
 *     unique buildThemeSections), non-interactives, fetchée par la TV
 *     elle-même (endpoint public) à chaque entrée en PLAYLIST_SELECTION
 *     (remount) ;
 *   - la card centrée côté animateur est highlightée (focusedId) ;
 *   - la position de scroll de l'animateur (scrollRatio 0..1) est appliquée à
 *     la grille → la TV suit l'écran host en direct.
 * Aucun clic, aucune recherche, aucun onglet : affichage seul.
 */
function ScreenPlaylistGridView({
  focusedId,
  scrollRatio,
  hRatios,
  selectedThemeKey,
  joinCode,
}: {
  focusedId: string;
  scrollRatio: number;
  hRatios: Record<string, number>;
  selectedThemeKey: string | null;
  joinCode: string;
}): JSX.Element {
  const { t } = useTranslation();
  const [categories, setCategories] = useState<LibraryCategoryWithPlaylists[] | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Fetch du catalogue public une seule fois (la TV n'a pas de cookies admin).
  useEffect(() => {
    let cancelled = false;
    void getPublicCatalog()
      .then((cats) => {
        if (!cancelled) setCategories(cats);
      })
      .catch(() => {
        if (!cancelled) setCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Scroll-sync : applique le ratio reçu de l'animateur à la grille TV.
  // Double application : immédiate + rAF (le scrollHeight change après le
  // chargement async des covers → max recalculé sur le vrai layout).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const apply = (): void => {
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) {
        // Grille plus courte que le viewport TV → rien à scroller. Diagnostic
        // explicite (vu en console TV) pour distinguer "max=0" d'un scroll figé.
        console.info(`[GridMirror] no overflow (max=${max}) — grille tient à l'écran`);
        return;
      }
      el.scrollTop = scrollRatio * max;
      console.info(
        `[GridMirror] apply ratio=${scrollRatio.toFixed(3)} max=${max} → top=${Math.round(el.scrollTop)}`,
      );
    };
    apply();
    const raf = window.requestAnimationFrame(apply);
    return () => window.cancelAnimationFrame(raf);
  }, [scrollRatio, categories]);

  // Scroll-sync HORIZONTAL : applique chaque hRatio[catSlug] au carrousel
  // matchant (même `data-carousel-cat` côté host et TV). Dimension en plus du
  // vertical, indépendante. Log [GridMirror] hApply = preuve côté TV.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const apply = (): void => {
      const parts: string[] = [];
      for (const [slug, r] of Object.entries(hRatios)) {
        // Quoté + CSS.escape : robuste si un slug contient un jour espace/accent/&/quote.
        const el = root.querySelector<HTMLElement>(`[data-carousel-cat="${CSS.escape(slug)}"]`);
        if (!el) continue;
        const max = el.scrollWidth - el.clientWidth;
        if (max <= 0) continue;
        el.scrollLeft = r * max;
        parts.push(`${slug}:${r.toFixed(2)}→${Math.round(el.scrollLeft)}`);
      }
      if (parts.length) console.info(`[GridMirror] hApply ${parts.join(' ')}`);
    };
    apply();
    const raf = window.requestAnimationFrame(apply);
    return () => window.cancelAnimationFrame(raf);
  }, [hRatios, categories]);

  // feat/host-tv-catalog-parity-v2 — MÊME groupement que le host (source unique).
  const sections = useMemo(() => buildThemeSections(categories ?? []), [categories]);
  // feat/host-tv-level-mirror — si le host est dans un thème (étape niveau),
  // on mirrore ses cartes de niveau au lieu des sections de thèmes.
  const selectedTheme = useMemo(
    () => (selectedThemeKey ? (flattenThemes(sections).get(selectedThemeKey) ?? null) : null),
    [sections, selectedThemeKey],
  );

  return (
    <div className="h-screen flex flex-col bg-cream">
      <MultiColorBar height="md" />
      <header className="px-10 pt-6 pb-2 shrink-0">
        <p className="font-mono text-sm uppercase tracking-[0.3em] text-spritz-deep mb-1">
          {t('screen.playlistSelection.eyebrow')}
        </p>
        <TitleHandwritten as="h1" className="text-5xl leading-none">
          <Underline>{t('screen.playlistSelection.gridTitle')}</Underline>
        </TitleHandwritten>
      </header>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-10 pb-10 pt-4">
        {categories === null ? (
          <p className="font-mono text-ink-soft animate-pulse">{t('common.loading')}</p>
        ) : selectedTheme ? (
          <ThemeLevelCards theme={selectedTheme} highlightId={focusedId} readOnly />
        ) : (
          <OfficialCatalogSections sections={sections} highlightId={focusedId} readOnly />
        )}
      </div>
      <MultiColorBar height="md" />
      {/* feat/tv-join-qr-codes (C) — QR rejoindre en coin, mirroir de l'écran
          animateur. Affichage seul (la TV ne pilote rien). */}
      <JoinQrCorner joinCode={joinCode} />
    </div>
  );
}

/**
 * feat/tv-join-qr-codes (D) — wrappe l'écran de jeu et affiche, par-dessus, le
 * QR de rejoindre EN GRAND centré quand l'animateur l'a togglé (`show`). TV
 * read-only : c'est l'animateur qui pilote le flag via screen-state.
 */
function ScreenWithQrOverlay({
  joinCode,
  show,
  children,
}: {
  joinCode: string;
  show: boolean;
  children: React.ReactNode;
}): JSX.Element {
  const { t } = useTranslation();
  const url = `${window.location.origin}/play?session=${joinCode}`;
  return (
    <div className="relative">
      {children}
      {show && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-ink/85 backdrop-blur-sm animate-fade-in">
          <p className="font-mono text-base uppercase tracking-[0.3em] text-cream">
            {t('screen.joinTitle')}
          </p>
          <QRCode value={url} size={440} />
          <p className="font-mono text-5xl font-bold tracking-[0.3em] text-cream">{joinCode}</p>
          <p className="font-editorial italic text-2xl text-cream/80">{t('screen.joinHint')}</p>
        </div>
      )}
    </div>
  );
}

// feat/tv-round-results — liste à auto-défilement : la TV n'a personne pour
// scroller, donc on défile lentement haut↔bas SEULEMENT si le contenu déborde
// (gère 15-20+ joueurs). Une seule boucle rAF montée à vie du composant ; elle
// lit scrollHeight/clientHeight à chaque frame → s'adapte aux updates 2s.
function AutoScrollList({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    let dir = 1;
    let pause = 90; // frames d'arrêt en haut/bas (~1.5s)
    let acc = 0;
    const step = (): void => {
      const max = el.scrollHeight - el.clientHeight;
      if (max > 2) {
        if (pause > 0) {
          pause -= 1;
        } else {
          acc += dir * 0.6;
          if (acc >= max) {
            acc = max;
            dir = -1;
            pause = 90;
          } else if (acc <= 0) {
            acc = 0;
            dir = 1;
            pause = 90;
          }
          el.scrollTop = acc;
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div ref={ref} className={`overflow-hidden ${className ?? ''}`}>
      {children}
    </div>
  );
}

function ScreenRoundPodiumView({
  joinCode,
  cumulative,
  roundRanking,
  fastest,
  roundPosition,
}: {
  joinCode: string;
  cumulative: import('@tutti/shared').CumulativeScore[];
  roundRanking: RoundRankingEntry[];
  fastest: FastestPlayer | null;
  roundPosition: number;
}): JSX.Element {
  const { t } = useTranslation();
  const cumulTop = cumulative.slice(0, 10);
  const fastestAvgSec =
    fastest && typeof fastest.avg_buzz_ms === 'number'
      ? (fastest.avg_buzz_ms / 1000).toFixed(2)
      : '—';
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-[#0B0B0F] to-[#14141C] text-white">
      <MultiColorBar height="md" />
      <main className="flex-1 flex flex-col items-center px-8 py-6 overflow-hidden">
        <p className="font-mono text-xs uppercase tracking-[0.3em] mb-1 text-[#FF5C4D]">
          {t('screen.roundPodiumEyebrow', { n: roundPosition })}
        </p>
        <h1 className="font-display text-5xl lg:text-6xl mb-5 text-white">
          {t('screen.roundPodiumTitle')}
        </h1>

        <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-6 w-full max-w-6xl flex-1 min-h-0">
          {/* Classement COMPLET de la manche — auto-scroll si débordement */}
          <section className="flex flex-col min-h-0">
            <p className="font-mono text-xs uppercase tracking-[0.25em] mb-3 text-[#FF5C4D]">
              🏆 {t('screen.roundRankingTitle')}
            </p>
            {roundRanking.length === 0 ? (
              <p className="font-editorial italic text-[#B8B8C4]/70">
                {t('host.intermission.noPoints')}
              </p>
            ) : (
              <AutoScrollList className="flex-1 min-h-0">
                <ol className="space-y-2 pr-1">
                  {roundRanking.map((e, idx) => (
                    <li
                      key={e.participant_id}
                      className="flex items-center gap-4 px-4 py-3 rounded-2xl"
                      style={{
                        backgroundColor: idx === 0 ? '#FF5C4D1f' : '#ffffff08',
                        border: `1px solid ${idx === 0 ? '#FF5C4D66' : '#ffffff12'}`,
                      }}
                    >
                      <span aria-hidden className="text-2xl w-9 text-center">
                        {['🥇', '🥈', '🥉'][idx] ?? (
                          <span className="font-mono text-lg text-[#B8B8C4]">{idx + 1}</span>
                        )}
                      </span>
                      <span className="font-display text-2xl lg:text-3xl flex-1 truncate text-white">
                        {e.pseudo}
                      </span>
                      <span className="font-mono text-2xl font-bold tabular-nums text-white">
                        +{e.points}
                      </span>
                    </li>
                  ))}
                </ol>
              </AutoScrollList>
            )}
          </section>

          {/* Plus rapide + classement général (cumul) */}
          <section className="flex flex-col min-h-0 gap-4">
            <div
              className="rounded-2xl px-4 py-4 text-center shrink-0"
              style={{ backgroundColor: '#FF5C4D14', border: '1px solid #FF5C4D55' }}
            >
              <p
                className="font-mono text-xs uppercase tracking-[0.2em] mb-2"
                style={{ color: '#FF5C4D' }}
              >
                ⚡ {t('host.intermission.fastest')}
              </p>
              {fastest ? (
                <>
                  <p className="font-display text-3xl mb-1 text-white">{fastest.pseudo}</p>
                  <p className="font-mono text-sm text-[#B8B8C4]">
                    {t('host.intermission.avgBuzz', { ms: fastestAvgSec })}
                  </p>
                </>
              ) : (
                <p className="font-editorial italic text-[#B8B8C4]/70">
                  {t('host.intermission.noBuzz')}
                </p>
              )}
            </div>
            <div className="flex flex-col min-h-0">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#B8B8C4] mb-3">
                📊 {t('screen.generalRankingTitle')}
              </p>
              <AutoScrollList className="flex-1 min-h-0">
                <ol className="space-y-1.5 pr-1">
                  {cumulTop.map((e, idx) => (
                    <li
                      key={e.id}
                      className="flex items-center gap-3 px-3 py-2 rounded-xl"
                      style={{
                        backgroundColor: idx === 0 ? '#FF5C4D1a' : '#ffffff08',
                        border: `1px solid ${idx === 0 ? '#FF5C4D55' : '#ffffff10'}`,
                      }}
                    >
                      <span className="font-mono text-sm w-6 text-[#B8B8C4]">{idx + 1}.</span>
                      <span className="font-display text-xl flex-1 truncate text-white">
                        {e.label}
                      </span>
                      <span className="font-mono text-xl font-bold tabular-nums text-white">
                        {e.total_points}
                      </span>
                    </li>
                  ))}
                </ol>
              </AutoScrollList>
            </div>
          </section>
        </div>

        <p className="font-mono text-sm tracking-[0.3em] text-[#B8B8C4] mt-4 shrink-0">
          {joinCode}
        </p>
      </main>
      <MultiColorBar height="md" />
    </div>
  );
}

function ScreenFinalPodiumView({
  joinCode,
  finalScores,
}: {
  joinCode: string;
  finalScores: import('@tutti/shared').CumulativeScore[];
}): JSX.Element {
  const { t } = useTranslation();
  const [first, second, third, ...rest] = finalScores;
  const winnerName = first?.label ?? '';
  const url = `${window.location.origin}/play?session=${joinCode}`;
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-[#0B0B0F] to-[#14141C] text-white">
      <MultiColorBar height="md" />
      <main className="flex-1 flex flex-col items-center justify-center p-8">
        <p className="font-mono text-sm uppercase tracking-[0.3em] mb-3 text-[#FF5C4D]">
          {t('screen.endedEyebrow')}
        </p>
        <h1 className="font-display text-7xl lg:text-8xl mb-2 text-center text-white">
          {t('screen.endedTitle')}
        </h1>
        {winnerName && (
          <p className="font-editorial italic text-3xl mb-8" style={{ color: '#FF5C4D' }}>
            {t('screen.endedWinner', { name: winnerName })}
          </p>
        )}
        {finalScores.length > 0 && (
          <ol className="space-y-3 max-w-2xl w-full mb-8">
            {[first, second, third].filter(Boolean).map((entry, idx) => (
              <li
                key={entry!.id}
                className="flex items-center gap-4 px-5 py-4 rounded-2xl"
                style={{
                  backgroundColor: idx === 0 ? '#FF5C4D1f' : '#ffffff08',
                  border: `1px solid ${idx === 0 ? '#FF5C4D66' : '#ffffff12'}`,
                }}
              >
                <span aria-hidden className="text-4xl">
                  {['🥇', '🥈', '🥉'][idx]}
                </span>
                <span className="font-display text-3xl lg:text-4xl flex-1 truncate text-white">
                  {entry!.label}
                </span>
                <span className="font-mono text-2xl font-bold tabular-nums text-white">
                  {entry!.total_points}
                </span>
              </li>
            ))}
            {rest.length > 0 && (
              <li className="px-5 py-3 rounded-2xl bg-white/[0.04] border border-white/10">
                <ul className="space-y-1">
                  {rest.map((entry, idx) => (
                    <li
                      key={entry.id}
                      className="flex items-center gap-3 font-mono text-sm text-[#B8B8C4]"
                    >
                      <span className="w-6 text-right">{idx + 4}.</span>
                      <span className="flex-1 truncate">{entry.label}</span>
                      <span className="tabular-nums">{entry.total_points}</span>
                    </li>
                  ))}
                </ul>
              </li>
            )}
          </ol>
        )}
        <div className="text-center">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#B8B8C4] mb-2">
            {t('screen.endedRematch')}
          </p>
          <div className="inline-block rounded-2xl bg-white p-2.5">
            <QRCode value={url} size={132} />
          </div>
          <p className="font-mono text-lg font-bold tracking-[0.2em] text-white mt-2">{joinCode}</p>
        </div>
      </main>
      <MultiColorBar height="md" />
    </div>
  );
}

// ── Visuel d'attente IDLE ────────────────────────────────────────────────

function FloatingVinyl({
  size,
  top,
  left,
  right,
  delay,
}: {
  size: number;
  top: string;
  left?: string;
  right?: string;
  delay: string;
}): JSX.Element {
  return (
    <div
      className="absolute opacity-30 animate-float-question"
      style={{
        top,
        left,
        right,
        width: size,
        height: size,
        animationDelay: delay,
        animationDuration: '6s',
      }}
    >
      <svg
        viewBox="0 0 120 120"
        className="w-full h-full animate-spin"
        style={{ animationDuration: '8s' }}
      >
        <circle cx="60" cy="60" r="56" fill="#1a1410" />
        <circle cx="60" cy="60" r="42" fill="none" stroke="#3d2f24" strokeWidth="0.5" />
        <circle cx="60" cy="60" r="34" fill="none" stroke="#3d2f24" strokeWidth="0.5" />
        <circle cx="60" cy="60" r="26" fill="none" stroke="#3d2f24" strokeWidth="0.5" />
        <circle cx="60" cy="60" r="18" fill="#ee6c2a" stroke="#1a1410" strokeWidth="2" />
        <circle cx="60" cy="60" r="3" fill="#1a1410" />
      </svg>
    </div>
  );
}

function FloatingNote({
  size,
  top,
  left,
  right,
  delay,
  children,
}: {
  size: number;
  top: string;
  left?: string;
  right?: string;
  delay: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <span
      aria-hidden
      className="absolute font-display text-raspberry/40 animate-pulse-buzz"
      style={{
        top,
        left,
        right,
        fontSize: size,
        animationDelay: delay,
      }}
    >
      {children}
    </span>
  );
}

/**
 * feat/tv-playlist-carousel — carrousel auto-rotation des playlists
 * officielles dispos. Charge le catalogue public scoped par session, affiche
 * 1 playlist en grand toutes les 6s avec dots indicateurs.
 *
 * Pas de navigation manuelle V1 — c'est purement décoratif/informatif sur la TV.
 * Les joueurs choisissent via leur smartphone (PlayPage ProposePlaylistButton).
 */
function LobbyPlaylistCarousel(props: { shortCode: string }): JSX.Element | null {
  const { i18n } = useTranslation();
  const [playlists, setPlaylists] = useState<
    Array<{
      id: string;
      name: string;
      description: string | null;
      theme: string | null;
      track_count: number;
      cover_url: string | null;
    }>
  >([]);
  const [idx, setIdx] = useState(0);
  // feat/tv-carousel-polish — résout URL absolue à partir du chemin retourné
  // par le backend (cover_url peut être relatif /api/library-cover/... ou
  // déjà absolu si fixé manuellement).
  const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';
  const resolveCover = (url: string | null | undefined): string | null => {
    if (!url) return null;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    if (url.startsWith('/')) return apiBase.replace(/\/+$/, '') + url;
    return url;
  };

  useEffect(() => {
    let cancelled = false;
    void import('../lib/playlistProposals.js')
      .then(({ getLibraryCatalogForSession }) => getLibraryCatalogForSession(props.shortCode))
      .then((rows) => {
        if (cancelled) return;
        const isFr = i18n.language?.toLowerCase().startsWith('fr');
        setPlaylists(
          rows.slice(0, 15).map((p) => ({
            id: p.id,
            name: isFr ? p.name_fr : p.name_en,
            description: isFr ? p.description_fr : p.description_en,
            theme: p.theme,
            track_count: p.track_count,
            cover_url: resolveCover(p.cover_url),
          })),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.shortCode, i18n.language]);

  useEffect(() => {
    if (playlists.length < 2) return;
    const id = window.setInterval(() => setIdx((i) => (i + 1) % playlists.length), 6000);
    return () => window.clearInterval(id);
  }, [playlists.length]);

  if (playlists.length === 0) return null;
  const current = playlists[idx]!;

  return (
    <section className="border-t border-white/10 bg-[#101018] py-6 px-8">
      <p
        className="font-mono text-xs uppercase tracking-[0.3em] text-center mb-4"
        style={{ color: '#FF5C4D' }}
      >
        🎶 Playlists disponibles
      </p>
      <div className="max-w-4xl mx-auto flex items-center gap-6 animate-fade-in" key={current.id}>
        {/* feat/tv-carousel-polish — cover mosaïque 2×2 si dispo, sinon
            fallback texte uniquement (cf. plus bas). */}
        {current.cover_url && (
          <div className="w-32 h-32 lg:w-40 lg:h-40 shrink-0 border border-white/10 rounded-lg overflow-hidden shadow-[0_10px_30px_rgba(0,0,0,0.5)]">
            <img
              src={current.cover_url}
              alt=""
              aria-hidden
              loading="lazy"
              className="w-full h-full object-cover"
              onError={(e) => {
                // 404 NO_COVERS → masque l'image, garde le layout texte
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-display text-3xl mb-2 text-white">{current.name}</p>
          {current.description && (
            <p className="font-editorial italic text-[#B8B8C4] text-base line-clamp-2">
              {current.description}
            </p>
          )}
          <p className="font-mono text-xs text-[#B8B8C4]/70 mt-2">
            {current.theme && <span>{current.theme} · </span>}
            {current.track_count} morceaux
          </p>
        </div>
      </div>
      {/* Dots indicateurs */}
      <div className="flex justify-center gap-1.5 mt-4">
        {playlists.map((_, i) => (
          <span
            key={i}
            className="h-1.5 rounded transition-all"
            style={{
              width: i === idx ? '1.5rem' : '0.375rem',
              backgroundColor: i === idx ? '#FF5C4D' : '#ffffff30',
            }}
          />
        ))}
      </div>
    </section>
  );
}
