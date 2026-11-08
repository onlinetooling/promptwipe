import { defineConfig } from 'vitest/config';

// Unit tests. tests/dist/ checks the built site and runs after `astro build`
// (pnpm test:dist, see vitest.dist.config.ts).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/dist/**', 'node_modules/**'],
  },
});
