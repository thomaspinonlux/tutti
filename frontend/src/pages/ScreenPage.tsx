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

import { useEffect, useRef, useState, type FormEvent } from 'react';
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
import { getMe } from '../lib/me.js';
import { connectAsSpectator } from '../lib/socket.js';
import { MainScreenView } from './screen/MainScreenView.js';
import { screenStateToMainScreenProps } from './screen/adapters/screenStateToMainScreenProps.js';

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

    const poll = async (): Promise<void> => {
      if (inFlight) return; // dédup : pas 2 fetchs concurrents
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
        if (cancelled) return;
        if (timeoutId !== null) window.clearTimeout(timeoutId);
        const interval =
          idleStreakRef.current >= SLOW_THRESHOLD_IDLE_TICKS ? POLL_SLOW_MS : POLL_FAST_MS;
        timeoutId = window.setTimeout(() => void poll(), interval);
      }
    };

    triggerPollRef.current = () => {
      // Annule le timeout en cours et déclenche un poll immédiat. Le finally
      // re-armera le timeout suivant.
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
      <div className="min-h-screen flex flex-col bg-cream relative overflow-hidden">
        <MultiColorBar height="md" />
        <main className="flex-1 flex items-center justify-center p-8 relative z-10">
          <div className="max-w-2xl w-full text-center">
            <p className="font-mono text-sm uppercase tracking-[0.3em] text-spritz-deep mb-4">
              {t('common.brand')}
            </p>
            <TitleHandwritten as="h1" className="mb-4 text-7xl">
              <Underline>{t('screen.castTitle')}</Underline>
            </TitleHandwritten>
            <p className="font-editorial italic text-2xl text-ink-2 mb-12">
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
      return <MainScreenView {...screenStateToMainScreenProps(screenState)} />;
    case 'PAUSED':
      return <MainScreenView {...screenStateToMainScreenProps(screenState)} />;
    case 'ROUND_PODIUM':
      return (
        <ScreenRoundPodiumView
          joinCode={screenState.joinCode}
          cumulative={screenState.cumulative}
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
    default:
      return <ScreenIdleView />;
  }
}

// ── Views par état ────────────────────────────────────────────────────────

