import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { initAuth } from './stores/auth.js';
import { HomePage } from './pages/HomePage.js';
import { LoginPage } from './pages/LoginPage.js';
import { SignupPage } from './pages/SignupPage.js';
import { AdminPage } from './pages/AdminPage.js';
import { ProtectedRoute } from './components/auth/ProtectedRoute.js';

// Lazy import : le chunk n'est jamais demandé en prod (route absente),
// donc le bundle principal reste léger.
const DesignSystemPage = lazy(() =>
  import('./pages/DesignSystemPage.js').then((m) => ({ default: m.DesignSystemPage })),
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
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <AdminPage />
            </ProtectedRoute>
          }
        />
        {/* Design system : visible uniquement en dev (build local). */}
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
