/**
 * Before the run, on the tests' own stack (stack.ts), never the development one:
 *  1. build and start it, recreating the server so its in-memory per-IP limits start fresh;
 *  2. wipe and reseed its database, keeping the admins' authenticator keys (the seed makes new random ones
 *     each time and prints them only then);
 *  3. sign each project's user in once through the API, so tests reuse the session instead of spending the
 *     server's sign-in limit.
 * The stack keeps running afterwards so the next run starts quickly; `npm run e2e:down` removes it.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { request, type FullConfig } from '@playwright/test';
import { AUTH_DIR, CAPTCHA_ANSWER, SEED_PASSWORD, storageStateFor } from './fixtures.js';
import { compose, repoRoot, stackAddresses } from './stack.js';

function step(message: string): void {
  process.stdout.write(`[e2e setup] ${message}\n`);
}

function startStack(): void {
  step('building and starting the test stack (cultivation-diary-e2e)…');
  // Build explicitly: `up --build` has been seen to keep a stale image.
  compose('build');
  compose('up', '--detach', '--wait', '--force-recreate', 'server', 'web');
}

function reseed(databaseUrl: string): Record<string, string> {
  step('reseeding its database…');
  // DATABASE_URL here wins over the one in .env (Node's --env-file never overrides the environment).
  const output = execFileSync('npm', ['run', '--silent', 'seed', '--', '--reset'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'development' },
  });
  // Lines look like "  SYS_ADMIN     admin           authenticator key: ABC…"
  const keys: Record<string, string> = {};
  for (const match of output.matchAll(/^\s*SYS_ADMIN\s+(\S+)\s+authenticator key: (\S+)/gm)) {
    keys[match[1]!] = match[2]!;
  }
  if (Object.keys(keys).length === 0) throw new Error(`Seed printed no admin keys:\n${output}`);
  return keys;
}

async function saveSession(baseURL: string, username: string): Promise<void> {
  const context = await request.newContext({ baseURL });
  const captcha = (await (await context.get('/api/auth/captcha')).json()) as { id: string };
  const response = await context.post('/api/auth/login', {
    data: {
      username,
      password: SEED_PASSWORD,
      captchaId: captcha.id,
      captchaAnswer: CAPTCHA_ANSWER,
    },
  });
  if (!response.ok()) {
    throw new Error(
      `Signing in ${username} failed (${response.status()} ${await response.text()}). ` +
        'Does .env have CAPTCHA_FIXED=true (the npm run dev:setup default)?',
    );
  }
  await context.storageState({ path: storageStateFor(username) });
  await context.dispose();
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const { baseURL, databaseUrl } = stackAddresses();
  mkdirSync(AUTH_DIR, { recursive: true });
  startStack();
  writeFileSync(new URL('seed.json', AUTH_DIR), JSON.stringify({ totpKeys: reseed(databaseUrl) }));

  const users = new Set(
    config.projects.map((p) => (p.use as { user?: string }).user).filter(Boolean),
  );
  for (const user of users) await saveSession(baseURL, user!);
  step('ready');
}
