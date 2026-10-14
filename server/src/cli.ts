/**
 * Server command-line tool (docs/ARCHITECTURE.md §8.1). Run inside the server container in production:
 *
 *   node server/dist/cli.js create-sysadmin <username>   first admin, with authenticator set up
 *   node server/dist/cli.js reset-totp <username>        admin lost their authenticator
 *   node server/dist/cli.js set-password <username>      recover any account, including the last admin
 *   node server/dist/cli.js seed [--reset]               development data (refused in production)
 *
 * In development: `npm run cli -w server -- <command>` or `npm run seed`.
 */
import QRCode from 'qrcode';
import { loadConfig, ConfigError } from './config.js';
import { createContext } from './context.js';
import { createDatabase } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './domain/auth/passwords.js';
import { generateTotpSecret, totpUri } from './domain/auth/totp.js';
import {
  AdminToolError,
  createSysadmin,
  resetTotp,
  seed,
  SEED_PASSWORD,
  setPassword,
} from './services/admin-tools.js';

const say = (line = '') => process.stdout.write(`${line}\n`);

/** Reads a line from the terminal without echoing it (for passwords). */
function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { stdin } = process;
    if (!stdin.isTTY) {
      reject(
        new AdminToolError('Run this in an interactive terminal (docker compose exec -it …).'),
      );
      return;
    }
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          process.stdout.write('\n');
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function readLine(prompt: string): Promise<string> {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}

async function askNewPassword(): Promise<string> {
  for (;;) {
    const first = await readHidden('New password: ');
    if (first.length < PASSWORD_MIN_LENGTH || first.length > PASSWORD_MAX_LENGTH) {
      say(`Use ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters.`);
      continue;
    }
    if ((await readHidden('Repeat it: ')) === first) return first;
    say('The two passwords differ; try again.');
  }
}

function requireArg(value: string | undefined, usage: string): string {
  if (!value) throw new AdminToolError(`Usage: ${usage}`);
  return value;
}

async function main(argv: string[]): Promise<void> {
  const [command, arg, ...flags] = argv;
  const config = loadConfig(process.env);
  const database = createDatabase(config.databaseUrl);
  const ctx = createContext(config, database.db);
  try {
    await runMigrations(database, config.migrationsDir);
    switch (command) {
      case 'create-sysadmin': {
        const username = requireArg(arg, 'create-sysadmin <username>');
        const password = await askNewPassword();
        const secret = generateTotpSecret();
        say(
          '\nScan this with an authenticator app (Google Authenticator, Microsoft Authenticator, …):\n',
        );
        say(await QRCode.toString(totpUri(secret, username), { type: 'terminal', small: true }));
        say(`Or enter this key by hand: ${secret}\n`);
        const code = await readLine('Code shown in the app: ');
        await createSysadmin(ctx, { username, password, totpSecret: secret, totpCode: code });
        say(`Created SYS_ADMIN ${username} with an authenticator.`);
        break;
      }
      case 'reset-totp': {
        const username = requireArg(arg, 'reset-totp <username>');
        await resetTotp(ctx, username);
        say(`Authenticator removed for ${username}; they set up a new one at next sign-in.`);
        break;
      }
      case 'set-password': {
        const username = requireArg(arg, 'set-password <username>');
        await setPassword(ctx, username, await askNewPassword());
        say(`Password set for ${username}; all their sessions were signed out.`);
        break;
      }
      case 'seed': {
        const reset = [arg, ...flags].includes('--reset');
        const result = await seed(ctx, { reset });
        say(`Seeded ${result.users.length} users. Every password is: ${SEED_PASSWORD}\n`);
        for (const u of result.users) {
          const extra = u.totpSecret ? `  authenticator key: ${u.totpSecret}` : '';
          const locked = u.resetPending ? '  (locked: waiting for password reset)' : '';
          say(`  ${u.role.padEnd(13)} ${u.username.padEnd(14)}${extra}${locked}`);
        }
        say('\nFor an admin login, add the key to an authenticator app, or run:');
        say('  npm run cli -w server -- totp-code <key>');
        break;
      }
      case 'totp-code': {
        // Development helper: what an authenticator app would show right now for a seed admin's key.
        if (config.env === 'production') throw new AdminToolError('Not available in production.');
        const { currentTotpCode } = await import('./domain/auth/totp.js');
        say(currentTotpCode(requireArg(arg, 'totp-code <key>'), new Date()));
        break;
      }
      default:
        throw new AdminToolError(
          'Commands: create-sysadmin <username> | reset-totp <username> | set-password <username> | seed [--reset]',
        );
    }
  } finally {
    await database.close();
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  if (err instanceof AdminToolError) console.error(err.message);
  else if (err instanceof ConfigError) console.error(err.message);
  else console.error(err);
  process.exit(1);
});
