/**
 * npm run test:hgab-review — the team red-flag registry in the reviewer (src/lib/hgab-redflags-team.ts): the
 * detector crosswalk covers every detector flag, the 16 questions group the 44 checks, project types, checklists and
 * questions, the review's validation and intake, and the report rows.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { NAMED_TYPES, REVIEW_INDEX_PATH, type ReviewIndex } from "../src/lib/hgab-documents";
import {
  CATEGORY, DETECTOR_TO_TEAM, DOCUMENT_TEAM_FLAG, QUESTIONS, QUESTION_OF_FLAG, REGISTRY, STAGE_GATED, TEAM_FLAGS, VOLUNTEER_OUTCOMES,
  caseTouched, checklistFor, classifyProject, detectorsForQuestion, emptyEvidence, emptyFlagCheck, emptyQuestionAnswer, flagStatus, newCaseReview, newId,
  questionsFor, readCaseReview, readVerdict, toCsv, upgradeCaseReview, verdictRows, VERDICT_COLUMNS, validateCaseReview, vocabCode, worseRating,
  type CaseReview,
} from "../src/lib/hgab-redflags-team";

const ixPath = resolve("data/hgab/2027", REVIEW_INDEX_PATH);
const ix = existsSync(ixPath) ? (JSON.parse(readFileSync(ixPath, "utf8")) as ReviewIndex) : null;

test("the registry is the team's workbook, whole", () => {
  assert.equal(REGISTRY.flags.length, 44);
  assert.equal(REGISTRY.tasks.length, 35);
  assert.equal(REGISTRY.workflow.length, 9);
  assert.equal(REGISTRY.drafts.length, 24);
  assert.match(REGISTRY.source.sha256, /^[0-9a-f]{64}$/);
  assert.ok(REGISTRY.flags.every((f) => f.safeguard && f.instructions && f.lead_skill));
  // The categories the classifier uses are the registry's own.
  const cats = new Set(REGISTRY.flags.map((f) => f.category));
  for (const c of Object.values(CATEGORY)) assert.ok(cats.has(c), c);
  assert.ok(!JSON.stringify(REGISTRY).includes("Jayson"), "encoder names stay out of the public registry");
  assert.ok(!VOLUNTEER_OUTCOMES.some((o) => o.code === "referred_with_approval"));
  assert.equal(vocabCode("Cleared / explained"), "cleared_explained");
});

test("the 16 questions group the 44 checks, each once, as the team's proposal says", () => {
  assert.equal(QUESTIONS.length, 16);
  assert.deepEqual(QUESTIONS.map((q) => q.id), Array.from({ length: 16 }, (_, i) => `BW-${String(i + 1).padStart(2, "0")}`));
  const named = QUESTIONS.flatMap((q) => q.flag_ids);
  assert.equal(named.length, 44);
  assert.deepEqual([...named].sort(), [...TEAM_FLAGS.keys()].sort());
  assert.match(REGISTRY.questions_source.sha256, /^[0-9a-f]{64}$/);
  assert.match(REGISTRY.questions_source.status, /NOT APPROVED/, "say so while it is a proposal");
  // The two "Conflicting document dates" are one question; the document checks are the documents question.
  assert.equal(QUESTION_OF_FLAG.get("RF-026")?.id, QUESTION_OF_FLAG.get("RF-036")?.id);
  for (const t of NAMED_TYPES) assert.equal(QUESTION_OF_FLAG.get(DOCUMENT_TEAM_FLAG[t])?.id, "BW-16", t);
});

test("DPWH Transparency's listing is no gap: Senate-only projects are never listed there", () => {
  for (const c of ["no-listed-dpwh-transparency-documents", "dpwh-transparency-match-not-verified", "no-listed-rdc", "no-listed-geotagged-photos", "no-listed-pow"]) {
    assert.deepEqual(DETECTOR_TO_TEAM[c], [], c);
  }
  // Our missing-document flags count files from both sources, and still suggest the documents question.
  assert.ok(detectorsForQuestion("BW-16").includes("missing-pow"));
  assert.ok(!detectorsForQuestion("BW-16").includes("no-listed-dpwh-transparency-documents"));
  assert.ok(!detectorsForQuestion("BW-12").includes("no-listed-dpwh-transparency-documents"), "nor a readiness question");
});

test("a project's questions: the documents and flagged ones first, not-yet-due last, only its kinds", () => {
  const items = questionsFor({ categories: ["buildings"], detectorCodes: ["potential-nep-insertion", "no-listed-dpwh-transparency-documents"], documentTypes: ["BP 202"] });
  const by = new Map(items.map((x) => [x.question.id, x]));
  assert.equal(by.get("BW-06")?.group, "suggested");
  assert.deepEqual(by.get("BW-06")?.detectors, ["potential-nep-insertion"]);
  assert.equal(by.get("BW-16")?.group, "suggested", "the documents question is always asked");
  assert.deepEqual(by.get("BW-16")?.detectors, [], "a missing DPWH Transparency listing suggests nothing");
  assert.equal(by.get("BW-12")?.group, "more");
  assert.equal(by.get("BW-08")?.group, "later", "procurement only once contracts are awarded");
  assert.ok(!by.has("BW-09"), "flood and drainage adequacy doesn't apply to a building");
  assert.ok(!by.has("BW-10") && !by.has("BW-11"));
  assert.ok(by.get("BW-03")!.flags.some((f) => f.id === "RF-010"), "building cost per sq m, under unit costs");
  const order = items.map((x) => x.group);
  assert.deepEqual(order, [...order].sort((a, b) => ["suggested", "more", "later"].indexOf(a) - ["suggested", "more", "later"].indexOf(b)));
  const flood = questionsFor({ categories: ["flood"], detectorCodes: [], documentTypes: [] });
  assert.ok(flood.some((x) => x.question.id === "BW-09"));
});

test("questions on every project", { skip: !ix && "review.json not built" }, () => {
  for (const [hgabId, , title, , , , , flagIdx] of ix!.rows) {
    const codes = flagIdx.map((i) => ix!.flags[i].code);
    const items = questionsFor({ categories: classifyProject({ title }), detectorCodes: codes, documentTypes: [] });
    assert.ok(items.length >= 13 && items.length <= 16, `${hgabId}: ${items.length}`);
    assert.equal(new Set(items.map((x) => x.question.id)).size, items.length);
    for (const x of items) for (const d of x.detectors) assert.ok(codes.includes(d), `${hgabId} ${x.question.id} ${d}`);
  }
});

test("one scale for every answer; the earlier final status reads on it", () => {
  assert.equal(worseRating(null, "satisfactory"), "satisfactory");
  assert.equal(worseRating("needs_attention", "satisfactory"), "needs_attention");
  assert.equal(worseRating("needs_attention", "needs_immediate_attention"), "needs_immediate_attention");
  assert.equal(readVerdict("unsatisfactory"), "needs_attention", "the two-way scale said nothing of urgency");
  assert.equal(readVerdict("needs_immediate_attention"), "needs_immediate_attention");
  assert.equal(readVerdict("fine"), null);
  assert.equal(readVerdict(undefined), null);
});

test("every detector flag has a crosswalk entry, and every entry names real team flags", { skip: !ix && "review.json not built" }, () => {
  const missing = ix!.flags.map((f) => f.code).filter((c) => !(c in DETECTOR_TO_TEAM));
  assert.deepEqual(missing, []);
  const unknown = Object.entries(DETECTOR_TO_TEAM).flatMap(([c, ids]) => ids.filter((id) => !TEAM_FLAGS.has(id)).map((id) => `${c} → ${id}`));
  assert.deepEqual(unknown, []);
  const stale = Object.keys(DETECTOR_TO_TEAM).filter((c) => !ix!.flags.some((f) => f.code === c));
  assert.deepEqual(stale, [], "crosswalk lists detector codes review.json no longer has");
  for (const t of NAMED_TYPES) assert.ok(TEAM_FLAGS.has(DOCUMENT_TEAM_FLAG[t]), t);
});

test("project types", () => {
  const c = (title: string, pap: string) => classifyProject({ title, pap });
  assert.deepEqual(c("Construction of Multi-Purpose Building, Barangay X", "BIP - Multi-Purpose Buildings/ Facilities to support Social Services"), ["buildings"]);
  assert.deepEqual(c("Construction of Bridge along Barangay A-B Road", "BIP - Access Roads and/or Bridges from the National Roads leading to Major/ Strategic Public Buildings/ Facilities"), ["roads", "bridge"]);
  assert.deepEqual(c("Concreting of Road, Barangay X", "BIP - Access Roads and/or Bridges from the National Roads leading to Major/ Strategic Public Buildings/ Facilities"), ["roads"]);
  assert.deepEqual(c("Pancian Viaduct along Manila North Road", "Rehabilitation/ Major Repair of Permanent Bridges"), ["roads", "bridge"]);
  assert.deepEqual(c("Construction of Revetment along Carmona River", "Construction/ Maintenance of Flood Mitigation Structures and Drainage Systems"), ["flood"]);
  assert.deepEqual(c("Improvement of Road with Drainage Canal", "BIP - Access Roads and/or Bridges from the National Roads leading to Major/ Strategic Public Buildings/ Facilities"), ["roads", "flood"]);
  assert.deepEqual(c("Construction of Level II Water Supply System", "Water Supply System"), ["water"]);
  assert.deepEqual(c("Construction of Rainwater Collector", "Rainwater Collector System"), ["rainwater"]);
});

test("a project's checklist: suggested first, later-stage last, only its kinds of check", () => {
  const items = checklistFor({ categories: ["buildings"], detectorCodes: ["potential-nep-insertion", "missing-pow"], documentTypes: ["BP 202", "Feasibility Study"] });
  const by = new Map(items.map((x) => [x.flag.id, x]));
  assert.equal(by.get("RF-024")?.group, "suggested");
  assert.deepEqual(by.get("RF-039")?.detectors, ["missing-pow"]);
  assert.equal(by.get("RF-038")?.group, "documents");
  assert.equal(by.get("RF-043")?.group, "documents");
  assert.equal(by.get("RF-010")?.group, "category", "building cost per sq m applies to buildings");
  assert.ok(!by.has("RF-016"), "road chainages don't apply to a building");
  for (const id of Object.keys(STAGE_GATED)) assert.equal(by.get(id)?.group, "later");
  const order = items.map((x) => x.group);
  assert.deepEqual(order, [...order].sort((a, b) => ["suggested", "documents", "category", "later"].indexOf(a) - ["suggested", "documents", "category", "later"].indexOf(b)));
  assert.equal(new Set(items.map((x) => x.flag.id)).size, items.length);
});

test("checklists on every project", { skip: !ix && "review.json not built" }, () => {
  // Every project gets at least the checks that apply to all, and every suggested check comes from its own flags.
  const all = REGISTRY.flags.filter((f) => f.category === "Applicable to all").length;
  for (const [hgabId, , title, , , , , flagIdx] of ix!.rows.slice(0, 3000)) {
    const codes = flagIdx.map((i) => ix!.flags[i].code);
    const items = checklistFor({ categories: classifyProject({ title }), detectorCodes: codes, documentTypes: [] });
    assert.ok(items.length >= all, hgabId);
    for (const x of items) for (const d of x.detectors) assert.ok(codes.includes(d), `${hgabId} ${x.flag.id} ${d}`);
  }
});

const project = {
  hgab_id: "HB10858-3-0546-008478", project_id: "house-reading:8501", budget_source_version: "House bill HB 10858, 3rd reading (FY2027)",
  title: "Construction of Roads and Drainage at Barangay Banlic", office: "Laguna 2nd District Engineering Office", region: "Region IV-A",
  amount_php: 10_000_000, categories: ["roads", "flood"] as ("roads" | "flood")[], detector_rule_ids: ["potential-nep-insertion"],
};
const fresh = () => newCaseReview({ caseId: "c1", reviewer: { reviewer_id: "r1", display_name: "", task_id: "" }, project, dataBuiltAt: "2026-11-12", now: "2026-11-12T00:00:00Z" });

test("validation follows the workbook's safeguards", () => {
  const r = fresh();
  assert.deepEqual(validateCaseReview(r).filter((i) => i.level === "error"), []);
  const f = emptyFlagCheck("RF-024", ["potential-nep-insertion"], "2026-11-12T00:00:00Z");
  assert.equal(flagStatus(f), "ai_candidate");
  r.flags.push(f);
  f.human_outcome = "verified_concern";
  const msgs = () => validateCaseReview(r).filter((i) => i.level === "error").map((i) => i.message).join(" | ");
  assert.match(msgs(), /evidence/);
  assert.match(msgs(), /facts only/);
  f.observed_discrepancy = "Not in the NEP; House bill p. 546.";
  f.evidence.push({ ...emptyEvidence("e1"), document_title: "HB 10858 Vol I-C", url: "https://example.org/hb.pdf", locator: "p. 546", availability: "available" });
  assert.equal(msgs(), "");
  assert.equal(flagStatus(f), "human_outcome");
  f.applicability = "not_yet_due";
  assert.match(msgs(), /can’t be a verified concern/);
  f.applicability = "required_now";
  f.human_outcome = "referred_with_approval";
  assert.match(msgs(), /committee/);
  f.human_outcome = "verified_concern";
  r.flags.push(emptyFlagCheck("RF-999", [], "x"));
  assert.match(msgs(), /Not in the team registry/);
  r.flags.pop();
  r.flags.push({ ...emptyFlagCheck("RF-011", [], "x"), human_outcome: "verified_concern", observed_discrepancy: "x", evidence: [{ ...emptyEvidence("e2"), document_title: "d" }] });
  assert.match(msgs(), /Procurement/);
  r.flags.pop();
  const r2 = fresh();
  r2.case_stage = "in_independent_review";
  assert.match(validateCaseReview(r2).map((i) => i.message).join(), /independent review/);
  r.case_stage = "nonsense";
  assert.match(msgs(), /case stage/);
});

test("the API's intake keeps a well-formed review as is and refuses anything else", () => {
  const r = fresh();
  r.case_id = "2b1f0c9e-5d1a-4c51-9a58-1f0c2d3e4f5a";
  r.flags.push({
    ...emptyFlagCheck("RF-024", ["potential-nep-insertion"], "2026-11-12T00:00:00Z"), human_outcome: "verified_concern", observed_discrepancy: "Not in the NEP.",
    evidence: [{ ...emptyEvidence("e1"), document_title: "HB 10858 Vol I-C", url: "https://example.org/hb.pdf", locator: "p. 546", availability: "available" }],
  });
  r.questions.push({ ...emptyQuestionAnswer("BW-06", ["potential-nep-insertion"], "2026-11-17T00:00:00Z"), rating: "needs_attention", remark: "Not in the NEP." });
  r.verdict = "needs_immediate_attention";
  r.notes = "Final remarks.";
  const ok = readCaseReview(JSON.parse(JSON.stringify(r)));
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.review, r);
  // Unknown fields are dropped, not stored.
  assert.equal("extra" in readCaseReview({ ...r, extra: "x" }).review!, false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a free-form copy, to break on purpose
  const refuse = (patch: (x: any) => void, why: RegExp) => {
    const x = JSON.parse(JSON.stringify(r));
    patch(x);
    const out = readCaseReview(x);
    assert.equal(out.review, null, String(why));
    assert.match(out.problems.join(" | "), why);
  };
  refuse((x) => { x.schema = "v0"; }, /schema/);
  refuse((x) => { x.case_id = "a b"; }, /case_id/);
  refuse((x) => { x.project.hgab_id = "HB-1"; }, /hgab_id/);
  refuse((x) => { x.project.amount_php = "10"; }, /amount_php/);
  refuse((x) => { x.notes = 5; }, /notes: expected text/);
  refuse((x) => { x.notes = "x".repeat(20_001); }, /notes: longer/);
  refuse((x) => { x.case_stage = "approved"; }, /case_stage/);
  refuse((x) => { x.flags[0].flag_id = "24"; }, /team check id/);
  refuse((x) => { x.flags.push(x.flags[0]); }, /listed twice/);
  refuse((x) => { x.flags[0].evidence.push({ ...x.flags[0].evidence[0] }); }, /used twice/);
  refuse((x) => { x.flags[0].evidence[0].evidence_id = ""; }, /evidence_id/);
  refuse((x) => { x.kind = "audit"; }, /kind/);
  refuse((x) => { x.verdict = "fine"; }, /verdict/);
  assert.equal(readCaseReview({ ...r, verdict: "unsatisfactory" }).review!.verdict, "needs_attention", "the earlier scale, read on today's");
  refuse((x) => { x.questions[0].question_id = "Q6"; }, /question id/);
  refuse((x) => { x.questions.push(x.questions[0]); }, /listed twice/);
  refuse((x) => { x.questions[0].rating = "bad"; }, /rating/);
  refuse((x) => { x.questions[0].flag_ids = ["24"]; }, /team check id/);
  refuse((x) => { x.questions[0].remark = "x".repeat(20_001); }, /remark: longer/);
  // A review saved before the questions has none.
  const before = JSON.parse(JSON.stringify(r));
  delete before.questions; delete before.registry.questions_sha256;
  assert.deepEqual(readCaseReview(before).review!.questions, []);
  assert.equal(readCaseReview(before).review!.registry.questions_sha256, "");
  refuse((x) => { x.verifies_case_id = "x"; }, /verifies_case_id/);
  refuse((x) => { x.flags[0].evidence[0].url = "javascript:alert(1)"; }, /http/);
  refuse((x) => { x.flags[0].evidence[0].availability = "maybe"; }, /availability/);
  refuse((x) => { x.flags[0].evidence = Array.from({ length: 41 }, () => x.flags[0].evidence[0]); }, /more than 40/);
  refuse((x) => { x.documents[0].matches_project = "perhaps"; }, /matches_project/);
  refuse((x) => { x.reviewer.task_id = "T99"; }, /role catalog/);
  refuse((x) => { x.updated_at = "yesterday"; }, /updated_at/);
  assert.equal(readCaseReview(null).review, null);
  assert.equal(readCaseReview([r]).review, null);
});

test("ids are kept: old reviews, retired checks, the API's own fields", () => {
  const r = fresh();
  r.case_id = "1794542748782-u50k0m4cm1b"; // an id from before newId made UUIDs: kept as is
  // A review saved before kind, verifies_case_id and revision existed is a review of its project.
  const old = JSON.parse(JSON.stringify(r));
  delete old.kind; delete old.verifies_case_id; delete old.revision; delete old.verdict;
  const read = readCaseReview(old);
  assert.deepEqual(read.problems, []);
  assert.equal(read.review!.case_id, "1794542748782-u50k0m4cm1b");
  assert.equal(read.review!.kind, "review");
  assert.equal(read.review!.verifies_case_id, null);
  assert.equal(read.review!.verdict, null, "reviews from before the final status have none");
  // A check the registry no longer has stays in a draft; only sending it for independent review is blocked.
  const retired = { ...JSON.parse(JSON.stringify(r)), flags: [emptyFlagCheck("RF-099", [], "2026-11-12T00:00:00Z")] };
  const kept = readCaseReview(retired);
  assert.deepEqual(kept.review!.flags.map((f) => f.flag_id), ["RF-099"]);
  assert.match(validateCaseReview(kept.review!).map((i) => i.message).join(), /Not in the team registry/);
  // The API sets revision and submitted_at; a client can't.
  assert.equal(readCaseReview({ ...r, revision: 7, submitted_at: "2026-11-13T00:00:00Z" }).review!.revision, null);
  assert.equal(readCaseReview({ ...r, revision: 7, submitted_at: "2026-11-13T00:00:00Z" }).review!.submitted_at, null);
  // A verification names the case it checks; a review names none.
  assert.match(validateCaseReview({ ...r, kind: "verification" }).map((i) => i.message).join(), /names the case/);
  assert.match(validateCaseReview({ ...r, verifies_case_id: "2b1f0c9e-5d1a-4c51-9a58-1f0c2d3e4f5a" }).map((i) => i.message).join(), /Only a verification/);
});

test("a final status alone is a review worth sending; so is an answer or a remark", () => {
  const r = fresh();
  assert.equal(caseTouched(r), false);
  assert.equal(caseTouched({ ...r, verdict: "needs_attention" }), true);
  assert.equal(caseTouched({ ...r, verdict: "satisfactory" }), true);
  assert.equal(caseTouched({ ...r, verdict: null }), false, "cleared again: withdrawn");
  assert.equal(caseTouched({ ...r, notes: "Final remarks." }), true);
  assert.equal(caseTouched({ ...r, questions: [{ ...emptyQuestionAnswer("BW-01", [], "t"), rating: "satisfactory" }] }), true);
  assert.equal(caseTouched({ ...r, questions: [{ ...emptyQuestionAnswer("BW-01", [], "t"), remark: "Checked the chainage." }] }), true);
  assert.equal(caseTouched({ ...r, questions: [emptyQuestionAnswer("BW-01", [], "t")] }), false);
  // An unknown question is the validator's to catch, as an unknown check is.
  assert.match(validateCaseReview({ ...r, questions: [{ ...emptyQuestionAnswer("BW-99", [], "t"), rating: "satisfactory" }] }).map((i) => i.message).join(), /questions/);
});

test("a stored review from before the questions reads on today's form, its checks kept", () => {
  const r = fresh();
  r.flags.push({ ...emptyFlagCheck("RF-040", [], "t"), human_outcome: "verified_concern", observed_discrepancy: "No photos." });
  const stored = JSON.parse(JSON.stringify({ ...r, verdict: "unsatisfactory" }));
  delete stored.questions; delete stored.registry.questions_sha256;
  const up = upgradeCaseReview(stored as CaseReview);
  assert.equal(up.verdict, "needs_attention");
  assert.deepEqual(up.questions, []);
  assert.equal(up.registry.questions_sha256, "");
  assert.deepEqual(up.flags, r.flags, "earlier answers to the checks are kept as they were");
  assert.equal(up.case_id, r.case_id);
});

test("new ids are random UUIDs, with or without randomUUID", () => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.match(newId(), uuid);
  const real = globalThis.crypto.randomUUID;
  try {
    // @ts-expect-error: as on an http:// page, where randomUUID is missing
    globalThis.crypto.randomUUID = undefined;
    const ids = new Set(Array.from({ length: 1000 }, newId));
    assert.equal(ids.size, 1000);
    for (const id of ids) assert.match(id, uuid);
  } finally {
    globalThis.crypto.randomUUID = real;
  }
});

test("the report CSV: one row per review, with its final status, final remarks and answers", () => {
  const r = { ...fresh(), verdict: "needs_immediate_attention" as const, notes: "Line 3, \"quoted\"" };
  r.questions = [
    { ...emptyQuestionAnswer("BW-16", [], "t"), rating: "needs_attention", remark: "No council endorsement." },
    { ...emptyQuestionAnswer("BW-06", [], "t"), rating: "satisfactory" },
  ];
  const rows = verdictRows(r);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].length, VERDICT_COLUMNS.length);
  assert.equal(rows[0][VERDICT_COLUMNS.indexOf("Final status")], "Needs immediate attention");
  assert.equal(rows[0][VERDICT_COLUMNS.indexOf("Final remarks")], r.notes);
  assert.equal(rows[0][VERDICT_COLUMNS.indexOf("Answers")],
    "BW-06 Possible NEP-to-GAB allocation change: Satisfactory; BW-16 Document availability, gaps and applicability: Needs attention (No council endorsement.)");
  const csv = toCsv(VERDICT_COLUMNS, rows);
  assert.ok(csv.startsWith("\uFEFFHouse bill row,"));
  assert.ok(csv.includes('"Line 3, ""quoted"""'));
  assert.equal(verdictRows(fresh())[0][VERDICT_COLUMNS.indexOf("Final status")], "Not given");
});
