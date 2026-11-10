import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// In development the browser talks to Vite (5173) and Vite forwards /api to the API (4000),
// so the session cookie is same-origin and no CORS configuration is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:4000', changeOrigin: false } },
  },
  build: { sourcemap: false },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
