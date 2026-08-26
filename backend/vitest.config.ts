import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'], // entry point, not logic
      reporter: ['text', 'lcov', 'html'],
    },
    testTimeout: 15000,
    hookTimeout: 15000,
    // Run each file in isolation so vi.mock() calls don't bleed between files
    pool: 'forks',
  },
});
