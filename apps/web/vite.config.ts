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
  server: {
    port: 5173,
    /**
     * Development is two origins; production is one.
     *
     * Vite keeps hot reload on 5173 and forwards `/api` to the server on 5000, so the browser
     * never sees a cross-origin request and there is no CORS anywhere — in development or in
     * production, where `dotnet` serves the built SPA itself.
     *
     * `/api` calls simply fail when nothing is listening, which is the intended experience:
     * slice 12's rule is that the app works with no server at all, and `npm run dev` must not
     * require .NET to be installed.
     */
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: true },
    },
  },
  // Straight into the server's wwwroot, so `dotnet publish` picks it up and there is one
  // artefact, one origin and one deploy. This is the only place the two builds touch.
  build: { outDir: '../../server/Evolab.Server/wwwroot', emptyOutDir: true },
});
