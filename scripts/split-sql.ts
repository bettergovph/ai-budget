/**
 * Split data/budget.sql into multiple smaller files for `wrangler d1 execute
 * --local --file=...`. Wrangler's --file loader reads the whole file into a
 * single Node string, which caps at ~512 MB (Node's max string length); our
 * dump is ~1 GB.
 *
 * Splits on statement boundaries (`;\n`) so we never cut a statement in half.
 * Output: data/budget.split/part-001.sql, part-002.sql, …
 *
 *   npx tsx scripts/split-sql.ts
 */

import { createReadStream, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const TARGET_BYTES = 200 * 1024 * 1024; // 200 MB per part

async function main() {
  const inputPath = resolve(process.cwd(), "data/budget.sql");
  const outDir = resolve(process.cwd(), "data/budget.split");
  if (!statSync(inputPath, { throwIfNoEntry: false })) {
    throw new Error(`${inputPath} not found — run \`npm run dump:sql\` first.`);
  }
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // Use readline so we can split on full statements without holding the
  // whole file in memory. budget.sql has one statement per line.
  const rl = createInterface({
    input: createReadStream(inputPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let partIdx = 1;
  let partBytes = 0;
  let buffered: string[] = [];
  const partsWritten: { path: string; bytes: number; lines: number }[] = [];
  let lineCount = 0;

  const flush = () => {
    if (buffered.length === 0) return;
    const path = resolve(outDir, `part-${String(partIdx).padStart(3, "0")}.sql`);
    const content = buffered.join("\n") + "\n";
    writeFileSync(path, content);
    partsWritten.push({ path, bytes: content.length, lines: buffered.length });
    buffered = [];
    partBytes = 0;
    partIdx++;
  };

  for await (const line of rl) {
    buffered.push(line);
    partBytes += line.length + 1;
    lineCount++;
    // Only break on statement-terminating semicolons so partial INSERTs
    // never end up in two files.
    if (partBytes >= TARGET_BYTES && line.endsWith(";")) {
      flush();
    }
  }
  flush();

  process.stdout.write(`Wrote ${partsWritten.length} parts (${lineCount} statements):\n`);
  for (const p of partsWritten) {
    process.stdout.write(
      `  ${p.path.replace(process.cwd() + "/", "")}  ${(p.bytes / 1024 ** 2).toFixed(1)} MB  ${p.lines} stmts\n`,
    );
  }
  process.stdout.write(`\nSeed local D1 with:\n`);
  for (const p of partsWritten) {
    process.stdout.write(
      `  npx wrangler d1 execute budget --local --yes --file=${p.path.replace(process.cwd() + "/", "")}\n`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
