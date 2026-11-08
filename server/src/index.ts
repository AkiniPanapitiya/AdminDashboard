import { pino } from 'pino';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { runMigrations } from './migrate.js';
import { purgeExpiredSessions } from './services/sessions.js';

const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL });
const pool = createPool(config.DATABASE_URL, (error) =>
  logger.error({ err: error }, 'idle database client error'),
);

async function main() {
  const applied = await runMigrations(pool);
  if (applied.length > 0) logger.info({ applied }, 'database migrations applied');

  const app = createApp({ pool, config });
  const server = app.listen(config.PORT, () => {
    logger.info(`API listening on http://localhost:${config.PORT} (${config.NODE_ENV})`);
  });
  // Slow-client protection.
  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;

  const cleanup = setInterval(() => {
    purgeExpiredSessions(pool).catch((error) =>
      logger.error({ err: error }, 'failed to purge expired sessions'),
    );
  }, 60 * 60_000);
  cleanup.unref();

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    clearInterval(cleanup);
    // Stop accepting connections, let in-flight requests finish, then close the DB pool.
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// A crash must be loud and must exit, so a process manager (Docker/systemd/pm2) restarts a clean process.
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled promise rejection');
  process.exit(1);
});
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'uncaught exception');
  process.exit(1);
});

main().catch((error) => {
  logger.fatal({ err: error }, 'failed to start');
  process.exit(1);
});
