/**
 * Keep the generated local data tree out of Cloudflare Workers Assets.
 *
 * Production client data is served from VITE_DATA_BASE_URL (R2), while the
 * public/data symlink exists for local development and contains multi-GB raw
 * extracts, SQLite files, and SQL migrations. The Cloudflare Vite plugin
 * generates dist/client/.assetsignore during build; append the production
 * exclusion immediately before `wrangler deploy`.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ignorePath = resolve("dist/client/.assetsignore");
if (!existsSync(ignorePath)) {
  throw new Error(`${ignorePath} is missing; run npm run build first.`);
}

const existing = readFileSync(ignorePath, "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);
const entries = [...new Set([...existing, "data/**"])];
writeFileSync(ignorePath, `${entries.join("\n")}\n`);

process.stdout.write(`Prepared ${ignorePath}; local data assets are excluded from deployment.\n`);
