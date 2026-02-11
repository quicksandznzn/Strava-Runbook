import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    environmentMatchGlobs: [
      ['src/web/**/*.test.{ts,tsx}', 'jsdom'],
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
});
