# The review form: the volunteer team's red-flag checklist

The project reviewer (`/hgab/2027/review`) asks volunteers to work through the volunteer team's red-flag registry for each project. A review is a `CaseReview`, shaped for a future API. There is no backend yet: reviews stay in the browser (localStorage) and download as JSON (the API payload) or as rows for the team's workbook.

Code: `src/lib/hgab-redflags-team.ts` (pure: registry, crosswalk, checklist, payload, validation, workbook rows), `src/components/HgabReviewForm.tsx` (the form), `src/lib/hgab-review-export.ts` (downloads). Tests: `npm run test:hgab-review`.

## The team's workbook

`Red_Flag_Volunteer_Crosswalk_Ready_for_Team.xlsx`, "Volunteer-ready draft v2 — 12 November 2026", SHA-256 `d6fb880dc7f89cb657a80f6927b80f884abf7a34ddef18210d60e6b0ae1398d3`. A copy is kept at `data/hgab/2027/review-registry/red-flag-volunteer-crosswalk-v2.xlsx`.

`npm run build:hgab-redflag-registry` (Python and openpyxl, in a uv venv; ExcelJS can't open this workbook) writes the checked-in `src/lib/hgab-redflag-registry.json`, verbatim:

- the 44 flags (RF-001…RF-044). Each has its category, lead and support roles, granular instructions, minimum evidence, safeguard and the team's notes. Continuation rows 7, 14 and 20 are folded into the flag above them, and RF-030's working notes are separated from its title.
- the 24 unmerged draft indicators with their crosswalk. These are kept for reference only, never used, because the workbook says they are "not automatically added".
- the 35 role tasks (T01…T35) and the 9-step workflow.
- the column order of CASE INTAKE & TRACKER and CASE EVIDENCE TEMPLATE.
- every dropdown vocabulary (case stage, evidence applicability, risk priority, human outcome, availability, verification state…).

Encoder names are left out; the workbook asks that personal details stay with authorized reviewers. The build fails unless the counts match the workbook's START HERE sheet (44, 24, 35, 9). Re-run it when the team sends a new version. A new SHA-256 makes reviews made under the old registry fail validation with "Made with another version of the team registry."

## Reconciliation: detector flags and team checks

They are different things, and the team's integration spec says so: `detector_rule_id` is "NOT identical to volunteer Flag ID".

- **Detector flags** say where to look. They are research.bettergov.ph's 39 flags plus our 5 "Missing …" document flags (`review.json` codes).
- **Team checks** say what a person verifies, who leads, what evidence is needed and what not to conclude.

`DETECTOR_TO_TEAM` maps every detector flag to the team checks it suggests. It is our proposal ("Proposed by BetterGov, 2026-11-12 · pending team review"), and the tests fail if a detector code is missing or names an unknown RF. A suggested check is an **AI candidate**, never a finding.

| Detector flag | Projects | Suggests |
| --- | ---: | --- |
| Potential NEP insertion | 5,548 | RF-024 |
| No selected NEP counterpart | 6,105 | RF-024 |
| NEP counterpart pairing is ambiguous | 556 | RF-024 |
| NEP counterpart needs scope review | 530 | RF-024, RF-016 |
| Allocation increase | 215 | RF-024 |
| Allocation decrease | 207 | RF-024 |
| Implementing office changed between NEP and House bill | 66 | RF-024, RF-023 |
| Within-NEP counterpart repeat candidate | 25 | RF-034 |
| Repeated allocation amount | 10,304 | RF-022 |
| Uniform RCS allocation amount | 1 | RF-022 |
| High allocation vs same-category peers | 384 | RF-035, RF-010 |
| High allocation per stated meter | 191 | RF-002, RF-035 |
| High cost per stated meter vs peers | 191 | RF-002, RF-035 |
| Extreme cost per stated meter vs peers | 111 | RF-002, RF-035 |
| Cost per meter unavailable · length review | 1,094 | RF-002, RF-025 |
| Very short printed project range | 8 | RF-002, RF-025 |
| Possible project doppelgänger · coordinates under 50 m apart | 124 | RF-001, RF-034 |
| Historical GAA coordinate doppelgänger · under 50 m | 14 | RF-001, RF-034, RF-009 |
| MPB same-site coordinate candidate · under 50 m | 12 | RF-001, RF-034 |
| MPB same-barangay coordinate pair | 113 | RF-001 |
| Coordinate falls outside its named locality · map review | 170 | RF-001 |
| Out of Place map review · printed coordinate | 176 | RF-001 |
| MPB location boundary review | 145 | RF-001 |
| MPB location boundary review · point at boundary | 1 | RF-001 |
| MPB location boundary match unresolved | 495 | RF-001 |
| Conflicting DEO and congressional district labels · irreconcilable | 117 | RF-001 |
| Historical project repeat candidate | 1,454 | RF-034, RF-009 |
| Historical GAA title recurrence | 709 | RF-009, RF-034 |
| MPB historical site or scope repeat candidate | 649 | RF-034, RF-009, RF-029 |
| Within-House bill repeat candidate | 157 | RF-034 |
| Explicit historical chainage overlap | 17 | RF-016, RF-034 |
| Bridge rated Good/Fair in inventory · assessment date needed | 167 | RF-018, RF-003 |
| Rehabilitation on recorded Good/Fair segment | 2 | RF-017 |
| Road rehabilitation · recorded segment rated Good/Fair | 2 | RF-017 |
| No listed DPWH Transparency documents | 15,228 | RF-033, RF-021 |
| DPWH Transparency match not verified | 6,886 | RF-033 |
| No listed RDC | 7,731 | RF-044, RF-033 |
| No listed geotagged photos | 1,252 | RF-040, RF-033 |
| No listed POW | 44 | RF-039, RF-033 |
| Missing POW | 2,291 | RF-039, RF-033 |
| Missing BP 202 | 2,298 | RF-038, RF-033 |
| Missing Development Council | 10,791 | RF-044, RF-033 |
| Missing Geotagged photos | 4,249 | RF-040, RF-033 |
| Missing Certificate of Implementability | 2,401 | RF-041, RF-033 |

22 of the 44 checks have no detector yet. Volunteers check them by hand, and the Team checklist filter shows them as "No red flag points here yet": RF-004 No watershed or drainage master plan; RF-005 Edited geotagged photos; RF-006 Not complete set of plans; RF-007 No identified water source; RF-008 No identified purpose; RF-011 Repeated awards to the same contractor; RF-012 Repeated awards despite poor performance; RF-013 Unsubstantiated pumping capacity; RF-014 Inconsistent or unsupported project quantities; RF-015 Unclear discharge or outfall arrangement; RF-019 Unclear physical scope and capacity; RF-020 Unrealistic construction duration; RF-026 Conflicting document dates; RF-027 Project plans are not signed and sealed; RF-028 At least one of the professionals who signed and sealed the plans are not in the database of PRC; RF-030 Apparent multi-phased project might have issues; RF-031 Unjustified embankment boulder-fill quantities; RF-032 Unsubstantiated quarry sources and hauling  costs; RF-036 Conflicting document dates; RF-037 Uncommon pay item; RF-042 Master Plan; RF-043 Feasibility Study. RF-042 and RF-043 still appear on a project when a Master Plan or Feasibility Study is among its files.

Other ways checks come in:

- **Documents.** The document-specific reviews (registry rows 46–52) join the checklist when the document is on file: BP 202 → RF-038, POW → RF-039, Geotagged photos → RF-040, Certificate of Implementability → RF-041, Development Council → RF-044. A Proposal file typed Master Plan or Feasibility Study brings in RF-042 or RF-043.
- **Project type.** `classifyProject` reads the DPWH PAP and the title and returns roads, bridge, flood, buildings, water or rainwater; BIP "Access Roads and/or Bridges" lines are split by title. A project gets the "Applicable to all" checks plus those of its types. 31 projects (ports, septage) match no type and get only "Applicable to all". The 216 "Rainwater Collector System" rows in our data are office lump sums, not projects, so they are not in the review set.
- **Stage.** RF-011 and RF-012 (contractor awards) are "Not yet due at the budget stage". Their own safeguards say they apply only once work is awarded.

## The form

For each project:

1. **Documents on file** (RF-033): for each of the 5 key documents, its availability, in the workbook's vocabulary, and whether the file we matched is for this project.
2. **The checklist**, in groups: suggested by this project's red flags, the documents on file, other checks for this kind of project (collapsed), and not yet due (collapsed). Each check shows:
   - its lead role, what to check, the team's notes, the minimum evidence and the **safeguard**;
   - then the volunteer's answers: does it apply now, what you found (facts only), evidence, and the outcome.
3. **Evidence** is one of the project's files or any link. Each piece records:
   - page, table or cell;
   - availability and whether it applies at this stage;
   - the volunteer's check of the extract;
   - the verbatim fact, and the volunteer's observation.
4. **The case**: name (optional), role (T-task), case stage, suggested priority, next action and notes.

**Save draft** always works. **Ready for independent review** runs validation and sets the case stage to "In independent review" (workflow step 5).

The **Team checklist** filter in the bar keeps projects whose detector flags suggest any checked RF. Each option shows how many projects it would keep.

## The payload (`CaseReview`, schema `bettergov.hgab-review/1`)

```json
{
 "schema": "bettergov.hgab-review/1",
 "case_id": "6f1c…",
 "registry": {
  "version": "Volunteer-ready draft v2 — 12 November 2026",
  "sha256": "d6fb880d…",
  "mapping": "Proposed by BetterGov, 2026-11-12 · pending team review"
 },
 "project": {
  "hgab_id": "HB10858-3-0546-008478",
  "project_id": "house-reading:8501",
  "budget_source_version": "House bill HB 10858, 3rd reading (FY2027)",
  "title": "Construction of Roads and Drainage at Barangay Banlic, Calamba City, Laguna",
  "office": "Laguna 2nd District Engineering Office",
  "region": "Region IV-A",
  "amount_php": 10000000,
  "categories": [
   "roads",
   "flood"
  ],
  "detector_rule_ids": [
   "potential-nep-insertion",
   "repeated-allocation-amount"
  ]
 },
 "reviewer": {
  "reviewer_id": "2d9b…",
  "display_name": "",
  "task_id": "T13"
 },
 "case_stage": "in_independent_review",
 "risk_priority": "not_prioritized",
 "documents": [
  {
   "named_type": "POW",
   "availability": "available",
   "matches_project": "yes"
  }
 ],
 "flags": [
  {
   "flag_id": "RF-024",
   "detector_rule_ids": [
    "potential-nep-insertion"
   ],
   "applicability": "required_now",
   "observed_discrepancy": "No NEP line with this title, office or amount.",
   "human_outcome": "unresolved_evidence_gap",
   "evidence": [
    {
     "evidence_id": "e1",
     "source_institution": "Senate copy of DPWH’s documents",
     "document_title": "2027DPWH-HGAB-12253_POW.pdf",
     "url": "https://budget-assets.bettergov.ph/…/2027DPWH-HGAB-12253_POW.pdf",
     "file_link_id": null,
     "file_sha256": null,
     "locator": "p. 1",
     "extracted_fact": "Construction of Roads and Drainage at Barangay Banlic … ₱10,000,000.00",
     "reviewer_observation": "",
     "applicable_at_stage": "yes",
     "availability": "available",
     "verification_state": "verified"
    }
   ],
   "updated_at": "2026-11-12T10:00:00Z"
  }
 ],
 "notes": "",
 "next_action": "",
 "created_at": "2026-11-12T09:40:00Z",
 "updated_at": "2026-11-12T10:00:00Z",
 "submitted_at": null,
 "client": {
  "app": "bettergov-budget/hgab-review",
  "data_built_at": "2026-11-12T03:03:00Z"
 }
}
```

- Codes are the workbook's labels in snake case (`vocabCode`: "Cleared / explained" → `cleared_explained`). `vocab(key)` gives code and label for every dropdown.
- `registry.sha256` pins which registry the `flag_id`s mean.
- `project.hgab_id` is the stable key. `project_id` is ours and positional, so treat it as a hint.
- `reviewer_id` is a random id kept in the browser (`hgab-review:reviewer`); `display_name` is optional.
- Only checks a volunteer touched are in `flags`.
- `submitted_at` is for the API to set.

## Validation (`validateCaseReview`; the API should run the same)

Errors block "Ready for independent review". The rules come from the workbook's safeguards and handoff rules:

- The schema and registry version must match, and every `flag_id` must be in the registry, each listed once.
- Every value must be in its vocabulary, and a `task_id` must be in the role catalog.
- Volunteers can't record "Referred with approval", which belongs to the review committee (step 8).
- A check marked "Not yet due" or "Not applicable" can't be a "Verified concern" ("No red flag from missing not-yet-required approval"). Neither can a stage-gated check (RF-011, RF-012).
- "Verified concern" and "Cleared / explained" need at least one piece of evidence. "Verified concern" and "Unresolved / evidence gap" need the observed facts.
- Evidence must name a document or give an http(s) link.
- A case in independent review or completed needs at least one outcome.
- Warnings, which don't block: a check started but without an outcome; available evidence with no page, table or cell.

## Rows for the team's workbook

- `caseIntakeRows`: one CASE INTAKE & TRACKER row per check the volunteer worked on, in the workbook's column order. The case ID is `case_id/RF-xxx`. "Initial screening source" names the research.bettergov.ph flags or our document matching.
- `caseEvidenceRows`: one CASE EVIDENCE TEMPLATE row per piece of evidence.

Columns for later workflow steps stay blank: independent verifier, the budget-origin and readiness/value assessments (step 6), due date and disposition approval (step 8). The rows download as CSV (UTF-8 with BOM) and paste into the workbook.

## For the API (not built)

- `POST /api/v1/hgab/2027/reviews` takes a `CaseReview`, runs `validateCaseReview` on the server, sets `submitted_at` and returns the stored case. It is idempotent on `case_id`.
- `GET /api/v1/hgab/2027/reviews?hgab_id=…` lists a project's reviews, for the independent verifier.
- `GET /api/v1/hgab/2027/reviews/status` returns a `ReviewStatusIndex` (`hgab_id` → status, number of reviews, last update; `src/lib/hgab-review.ts`). It feeds the list's status chips, the review-status filter and the review-status sort, which today read this browser's reviews.
- Storage could be a D1 table per case plus one per check and per piece of evidence, matching the workbook rows. A D1 table needs the maintainer's go-ahead.
- Before reviews go public, decide what is shown. The workbook asks that case notes and personal data stay with authorized reviewers.

## Migration

Reviews from the reviewer's first version (`hgab-review:v1`: one verdict per document, an overall answer and notes) become cases on load (`fromV1`). The document answers carry over and the rest goes into the notes. The old key is then removed.

## Not taken in

- The 24 draft indicators. Promoting any of them is the team's decision.
- Steps 6–9 (scoring, prioritising, routing, closing). They need approved rubrics and authority; the form only suggests a priority.
- Assignment and routing status from LIVE FLAG ROUTING: there are no accounts yet.
