/**
 * npm run test:hgab-review — the team red-flag registry in the reviewer (src/lib/hgab-redflags-team.ts): the
 * detector crosswalk covers every detector flag, project types, checklists, the review's validation and the
 * workbook rows.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { NAMED_TYPES, REVIEW_INDEX_PATH, type ReviewIndex } from "../src/lib/hgab-documents";
import {
  CATEGORY, DETECTOR_TO_TEAM, DOCUMENT_TEAM_FLAG, REGISTRY, STAGE_GATED, TEAM_FLAGS, VOLUNTEER_OUTCOMES, caseEvidenceRows,
  caseIntakeRows, checklistFor, classifyProject, emptyEvidence, emptyFlagCheck, flagStatus, newCaseReview, toCsv,
  validateCaseReview, vocab, vocabCode,
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

test("workbook rows match the team's columns", () => {
  const r = fresh();
  const f = emptyFlagCheck("RF-024", ["potential-nep-insertion"], "2026-11-12T08:00:00Z");
  f.human_outcome = "unresolved_evidence_gap";
  f.observed_discrepancy = "No NEP line found.";
  f.evidence.push({ ...emptyEvidence("e1"), document_title: "HB 10858", url: "https://x/hb.pdf", locator: "p. 546", file_sha256: "ab" });
  r.flags.push(f, emptyFlagCheck("RF-001", [], "2026-11-12T08:00:00Z"));
  const rows = caseIntakeRows(r);
  assert.equal(rows.length, 1, "untouched checks are not rows");
  assert.equal(rows[0].length, REGISTRY.case_columns.length);
  const row = Object.fromEntries(REGISTRY.case_columns.map((h, i) => [h, rows[0][i]]));
  assert.equal(row["Flag ID"], "RF-024");
  assert.equal(row["Human outcome"], "Unresolved / evidence gap");
  assert.ok(vocab("human_outcome").some((o) => o.label === row["Human outcome"]));
  assert.equal(row["Flag description (lookup)"], TEAM_FLAGS.get("RF-024")!.title);
  const ev = caseEvidenceRows(r);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].length, REGISTRY.evidence_columns.length);
  const csv = toCsv(REGISTRY.case_columns, rows);
  assert.ok(csv.startsWith("\uFEFFCase ID,"));
});
