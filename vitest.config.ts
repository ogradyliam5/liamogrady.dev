import { defineConfig } from 'vitest/config';

// Pure-logic tests run in plain Node (no workerd needed); see tests/worker.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
