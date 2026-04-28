import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth.js';
import { api, ApiError } from '../lib/api.js';

interface MeResponse {
  user: { id: string; email: string | null };
  workspace: {
    id: string;
    name: string;
    plan: string;
    establishments: Array<{ id: string; name: string; default_language: string }>;
  } | null;
  role: string | null;
  hasWorkspace: boolean;
}

export function AdminPage(): JSX.Element {
  const navigate = useNavigate();
  const { user, signOut } = useAuthStore();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const data = await api<MeResponse>('/api/me');
        setMe(data);
      } catch (err: unknown) {
        const msg = err instanceof ApiError ? err.message : (err as Error).message;
        setError(msg);
      }
    })();
  }, []);

  const handleSignOut = async (): Promise<void> => {
    await signOut();
    navigate('/', { replace: true });
  };

  return (
    <main className="min-h-screen p-8 bg-cream text-ink">
      <header className="max-w-5xl mx-auto flex items-center justify-between mb-12 pb-4 border-b-2 border-ink">
        <h1 className="text-3xl font-bold">Tutti</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm font-mono text-ink/70">{user?.email}</span>
          <button
            onClick={() => void handleSignOut()}
            className="px-3 py-1 border-2 border-ink rounded bg-white hover:bg-raspberry hover:text-white transition-colors text-sm font-medium"
          >
            Déconnexion
          </button>
        </div>
      </header>

      <section className="max-w-5xl mx-auto">
        {error && (
          <p role="alert" className="text-raspberry mb-6">
            Erreur : {error}
          </p>
        )}

        {me && (
          <div className="border-2 border-ink rounded-lg p-8 bg-white shadow-[8px_8px_0_0_#1a1410]">
            <h2 className="text-2xl font-bold mb-2">
              Bienvenue dans <span className="text-spritz">{me.workspace?.name ?? '…'}</span>
            </h2>
            {me.workspace && (
              <>
                <p className="text-sm text-ink/60 italic mb-6">
                  Établissements : {me.workspace.establishments.map((e) => e.name).join(', ')}
                </p>
                <dl className="text-sm font-mono space-y-1 mb-6">
                  <div className="flex gap-2">
                    <dt className="text-ink/60 w-24">Workspace ID:</dt>
                    <dd>{me.workspace.id}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-ink/60 w-24">Plan:</dt>
                    <dd>{me.workspace.plan}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-ink/60 w-24">Rôle:</dt>
                    <dd className="text-basil font-bold">{me.role}</dd>
                  </div>
                </dl>
                <p className="text-sm text-ink/60 italic">
                  Étapes 4-15 du plan de dev à venir : i18n, design system Pop Cocktail, jeux Tutti
                  Tracks et Tutti Quizz…
                </p>
              </>
            )}
          </div>
        )}

        {!me && !error && <p className="font-mono text-ink/60">Chargement…</p>}
      </section>
    </main>
  );
}
