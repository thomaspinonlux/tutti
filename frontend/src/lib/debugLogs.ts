/**
 * debugLogs.ts — feat/debug-audio-overlay
 *
 * Capture des logs `console.{log,info,warn,error}` qui contiennent les tags
 * `[Audio]`, `[Player]`, `[PWA]` ou `[YouTube]`. Stocke dans un ring buffer
 * de 100 entries exposé via :
 *   - subscribe(cb) → notifié à chaque nouveau log
 *   - getLogs() → snapshot courant
 *
 * L'overlay React (DebugOverlay.tsx) consomme ces helpers pour afficher en
 * temps réel les logs sur l'écran du PWA (où Thomas n'a pas accès à
 * l'Inspecteur web).
 *
 * Activation :
 *   - URL `?debug=audio`
 *   - OU localStorage `debugAudio=true`
 *   - Sinon : pas d'overlay rendu (le capture reste actif par souci de
 *     symétrie mais n'est pas observable).
 */

const TAG_REGEX =
  /\[(Audio|Player|PWA|YouTube|Spotify SDK|Deepgram|AssemblyAI|Whisper|Voice|HostContentBoundary|HostPageTopLevel)\]/;
const MAX_LOGS = 100;

export interface DebugLogEntry {
  ts: number; // Date.now()
  level: 'log' | 'info' | 'warn' | 'error';
  text: string;
}

type Subscriber = (logs: readonly DebugLogEntry[]) => void;

const logs: DebugLogEntry[] = [];
const subscribers = new Set<Subscriber>();

function notify(): void {
  // Copie défensive pour éviter mutation cliente sur l'array interne.
  const snapshot = logs.slice();
  for (const sub of subscribers) {
    try {
      sub(snapshot);
    } catch {
      /* noop — un sub buggué ne doit pas casser les autres */
    }
  }
}

function pushLog(level: DebugLogEntry['level'], args: unknown[]): void {
  // Stringify defensive : tolère erreurs / circular refs.
  const text = args
    .map((a) => {
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
  if (!TAG_REGEX.test(text)) return;
  logs.push({ ts: Date.now(), level, text });
  if (logs.length > MAX_LOGS) logs.shift();
  notify();
}

let installed = false;

/**
 * Installe les wrappers `console.*`. Idempotent. Conserve les implémentations
 * d'origine pour le passthrough complet.
 */
export function installDebugLogCapture(): void {
  if (installed) return;
  installed = true;
  const orig = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };
  console.log = (...args: unknown[]): void => {
    pushLog('log', args);
    orig.log(...args);
  };
  console.info = (...args: unknown[]): void => {
    pushLog('info', args);
    orig.info(...args);
  };
  console.warn = (...args: unknown[]): void => {
    pushLog('warn', args);
    orig.warn(...args);
  };
  console.error = (...args: unknown[]): void => {
    pushLog('error', args);
    orig.error(...args);
  };
}

export function subscribeDebugLogs(cb: Subscriber): () => void {
  subscribers.add(cb);
  // Push état initial pour que le subscriber ait quelque chose à afficher.
  cb(logs.slice());
  return () => {
    subscribers.delete(cb);
  };
}

export function getDebugLogs(): readonly DebugLogEntry[] {
  return logs.slice();
}

export function clearDebugLogs(): void {
  logs.length = 0;
  notify();
}

/**
 * True si l'overlay doit être visible :
 *   - URL `?debug=audio`
 *   - OU localStorage `debugAudio=true`
 */
export function isDebugOverlayActive(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('debug') === 'audio') return true;
  } catch {
    /* noop */
  }
  try {
    if (localStorage.getItem('debugAudio') === 'true') return true;
  } catch {
    /* noop */
  }
  return false;
}
