import { defineConfig } from 'vitest/config';

// Runner OS test runner. Core/application tests are pure (in-memory repos) and
// need no database. Real PostgreSQL integration tests arrive in M07-C.
export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    environment: 'node',
    globals: false,
    reporters: 'default',
  },
});
