import pg from 'pg';

// bigint (int8) columns hold money in cents. Return them as JS numbers, but refuse
// to silently lose precision.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`int8 value ${value} is outside the safe integer range`);
  }
  return parsed;
});

// Keep calendar dates as plain "YYYY-MM-DD" strings (no time-zone shifting).
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export type Pool = pg.Pool;
export type Queryable = Pick<pg.Pool, 'query'>;

export function createPool(connectionString: string, onError?: (error: Error) => void): Pool {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
  });
  // An idle client can error (e.g. the database restarts). Without this handler Node
  // would crash with an unhandled 'error' event; with it the pool simply reconnects.
  pool.on('error', (error) => onError?.(error));
  return pool;
}

export async function withTransaction<T>(
  pool: Pool,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
