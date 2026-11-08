import { defineConfig } from 'vitest/config';

// Checks on the built site in dist/: run after `pnpm build`.
export default defineConfig({
  test: { include: ['tests/dist/**/*.test.ts'] },
});
