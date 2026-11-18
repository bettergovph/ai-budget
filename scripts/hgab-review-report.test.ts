/**
 * npm run test:hgab-review — the team's review report (src/lib/hgab-review-report.ts): how reviews become projects,
 * tallies and CSV rows.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyFlagCheck, emptyQuestionAnswer, newCaseReview, type CaseReview, type Verdict } from "../src/lib/hgab-redflags-team";
import type { ReviewProject } from "../src/lib/hgab-review";
import type { ReviewIndexFlag } from "../src/lib/hgab-documents";
import {
  REPORT_ANSWER_COLUMNS, REPORT_PAGES, REPORT_REVIEW_COLUMNS, answerLines, answerRows, checkTallies, docLevel, docTallies, docTally,
  flagPath, flagTallies, groupCounts, groupIndex, insertionKey, memberNames, projectPath, questionTallies, reportPath, reportProjects,
  reviewRows, tallyBy, totalTally, type ReportCase,
} from "../src/lib/hgab-review-report";

const project = (hgabId: string, amount: number) => ({
  hgab_id: hgabId, project_id: "house-reading:1", budget_source_version: "v", title: `Project ${hgabId}`, office: "Cavite 1st District Engineering Office",
  region: "Region IV-A", amount_php: amount, categories: [], detector_rule_ids: [],
});
function review(hgabId: string, member: string, verdict: Verdict | null, at: string, extra: (r: CaseReview) => void = () => {}): ReportCase {
  const r = newCaseReview({ caseId: `${hgabId}-${member}`, reviewer: { reviewer_id: member, display_name: "", task_id: "" }, project: project(hgabId, 1_000_000), dataBuiltAt: "d", now: at });
  r.verdict = verdict;
  extra(r);
  return { hgab_id: hgabId, member_id: member, member_name: null, status: "in_progress", revisions: 2, created_at: at, updated_at: at, review: r };
}
const listed = (hgabId: string, insertion: boolean, region = "Region IV-A"): ReviewProject => ({
  hgabId, seq: 1, page: 1, projectId: "house-reading:1", title: `Listed ${hgabId}`, region, program: "BIP", amount: 5_000_000, flags: [0, 1], docs: 0b111, files: 3,
  source: "senate", insertion, auto: null, office: { name: "Cavite 1st District Engineering Office", districts: ["Cavite, 1st District"], tier: "A" } as ReviewProject["office"],
});

const A = "HB10858-3-0001-000001", B = "HB10858-3-0002-000002", C = "HB10858-3-0003-000003";
const cases: ReportCase[] = [
  review(A, "m1", "satisfactory", "2026-11-15T00:00:00Z"),
  review(A, "m2", "needs_immediate_attention", "2026-11-16T00:00:00Z", (r) => {
    r.notes = "No POW for this line.";
    r.questions.push({ ...emptyQuestionAnswer("BW-16", [], "t"), rating: "needs_immediate_attention", remark: "Nothing on file" });
    r.questions.push({ ...emptyQuestionAnswer("BW-01", [], "t"), rating: "satisfactory" });
  }),
  review(B, "m1", null, "2026-11-14T00:00:00Z", (r) => {
    r.flags.push({ ...emptyFlagCheck("RF-024", [], "t"), human_outcome: "verified_concern", observed_discrepancy: "Not in the NEP." });
  }),
  { ...review(C, "m3", "needs_attention", "2026-11-17T00:00:00Z"), member_name: "Ana" },
];

test("members show by name, else numbered by their first review", () => {
  const names = memberNames(cases);
  assert.equal(names.get("m1"), "Member 1");
  assert.equal(names.get("m2"), "Member 2");
  assert.equal(names.get("m3"), "Ana");
});

test("a project counts under its most serious final status, joined to the project list", () => {
  const rows = reportProjects(cases, [listed(A, true), listed(B, false, "NCR")]);
  assert.deepEqual(rows.map((p) => [p.hgabId, p.group]), [[A, "needs_immediate_attention"], [C, "needs_attention"], [B, "none"]]);
  const a = rows[0];
  assert.equal(a.reviews[0].member_id, "m2", "most serious review first");
  assert.equal(a.title, `Listed ${A}`);
  assert.equal(a.amount, 5_000_000);
  assert.deepEqual(a.districts, ["Cavite, 1st District"]);
  assert.equal(a.docs, 3);
  assert.equal(rows[1].insertion, null, "not in the project list: the review's own copy");
  assert.equal(rows[1].amount, 1_000_000);

  const total = totalTally(rows, 3);
  assert.equal(total.projects, 3);
  assert.equal(total.reviews, 4);
  assert.equal(total.groups.needs_immediate_attention.projects, 1);
  assert.equal(total.groups.none.amount, 5_000_000);
  const bySource = tallyBy(rows, insertionKey, (k) => (k === "insertion" ? 10 : null));
  assert.deepEqual(bySource.map((t) => [t.key, t.projects, t.of]), [["insertion", 1, 10], ["unknown", 1, null], ["nep", 1, null]]);
});

test("question tallies, answer lines and CSV rows", () => {
  const qs = questionTallies(cases);
  const bw16 = qs.find((q) => q.id === "BW-16")!;
  assert.equal(bw16.answered, 1);
  assert.equal(bw16.ratings.needs_immediate_attention, 1);
  assert.deepEqual(bw16.urgentProjects, [A]);
  assert.equal(qs.length, 16);

  assert.deepEqual(checkTallies(cases), [{ id: "RF-024", title: checkTallies(cases)[0].title, answered: 1, outcomes: [{ label: "Verified concern", count: 1 }], projects: [B] }]);

  const lines = answerLines(cases[1].review);
  assert.deepEqual(lines.map((l) => l.id), ["BW-16", "BW-01"], "most serious first");
  assert.equal(answerLines(cases[2].review)[0].older, true);

  const rows = reportProjects(cases, [listed(A, true)]);
  const names = memberNames(cases);
  const csv = reviewRows(rows, names, "https://budget.bettergov.ph");
  assert.equal(csv.length, 4);
  assert.ok(csv.every((r) => r.length === REPORT_REVIEW_COLUMNS.length));
  assert.equal(csv[0][REPORT_REVIEW_COLUMNS.indexOf("Final remarks")], "No POW for this line.");
  assert.equal(csv[0][REPORT_REVIEW_COLUMNS.indexOf("House insertion")], "Yes");
  assert.match(csv[0].at(-1)!, /\/hgab\/2027\/review\?p=HB10858-3-0001-000001$/);
  const answers = answerRows(rows, names);
  assert.ok(answers.every((r) => r.length === REPORT_ANSWER_COLUMNS.length));
  assert.deepEqual(answers.map((r) => r[5]), ["BW-16", "BW-01", "RF-024"]);
});

// --- The hand-over pages (2026-11-18): the automatic review counted, red flags and documents on every project ---------

const D = "HB10858-3-0004-000004", E = "HB10858-3-0005-000005";
const auto = (p: ReviewProject): ReviewProject => ({ ...p, docs: 0, files: 0, source: "none", auto: { rules: ["no-key-documents"], score: 100 } });

test("the automatic review counts in the report until a member reviews the project", () => {
  // A: members (immediate attention); B: auto-marked but reviewed by a member; D: auto only; E: neither.
  const all = [listed(A, true), auto(listed(B, false, "NCR")), auto(listed(D, true, "NCR")), listed(E, false)];
  assert.deepEqual(reportProjects(cases, all).map((p) => p.hgabId), [A, C, B], "without withAuto, members' reviews only");
  const rows = reportProjects(cases, all, true);
  assert.deepEqual(rows.map((p) => [p.hgabId, p.group]), [[A, "needs_immediate_attention"], [C, "needs_attention"], [D, "auto"], [B, "none"]]);
  assert.equal(rows.find((p) => p.hgabId === B)!.auto?.score, 100, "a member's review takes over, the automatic one is kept");
  assert.deepEqual(rows.find((p) => p.hgabId === D)!.reviews, []);

  const groups = groupIndex(all, rows);
  assert.deepEqual([A, B, D, E].map((h) => groups.get(h)), ["needs_immediate_attention", "none", "auto", "not_reviewed"]);
  const counts = groupCounts(all, (h) => groups.get(h)!);
  assert.equal(counts.auto.projects, 1);
  assert.equal(counts.not_reviewed.amount, 5_000_000);
  // Review-only CSVs leave the automatic ones out (no review to list).
  assert.equal(reviewRows(rows, memberNames(cases), "https://x").length, 4);
  // Tallies put attention, the automatic review's included, first.
  const byRegion = tallyBy(rows, (p) => [p.region, p.region]);
  assert.deepEqual(byRegion.map((t) => [t.key, t.groups.auto.projects]), [["Region IV-A", 0], ["NCR", 1]]);
});

test("red flags and documents on every project", () => {
  const flags = [
    { code: "missing-pow", label: "Missing POW", family: "documents", n: 2, computed: true, source: "bettergov" },
    { code: "potential-nep-insertion", label: "Potential NEP insertion", family: "nep", n: 1 },
  ] as ReviewIndexFlag[];
  const all = [{ ...listed(A, true), flags: [0, 1] }, { ...auto(listed(D, true)), flags: [0] }, { ...listed(E, false), flags: [], docs: 0b11111, files: 9 }];
  const groupOf = (h: string) => (h === D ? "auto" as const : "not_reviewed" as const);
  const t = flagTallies(flags, all, groupOf);
  assert.deepEqual(t.map((x) => [x.flag.code, x.projects, x.amount, x.groups.auto.projects]), [["missing-pow", 2, 10_000_000, 1], ["potential-nep-insertion", 1, 5_000_000, 0]]);

  assert.deepEqual(all.map(docLevel), ["partial", "none", "complete"]);
  const d = docTally(all);
  assert.deepEqual(d.levels, { complete: 1, partial: 1, none: 1 });
  assert.deepEqual(d.byType, [2, 2, 2, 1, 1]);
  assert.deepEqual(d.byCount, [1, 0, 0, 1, 0, 1]);
  assert.equal(d.files, 12);
  assert.equal(d.sources.none, 1);
  const byIns = docTallies(all, (p) => (p.insertion ? ["insertion", "House insertions"] : ["nep", "NEP only"]));
  assert.deepEqual(byIns.map((x) => [x.key, x.projects, x.levels.complete]), [["insertion", 2, 0], ["nep", 1, 1]], "fewest complete first");
});

test("the report's pages have their own addresses", () => {
  assert.equal(reportPath(), "/hgab/2027/review/report");
  assert.equal(reportPath("flags"), "/hgab/2027/review/report/flags");
  assert.equal(flagPath("missing-pow"), "/hgab/2027/review/report/flags/missing-pow");
  assert.equal(projectPath(A), `/hgab/2027/review/report/project/${A}`);
  assert.equal(new Set(REPORT_PAGES.map((p) => p.slug)).size, REPORT_PAGES.length);
});
