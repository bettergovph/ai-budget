/**
 * npm run sync:hgab-auto-reviews — write the automatic reviews (review.json `auto`, AUTO_REVIEW in
 * src/lib/hgab-documents.ts) to D1's review_auto, so the reviews database holds every project's status: members'
 * reviews (review_cases) and the automatic ones. Run it after each `build:hgab-documents` that changes `auto`.
 *
 *   npm run sync:hgab-auto-reviews                                   local D1 (.wrangler)
 *   npm run sync:hgab-auto-reviews -- --persist-to=/tmp/d1           another local D1 state
 *   npm run sync:hgab-auto-reviews -- --remote                       production (a token with D1 edit; ask first)
 *   npm run sync:hgab-auto-reviews -- --remote --dry-run             what it would change, nothing written
 *
 * It compares review.json with what review_auto holds and changes only the difference: projects added, changed
 * (score, rules or method), withdrawn (no longer meeting a rule; kept, with withdrawn_at) and restored (meeting a rule
 * again). Every run is logged in review_auto_runs, first, so the rows can name it. Statements go in small batches of
 * plain queries, not a `--file` import (which takes the whole D1 offline for about 10 s). A batch that fails leaves the
 * rest for the next run: running it again finishes the job, and a run with nothing to change writes only its log row.
 * Tables: scripts/hgab-review/reviews-schema.sql.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REVIEW_INDEX_PATH, type ReviewIndex } from "../../src/lib/hgab-documents";

export interface AutoRow { hgab_id: string; score: number; rules: string; method: string; withdrawn_at: string | null }
export interface AutoWant { hgab_id: string; score: number; rules: string; method: string }
export interface AutoPlan { added: AutoWant[]; changed: AutoWant[]; restored: AutoWant[]; withdrawn: string[]; unchanged: number }

/** What a run changes, from what review_auto holds and what review.json says. */
export function planAutoSync(current: readonly AutoRow[], want: readonly AutoWant[]): AutoPlan {
  const have = new Map(current.map((r) => [r.hgab_id, r]));
  const wanted = new Set(want.map((w) => w.hgab_id));
  const plan: AutoPlan = { added: [], changed: [], restored: [], withdrawn: [], unchanged: 0 };
  for (const w of want) {
    const h = have.get(w.hgab_id);
    if (!h) plan.added.push(w);
    else if (h.withdrawn_at) plan.restored.push(w);
    else if (h.score !== w.score || h.rules !== w.rules || h.method !== w.method) plan.changed.push(w);
    else plan.unchanged++;
  }
  for (const h of current) if (!h.withdrawn_at && !wanted.has(h.hgab_id)) plan.withdrawn.push(h.hgab_id);
  return plan;
}

/** The automatic reviews review.json asks for, one per project, rules as a JSON array of codes. */
export function wantedFrom(ix: ReviewIndex): AutoWant[] {
  const a = ix.auto;
  if (!a) return [];
  return Object.entries(a.rows).map(([hgab_id, r]) => ({
    hgab_id, score: r.s, method: a.method, rules: JSON.stringify(r.r.map((i) => a.rules[i]?.code).filter(Boolean)),
  })).sort((x, y) => x.hgab_id.localeCompare(y.hgab_id));
}

const lit = (v: string | number | null) => (v == null ? "NULL" : typeof v === "number" ? String(v) : `'${v.replace(/'/g, "''")}'`);

/** The statements for a plan, the run's log row first. */
export function planSql(plan: AutoPlan, run: { run_id: string; method: string; data_built_at: string; data_md5: string; projects: number; ran_at: string }): string[] {
  const r = run;
  const out = [
    `INSERT INTO review_auto_runs (run_id, method, data_built_at, data_md5, projects, added, changed, withdrawn, restored, ran_at) VALUES (${[
      r.run_id, r.method, r.data_built_at, r.data_md5, r.projects, plan.added.length, plan.changed.length, plan.withdrawn.length, plan.restored.length, r.ran_at,
    ].map(lit).join(", ")})`,
  ];
  for (const w of plan.added) {
    out.push(`INSERT INTO review_auto (hgab_id, status, score, rules, method, first_run_id, last_run_id, created_at, updated_at) VALUES (${[
      w.hgab_id, "red_flag", w.score, w.rules, w.method, r.run_id, r.run_id, r.ran_at, r.ran_at,
    ].map(lit).join(", ")})`);
  }
  for (const w of [...plan.changed, ...plan.restored]) {
    out.push(`UPDATE review_auto SET score = ${lit(w.score)}, rules = ${lit(w.rules)}, method = ${lit(w.method)}, last_run_id = ${lit(r.run_id)}, updated_at = ${lit(r.ran_at)}, withdrawn_at = NULL WHERE hgab_id = ${lit(w.hgab_id)}`);
  }
  for (let i = 0; i < plan.withdrawn.length; i += 200) {
    const ids = plan.withdrawn.slice(i, i + 200);
    out.push(`UPDATE review_auto SET withdrawn_at = ${lit(r.ran_at)}, last_run_id = ${lit(r.run_id)} WHERE withdrawn_at IS NULL AND hgab_id IN (${ids.map(lit).join(", ")})`);
  }
  return out;
}

