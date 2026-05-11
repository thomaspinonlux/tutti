/**
 * <SuperAdminRouteGuard /> — layout route qui bloque l'accès aux pages
 * super-admin pour les comptes non super-admin (fix/admin-users-integration).
 *
 * Utilisation dans App.tsx, en nesting sous AdminLayout :
 *
 *   <Route path="/admin" element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
 *     <Route path="dashboard" element={<DashboardPage />} />
 *     <Route element={<SuperAdminRouteGuard />}>
 *       <Route path="users" element={<UsersPage />} />
 *       <Route path="library" element={<LibraryPage />} />
 *       …
 *     </Route>
 *   </Route>
 *
 * Si me.isSuperAdmin === false → redirect /admin/dashboard. Pendant le
 * chargement de getMe(), affiche le même message neutre que AdminLayout.
 * Le check backend (requireSuperAdmin sur /api/admin/*) reste la vraie
 * sécurité ; cette barrière frontend évite juste un flash 403 cosmétique.
 */

import { Navigate, Outlet } from 'react-router-dom';
import { useEstablishment, type EstablishmentContext } from '../../pages/admin/AdminLayout.js';

export function SuperAdminRouteGuard(): JSX.Element {
  const ctx = useEstablishment();
  const { me } = ctx;
  if (!me) {
    return <p className="font-mono text-ink-soft animate-fade-in">Chargement…</p>;
  }
  if (!me.isSuperAdmin) {
    return <Navigate to="/admin/dashboard" replace />;
  }
  // fix/super-admin-routes-broken — bug critique : <Outlet /> sans `context`
  // wrap les enfants dans un nouveau OutletContext.Provider value=undefined,
  // ce qui casse useOutletContext() / useEstablishment() côté SuperAdminPage
  // (qui consomme le ctx pour le check me.isSuperAdmin et autres). On
  // re-forward explicitement le ctx parent (AdminLayout).
  return <Outlet context={ctx satisfies EstablishmentContext} />;
}
