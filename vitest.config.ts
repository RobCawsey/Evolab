import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    // Same aliases as apps/web/vite.config.ts. Packages are consumed as source, so tests
    // exercise exactly the files the app imports — there is no build step to drift.
    alias: {
      '@evolab/evolution': src('./packages/evolution/src/index.ts'),
      '@evolab/sim': src('./packages/sim/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/__tests__/**/*.test.ts'],
    // The physics tests build and step real Rapier worlds; a few seconds each is normal.
    testTimeout: 30_000,
  },
});