/** Statements into commands of at most `max` characters. */
export function batches(statements: readonly string[], max = 80_000): string[] {
  const out: string[] = [];
  let cur = "";
  for (const s of statements) {
    if (cur && cur.length + s.length + 2 > max) { out.push(cur); cur = ""; }
    cur += `${s};\n`;
  }
  if (cur) out.push(cur);
  return out;
}

function d1(args: { remote: boolean; persistTo: string | null }, sql: string): unknown[] {
  const where = args.remote ? ["--remote"] : ["--local", ...(args.persistTo ? ["--persist-to", args.persistTo] : [])];
  const out = execFileSync("npx", ["wrangler", "d1", "execute", "budget", ...where, "--json", "--command", sql], { encoding: "utf8", maxBuffer: 64 << 20 });
  const parsed = JSON.parse(out) as { results?: unknown[]; error?: { text: string } }[] | { error: { text: string } };
  if (!Array.isArray(parsed)) throw new Error(`D1: ${parsed.error?.text ?? out.slice(0, 300)}`);
  return parsed.flatMap((p) => p.results ?? []);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const args = { remote: argv.includes("--remote"), persistTo: get("persist-to") ?? null, dryRun: argv.includes("--dry-run") };
  const file = resolve(get("index") ?? resolve("data/hgab/2027", REVIEW_INDEX_PATH));
  if (!existsSync(file)) throw new Error(`${file} not found; run build:hgab-documents`);
  const bytes = readFileSync(file);
  const ix = JSON.parse(bytes.toString("utf8")) as ReviewIndex;
  if (!ix.auto) throw new Error("review.json has no `auto`: rebuild it with build:hgab-documents");
  const want = wantedFrom(ix);
  const current = d1(args, "SELECT hgab_id, score, rules, method, withdrawn_at FROM review_auto") as AutoRow[];
  const plan = planAutoSync(current, want);
  const run = {
    run_id: randomUUID(), method: ix.auto.method, data_built_at: ix.built_at, data_md5: createHash("md5").update(bytes).digest("hex"),
    projects: want.length, ran_at: new Date().toISOString(),
  };
  const where = args.remote ? "production D1 (remote)" : `local D1${args.persistTo ? ` (${args.persistTo})` : ""}`;
  process.stdout.write(`${where}: review.json ${run.data_md5} (${run.data_built_at}), method ${run.method}\n`);
  process.stdout.write(`  ${want.length} auto-reviewed: ${plan.added.length} to add, ${plan.changed.length} to change, ${plan.restored.length} to restore, ${plan.withdrawn.length} to withdraw, ${plan.unchanged} unchanged\n`);
  if (args.dryRun) { process.stdout.write("  dry run: nothing written\n"); return; }
  const cmds = batches(planSql(plan, run));
  cmds.forEach((sql, i) => {
    d1(args, sql);
    process.stdout.write(`  batch ${i + 1}/${cmds.length} written\n`);
  });
  const [after] = d1(args, `SELECT count(*) AS live FROM review_auto WHERE withdrawn_at IS NULL`) as { live: number }[];
  if (after.live !== want.length) throw new Error(`review_auto has ${after.live} live rows, review.json ${want.length}: run it again`);
  process.stdout.write(`  done: ${after.live} live in review_auto; run ${run.run_id} logged\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename ?? "")) {
  main().catch((e: unknown) => { process.stderr.write(`sync-auto-reviews: ${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); });
}
