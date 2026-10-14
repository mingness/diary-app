/**
 * Process entry point: load config (fail fast), migrate, listen, and shut down cleanly on SIGTERM/SIGINT.
 */
import { buildApp } from './app.js';
import { createContext } from './context.js';
import { JOBS } from './jobs.js';
import { startScheduler } from './scheduler.js';
import { ConfigError, loadConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { runMigrations } from './db/migrate.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      // Names only: the values are secrets.
      console.error(
        JSON.stringify({ level: 'fatal', msg: err.message, variables: err.invalidVariables }),
      );
      process.exit(1);
    }
    throw err;
  }

  const database = createDatabase(config.databaseUrl);
  const app = await buildApp({ config, database });
  if (config.captchaFixed) {
    app.log.warn('CAPTCHA_FIXED is on: every CAPTCHA answer is 3. Development only.');
  }

  try {
    await runMigrations(database, config.migrationsDir);
    app.log.info('migrations applied');
  } catch (err) {
    app.log.fatal({ err }, 'migrations failed');
    await database.close();
    process.exit(1);
  }

  const scheduler = startScheduler(
    createContext(config, database.db),
    database.pool,
    JOBS,
    app.log,
  );
  if (!config.smtp) app.log.info('SMTP_URL not set: admin alerts stay in the app (no email)');

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    scheduler.stop();
    await app.close();
    await database.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
