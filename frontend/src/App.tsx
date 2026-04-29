import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { initAuth } from './stores/auth.js';
import { HomePage } from './pages/HomePage.js';
import { LoginPage } from './pages/LoginPage.js';
import { SignupPage } from './pages/SignupPage.js';
import { AdminLayout } from './pages/admin/AdminLayout.js';
import { DashboardPage } from './pages/admin/DashboardPage.js';
import { TracksPage } from './pages/admin/TracksPage.js';
import { QuizzPage } from './pages/admin/QuizzPage.js';
import { SettingsPage } from './pages/admin/SettingsPage.js';
import { AccountPage } from './pages/admin/AccountPage.js';
import { ProtectedRoute } from './components/auth/ProtectedRoute.js';

// Lazy : chunks dédiés aux pages volumineuses
const DesignSystemPage = lazy(() =>
  import('./pages/DesignSystemPage.js').then((m) => ({ default: m.DesignSystemPage })),
);
const PlaylistEditPage = lazy(() =>
  import('./pages/admin/PlaylistEditPage.js').then((m) => ({ default: m.PlaylistEditPage })),
);

function App(): JSX.Element {
  useEffect(() => {
    const cleanup = initAuth();
    return cleanup;
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/auth/signup" element={<SignupPage />} />
        <Route path="/auth/login" element={<LoginPage />} />

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
          <Route path="settings" element={<SettingsPage />} />
          <Route path="account" element={<AccountPage />} />
        </Route>

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
