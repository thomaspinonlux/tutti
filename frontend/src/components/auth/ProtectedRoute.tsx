/**
 * <ProtectedRoute /> — redirige vers /auth/login si pas de session.
 *
 * À utiliser dans le router pour wrapper les pages protégées :
 *   <Route path="/admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
 */

import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/auth.js';

interface Props {
  children: ReactNode;
}

export function ProtectedRoute({ children }: Props): JSX.Element {
  const { t } = useTranslation();
  const { session, loading } = useAuthStore();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream">
        <p className="font-mono text-ink/60">{t('common.loading')}</p>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/auth/login" replace />;
  }

  return <>{children}</>;
}
