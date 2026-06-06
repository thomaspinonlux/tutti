import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
//
// feat/pwa-installable — manifest + Workbox service worker.
//
// Stratégie cache :
//   - Assets statiques (JS/CSS/fonts/images/icons) : précachés à l'install (SW)
//     puis servis depuis le cache. Auto-update à la nouvelle version (registerType
//     'prompt' + bouton "Recharger" déclenche skipWaiting).
//   - API calls (/api/*) : exclus du cache (NetworkOnly) — données live, pas de
//     stale jamais.
//   - Socket.IO (/socket.io/*) : exclus aussi (long-poll + ws, jamais cacheable).
//
// La PWA cible surtout le HOST (qui veut un feeling app pro sur sa tablette).
// Les joueurs scannent un QR et restent dans le navigateur — le SW ne casse
// rien pour eux (cache HIT transparent + appels API direct réseau).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: 'auto',
      includeAssets: [
        'favicon.ico',
        'favicon-16x16.png',
        'favicon-32x32.png',
        'logo-monogram-dark.svg',
        'logo-wordmark-dark.svg',
        'logo-wordmark-light.svg',
        'fonts/*.woff2',
        'icons/*.png',
      ],
      manifest: {
        name: 'Tutti — Blind test & quiz',
        short_name: 'Tutti',
        description: 'Le blind test & quiz premium pour vos soirées',
        start_url: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#fefae0',
        theme_color: '#e76f51',
        lang: 'fr',
        categories: ['games', 'entertainment', 'music'],
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Précache : assets buildés (JS/CSS hashés) + HTML + assets statiques
        // de includeAssets (fonts, icônes…).
        //
        // fix/csp-definitive-and-covers-fallback — `index.html` reste précaché
        // (sinon createHandlerBoundToURL("index.html") throw au SW install).
        // Le fix pour la CSP cached vient de skipWaiting+clientsClaim : à
        // chaque deploy, le SW nouvellement installé prend immédiatement la
        // main, refresh la précache (donc une nouvelle copie de index.html
        // avec nouveaux headers CSP) et la sert aux navigations suivantes.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        // 5MB cap pour éviter de précacher des fichiers énormes.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // NE PAS intercepter /api/* (live data) ni /socket.io/* (websocket).
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io\//],
        // skipWaiting : le SW nouvellement installé devient actif sans
        // attendre la fermeture des onglets. clientsClaim : il reprend
        // immédiatement le contrôle des onglets ouverts. Combinés : nouveau
        // SW = nouveau comportement appliqué instantanément.
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            // Google Fonts (CSS) — StaleWhileRevalidate, expire 7j.
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            // Google Fonts (woff2) — CacheFirst, expire 1 an.
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        // SW dispo en dev pour tester install/update flows. Désactive si gênant
        // (HMR + SW peuvent se marcher dessus).
        enabled: false,
        type: 'module',
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: false,
  },
  preview: {
    port: 4173,
  },
});
