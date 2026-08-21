import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(({ mode }) => ({
  // Default build feeds the .NET server's wwwroot at the app's own root. The portfolio site
  // embeds this app under a subpath instead, via `vite build --mode embed`, which needs its
  // assets to resolve under that subpath rather than the server's root. EMBED_BASE_PATH lets
  // the site's deploy workflow compose this with its own base when it isn't served from root.
  base: mode === 'embed' ? (process.env.EMBED_BASE_PATH ?? '/apps/evolab/') : '/',
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
  // `embed` mode builds to a plain dist/ instead, for the portfolio site to copy.
  build:
    mode === 'embed'
      ? { outDir: 'dist' }
      : { outDir: '../../server/Evolab.Server/wwwroot', emptyOutDir: true },
}));
