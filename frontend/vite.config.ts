import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
//
// feat/pwa-installable — manifest + Workbox service worker.
//
// Stratégie cache :
//   - Assets statiques (JS/CSS/fonts/images/icons) : précachés à l'install (SW)
//     puis servis depuis le cache. registerType 'autoUpdate' : un nouveau deploy
//     s'active TOUT SEUL au prochain (ré)ouverture de l'app (skipWaiting +
//     clientsClaim + reload auto injecté par vite-plugin-pwa). Plus de bouton
//     "Recharger" à cliquer → fini les clients coincés sur un vieux bundle.
//     Le reload n'arrive qu'au chargement de la page (jamais en pleine partie :
//     la vérif périodique en session est retirée côté usePwa).
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
      registerType: 'autoUpdate',
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
        // Précache : tous les assets buildés (JS/CSS) + assets statiques de
        // includeAssets (fonts, icônes…).
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        // Les gros chunks lazy (parseurs Excel/PDF de l'import « Coller une
        // liste ») sont chargés à la demande → on les exclut du précache pour
        // ne pas alourdir l'install PWA de ~900 Ko inutiles.
        globIgnores: ['**/{xlsx,pdf}-*.js'],
        // 5MB cap pour éviter de précacher des fichiers énormes (vidéos
        // landing dans public/videos/).
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // NE PAS intercepter /api/* (live data) ni /socket.io/* (websocket).
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io\//],
        // fix/csp-meta-tag-and-cover-fallback — SW nouvellement installé
        // devient actif immédiatement (skipWaiting) + reprend le contrôle
        // des onglets ouverts (clientsClaim). Combiné : nouveau deploy =
        // nouveau index.html (avec nouveau meta CSP) appliqué sans clic
        // "Recharger" sur PwaUpdateBanner.
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
