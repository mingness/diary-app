/**
 * The end-to-end tests' own copy of the Docker stack: Compose project `cultivation-diary-e2e`, with its own
 * database volume and the ports in `stack.env`, so reseeding it never touches development data.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const PROJECT = 'cultivation-diary-e2e';
export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const stackEnvFile = fileURLToPath(new URL('./stack.env', import.meta.url));

function envFrom(file: string): Record<string, string | undefined> {
  return parseEnv(readFileSync(file, 'utf8'));
}

/** Where the test stack listens, and how to reach its database from this machine (for the seed). */
export function stackAddresses() {
  const stack = envFrom(stackEnvFile);
  const { POSTGRES_PASSWORD } = envFrom(`${repoRoot}.env`);
  if (!POSTGRES_PASSWORD) throw new Error('No POSTGRES_PASSWORD in .env: run npm run dev:setup');
  return {
    baseURL: `http://localhost:${stack.WEB_PORT}`,
    databaseUrl: `postgres://diary:${POSTGRES_PASSWORD}@localhost:${stack.DB_PORT}/diary`,
  };
}

/**
 * Runs `docker compose` on the test project. `DOCKER` overrides the command, e.g.
 * `DOCKER="flatpak-spawn --host docker"` from a sandboxed editor terminal (AGENTS.md, known pitfalls).
 */
export function compose(...args: string[]): void {
  const [command = 'docker', ...prefix] = (process.env.DOCKER ?? 'docker').split(' ');
  execFileSync(
    command,
    [
      ...prefix,
      'compose',
      '--project-name',
      PROJECT,
      '--project-directory',
      repoRoot,
      '--file',
      `${repoRoot}compose.yaml`,
      '--env-file',
      `${repoRoot}.env`,
      '--env-file',
      stackEnvFile,
      ...args,
    ],
    { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] },
  );
}
