/**
 * <AdminLayout /> — coque de l'espace admin (sidebar + main content via Outlet).
 *
 * Wrappé par <ProtectedRoute /> dans App.tsx.
 * L'établissement courant est fetché une fois ici et exposé aux pages enfants
 * via useOutletContext (cf. type EstablishmentContext).
 */

import { useEffect, useState } from 'react';
import { Outlet, useOutletContext } from 'react-router-dom';
import { Sidebar } from '../../components/admin/Sidebar.js';
import { api, ApiError } from '../../lib/api.js';
import { MultiColorBar } from '../../components/ui/index.js';

export interface Establishment {
  id: string;
  workspace_id: string;
  name: string;
  branding_color: string | null;
  branding_logo: string | null;
  default_language: string;
  active_provider: string;
  created_at: string;
  updated_at: string;
}

export interface EstablishmentContext {
  establishment: Establishment | null;
  refetch: () => Promise<void>;
  loading: boolean;
  error: string | null;
}

export function AdminLayout(): JSX.Element {
  const [establishment, setEstablishment] = useState<Establishment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEstablishment = async (): Promise<void> => {
    try {
      const data = await api<{ establishment: Establishment }>('/api/establishment');
      setEstablishment(data.establishment);
      setError(null);
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchEstablishment();
  }, []);

  const ctx: EstablishmentContext = {
    establishment,
    refetch: fetchEstablishment,
    loading,
    error,
  };

  return (
    <div className="min-h-screen flex bg-cream">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <MultiColorBar height="sm" />
        <main className="flex-1 px-6 md:px-10 py-8">
          <Outlet context={ctx} />
        </main>
      </div>
    </div>
  );
}

/** Hook utilitaire pour récupérer le contexte établissement dans une page admin. */
export function useEstablishment(): EstablishmentContext {
  return useOutletContext<EstablishmentContext>();
}
