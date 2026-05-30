/**
 * Tutti — racine du routeur.
 *
 * IMPORTANT : toute nouvelle route doit respecter la stratégie responsive
 * documentée dans `docs/RESPONSIVE.md`. En résumé :
 *   - mobile-first systématique
 *   - /admin/*  : bloqué sub-md, 2 cols md→xl (panel en modale), 3 cols xl+
 *   - /host     : bloqué sub-lg, 2x2 lg→xl, 4 cols xl+
 *   - /screen   : adaptatif lg→2xl, polices XL en 2xl pour TV
 *   - /play     : mobile-first absolu, max-w-[500px] centré sur grands écrans
 *   - public    : 360 px → 2xl
 *
 * Outils dispo : <MinScreen min="md|lg|xl"> + useBreakpoint().
 */

import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { initAuth } from './stores/auth.js';
import { HomePage } from './pages/HomePage.js';
import { LoginPage } from './pages/LoginPage.js';
import { SignupPage } from './pages/SignupPage.js';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage.js';
import { ResetPasswordPage } from './pages/ResetPasswordPage.js';
import { AdminLayout } from './pages/admin/AdminLayout.js';
import { DashboardPage } from './pages/admin/DashboardPage.js';
import { TracksPage } from './pages/admin/TracksPage.js';
import { QuizzPage } from './pages/admin/QuizzPage.js';
import { SettingsPage } from './pages/admin/SettingsPage.js';
import { AccountPage } from './pages/admin/AccountPage.js';
import { SuperAdminPage } from './pages/admin/SuperAdminPage.js';
import { VoiceAnalyticsPage } from './pages/admin/VoiceAnalyticsPage.js';
import { UsersPage } from './pages/admin/UsersPage.js';
import { UserDetailPage } from './pages/admin/UserDetailPage.js';
import { ImportPlaylistPage } from './pages/admin/ImportPlaylistPage.js';
import { LibraryPage } from './pages/admin/LibraryPage.js';
import { LibraryPlaylistDetailPage } from './pages/admin/LibraryPlaylistDetailPage.js';
import { LibraryQuizPackDetailPage } from './pages/admin/LibraryQuizPackDetailPage.js';
import { LibraryAuditPage } from './pages/admin/LibraryAuditPage.js';
import { ProtectedRoute } from './components/auth/ProtectedRoute.js';
import { SuperAdminRouteGuard } from './components/auth/SuperAdminRouteGuard.js';
import { PrivacyPage } from './pages/legal/PrivacyPage.js';
import { TermsPage } from './pages/legal/TermsPage.js';
import { PwaUpdateBanner } from './components/PwaUpdateBanner.js';

// Lazy : chunks dédiés aux pages volumineuses (audio, dnd, qrcode, socket.io…)
const DesignSystemPage = lazy(() =>
  import('./pages/DesignSystemPage.js').then((m) => ({ default: m.DesignSystemPage })),
);
const PlaylistEditPage = lazy(() =>
  import('./pages/admin/PlaylistEditPage.js').then((m) => ({ default: m.PlaylistEditPage })),
);
const QuizzPackEditPage = lazy(() =>
  import('./pages/admin/QuizzPackEditPage.js').then((m) => ({ default: m.QuizzPackEditPage })),
);
const SessionConfigPage = lazy(() =>
  import('./pages/admin/SessionConfigPage.js').then((m) => ({ default: m.SessionConfigPage })),
);
const HostPage = lazy(() => import('./pages/HostPage.js').then((m) => ({ default: m.HostPage })));
const PlayPage = lazy(() => import('./pages/PlayPage.js').then((m) => ({ default: m.PlayPage })));
const ScreenPage = lazy(() =>
  import('./pages/ScreenPage.js').then((m) => ({ default: m.ScreenPage })),
);

function App(): JSX.Element {
  useEffect(() => {
    const cleanup = initAuth();
    return cleanup;
  }, []);

  return (
    <BrowserRouter>
      {/* feat/pwa-installable — banner global non-modal. S'affiche quand le SW
          a téléchargé une nouvelle version, propose un reload manuel. JAMAIS
          d'auto-reload (casserait une partie host en cours). */}
      <PwaUpdateBanner />
      <Routes>
        <Route path="/" element={<HomePage />} />

        {/* feat/youtube-compliance — pages légales publiques (Privacy/Terms)
            requises par YouTube API Services. Liées depuis footer + signup. */}
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        {/* Compat ancien lien footer landing ("/cgu" historiquement). */}
        <Route path="/cgu" element={<Navigate to="/terms" replace />} />

        <Route path="/auth/signup" element={<SignupPage />} />
        <Route path="/auth/login" element={<LoginPage />} />
        <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/auth/reset-password" element={<ResetPasswordPage />} />

        {/* Espace admin protégé : toutes les sous-routes héritent du layout. */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="tracks" element={<TracksPage />} />
          <Route
            path="tracks/:id"
            element={
              <Suspense fallback={null}>
                <PlaylistEditPage />
              </Suspense>
            }
          />
          <Route path="quizz" element={<QuizzPage />} />
          <Route
            path="quizz/:id"
            element={
              <Suspense fallback={null}>
                <QuizzPackEditPage />
              </Suspense>
            }
          />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="account" element={<AccountPage />} />
          <Route path="import-playlist" element={<ImportPlaylistPage />} />
          <Route
            path="sessions/new"
            element={
              <Suspense fallback={null}>
                <SessionConfigPage />
              </Suspense>
            }
          />

          {/* Routes super-admin only — gardées par SuperAdminRouteGuard. */}
          {/* Le backend gate aussi via requireSuperAdmin sur /api/admin/*. */}
          <Route element={<SuperAdminRouteGuard />}>
            <Route path="super-admin" element={<SuperAdminPage />} />
            <Route path="voice-analytics" element={<VoiceAnalyticsPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="users/:id" element={<UserDetailPage />} />
            <Route path="library" element={<LibraryPage />} />
            <Route path="library/audit" element={<LibraryAuditPage />} />
            <Route path="library/playlists/:id" element={<LibraryPlaylistDetailPage />} />
            <Route path="library/quiz-packs/:id" element={<LibraryQuizPackDetailPage />} />
          </Route>
        </Route>

        {/* Pages session : /host (host iPad) et /play (joueur mobile). */}
        <Route
          path="/host"
          element={
            <ProtectedRoute>
              <Suspense fallback={null}>
                <HostPage />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/play"
          element={
            <Suspense fallback={null}>
              <PlayPage />
            </Suspense>
          }
        />
        <Route
          path="/screen"
          element={
            <Suspense fallback={null}>
              <ScreenPage />
            </Suspense>
          }
        />

        {/* Design system : visible uniquement en dev. */}
        {import.meta.env.DEV && (
          <Route
            path="/_design-system"
            element={
              <Suspense fallback={null}>
                <DesignSystemPage />
              </Suspense>
            }
          />
        )}

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
