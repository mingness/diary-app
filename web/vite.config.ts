import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// The shared package is used from source, so the web app never needs `shared/dist` to be built first.
const sharedSrc = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    // The installable app (spec §9.1, ARCHITECTURE §8.7).
    VitePWA({
      // A new version waits until the user chooses to reload (never while an editor has unsaved changes).
      registerType: 'prompt',
      // Registered from the app (src/components/AppUpdate.tsx), so the CSP needs no inline script.
      injectRegister: null,
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: '修行日記',
        short_name: '修行日記',
        description: '修行日記 · Cultivation Diary',
        lang: 'zh-Hant',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#F6F2EC',
        theme_color: '#7A4E24',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Only the app's own files (spec §9.1, engineering standards §12.4): never an API response, so
        // diary content never sits in the device's cache.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        runtimeCaching: [],
        // Screens are addresses of the one page, offline too; the API is never answered from here.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: { alias: { '@diary/shared': sharedSrc } },
  server: {
    port: 5173,
    // `npm run dev` (the API) listens on :3000; same-origin requests keep the session cookie simple.
    proxy: { '/api': 'http://localhost:3000' },
  },
  build: { sourcemap: false },
});
