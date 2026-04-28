import { useEffect, useState } from 'react';
import type { HealthResponse } from '@tutti/shared';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

type HealthState =
  | { kind: 'loading' }
  | { kind: 'ok'; data: HealthResponse }
  | { kind: 'error'; message: string };

function App(): JSX.Element {
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_URL}/api/health`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as HealthResponse;
        setHealth({ kind: 'ok', data });
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        const message = err instanceof Error ? err.message : 'Erreur inconnue';
        setHealth({ kind: 'error', message });
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 bg-cream text-ink">
      <h1 className="text-5xl font-bold mb-2">Tutti</h1>
      <p className="text-lg text-ink/70 mb-8 italic">Hello World — Étape 1</p>

      <section
        className="border-2 border-ink rounded-lg p-6 bg-white shadow-[6px_6px_0_0_#1a1410] max-w-md w-full"
        aria-live="polite"
      >
        <h2 className="text-sm font-mono uppercase tracking-wider text-spritz mb-3">
          Backend status
        </h2>
        {health.kind === 'loading' && <p>Connexion au backend…</p>}
        {health.kind === 'ok' && (
          <dl className="text-sm font-mono space-y-1">
            <div className="flex gap-2">
              <dt className="text-ink/60">status:</dt>
              <dd className="text-basil font-bold">{health.data.status}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink/60">version:</dt>
              <dd>{health.data.version}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink/60">uptime:</dt>
              <dd>{health.data.uptime.toFixed(2)}s</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink/60">timestamp:</dt>
              <dd className="text-xs">{health.data.timestamp}</dd>
            </div>
          </dl>
        )}
        {health.kind === 'error' && (
          <p className="text-raspberry">
            Backend injoignable : <span className="font-mono">{health.message}</span>
          </p>
        )}
      </section>
    </main>
  );
}

export default App;
