import pg from 'pg';
import { runMigrations } from '../src/migrate.js';

/**
 * Resets the TEST database to a clean schema before the suite runs.
 * Safety: refuses to touch any database whose name does not end in "_test",
 * so a mistake in .env can never wipe real data.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Example: postgres://postgres:postgres@localhost:5432/inka_test',
    );
  }
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to reset database "${dbName}": test database names must end in "_test".`);
  }
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await pool.query('DROP SCHEMA public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}
