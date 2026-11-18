/**
 * npm run test:hgab-review — the reviewer's funnel logic (src/lib/hgab-review.ts) on the built review.json.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { REVIEW_INDEX_PATH, autoScore, scoreBand, type ReviewIndex } from "../src/lib/hgab-documents";
import {
  INSERTION_FLAG, NOT_REVIEWED_STATUSES, PRESETS, buildStatusIndex, projectVerdict, reviewProgress, sourceGroup, isReviewed, listStatus, stepLabel, checkedValues, countBy, furthestStatus, pageCount, pageOf, pageWindow, decodeIndex, docCount, flagYields, projectsWithout, readerText, runFunnel, setValues,
  sortProjects, stepFromParam, stepToParam, stepsFromSearch, toggleFlag, type Step,
} from "../src/lib/hgab-review";

const path = resolve("data/hgab/2027", REVIEW_INDEX_PATH);
const ix = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as ReviewIndex) : null;

test("steps round-trip through the URL", () => {
  const steps: Step[] = [
    { kind: "flag", code: "potential-nep-insertion" }, { kind: "flag", code: "repeated-allocation-amount", not: true },
    { kind: "region", values: ["Region IV-A", "NCR"] }, { kind: "office", values: ["Cavite 1st District Engineering Office"] },
    { kind: "docs", values: ["none", "incomplete"] }, { kind: "min", value: 50_000_000 }, { kind: "q", value: "multi-purpose: Imus" }, { kind: "status", values: ["not_started", "needs_attention"] },
    { kind: "team", values: ["BW-06", "BW-16"] },
  ];
  for (const s of steps) assert.deepEqual(stepFromParam(stepToParam(s)), s.kind === "flag" && !s.not ? { ...s, not: false } : s);
  assert.equal(stepFromParam("flag:<script>"), null);
  assert.equal(stepFromParam("docs:all"), null);
  assert.deepEqual(stepFromParam("reviewed:no"), { kind: "status", values: ["not_started"] }, "old links still work");
  // Links from the two-way final status and from the 44 checks.
  assert.deepEqual(stepFromParam("status:unsatisfactory"), { kind: "status", values: ["needs_immediate_attention", "needs_attention"] });
  assert.deepEqual(stepFromParam("status:in_progress|not_started"), { kind: "status", values: ["reviewed", "not_started"] }, "in progress is now reviewed");
  assert.deepEqual(stepFromParam("team:RF-024|RF-016|RF-001"), { kind: "team", values: ["BW-06", "BW-01"] }, "a check reads as its question, once");
  assert.equal(stepFromParam("team:RF-999"), null);
  assert.equal(stepFromParam("status:done"), null);
  assert.equal(stepFromParam("status:on_hold"), null, "case stages are no longer list statuses");
  assert.deepEqual(stepFromParam("docs:all|none"), { kind: "docs", values: ["none"] });
  assert.deepEqual(stepFromParam("region:NCR|NCR"), { kind: "region", values: ["NCR"] });
  assert.equal(stepFromParam("min:-5"), null);
  const sp = new URLSearchParams("s=flag:potential-nep-insertion&s=flag:not-a-flag&s=junk");
  assert.deepEqual(stepsFromSearch(sp, new Set(["potential-nep-insertion"])), [{ kind: "flag", code: "potential-nep-insertion", not: false }]);
});

test("filters keep their place in the funnel", () => {
  const a: Step[] = [{ kind: "flag", code: "x" }, { kind: "region", values: ["NCR"] }, { kind: "flag", code: "y" }];
  assert.deepEqual(setValues(a, "region", ["NCR", "CAR"])[1], { kind: "region", values: ["NCR", "CAR"] });
  assert.equal(setValues(a, "region", []).length, 2);
  assert.deepEqual(setValues(a, "office", ["O"]).at(-1), { kind: "office", values: ["O"] });
  assert.deepEqual(checkedValues(a, "region"), ["NCR"]);
  assert.deepEqual(toggleFlag(a, "x").map(stepToParam), ["region:NCR", "flag:y"]);
  assert.deepEqual(toggleFlag(a, "z").map(stepToParam), ["flag:x", "region:NCR", "flag:y", "flag:z"]);
});

test("automatic review: no key document and no file, a red flag the list can hide", { skip: !ix && "review.json not built" }, () => {
  const all = decodeIndex(ix!);
  const auto = all.filter((p) => p.auto);
  assert.equal(auto.length, all.filter((p) => p.docs === 0 && p.files === 0).length);
  assert.ok(auto.length > 1000 && auto.every((p) => p.auto!.score === autoScore(["no-key-documents"]) && p.auto!.rules[0] === "no-key-documents"));
  assert.equal(scoreBand(100), "High");
  // A member's final status takes over; a review without one shows "in progress"; nobody's review leaves the automatic one.
  assert.equal(listStatus(null, false, true), "auto_red_flag");
  assert.equal(listStatus(null, true, true), "reviewed", "a saved review without a final status is a review");
  assert.equal(listStatus("satisfactory", true, true), "satisfactory");
  assert.equal(listStatus("needs_attention", true, false), "needs_attention");
  assert.equal(listStatus("needs_immediate_attention", true, true), "needs_immediate_attention");
  assert.equal(listStatus(null, false, false), "not_started");
  assert.ok(isReviewed("auto_red_flag") && isReviewed("satisfactory") && isReviewed("needs_attention") && isReviewed("needs_immediate_attention") && isReviewed("reviewed") && !isReviewed("not_started"));
  const autoSet = new Set(auto.map((p) => p.hgabId));
  const ctx = { flagIndex: new Map(ix!.flags.map((f, i) => [f.code, i])), statusOf: (h: string) => listStatus(null, false, autoSet.has(h)) };
  const hidden = runFunnel(all, [{ kind: "status", values: [...NOT_REVIEWED_STATUSES] }], ctx)[1].projects;
  assert.equal(hidden.length, all.length - auto.length, "Hide reviewed leaves out the auto-reviewed");
  assert.equal(stepLabel({ kind: "status", values: [...NOT_REVIEWED_STATUSES] }, ix!.flags), "Not yet reviewed");
  const byScore = sortProjects(all, "score");
  assert.ok(byScore.slice(0, auto.length).every((p) => p.auto));
  assert.deepEqual(stepFromParam("status:auto_red_flag"), { kind: "status", values: ["auto_red_flag"] });
});

test("review progress: House insertions and NEP only, auto-reviewed included; the document source filter", { skip: !ix && "review.json not built" }, () => {
  const all = decodeIndex(ix!);
  const ins = all.filter((p) => p.insertion);
  assert.equal(ins.length, ix!.flags.find((f) => f.code === INSERTION_FLAG)!.n, "House insertions are the lines our comparison finds in the House bill only");
  const autoSet = new Set(all.filter((p) => p.auto).map((p) => p.hgabId));
  const done = new Set(ins.filter((p) => !p.auto).slice(0, 5).map((p) => p.hgabId));
  const flagged = new Set(ins.filter((p) => !p.auto).slice(0, 2).map((p) => p.hgabId));
  // Saved by a member without a final status: reviewed all the same.
  const saved = new Set(ins.filter((p) => !p.auto).slice(5, 8).map((p) => p.hgabId));
  const statusOf = (h: string) => listStatus(flagged.has(h) ? "needs_attention" : done.has(h) ? "satisfactory" : null, done.has(h) || saved.has(h), autoSet.has(h));
  const { groups, total } = reviewProgress(all, statusOf);
  assert.equal(groups.insertion.projects, ins.length);
  assert.equal(groups.insertion.projects + groups.nep.projects, all.length);
  // The auto-reviewed House insertions count as reviewed in their group.
  assert.equal(groups.insertion.auto, ins.filter((p) => p.auto).length);
  assert.ok(groups.insertion.auto > 1500, "most auto-reviewed projects are House insertions");
  assert.equal(groups.insertion.needs_attention, 2);
  assert.equal(groups.insertion.needs_immediate_attention, 0);
  assert.equal(groups.insertion.satisfactory, 3);
  assert.equal(groups.insertion.no_final_status, 3);
  assert.equal(groups.insertion.reviewed, groups.insertion.auto + 8);
  assert.equal(groups.insertion.pending, ins.length - groups.insertion.auto - 8);
  assert.equal(total.auto, autoSet.size);
  assert.equal(total.pending + total.reviewed, total.projects);
  assert.equal(groups.insertion.php + groups.nep.php, total.php);
  // A card's funnel: the insertion flag (or its negation), then not yet reviewed.
  const ctx = { flagIndex: new Map(ix!.flags.map((f, i) => [f.code, i])), statusOf };
  const pend = (not: boolean) => runFunnel(all, [{ kind: "flag", code: INSERTION_FLAG, not }, { kind: "status", values: [...NOT_REVIEWED_STATUSES] }], ctx)[2].projects.length;
  assert.equal(pend(false), groups.insertion.pending);
  assert.equal(pend(true), groups.nep.pending);
  assert.equal(stepLabel({ kind: "flag", code: INSERTION_FLAG }, ix!.flags), "House insertions");
  assert.equal(stepLabel({ kind: "flag", code: INSERTION_FLAG, not: true }, ix!.flags), "NEP only");
  // Document source groups (the Documents filter).
  const by = (g: string) => all.filter((p) => p.source === g).length;
  assert.equal(by("senate") + by("nep") + by("both") + by("none"), all.length);
  assert.equal(sourceGroup(1), "senate"); assert.equal(sourceGroup(2), "nep"); assert.equal(sourceGroup(3), "both"); assert.equal(sourceGroup(0), "none");
  assert.ok(all.filter((p) => p.auto).every((p) => p.source === "none"));
  assert.equal(runFunnel(all, [{ kind: "source", values: ["senate"] }], ctx)[1].projects.length, by("senate"));
  assert.deepEqual(stepFromParam(stepToParam({ kind: "source", values: ["senate", "nep"] })), { kind: "source", values: ["senate", "nep"] });
});

test("pages", () => {
  assert.equal(pageCount(0), 1);
  assert.equal(pageCount(15_979), 320);
  assert.equal(pageOf(0), 1);
  assert.equal(pageOf(49), 1);
  assert.equal(pageOf(50), 2);
  assert.deepEqual(pageWindow(1, 320), [1, 2, 3, null, 320]);
  assert.deepEqual(pageWindow(160, 320), [1, null, 158, 159, 160, 161, 162, null, 320]);
  assert.deepEqual(pageWindow(4, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(pageWindow(1, 1), [1]);
});

test("reader text says House bill, not HGAB", () => {
  assert.equal(readerText("Implementing office changed between NEP and HGAB"), "Implementing office changed between NEP and House bill");
  assert.equal(readerText("Within-HGAB repeat candidate"), "Within-House bill repeat candidate");
});

test("the funnel on review.json", { skip: !ix && "review.json not built" }, () => {
  const all = decodeIndex(ix!);
  assert.equal(all.length, 15_979);
  const flagIndex = new Map(ix!.flags.map((f, i) => [f.code, i]));
  // List status as the page has it with no member reviews: auto-reviewed where review.json marks it, else not started.
  const autoSet = new Set(Object.keys(ix!.auto?.rows ?? {}));
  const ctx = { flagIndex, statusOf: (h: string) => listStatus(null, false, autoSet.has(h)) };
  // Level 0 is everything; each level is a subset of the one before; amounts add up.
  const steps: Step[] = [{ kind: "flag", code: "potential-nep-insertion" }, { kind: "docs", values: ["incomplete"] }, { kind: "region", values: ["Region IV-A"] }];
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
  const n = (v: "none" | "incomplete" | "complete") => runFunnel(all, [{ kind: "docs", values: [v] }], ctx)[1].projects.length;
  assert.equal(runFunnel(all, [{ kind: "docs", values: ["incomplete", "complete"] }], ctx)[1].projects.length, all.length);
  // Several regions keep any of them; options count against every other step.
  const two = runFunnel(all, [{ kind: "region", values: ["National Capital Region", "CAR"] }], ctx)[1].projects.length;
  const byRegion = countBy(all, (p) => p.region);
  assert.ok((byRegion.get("National Capital Region") ?? 0) > 0 && (byRegion.get("CAR") ?? 0) > 0);
  assert.equal(two, byRegion.get("National Capital Region")! + byRegion.get("CAR")!);
  assert.equal(projectsWithout(all, steps, "region", ctx).length, L[2].projects.length);
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
  for (const k of ["flags", "amount", "bill", "status"] as const) assert.equal(sortProjects(all, k).length, all.length);
  // Review status: what still needs a reviewer first, then bill order.
  const done = new Set(all.slice(0, 3).map((p) => p.hgabId));
  const byStatus = sortProjects(all, "status", (h) => (done.has(h) ? "satisfactory" : "not_started"));
  assert.ok(byStatus.slice(-3).every((p) => done.has(p.hgabId)));
  assert.ok(byStatus.slice(0, -3).every((p, i, a) => i === 0 || a[i - 1].seq < p.seq));
  assert.equal(runFunnel(all, [{ kind: "status", values: ["satisfactory"] }], { ...ctx, statusOf: (h: string) => (done.has(h) ? "satisfactory" : "not_started") })[1].projects.length, 3);
  // The report preset lists members' reviews needing attention and the automatic red flags.
  const red = PRESETS.find((p) => p.key === "red-flags")!;
  assert.deepEqual(red.steps, [{ kind: "status", values: ["needs_immediate_attention", "needs_attention", "auto_red_flag"] }]);
  assert.ok(sortProjects(all, "bill").every((p, i, a) => i === 0 || a[i - 1].seq < p.seq));
});

test("a project's final status: the most serious its members gave", () => {
  const c = (satisfactory: number, needs_attention: number, needs_immediate_attention: number) => ({ satisfactory, needs_attention, needs_immediate_attention });
  assert.equal(projectVerdict(undefined), null);
  assert.equal(projectVerdict(c(0, 0, 0)), null);
  assert.equal(projectVerdict(c(3, 0, 0)), "satisfactory");
  assert.equal(projectVerdict(c(3, 1, 0)), "needs_attention");
  assert.equal(projectVerdict(c(3, 1, 1)), "needs_immediate_attention");
  assert.equal(projectVerdict(c(0, 0, 1)), "needs_immediate_attention");
  const ix = buildStatusIndex([
    { hgab_id: "HB10858-3-0001-000001", status: "in_progress", updated_at: "2026-11-14T01:00:00Z", verdict: "satisfactory" },
    // Saved on the two-way scale (2026-11-14 to 2026-11-17): reads as needing attention.
    { hgab_id: "HB10858-3-0001-000001", status: "in_progress", updated_at: "2026-11-14T02:00:00Z", verdict: "unsatisfactory" },
    { hgab_id: "HB10858-3-0002-000004", status: "in_progress", updated_at: "2026-11-14T00:00:00Z", verdict: null },
    { hgab_id: "HB10858-3-0003-000009", status: "in_progress", updated_at: "2026-11-14T00:00:00Z", verdict: "maybe" },
    { hgab_id: "HB10858-3-0004-000010", status: "in_progress", updated_at: "2026-11-17T00:00:00Z", verdict: "needs_attention" },
    { hgab_id: "HB10858-3-0004-000010", status: "in_progress", updated_at: "2026-11-17T01:00:00Z", verdict: "needs_immediate_attention" },
  ]);
  assert.equal(ix["HB10858-3-0001-000001"].verdict, "needs_attention");
  assert.deepEqual(ix["HB10858-3-0001-000001"].verdicts, c(1, 1, 0));
  assert.equal(ix["HB10858-3-0004-000010"].verdict, "needs_immediate_attention");
  assert.equal(ix["HB10858-3-0002-000004"].verdict, null, "a review without a final status");
  assert.equal(ix["HB10858-3-0003-000009"].verdict, null, "anything else isn't a final status");
  assert.equal(listStatus(ix["HB10858-3-0002-000004"].verdict!, ix["HB10858-3-0002-000004"].reviews > 0, true), "reviewed");
});

test("a project shows the furthest of its members' reviews", () => {
  assert.equal(furthestStatus([]), "not_started");
  assert.equal(furthestStatus(["on_hold", "in_progress"]), "in_progress");
  assert.equal(furthestStatus(["in_independent_review", "in_progress", "on_hold"]), "in_independent_review");
  const ix = buildStatusIndex([
    { hgab_id: "HB10858-3-0001-000001", status: "in_progress", updated_at: "2026-11-13T01:00:00Z" },
    { hgab_id: "HB10858-3-0001-000001", status: "in_independent_review", updated_at: "2026-11-13T00:00:00Z" },
    { hgab_id: "HB10858-3-0002-000004", status: "on_hold", updated_at: "2026-11-12T00:00:00Z" },
  ]);
  const none = { verdict: null, verdicts: { satisfactory: 0, needs_attention: 0, needs_immediate_attention: 0 } };
  assert.deepEqual(ix, {
    "HB10858-3-0001-000001": { status: "in_independent_review", reviews: 2, updated_at: "2026-11-13T01:00:00Z", ...none },
    "HB10858-3-0002-000004": { status: "on_hold", reviews: 1, updated_at: "2026-11-12T00:00:00Z", ...none },
  });
});

test("Show my reviews: a funnel step for the signed-in member's projects", { skip: !ix && "review.json not built" }, () => {
  assert.deepEqual(stepFromParam("mine:yes"), { kind: "mine" });
  assert.equal(stepFromParam("mine:no"), null);
  assert.equal(stepToParam({ kind: "mine" }), "mine:yes");
  assert.equal(stepLabel({ kind: "mine" }, ix!.flags), "My reviews");
  const all = decodeIndex(ix!);
  const mine = new Set(all.slice(10, 13).map((p) => p.hgabId));
  const ctx = { flagIndex: new Map(ix!.flags.map((f, i) => [f.code, i])), statusOf: () => "not_started" as const, isMine: (h: string) => mine.has(h) };
  assert.deepEqual(runFunnel(all, [{ kind: "mine" }], ctx)[1].projects.map((p) => p.hgabId), [...mine]);
  // Signed out (no isMine): nothing.
  assert.equal(runFunnel(all, [{ kind: "mine" }], { ...ctx, isMine: undefined })[1].projects.length, 0);
});

test("only DPWH Transparency PDFs come through the Worker; our own files are read as they are", async () => {
  const { proxiedDocument, pdfSource, DOCUMENT_PROXY_API } = await import("../src/lib/hgab-review-api");
  const ok = "https://s3.infrawatch.ph/nep/fy2027/2027DPWH-Proposal-12535/2027DPWH-Proposal-12535_GEOTAGGED%20PHOTO.pdf";
  assert.ok(proxiedDocument(ok));
  for (const bad of [
    "https://s3.infrawatch.ph/nep/fy2026/x.pdf", "https://s3.infrawatch.ph/nep/fy2027/../x.pdf", "http://s3.infrawatch.ph/nep/fy2027/x.pdf",
    "https://s3.infrawatch.ph/nep/fy2027/x.pdf?y=1", "https://s3.infrawatch.ph/nep/fy2027/x.html", "https://evil.example/nep/fy2027/x.pdf",
    "https://user@s3.infrawatch.ph/nep/fy2027/x.pdf", "not a url",
  ]) assert.ok(!proxiedDocument(bad), bad);
  assert.equal(pdfSource(ok), `${DOCUMENT_PROXY_API}?u=${encodeURIComponent(ok)}`);
  const ours = "https://budget-assets.bettergov.ph/hgab/2027/dpwh/supporting-documents/Region%20VIII/x.pdf";
  assert.equal(pdfSource(ours), ours);
  assert.equal(pdfSource("https://example.com/x.pdf"), null);
});
