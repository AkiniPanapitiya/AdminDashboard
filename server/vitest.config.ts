import { defineConfig } from 'vitest/config';

// Pick up TEST_DATABASE_URL from the repo-level .env when it exists (already-set variables win).
try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // no .env file: rely on the real environment (CI)
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    // Tests share one real PostgreSQL database, so run files one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
