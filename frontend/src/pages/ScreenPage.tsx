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
import { getShareableOrigin } from '../lib/platform.js';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Input,
  MultiColorBar,
} from '../components/ui/index.js';
import { QRCode } from '../components/host/QRCode.js';
import { getScreenState, type ScreenState } from '../lib/screenState.js';
import type { RoundRankingEntry, FastestPlayer } from '../lib/sessions.js';
import { getMe } from '../lib/me.js';
import { connectAsSpectator } from '../lib/socket.js';
import { fetchCurrentLyrics, type LrcLine } from '../lib/lyrics.js';
import { TvScreenView } from './screen/TvScreenView.js';
import { screenStateToMainScreenProps } from './screen/adapters/screenStateToMainScreenProps.js';
import {
  getPublicCatalog,
  type LibraryCategoryWithPlaylists,
  type LibraryPlaylistSummary,
} from '../lib/library.js';
import { buildThemeSections, flattenThemes } from '../lib/officialThemes.js';
import { JoinQrCorner } from '../components/host/JoinQrCorner.js';

// fix/tv-1s-poll — 1 s en partie : l'écran ne peut jamais avoir plus d'une
// seconde de retard sur le serveur, même si le canal temps réel est mort.
const POLL_FAST_MS = 1000;
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
  // fix/tv-freeze — BATTEMENT DE COEUR pour le chien de garde NATIF.
  // La page publie window.__tuttiBeat = Date.now() chaque seconde. Le plugin
  // natif (iPad) le lit toutes les 4 s : battement arrêté ~8 s → il détruit et
  // reconstruit la fenêtre TV. Détecte les gels que rien d'autre ne voit
  // (timers suspendus par iOS, deadlock JS, boucle de rechargement).
  useEffect(() => {
    const w = window as unknown as { __tuttiBeat?: number };
    w.__tuttiBeat = Date.now();
    const beat = window.setInterval(() => {
      w.__tuttiBeat = Date.now();
    }, 1_000);
    return () => window.clearInterval(beat);
  }, []);

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
  // feat/synced-lyrics — Mode A : la TV n'a PAS le son (il sort de la console).
  // On suit donc la position via track:progress (émis 1×/s par la console) et
  // on interpole entre deux messages, sinon les paroles avanceraient par à-coups.
  const progressRef = useRef<{ position_ms: number; at: number; is_paused: boolean } | null>(null);
  const [lyricsLines, setLyricsLines] = useState<LrcLine[] | null>(null);
  // fix/tv-watchdog — horodatage du dernier poll RÉUSSI. La TV interroge le
  // serveur toutes les 1 s ; si elle reste 6 s sans réponse (boucle morte,
  // réseau tombé, onglet gelé par le navigateur TV), on recharge la page :
  // une TV de bar doit se rattraper TOUTE SEULE, jamais rester figée sur
  // Pause ou sur une erreur. 6 s = 6 polls manqués d'affilée — jamais un
  // simple ralentissement, toujours une vraie panne.
  const lastPollOkRef = useRef<number>(Date.now());

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
        lastPollOkRef.current = Date.now();
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

    // fix/tv-watchdog — filet ultime : 6 s sans poll réussi → reload complet
    // (le reload lui-même prend ~2 s). Couvre TOUS les cas de blocage (Pause
    // figée, socket mort + boucle morte, navigateur TV qui a gelé les timers)
    // sans intervention humaine.
    // fix/tv-boucle-de-rechargement — LE RECHARGEMENT NE BOUCLE PLUS HORS RÉSEAU.
    // Recharger alors que le réseau est coupé donnait une page d'erreur du
    // navigateur : plus de code, donc plus de battement de cœur, donc le chien
    // de garde natif reconstruisait la fenêtre, qui échouait à son tour. Trois
    // superviseurs s'emballaient ensemble et la TV clignotait sans revenir.
    // Désormais : on ne recharge que si l'appareil se dit connecté, et on
    // espace les tentatives (6 s, 12 s, 24 s, puis 60 s au plus).
    let echecsConsecutifs = 0;
    const watchdogId = window.setInterval(() => {
      const silence = Date.now() - lastPollOkRef.current;
      const seuil = Math.min(6_000 * Math.pow(2, echecsConsecutifs), 60_000);
      if (silence <= seuil) {
        echecsConsecutifs = 0;
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        console.warn('[Écran TV] appareil hors réseau — on garde l\'image et on attend');
        return;
      }
      echecsConsecutifs += 1;
      console.warn(
        `[Écran TV] ${Math.round(silence / 1000)} s sans réponse du serveur → rechargement ` +
          `(tentative ${echecsConsecutifs})`,
      );
      lastPollOkRef.current = Date.now();
      window.location.reload();
    }, 1_000);
    // Retour réseau / onglet redevenu visible → re-poll immédiat.
    const kick = (): void => triggerPollRef.current?.();
    window.addEventListener('online', kick);
    document.addEventListener('visibilitychange', kick);

    return () => {
      cancelled = true;
      triggerPollRef.current = null;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      window.clearInterval(watchdogId);
      window.removeEventListener('online', kick);
      document.removeEventListener('visibilitychange', kick);
    };
  }, [workspaceId]);

  // feat/synced-lyrics — charge le TEXTE quand l'animateur active l'overlay.
  // Le serveur refuse tant que le morceau n'est pas révélé : fetchCurrentLyrics
  // renvoie alors null et rien ne s'affiche. Rechargé à chaque changement de
  // morceau (track_id) pour ne jamais afficher les paroles du précédent.
  const lyricsOn =
    screenState && 'lyrics_overlay' in screenState ? screenState.lyrics_overlay : false;
  const lyricsTrackId =
    screenState && 'currentTrack' in screenState
      ? (screenState.currentTrack?.track_id ?? null)
      : null;
  const lyricsJoinCode = screenState && 'joinCode' in screenState ? screenState.joinCode : null;

  useEffect(() => {
    if (!lyricsOn || !lyricsJoinCode || !lyricsTrackId) {
      setLyricsLines(null);
      return;
    }
    let cancelled = false;
    void fetchCurrentLyrics(lyricsJoinCode).then((lines) => {
      if (!cancelled) setLyricsLines(lines);
    });
    return () => {
      cancelled = true;
    };
  }, [lyricsOn, lyricsJoinCode, lyricsTrackId]);

  // Position audio pour la synchro : la TV n'a pas le son, on interpole depuis
  // le dernier track:progress reçu. Repli sur l'estimation started_at si aucun
  // message depuis 5 s (console déconnectée ou socket mort).
  const getLyricsPositionMs = useMemo(() => {
    return (): number => {
      const p = progressRef.current;
      if (p && Date.now() - p.at < 5000) {
        return p.position_ms + (p.is_paused ? 0 : Date.now() - p.at);
      }
      if (screenState && 'currentTrack' in screenState && screenState.currentTrack?.started_at) {
        const ms = Date.now() - new Date(screenState.currentTrack.started_at).getTime();
        return Number.isFinite(ms) && ms > 0 ? ms : 0;
      }
      return 0;
    };
  }, [screenState]);

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
    // fix/tv-socket-event-names — CES NOMS DOIVENT correspondre EXACTEMENT aux
    // events réellement émis par le backend (broadcastToSession). Avant ce fix,
    // 'track:phase' et 'track:reveal' ne matchaient RIEN (le backend émet
    // 'track:phase_changed' et 'track:revealed') → la révélation et les
    // changements de phase ne déclenchaient PAS de re-poll immédiat, et la TV
    // n'affichait la réponse qu'au tick de polling suivant (jusqu'à 2 s de
    // retard). Ajout aussi de buzz:received (surbrillance buzzer) et
    // scores:invalidated (corrections de score) pour un rafraîchissement
    // immédiat.
    const events = [
      'session:paused',
      'session:resumed',
      'session:ended',
      'session:started',
      'track:start',
      'track:phase_changed',
      'track:correct_answer',
      'track:revealed',
      'buzz:received',
      'scores:invalidated',
      'round:created',
      'round:started',
      'round:ended',
      // feat/tv-playlist-selection-sync — re-poll quand l'host change la
      // playlist focused dans le carrousel.
      'screen-state:focus-changed',
      // feat/synced-lyrics — l'animateur a (dé)clenché l'affichage des paroles.
      'lyrics:overlay',
    ];
    events.forEach((ev) => socket.on(ev, trigger));

    // fix/tv-timeline-reset — nouveau morceau : on jette la position du
    // précédent. Sans ça, la barre/paroles continuaient sur l'ancienne
    // position jusqu'au premier track:progress du nouveau titre (~1-2 s).
    const onTrackStart = (): void => {
      progressRef.current = null;
    };
    socket.on('track:start', onTrackStart);

    // feat/synced-lyrics — position audio réelle diffusée par la console.
    // Mémorisée avec son horodatage local pour interpoler entre deux messages.
    const onProgress = (p: { position_ms: number; is_paused?: boolean }): void => {
      progressRef.current = {
        position_ms: p.position_ms,
        at: Date.now(),
        is_paused: p.is_paused ?? false,
      };
    };
    socket.on('track:progress', onProgress);

    return () => {
      events.forEach((ev) => socket.off(ev, trigger));
      socket.off('track:start', onTrackStart);
      socket.off('track:progress', onProgress);
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

  // fix/ecran-tv-efface — UNE REQUÊTE RATÉE N'EFFACE PLUS LE JEU.
  // La carte d'erreur passait AVANT l'état affiché : un seul 500 passager, ou
  // un paquet perdu, remplaçait tout l'écran par une carte vide devant la
  // salle. On ne montre désormais cette carte que si l'on n'a JAMAIS reçu
  // d'état ; sinon on garde la dernière image et on signale discrètement la
  // reconnexion en cours.
  if (error && !screenState) {
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
          <TvScreenView
            {...screenStateToMainScreenProps(screenState)}
            lyrics={
              lyricsLines
                ? {
                    lines: lyricsLines,
                    getPositionMs: getLyricsPositionMs,
                    paused: progressRef.current?.is_paused ?? false,
                  }
                : undefined
            }
          />
        </ScreenWithQrOverlay>
      );
    case 'PAUSED':
      return (
        <ScreenWithQrOverlay joinCode={screenState.joinCode} show={screenState.qr_overlay}>
          <TvScreenView
            {...screenStateToMainScreenProps(screenState)}
            lyrics={
              lyricsLines
                ? {
                    lines: lyricsLines,
                    getPositionMs: getLyricsPositionMs,
                    paused: progressRef.current?.is_paused ?? false,
                  }
                : undefined
            }
          />
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
  const url = `${getShareableOrigin()}/play?session=${joinCode}`;
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
 * Pochette d'une playlist : mosaïque servie par le backend, avec les mêmes
 * replis que les cartes de l'animateur (cover de secours, puis vignette
 * YouTube). Une seule source de vérité visuelle entre les deux écrans.
 */
function coverUrlFor(p: LibraryPlaylistSummary): string | null {
  if (p.slug) return `/api/library-cover/${encodeURIComponent(p.slug)}.jpg`;
  if (p.cover_fallback_url) return p.cover_fallback_url;
  if (p.cover_fallback_youtube_id) {
    return `https://img.youtube.com/vi/${p.cover_fallback_youtube_id}/hqdefault.jpg`;
  }
  return null;
}

/** Espace entre deux cartes du bandeau TV (px). */
const RAIL_GAP = 26;
/** Corail de l'identité écran (identique à TvScreenView). */
const TV_CORAL = '#FF5C4D';
/** Libellés des cinq niveaux, tels qu'affichés côté animateur. */
const LEVEL_LABELS: Record<string, string> = {
  easy: 'Facile',
  medium: 'Moyen',
  hard: 'Difficile',
  mix_em: 'Mix Facile/Moyen',
  mix: 'Mix complet',
};

/**
 * feat/tv-rail-selection — VUE TV PENDANT LA SÉLECTION DE PLAYLIST.
 *
 * Remplace le miroir de grille verticale par un BANDEAU HORIZONTAL qui amène
 * la playlist sélectionnée AU CENTRE. Raison : la console et la télécommande
 * défilent verticalement (on les tient en main), la TV est un rectangle large
 * regardé de loin. Recopier une position de défilement verticale sur un écran
 * horizontal n'a aucune traduction fidèle — c'était la source du décalage.
 *
 * Ici on ne synchronise plus un DÉFILEMENT mais une SÉLECTION : l'identifiant
 * de la carte centrée côté animateur suffit. La TV calcule elle-même le
 * mouvement, en glissant vers la cible image par image (amorti). Un message en
 * retard n'induit donc aucune erreur : la carte arrive au centre un instant
 * plus tard, à la bonne place.
 *
 * `scrollRatio` / `hRatios` restent acceptés pour compatibilité avec les
 * consoles pas encore mises à jour, mais ne sont plus utilisés.
 */
function ScreenPlaylistGridView({
  focusedId,
  selectedThemeKey,
  joinCode,
}: {
  focusedId: string;
  scrollRatio?: number;
  hRatios?: Record<string, number>;
  selectedThemeKey: string | null;
  joinCode: string;
}): JSX.Element {
  const { t } = useTranslation();
  const [categories, setCategories] = useState<LibraryCategoryWithPlaylists[] | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const posRef = useRef(0);
  const targetRef = useRef(0);

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

  const sections = useMemo(() => buildThemeSections(categories ?? []), [categories]);
  const selectedTheme = useMemo(
    () => (selectedThemeKey ? (flattenThemes(sections).get(selectedThemeKey) ?? null) : null),
    [sections, selectedThemeKey],
  );

  /** Liste plate des cartes affichées, dans l'ordre du catalogue animateur. */
  const items = useMemo(() => {
    if (selectedTheme) {
      return selectedTheme.variants.map((v) => ({
        id: v.variantId,
        name: selectedTheme.name,
        levelLabel: LEVEL_LABELS[v.level ?? 'mix'] ?? null,
        count: v.count ?? v.playlist.track_count,
        cover: coverUrlFor(v.playlist),
        section: selectedTheme.name,
      }));
    }
    const flat: {
      id: string;
      name: string;
      levelLabel: string | null;
      count: number;
      cover: string | null;
      section: string;
    }[] = [];
    for (const sec of sections) {
      for (const theme of sec.themes) {
        flat.push({
          id: theme.variants[0]?.variantId ?? theme.cover.id,
          name: theme.name,
          levelLabel: theme.variants.length > 1 ? `${theme.variants.length} niveaux` : null,
          count: theme.cover.track_count,
          cover: coverUrlFor(theme.cover),
          section: sec.label_fr,
        });
      }
    }
    return flat;
  }, [sections, selectedTheme]);

  /** Index de la carte désignée par l'animateur (id de variante OU de playlist). */
  const focusIndex = useMemo(() => {
    if (!focusedId) return 0;
    const exact = items.findIndex((it) => it.id === focusedId);
    if (exact >= 0) return exact;
    // Repli : l'animateur a envoyé un id de playlist, nos cartes portent un
    // variantId `${playlistId}::niveau` — on retrouve la carte par préfixe.
    const base = focusedId.split('::')[0]!;
    const loose = items.findIndex((it) => it.id.split('::')[0] === base);
    return loose >= 0 ? loose : 0;
  }, [items, focusedId]);

  /** Glissade amortie : 18 % de la distance restante à chaque image. */
  useEffect(() => {
    let raf = 0;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const step = (): void => {
      const el = trackRef.current;
      if (el) {
        const card = el.firstElementChild as HTMLElement | null;
        if (card) {
          const cardW = card.offsetWidth + RAIL_GAP;
          targetRef.current = -(focusIndex * cardW) - cardW / 2;
          posRef.current += (targetRef.current - posRef.current) * (reduce ? 1 : 0.18);
          if (Math.abs(targetRef.current - posRef.current) < 0.4) {
            posRef.current = targetRef.current;
          }
          el.style.transform = `translateX(${posRef.current}px)`;
        }
      }
      raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [focusIndex, items.length]);

  const current = items[focusIndex] ?? null;

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-[#0B0B0F] text-white">
      <MultiColorBar height="md" />
      <header className="flex shrink-0 items-baseline justify-between px-12 pb-3 pt-7">
        <div>
          <p
            className="mb-1 font-mono text-[11px] uppercase tracking-[0.3em]"
            style={{ color: TV_CORAL }}
          >
            {t('screen.playlistSelection.eyebrow')}
          </p>
          <h1 className="font-display text-5xl leading-none text-white">
            {current ? current.name : t('screen.playlistSelection.gridTitle')}
          </h1>
        </div>
        {current && (
          <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-white/45">
            {current.section}
          </span>
        )}
      </header>

      <div className="relative flex-1 overflow-hidden">
        {categories === null ? (
          <p className="px-12 font-mono text-white/45">{t('common.loading')}</p>
        ) : (
          <div
            ref={trackRef}
            className="absolute left-1/2 top-1/2 flex -translate-y-1/2 items-stretch"
            style={{ gap: RAIL_GAP }}
          >
            {items.map((it, i) => {
              const on = i === focusIndex;
              return (
                <article
                  key={it.id}
                  className="flex w-[19vw] max-w-[300px] shrink-0 flex-col gap-3 rounded-[20px] border p-5 transition-[opacity,background-color,border-color,transform] duration-[420ms]"
                  style={{
                    opacity: on ? 1 : 0.38,
                    transform: on ? 'scale(1.06)' : 'scale(0.92)',
                    backgroundColor: on ? 'rgba(255,92,77,0.13)' : 'rgba(245,239,224,0.05)',
                    borderColor: on ? 'rgba(255,92,77,0.52)' : 'rgba(245,239,224,0.10)',
                  }}
                >
                  <div
                    className="aspect-square w-full overflow-hidden rounded-[14px] ring-1 ring-white/10"
                    style={{
                      backgroundColor: '#15151D',
                      backgroundImage: it.cover ? `url(${it.cover})` : undefined,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  />
                  <p
                    className="font-display leading-tight text-white"
                    style={{ fontSize: on ? '1.6rem' : '1.35rem' }}
                  >
                    {it.name}
                  </p>
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/45">
                    {it.count} {t('screen.playlistSelection.tracks', { defaultValue: 'titres' })}
                    {it.levelLabel ? ` · ${it.levelLabel}` : ''}
                  </p>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3 px-12 pb-5">
        {items.map((it, i) => (
          <span
            key={it.id}
            aria-hidden
            className="h-1.5 rounded-full transition-all duration-300"
            style={{
              width: i === focusIndex ? 26 : 6,
              backgroundColor: i === focusIndex ? TV_CORAL : 'rgba(245,239,224,0.22)',
            }}
          />
        ))}
      </div>

      <MultiColorBar height="md" />
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
  const url = `${getShareableOrigin()}/play?session=${joinCode}`;
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
  // fix/tv-podium-legibility — la liste défile (AutoScrollList) : on affiche
  // TOUT le classement, pas seulement le top 10.
  const cumulTop = cumulative;
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
                      className="flex items-center gap-5 px-6 py-4 rounded-2xl"
                      style={{
                        backgroundColor: idx === 0 ? '#FF5C4D1f' : '#ffffff08',
                        border: `1px solid ${idx === 0 ? '#FF5C4D66' : '#ffffff12'}`,
                      }}
                    >
                      <span aria-hidden className="text-4xl w-14 text-center">
                        {['🥇', '🥈', '🥉'][idx] ?? (
                          <span className="font-mono text-2xl text-[#B8B8C4]">{idx + 1}</span>
                        )}
                      </span>
                      <span className="font-display text-4xl lg:text-5xl flex-1 truncate text-white">
                        {e.pseudo}
                      </span>
                      <span className="font-mono text-4xl lg:text-5xl font-bold tabular-nums text-white">
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
                      className="flex items-center gap-4 px-5 py-3 rounded-xl"
                      style={{
                        backgroundColor: idx === 0 ? '#FF5C4D1a' : '#ffffff08',
                        border: `1px solid ${idx === 0 ? '#FF5C4D55' : '#ffffff10'}`,
                      }}
                    >
                      <span className="font-mono text-xl w-10 text-[#B8B8C4]">{idx + 1}.</span>
                      <span className="font-display text-3xl lg:text-4xl flex-1 truncate text-white">
                        {e.label}
                      </span>
                      <span className="font-mono text-3xl lg:text-4xl font-bold tabular-nums text-white">
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
  const url = `${getShareableOrigin()}/play?session=${joinCode}`;
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
