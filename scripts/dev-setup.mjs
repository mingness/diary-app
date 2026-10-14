#!/usr/bin/env node
/**
 * Writes .env for local development with freshly generated throwaway keys (engineering standards §12.3:
 * dev never uses production keys). Refuses to overwrite an existing .env unless --force is given.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const target = new URL('../.env', import.meta.url);
const template = new URL('../.env.example', import.meta.url);

if (existsSync(target) && !process.argv.includes('--force')) {
  console.log('.env already exists; leaving it alone (use --force to regenerate).');
  process.exit(0);
}

const hex = (bytes) => randomBytes(bytes).toString('hex');
const dbPassword = hex(16);
const generated = {
  POSTGRES_PASSWORD: dbPassword,
  DIARY_KEYRING: `v1:${hex(32)}`,
  PROFILE_KEYRING: `v1:${hex(32)}`,
  SESSION_SECRET: hex(32),
  CRON_SECRET: hex(32),
  // Convenient for trying the API by hand; set to false to see real CAPTCHAs.
  CAPTCHA_FIXED: 'true',
};

const lines = readFileSync(template, 'utf8')
  .split('\n')
  .map((line) => {
    const match = /^([A-Z_]+)=(.*)$/.exec(line);
    if (!match) return line;
    const [, key, value] = match;
    if (key in generated) return `${key}=${generated[key]}`;
    if (key === 'DATABASE_URL' || key === 'TEST_DATABASE_URL') {
      return `${key}=${value.replace('change-me', dbPassword)}`;
    }
    return line;
  });

writeFileSync(target, lines.join('\n'), { mode: 0o600 });
console.log('Wrote .env with throwaway development keys.');
