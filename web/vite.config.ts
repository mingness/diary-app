import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The shared package is used from source, so the web app never needs `shared/dist` to be built first.
const sharedSrc = fileURLToPath(new URL('../shared/src/index.ts', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@diary/shared': sharedSrc } },
  server: {
    port: 5173,
    // `npm run dev` (the API) listens on :3000; same-origin requests keep the session cookie simple.
    proxy: { '/api': 'http://localhost:3000' },
  },
  build: { sourcemap: false },
});
