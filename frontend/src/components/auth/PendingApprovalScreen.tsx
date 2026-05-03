/**
 * <PendingApprovalScreen /> — Phase 4e
 *
 * Affiché aux utilisateurs dont le WorkspaceMember est en status PENDING
 * (file d'attente Mode C) ou REJECTED. Page bloquante avec CTA contact +
 * code invitation.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/auth.js';
import { api } from '../../lib/api.js';
import { Button, Card, Input, MultiColorBar, TitleHandwritten, Underline } from '../ui/index.js';

interface Props {
  status: 'PENDING' | 'REJECTED';
  email: string | null;
  /** Callback quand l'utilisateur a réussi à valider via code invitation. */
  onApproved?: () => void;
}

export function PendingApprovalScreen({ status, email, onApproved }: Props): JSX.Element {
  const { t } = useTranslation();
  const { signOut } = useAuthStore();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmitCode = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      // On rappelle /api/auth/initialize avec le code. Si déjà créé, le
      // backend détectera l'existing member et ne réessaiera pas la logique
      // d'approbation. → On force la création initiale via un upgrade endpoint.
      // V1 simple : on demande au user de se reconnecter après validation
      // par un super admin, ou on ouvre un endpoint /api/me/redeem-invitation.
      // Pour V1 on POST sur un nouvel endpoint dédié.
      await api('/api/me/redeem-invitation', {
        method: 'POST',
        body: { invitationCode: code.trim().toUpperCase() },
      });
      onApproved?.();
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const eyebrow = status === 'PENDING' ? t('auth.pendingEyebrow') : t('auth.rejectedEyebrow');
  const title = status === 'PENDING' ? t('auth.pendingTitle') : t('auth.rejectedTitle');
  const body = status === 'PENDING' ? t('auth.pendingBody') : t('auth.rejectedBody');

  return (
    <div className="min-h-screen flex flex-col bg-cream">
      <MultiColorBar height="md" />
      <main className="flex-1 flex items-center justify-center p-6">
        <Card size="lg" tone="cream" className="max-w-xl w-full text-center">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-spritz-deep mb-3">
            {eyebrow}
          </p>
          <TitleHandwritten as="h1" className="mb-4">
            <Underline>{title}</Underline>
          </TitleHandwritten>
          <p className="font-editorial italic text-ink-2 mb-2">{body}</p>
          {email && (
            <p className="font-mono text-xs text-ink-soft mb-6">
              {t('auth.pendingAccountLabel')} {email}
            </p>
          )}

          {status === 'PENDING' && (
            <form onSubmit={handleSubmitCode} className="space-y-3 text-left mt-6">
              <p className="font-mono text-xs uppercase tracking-wider text-ink-soft">
                {t('auth.pendingCodeLabel')}
              </p>
              <Input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder={t('auth.pendingCodePlaceholder')}
                autoComplete="off"
                maxLength={16}
              />
              {error && (
                <p role="alert" className="text-sm text-raspberry">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                variant="primary"
                size="md"
                disabled={busy || !code.trim()}
                className="w-full"
              >
                {busy ? t('common.loading') : t('auth.pendingCodeSubmit')}
              </Button>
            </form>
          )}

          <div className="mt-6 pt-6 border-t-2 border-ink/10">
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              {t('auth.signOut')}
            </Button>
          </div>
        </Card>
      </main>
      <MultiColorBar height="md" />
    </div>
  );
}
