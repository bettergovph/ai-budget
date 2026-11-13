/**
 * npm run test:hgab-review — the automatic reviews in D1: the sync's plan and SQL (scripts/hgab-review/
 * sync-auto-reviews.ts) and the status list that carries them (withAutoReviews).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { REVIEW_INDEX_PATH, type ReviewIndex } from "../src/lib/hgab-documents";
import { listStatus, withAutoReviews } from "../src/lib/hgab-review";
import { batches, planAutoSync, planSql, wantedFrom, type AutoRow } from "./hgab-review/sync-auto-reviews";

const ixPath = resolve("data/hgab/2027", REVIEW_INDEX_PATH);
const ix = existsSync(ixPath) ? (JSON.parse(readFileSync(ixPath, "utf8")) as ReviewIndex) : null;
const run = { run_id: "r1", method: "auto-1", data_built_at: "b", data_md5: "m", projects: 2, ran_at: "2026-11-13T00:00:00Z" };

test("the sync changes only the difference", () => {
  const want = [
    { hgab_id: "A", score: 100, rules: '["no-key-documents"]', method: "auto-1" },
    { hgab_id: "B", score: 100, rules: '["no-key-documents"]', method: "auto-1" },
    { hgab_id: "C", score: 100, rules: '["no-key-documents"]', method: "auto-1" },
    { hgab_id: "D", score: 100, rules: '["no-key-documents"]', method: "auto-1" },
  ];
  const current: AutoRow[] = [
    { hgab_id: "B", score: 100, rules: '["no-key-documents"]', method: "auto-1", withdrawn_at: null },
    { hgab_id: "C", score: 50, rules: '["no-key-documents"]', method: "auto-1", withdrawn_at: null },
    { hgab_id: "D", score: 100, rules: '["no-key-documents"]', method: "auto-1", withdrawn_at: "earlier" },
    { hgab_id: "E", score: 100, rules: '["no-key-documents"]', method: "auto-1", withdrawn_at: null },
    { hgab_id: "F", score: 100, rules: '["no-key-documents"]', method: "auto-1", withdrawn_at: "earlier" },
  ];
  const p = planAutoSync(current, want);
  assert.deepEqual(p.added.map((x) => x.hgab_id), ["A"]);
  assert.deepEqual(p.changed.map((x) => x.hgab_id), ["C"]);
  assert.deepEqual(p.restored.map((x) => x.hgab_id), ["D"]);
  assert.deepEqual(p.withdrawn, ["E"], "already withdrawn rows stay as they are");
  assert.equal(p.unchanged, 1);
  const sql = planSql(p, run);
  assert.match(sql[0], /^INSERT INTO review_auto_runs .*'r1'.*1, 1, 1, 1,/, "the run is logged first, with its counts");
  assert.equal(sql.length, 1 + 1 + 2 + 1);
  assert.ok(sql.every((s) => !/DELETE/i.test(s)), "nothing is deleted");
  assert.match(sql.find((s) => s.includes("withdrawn_at = '2026"))!, /WHERE withdrawn_at IS NULL AND hgab_id IN \('E'\)/);
  // Nothing to change: only the log row.
  assert.equal(planSql(planAutoSync([{ ...current[0] }], [want[1]]), run).length, 1);
});

test("values are quoted; batches stay small", () => {
  const sql = planSql({ added: [{ hgab_id: "O'Brien", score: 1, rules: "[]", method: "m" }], changed: [], restored: [], withdrawn: [], unchanged: 0 }, run);
  assert.ok(sql[1].includes("'O''Brien'"));
  const many = Array.from({ length: 3000 }, (_, i) => `INSERT INTO t VALUES ('${"x".repeat(60)}${i}')`);
  const b = batches(many, 80_000);
  assert.ok(b.length > 1 && b.every((x) => x.length <= 80_000));
  assert.equal(b.join("").split(";\n").filter(Boolean).length, many.length);
});

test("review.json's automatic reviews, as the sync reads them", { skip: !ix && "review.json not built" }, () => {
  const want = wantedFrom(ix!);
  assert.equal(want.length, Object.keys(ix!.auto!.rows).length);
  assert.ok(want.every((w) => w.method === ix!.auto!.method && JSON.parse(w.rules).includes("no-key-documents") && w.score === 100));
});

test("the status list carries D1's automatic reviews; members' reviews take over", () => {
  const idx = withAutoReviews(
    { A: { status: "in_progress", reviews: 1, updated_at: "t1" } },
    [{ hgab_id: "A", score: 100, method: "auto-1", updated_at: "t0" }, { hgab_id: "B", score: 100, method: "auto-1", updated_at: "t0" }],
  );
  assert.deepEqual(idx.B, { status: "not_started", reviews: 0, updated_at: "t0", auto: { score: 100, method: "auto-1" } });
  assert.equal(idx.A.status, "in_progress");
  assert.equal(listStatus(idx.A.status, !!idx.A.auto), "in_progress");
  assert.equal(listStatus(idx.B.status, !!idx.B.auto), "auto_red_flag");
});
