/**
 * <AdminLayout /> — coque de l'espace admin (sidebar + main content via Outlet).
 *
 * Wrappé par <ProtectedRoute /> dans App.tsx.
 * Bloque la navigation sous `md` (cf. docs/RESPONSIVE.md).
 * L'établissement courant est fetché une fois ici et exposé aux pages enfants
 * via useOutletContext (cf. type EstablishmentContext).
 */

import { useEffect, useState } from 'react';
import { Outlet, useOutletContext } from 'react-router-dom';
import { Sidebar } from '../../components/admin/Sidebar.js';
import { MobileNav } from '../../components/admin/MobileNav.js';
// MinScreen retiré — admin utilisable depuis tout écran (iPhone 375px inclus).
import { api, ApiError } from '../../lib/api.js';
import { MultiColorBar } from '../../components/ui/index.js';
import { ResumeSessionBanner } from '../../components/admin/ResumeSessionBanner.js';
import { getMe, type MeResponse } from '../../lib/me.js';
import { PendingApprovalScreen } from '../../components/auth/PendingApprovalScreen.js';

export interface Establishment {
  id: string;
  workspace_id: string;
  name: string;
  branding_color: string | null;
  branding_logo: string | null;
  default_language: string;
  active_providers: string[];
  created_at: string;
  updated_at: string;
}

export interface EstablishmentContext {
  establishment: Establishment | null;
  refetch: () => Promise<void>;
  loading: boolean;
  error: string | null;
  me: MeResponse | null;
}

export function AdminLayout(): JSX.Element {
  const [establishment, setEstablishment] = useState<Establishment | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [meLoading, setMeLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEstablishment = async (): Promise<void> => {
    console.log('[DBG AdminLayout] fetchEstablishment START');
    try {
      const data = await api<{ establishment: Establishment }>('/api/establishment');
      console.log('[DBG AdminLayout] fetchEstablishment OK', { id: data.establishment.id });
      setEstablishment(data.establishment);
      setError(null);
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      console.error('[DBG AdminLayout] fetchEstablishment ERROR', msg);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const fetchMe = async (): Promise<void> => {
    console.log('[DBG AdminLayout] fetchMe START');
    try {
      const data = await getMe();
      console.log('[DBG AdminLayout] fetchMe OK', {
        memberStatus: data.memberStatus,
        isSuperAdmin: data.isSuperAdmin,
      });
      setMe(data);
    } catch (err) {
      
      setLoading(false);
      setError((err as Error).message ?? 'getMe failed');
    } finally {
      setMeLoading(false);
    }
  };

  useEffect(() => {
    console.log('[DBG AdminLayout] MOUNTED');
    void fetchMe();
    return () => {
      console.log('[DBG AdminLayout] UNMOUNTED');
    };
  }, []);

  // Phase 4 — ne fetch establishment que si le compte est APPROVED ou super admin.
  // Sinon on évite le 403 cosmétique côté API et on affiche directement le pending screen.
  useEffect(() => {
    console.log('[DBG AdminLayout] me changed →', me ? me.memberStatus : null);
    if (!me) return;
    if (me.memberStatus === 'APPROVED' || me.isSuperAdmin) {
      void fetchEstablishment();
    } else {
      setLoading(false);
    }
  }, [me]);

  // Phase 4e — pending / rejected → écran bloquant
  if (!meLoading && me && !me.isSuperAdmin) {
    if (me.memberStatus === 'PENDING' || me.memberStatus === 'REJECTED') {
      return (
        <PendingApprovalScreen
          status={me.memberStatus}
          email={me.user.email}
          onApproved={() => void fetchMe()}
        />
      );
    }
  }

  const ctx: EstablishmentContext = {
    establishment,
    refetch: fetchEstablishment,
    loading,
    error,
    me,
  };

  // Admin accessible TOUTES tailles d'écran (incluant iPhone 375px).
  // Sidebar masquée sub-md (`hidden md:flex` interne) + MobileNav bottom-fixed
  // sub-md. Plus de blocage MinScreen — toutes les pages admin utilisables
  // depuis n'importe quel mobile moderne.
  return (
    <div className="min-h-screen flex bg-cream">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 pb-[60px] md:pb-0">
        <MultiColorBar height="sm" />
        <ResumeSessionBanner />
        <main className="flex-1 px-4 sm:px-6 md:px-10 py-4 sm:py-8">
          <Outlet context={ctx} />
        </main>
      </div>
      <MobileNav />
    </div>
  );
}

/** Hook utilitaire pour récupérer le contexte établissement dans une page admin. */
export function useEstablishment(): EstablishmentContext {
  return useOutletContext<EstablishmentContext>();
}
