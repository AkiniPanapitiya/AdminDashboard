import { loadConfig } from '../config.js';
import { createPool } from '../db.js';
import { runMigrations } from '../migrate.js';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
try {
  const applied = await runMigrations(pool);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
} finally {
  await pool.end();
}
