import { cpSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    cloudflare(),
    {
      name: 'copy-app-public-assets',
      apply: 'build',
      writeBundle(options) {
        if (!options.dir || basename(options.dir) !== 'client') return;
        // R2 serves dataset assets separately; never bundle public/data.
        for (const name of readdirSync('public')) {
          if (name !== 'data') cpSync(resolve('public', name), resolve(options.dir, name), { recursive: true });
        }
      },
    },
  ],
  build: { copyPublicDir: false },
  server: {
    host: '0.0.0.0',
    // Reserved in ~/projects/ports.md (ai-reports web). strictPort so a
    // collision fails loudly instead of silently moving the reader's URL.
    port: 5130,
    strictPort: true,
    watch: { ignored: ['**/data/**', '**/.wrangler/**'] },
    // duckdb-wasm fetches parquet via HTTP Range requests; Vite's dev server
    // supports them natively. Dev deliberately does NOT send the cross-origin
    // isolation headers (COOP/COEP): production never has, so DuckDB already
    // runs its non-threaded bundle there, and with them on, every cross-origin
    // image without a resource-policy header (the masthead logo, the juris.ph
    // portraits on /hgab/2027/districts) is blocked in dev only.
    allowedHosts: ["dev.neonplayground.com"]
  },
  optimizeDeps: {
    // duckdb-wasm ships worker files that Vite's dep-optimizer otherwise
    // mangles; keeping it out of the prebundle lets the worker bootstrap.
    exclude: ['@duckdb/duckdb-wasm'],
  },
  worker: {
    format: 'es',
  },
})