function ScreenIdleView(): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen flex flex-col bg-cream relative overflow-hidden">
      <MultiColorBar height="md" />
      <div aria-hidden className="absolute inset-0 pointer-events-none overflow-hidden">
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
          <p className="font-mono text-sm uppercase tracking-[0.3em] text-spritz-deep mb-4">
            {t('common.brand')}
          </p>
          <TitleHandwritten as="h1" className="mb-4 text-7xl">
            <Underline>{t('screen.castTitle')}</Underline>
          </TitleHandwritten>
          <p className="font-editorial italic text-2xl text-ink-2">{t('screen.taglineWaiting')}</p>
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
    <div className="min-h-screen flex flex-col bg-cream">
      <MultiColorBar height="md" />
      <main className="flex-1 grid lg:grid-cols-2 gap-8 p-8 items-center max-w-7xl mx-auto w-full">
        <div className="text-center">
          <p className="font-mono text-sm uppercase tracking-[0.3em] text-spritz-deep mb-3">
            {t('screen.lobbyEyebrow')}
          </p>
          <TitleHandwritten as="h1" className="mb-6 text-6xl">
            <Underline>{sessionName ?? t('common.brand')}</Underline>
          </TitleHandwritten>
          <div className="inline-block bg-cream-2 border-4 border-ink rounded-2xl p-6 shadow-pop-lg">
            <p className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-3">
              {t('screen.scanToJoin')}
            </p>
            <QRCode value={url} size={260} />
            <p className="font-mono text-3xl font-bold tracking-[0.3em] text-ink mt-4">
              {joinCode}
            </p>
            <p className="font-editorial italic text-sm text-ink-soft mt-2">{url}</p>
          </div>
        </div>
        <div className="text-center">
          <p className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-2">
            {t('screen.playersConnected', { count: players.length })}
          </p>
          {players.length === 0 ? (
            <p className="font-editorial italic text-2xl text-ink-2">{t('screen.lobbyWaiting')}</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 max-w-lg mx-auto">
              {players.map((p) => (
                <li
                  key={p.id}
                  className="px-3 py-2 border-2 border-ink rounded bg-white font-medium animate-pop-in flex items-center gap-2"
                >
                  <span
                    aria-hidden
                    className="w-7 h-7 rounded-full border-2 border-ink bg-spritz flex items-center justify-center font-display text-sm shrink-0"
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
      <MultiColorBar height="md" />
    </div>
  );
}

// ScreenPlayingView et ScreenPausedView inline retirés — remplacés par
// MainScreenView via screenStateToMainScreenProps adapter (cf. switch render
// + import en haut). Récupère vinyl rotation, confettis, countdown 15s,
// dance pulse, reveal cover, phase eyebrow, etc. d'un coup.

function ScreenRoundPodiumView({
  joinCode,
  cumulative,
  roundPosition,
}: {
  joinCode: string;
  cumulative: import('@tutti/shared').CumulativeScore[];
  roundPosition: number;
}): JSX.Element {
  const { t } = useTranslation();
  const top5 = cumulative.slice(0, 5);
  return (
    <div className="min-h-screen flex flex-col bg-cream">
      <MultiColorBar height="md" />
      <main className="flex-1 flex flex-col items-center justify-center p-8">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-spritz-deep mb-2">
          {t('screen.roundPodiumEyebrow', { n: roundPosition })}
        </p>
        <TitleHandwritten as="h1" className="text-6xl mb-8">
          <Underline>{t('screen.roundPodiumTitle')}</Underline>
        </TitleHandwritten>
        <ol className="space-y-3 max-w-2xl w-full">
          {top5.map((entry, idx) => (
            <li
              key={entry.id}
              className="flex items-center gap-4 px-5 py-4 border-4 border-ink rounded-xl bg-white shadow-pop"
            >
              <span aria-hidden className="text-3xl">
                {['🥇', '🥈', '🥉', '🎯', '🎯'][idx]}
              </span>
              <span className="font-display text-2xl flex-1 truncate">{entry.label}</span>
              <span className="font-mono text-2xl font-bold">{entry.total_points}</span>
            </li>
          ))}
        </ol>
        <p className="font-editorial italic text-xl text-ink-soft mt-8">
          {t('screen.roundPodiumWaiting')}
        </p>
        <p className="font-mono text-base tracking-[0.3em] text-ink-soft mt-4">{joinCode}</p>
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
    <div className="min-h-screen flex flex-col bg-cream">
      <MultiColorBar height="md" />
      <main className="flex-1 flex flex-col items-center justify-center p-8">
        <p className="font-mono text-sm uppercase tracking-[0.3em] text-spritz-deep mb-3">
          {t('screen.endedEyebrow')}
        </p>
        <h1 className="font-display text-7xl mb-2 text-center">{t('screen.endedTitle')}</h1>
        {winnerName && (
          <p className="font-editorial italic text-3xl text-raspberry mb-8">
            {t('screen.endedWinner', { name: winnerName })}
          </p>
        )}
        {finalScores.length > 0 && (
          <ol className="space-y-3 max-w-2xl w-full mb-8">
            {[first, second, third].filter(Boolean).map((entry, idx) => (
              <li
                key={entry!.id}
                className="flex items-center gap-4 px-5 py-4 border-4 border-ink rounded-xl bg-white shadow-pop-lg"
              >
                <span aria-hidden className="text-4xl">
                  {['🥇', '🥈', '🥉'][idx]}
                </span>
                <span className="font-display text-3xl flex-1 truncate">{entry!.label}</span>
                <span className="font-mono text-2xl font-bold">{entry!.total_points}</span>
              </li>
            ))}
            {rest.length > 0 && (
              <li className="px-5 py-3 border-2 border-ink/30 rounded bg-cream-2/40">
                <ul className="space-y-1">
                  {rest.map((entry, idx) => (
                    <li
                      key={entry.id}
                      className="flex items-center gap-3 font-mono text-sm text-ink-soft"
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
          <p className="font-mono text-xs uppercase tracking-wider text-ink-soft mb-2">
            {t('screen.endedRematch')}
          </p>
          <QRCode value={url} size={140} />
          <p className="font-mono text-lg font-bold tracking-[0.2em] text-ink mt-2">{joinCode}</p>
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
