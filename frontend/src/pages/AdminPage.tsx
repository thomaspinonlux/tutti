import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../stores/auth.js';
import { api, ApiError } from '../lib/api.js';
import { LanguageSwitch } from '../components/LanguageSwitch.js';
import {
  Button,
  Card,
  Badge,
  MultiColorBar,
  TitleHandwritten,
  Swirl,
} from '../components/ui/index.js';

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
  const { t } = useTranslation();
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
    <main className="min-h-screen flex flex-col">
      <MultiColorBar height="md" />

      <div className="flex-1 px-8 py-10">
        <header className="max-w-5xl mx-auto flex items-center justify-between mb-12 pb-4 border-b-2 border-ink relative">
          <div className="absolute -bottom-0.5 left-0 w-20 h-1.5 bg-spritz" />
          <TitleHandwritten as="h2">{t('common.brand')}</TitleHandwritten>
          <div className="flex items-center gap-3">
            <LanguageSwitch />
            <span className="font-mono text-xs text-ink-soft hidden md:inline">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={() => void handleSignOut()}>
              {t('common.signOut')}
            </Button>
          </div>
        </header>

        <section className="max-w-5xl mx-auto">
          {error && (
            <p role="alert" className="text-raspberry mb-6 font-medium">
              {t('common.error')} : {error}
            </p>
          )}

          {me?.workspace && (
            <Card size="lg">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-3">
                {t('admin.welcomeTo')}
              </p>
              <TitleHandwritten as="h2" className="mb-4">
                <Swirl>{me.workspace.name}</Swirl>
              </TitleHandwritten>

              <div className="flex flex-wrap gap-2 mb-6">
                {me.workspace.establishments.map((est, idx) => (
                  <Badge key={est.id} tone="cream" tilt={idx % 2 === 0 ? -1 : 1}>
                    {est.name}
                  </Badge>
                ))}
              </div>

              <dl className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <Stat label={t('admin.workspaceId')} value={me.workspace.id} mono />
                <Stat label={t('admin.plan')} value={me.workspace.plan} />
                <Stat label={t('admin.role')} value={me.role ?? '—'} accent="basil" />
              </dl>

              <p className="font-editorial italic text-sm text-ink-soft border-l-2 border-cream-4 pl-3">
                {t('admin.upcomingSteps')}
              </p>
            </Card>
          )}

          {!me && !error && (
            <p className="font-mono text-ink-soft animate-fade-in">{t('common.loading')}</p>
          )}
        </section>
      </div>

      <MultiColorBar height="md" />
    </main>
  );
}

function Stat({
  label,
  value,
  mono,
  accent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: 'basil' | 'spritz';
}): JSX.Element {
  const accentClass = accent === 'basil' ? 'text-basil-deep font-bold' : '';
  return (
    <div className="border-2 border-ink rounded p-3 bg-cream-2">
      <dt className="font-mono text-[10px] uppercase tracking-wider text-ink-soft mb-1">{label}</dt>
      <dd className={`${mono ? 'font-mono text-xs break-all' : 'text-base'} ${accentClass}`}>
        {value}
      </dd>
    </div>
  );
}
