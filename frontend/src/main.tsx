import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './styles/landing.css';
import './i18n/index.ts';
import App from './App.tsx';
// feat/debug-audio-overlay — installe le wrapper console.* AVANT le render
// pour capturer même les logs émis pendant le bootstrap (registerSW, audio
// unlock initial…). Idempotent.
import { installDebugLogCapture } from './lib/debugLogs.ts';
installDebugLogCapture();

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element #root introuvable dans index.html');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
