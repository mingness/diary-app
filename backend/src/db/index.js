import pg from 'pg';

// Connection config — set by initFromEnv() or initFromHyperdrive()
let connectionConfig = null;
let usePool = false;  // Pool for local dev, per-query client for Workers
let pool = null;

/** Initialize from environment variables (local development / Render) */
export function initFromEnv() {
  if (connectionConfig) return;
  connectionConfig = {
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432', 10),
    database: process.env.PGDATABASE || 'riji',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
  };
  if (process.env.PGSSL === 'require') {
    connectionConfig.ssl = { require: true, rejectUnauthorized: false };
  }
  // Use Pool for local dev / Render (persistent Node.js process)
  usePool = true;
  pool = new pg.Pool({ ...connectionConfig, max: 5 });
}

/** Initialize from Hyperdrive binding (Cloudflare Workers) */
export function initFromHyperdrive(hyperdrive) {
  if (connectionConfig) return;
  // Hyperdrive provides a connectionString that handles SSL and routing
  if (hyperdrive.connectionString) {
    connectionConfig = { connectionString: hyperdrive.connectionString };
  } else {
    connectionConfig = {
      host: hyperdrive.host,
      port: hyperdrive.port,
      database: hyperdrive.database,
      user: hyperdrive.user,
      password: hyperdrive.password,
    };
  }
  // In Workers, use per-query clients — Pool doesn't work reliably
  // because Workers don't maintain persistent TCP connections between requests
  usePool = false;
}

// Auto-initialize from env if not in Worker context (for local dev / Render)
if (!connectionConfig && typeof process !== 'undefined' && process.env && process.env.PGHOST) {
  initFromEnv();
}

/** Get a connected client (from Pool or create new) */
async function getClient() {
  if (usePool) {
    const client = await pool.connect();
    return { client, release: () => client.release() };
  }
  // Per-query client for Workers
  const client = new pg.Client(connectionConfig);
  await client.connect();
  return { client, release: () => client.end().catch(() => {}) };
}

/** Execute a query with automatic client management and retry */
async function withClient(fn) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { client, release } = await getClient();
    try {
      const result = await fn(client);
      release();
      return result;
    } catch (err) {
      release();
      // Retry on connection errors
      if (attempt === 0 && (
        err.code === 'ECONNRESET' ||
        err.code === 'ETIMEDOUT' ||
        err.code === '57P01' ||  // admin_shutdown
        err.code === '57P03' ||  // cannot_connect_now
        err.code === '08006' ||  // connection_failure
        err.code === '08001' ||  // sqlclient_unable_to_establish_sqlconnection
        err.message?.includes('Connection terminated') ||
        err.message?.includes('timeout')
      )) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// Convert ? placeholders to $1, $2, ... for PostgreSQL
function convertSql(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Mimic better-sqlite3 prepared statement API (async)
function prepare(sql) {
  const pgSql = convertSql(sql);
  return {
    async all(...params) {
      return withClient(async (client) => {
        const { rows } = await client.query(pgSql, params);
        return rows;
      });
    },
    async get(...params) {
      return withClient(async (client) => {
        const { rows } = await client.query(pgSql, params);
        return rows[0] || null;
      });
    },
    async run(...params) {
      return withClient(async (client) => {
        const result = await client.query(pgSql, params);
        return {
          changes: result.rowCount,
          lastInsertRowid: result.rows[0]?.id ?? null,
        };
      });
    },
  };
}

// Mimic db.exec() — runs raw SQL (no params)
async function exec(sql) {
  return withClient(async (client) => {
    await client.query(sql);
  });
}

// Direct query access
async function query(sql, params = []) {
  const pgSql = convertSql(sql);
  return withClient(async (client) => {
    const { rows } = await client.query(pgSql, params);
    return rows;
  });
}

export default { get pool() { return pool; }, prepare, exec, query, convertSql };
