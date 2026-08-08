import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Packages are consumed as source — no build step, HMR across the whole workspace.
      '@evolab/evolution': src('../../packages/evolution/src/index.ts'),
      '@evolab/sim': src('../../packages/sim/src/index.ts'),
    },
  },
  server: { port: 5173 },
});
