import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Resolve everything from the repo root, so the same config works from `npm test` at the root or in server/.
const root = fileURLToPath(new URL('.', import.meta.url));
const alias = { '@diary/shared': `${root}shared/src/index.ts` };

// Local runs read TEST_DATABASE_URL from .env (written by `npm run dev:setup`); CI sets it directly.
if (existsSync(`${root}.env`)) process.loadEnvFile(`${root}.env`);

export default defineConfig({
  root,
  test: {
    coverage: {
      provider: 'v8',
      include: ['server/src/**', 'shared/src/**'],
      exclude: ['server/src/main.ts'],
      reporter: ['text-summary', 'html', 'lcov'],
      reportsDirectory: `${root}coverage`,
    },
    projects: [
      {
        root,
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['server/test/unit/**/*.test.ts', 'shared/test/**/*.test.ts'],
        },
      },
      {
        root,
        resolve: { alias },
        test: {
          name: 'integration',
          include: ['server/test/integration/**/*.test.ts'],
          // Each file creates its own database, so files can run in parallel.
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
