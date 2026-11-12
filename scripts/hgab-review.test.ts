/**
 * npm run test:hgab-review — the reviewer's funnel logic (src/lib/hgab-review.ts) on the built review.json.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { REVIEW_INDEX_PATH, type ReviewIndex } from "../src/lib/hgab-documents";
import {
  PRESETS, decodeIndex, docCount, flagYields, readerText, reviewsCsv, runFunnel, sortProjects, stepFromParam, stepToParam,
  stepsFromSearch, type Step,
} from "../src/lib/hgab-review";

const path = resolve("data/hgab/2027", REVIEW_INDEX_PATH);
const ix = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as ReviewIndex) : null;

test("steps round-trip through the URL", () => {
  const steps: Step[] = [
    { kind: "flag", code: "potential-nep-insertion" }, { kind: "flag", code: "repeated-allocation-amount", not: true },
    { kind: "region", value: "Region IV-A" }, { kind: "office", value: "Cavite 1st District Engineering Office" },
    { kind: "docs", value: "none" }, { kind: "min", value: 50_000_000 }, { kind: "q", value: "multi-purpose: Imus" }, { kind: "reviewed", value: "no" },
  ];
  for (const s of steps) assert.deepEqual(stepFromParam(stepToParam(s)), s.kind === "flag" && !s.not ? { ...s, not: false } : s);
  assert.equal(stepFromParam("flag:<script>"), null);
  assert.equal(stepFromParam("docs:all"), null);
  assert.equal(stepFromParam("min:-5"), null);
  const sp = new URLSearchParams("s=flag:potential-nep-insertion&s=flag:not-a-flag&s=junk");
  assert.deepEqual(stepsFromSearch(sp, new Set(["potential-nep-insertion"])), [{ kind: "flag", code: "potential-nep-insertion", not: false }]);
});

test("reader text says House bill, not HGAB", () => {
  assert.equal(readerText("Implementing office changed between NEP and HGAB"), "Implementing office changed between NEP and House bill");
  assert.equal(readerText("Within-HGAB repeat candidate"), "Within-House bill repeat candidate");
});

test("CSV escapes and keeps one row per review", () => {
  const csv = reviewsCsv([{ hgabId: "HB10858-3-0111-000001", projectId: "house-reading:32", title: 'Road, "A"', docs: { POW: "matches" }, overall: "partly", notes: "line1\nline2", savedAt: "2026-11-12" }]);
  assert.ok(csv.startsWith("\uFEFFhgab_id,project_id,title,doc_pow,"));
  assert.ok(csv.includes('"Road, ""A"""') && csv.includes('"line1\nline2"'));
});

test("the funnel on review.json", { skip: !ix && "review.json not built" }, () => {
  const all = decodeIndex(ix!);
  assert.equal(all.length, 15_979);
  const flagIndex = new Map(ix!.flags.map((f, i) => [f.code, i]));
  const ctx = { flagIndex, reviewed: new Set<string>() };
  // Level 0 is everything; each level is a subset of the one before; amounts add up.
  const steps: Step[] = [{ kind: "flag", code: "potential-nep-insertion" }, { kind: "docs", value: "incomplete" }, { kind: "region", value: "Region IV-A" }];
  const L = runFunnel(all, steps, ctx);
  assert.equal(L.length, 4);
  assert.equal(L[0].projects.length, all.length);
  for (let i = 1; i < L.length; i++) {
    const prev = new Set(L[i - 1].projects.map((p) => p.hgabId));
    assert.ok(L[i].projects.every((p) => prev.has(p.hgabId)));
    assert.equal(L[i].amount, L[i].projects.reduce((s, p) => s + p.amount, 0));
  }
  // A flag step keeps exactly the rows review.json counts for it; its negation keeps the rest.
  for (const f of ix!.flags) {
    const on = runFunnel(all, [{ kind: "flag", code: f.code }], ctx)[1].projects.length;
    const off = runFunnel(all, [{ kind: "flag", code: f.code, not: true }], ctx)[1].projects.length;
    assert.equal(on, f.n, f.code);
    assert.equal(on + off, all.length, f.code);
  }
  // Yields over everything are the flag counts.
  assert.deepEqual(flagYields(all, ix!.flags.length), ix!.flags.map((f) => f.n));
  // Docs filters partition the rows with at least one document.
  const n = (v: "none" | "incomplete" | "complete") => runFunnel(all, [{ kind: "docs", value: v }], ctx)[1].projects.length;
  assert.equal(n("incomplete") + n("complete"), all.length);
  assert.ok(n("none") > 0 && n("none") <= n("incomplete"));
  assert.equal(n("complete"), all.filter((p) => docCount(p.docs) >= 4).length);
  // Every preset's flags exist, and every preset keeps some projects.
  for (const p of PRESETS) {
    for (const s of p.steps) if (s.kind === "flag") assert.ok(flagIndex.has(s.code), `${p.key}: ${s.code}`);
    assert.ok(runFunnel(all, p.steps, ctx).at(-1)!.projects.length > 0, p.key);
  }
  // Search folds accents and case.
  assert.ok(runFunnel(all, [{ kind: "q", value: "las pinas" }], ctx)[1].projects.length > 0);
  // Sorts keep every project.
  for (const k of ["flags", "amount", "bill"] as const) assert.equal(sortProjects(all, k).length, all.length);
  assert.ok(sortProjects(all, "bill").every((p, i, a) => i === 0 || a[i - 1].seq < p.seq));
});
