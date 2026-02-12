import { Pool, type PoolConfig } from 'pg';

const DEFAULT_POSTGRES_HOST = '127.0.0.1';
const DEFAULT_POSTGRES_PORT = 5432;
const DEFAULT_POSTGRES_DB = 'run_strava';
const DEFAULT_POSTGRES_USER = 'run_strava';
const DEFAULT_POSTGRES_PASSWORD = 'run_strava';

function toBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  return fallback;
}

function createSslConfigFromEnv(): PoolConfig['ssl'] {
  const enabled = toBoolean(process.env.POSTGRES_SSL, false);
  if (!enabled) {
    return false;
  }
  return {
    rejectUnauthorized: false,
  };
}

export function createPgPoolFromEnv(): Pool {
  const ssl = createSslConfigFromEnv();

  if (process.env.DATABASE_URL) {
    return new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl,
    });
  }

  return new Pool({
    host: process.env.POSTGRES_HOST ?? DEFAULT_POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT ?? DEFAULT_POSTGRES_PORT),
    database: process.env.POSTGRES_DB ?? DEFAULT_POSTGRES_DB,
    user: process.env.POSTGRES_USER ?? DEFAULT_POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD ?? DEFAULT_POSTGRES_PASSWORD,
    ssl,
  });
}
