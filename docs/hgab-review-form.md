# The review form: the volunteer team's questions

The project reviewer (`/hgab/2027/review`) asks volunteers the volunteer team's 16 questions for each project (BW-01…BW-16, grouping the team's 44 red-flag checks), and a final status. Every answer is on one scale: **Satisfactory**, **Needs attention** or **Needs immediate attention**. A review is a `CaseReview`. Anyone can browse the projects. **Reviewing needs a sign-in**, and reviews are kept only on the server (D1; see "Sending reviews" below), never in the browser. Members can download their reviews as CSV, one row per review.

Code: `src/lib/hgab-redflags-team.ts` (pure: registry, questions, crosswalk, checklist, payload, intake, validation, report rows), `src/components/HgabReviewForm.tsx` (the form), `src/lib/hgab-review-export.ts` (downloads), `src/worker/hgab-reviews.ts` (the API), `src/components/HgabReviewMember.tsx` (sign-in). Tests: `npm run test:hgab-review`.

## The team's workbook

`Red_Flag_Volunteer_Crosswalk_Ready_for_Team.xlsx`, "Volunteer-ready draft v2 — 12 November 2026", SHA-256 `d6fb880dc7f89cb657a80f6927b80f884abf7a34ddef18210d60e6b0ae1398d3`. A copy is kept at `data/hgab/2027/review-registry/red-flag-volunteer-crosswalk-v2.xlsx`.

`npm run build:hgab-redflag-registry` (Python and openpyxl, in a uv venv; ExcelJS can't open this workbook) writes the checked-in `src/lib/hgab-redflag-registry.json`, verbatim:

- the 44 flags (RF-001…RF-044). Each has its category, lead and support roles, granular instructions, minimum evidence, safeguard and the team's notes. Continuation rows 7, 14 and 20 are folded into the flag above them, and RF-030's working notes are separated from its title.
- the 24 unmerged draft indicators with their crosswalk. These are kept for reference only, never used, because the workbook says they are "not automatically added".
- the 35 role tasks (T01…T35) and the 9-step workflow.
- the column order of CASE INTAKE & TRACKER and CASE EVIDENCE TEMPLATE.
- every dropdown vocabulary (case stage, evidence applicability, risk priority, human outcome, availability, verification state…).

Encoder names are left out; the workbook asks that personal details stay with authorized reviewers. The build fails unless the counts match the workbook's START HERE sheet (44, 24, 35, 9). Re-run it when the team sends a new version. A new SHA-256 makes reviews made under the old registry fail validation with "Made with another version of the team registry."

### The 16 questions (the team's consolidation proposal)

`BudgetWatch_Red_Flags_44_to_16_Consolidation_Proposal.xlsx`, "FOR REVIEW — NOT APPROVED", SHA-256 `73d7eeb287abdfc89973775adb41a685d121f7cf61d5377f43cb55b11999aab1`, kept at `data/hgab/2027/review-registry/red-flag-44-to-16-consolidation-proposal.xlsx`. The same build reads it (second argument) into the registry's `questions` and `questions_source`: each question's id, title, family, the checks it groups (`flag_ids`), what to check, lead, form route and non-loss note, verbatim. The build fails unless every one of the 44 checks is in exactly one question, the groups and mapping sheets agree, and each check's title, category and lead specialist match the crosswalk (they all do). The crosswalk's own fingerprint is unchanged, so reviews made before still validate.

| Question | Checks |
| --- | --- |
| BW-01 Project overlap, duplication and chainage | RF-001, RF-016, RF-034 |
| BW-02 Scope, physical targets and quantities | RF-002, RF-014, RF-019, RF-025 |
| BW-03 Unit costs, unusual pay items and material sourcing | RF-010, RF-031, RF-032, RF-035, RF-037 |
| BW-04 Repeated or identical project cost breakdown | RF-022 |
| BW-05 Inconsistent costs across source documents | RF-023 |
| BW-06 Possible NEP-to-GAB allocation change | RF-024 |
| BW-07 Previous work, recurrence and completion | RF-003, RF-009 |
| BW-08 Contractor award pattern and performance | RF-011, RF-012 (not yet due) |
| BW-09 Flood/drainage system adequacy | RF-004, RF-013, RF-015 |
| BW-10 Water supply and rainwater project purpose | RF-007, RF-008 |
| BW-11 Road and bridge treatment/condition justification | RF-017, RF-018 |
| BW-12 Implementation readiness, duration and phasing | RF-020, RF-021, RF-029, RF-030 |
| BW-13 Plans completeness and professional authentication | RF-006, RF-027, RF-028 |
| BW-14 Geotagged-photo authenticity | RF-005 |
| BW-15 Conflicting document dates | RF-026, RF-036 (the same check, twice in the crosswalk) |
| BW-16 Document availability, gaps and applicability | RF-033, RF-038…RF-044 |

A question applies to a project when any of its checks does (`questionsFor`), so a project gets 13 to 15 of them.

## Reconciliation: detector flags and team checks

They are different things, and the team's integration spec says so: `detector_rule_id` is "NOT identical to volunteer Flag ID".

- **Detector flags** say where to look. They are research.bettergov.ph's 39 flags, plus our 5 "Missing …" document flags and our 2 NEP comparison flags (`review.json` codes).
- **Team checks** say what a person verifies, who leads, what evidence is needed and what not to conclude.

`DETECTOR_TO_TEAM` maps every detector flag to the team checks it suggests. It is our proposal ("Proposed by BetterGov, 2026-11-12 · pending team review"), and the tests fail if a detector code is missing or names an unknown RF. A suggested check is an **AI candidate**, never a finding.

| Detector flag | Projects | Suggests |
| --- | ---: | --- |
| Potential NEP insertion | 5,548 | RF-024 |
| In the House bill only (our comparison) | 6,192 | RF-024 |
| Sources disagree on the NEP match | 862 | RF-024 |
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
| No listed DPWH Transparency documents | 15,228 | none (until 2026-11-17: RF-033, RF-021) |
| DPWH Transparency match not verified | 6,886 | none (until 2026-11-17: RF-033) |
| No listed RDC | 7,731 | none (until 2026-11-17: RF-044, RF-033) |
| No listed geotagged photos | 1,252 | none (until 2026-11-17: RF-040, RF-033) |
| No listed POW | 44 | none (until 2026-11-17: RF-039, RF-033) |
| Missing POW | 2,291 | RF-039, RF-033 |
| Missing BP 202 | 2,298 | RF-038, RF-033 |
| Missing Development Council | 10,791 | RF-044, RF-033 |
| Missing Geotagged photos | 4,249 | RF-040, RF-033 |
| Missing Certificate of Implementability | 2,401 | RF-041, RF-033 |

**DPWH Transparency's listing is no gap** (the maintainer, 2026-11-17). Projects with only Senate copies, nearly all House insertions, are never listed on DPWH Transparency, so "No listed DPWH Transparency documents", "DPWH Transparency match not verified" and "No listed RDC / geotagged photos / POW" suggest nothing (1,884 of the "No listed RDC" projects have a development council document anyway). They still show among a project's red flags. Our own "Missing …" flags, which count files from both sources, are the document gaps: they suggest BW-16 on 11,552 projects.

**Our NEP comparison is a detector too.** Our House bill pages count 6,193 DPWH rows (6,196 bill lines) as in the House bill only. That is the analysis workbench's House-only group: no NEP pair, a fuzzy match or an ambiguous one. research.bettergov.ph flags 5,548 lines as "Potential NEP insertion", because it leaves out lines where its newer matching sees a possible NEP counterpart it can't confirm ("pairing is ambiguous" 548, "needs scope review" 192). Both lists are candidates, so the reviewer carries both:

- `house-bill-only-our-comparison`, "In the House bill only (our comparison)": 6,192 lines. Four House-only rows are outside the research site's 15,979.
- `nep-match-sources-disagree`, "Sources disagree on the NEP match": 862 lines. 753 are ours but not theirs; 109 are theirs, but our comparison pairs them with an NEP line (47 with the same amount, 37 on different stretches of the same road, 14 raised, 11 cut). These are the lines a person should settle first. They have a "Start from" preset.

Both suggest RF-024 and appear on each project's Overview under "From our comparison". The manifest's `reviewer.nep_comparison` and `verify:hgab` keep the counts.

23 of the 44 checks have no detector yet (RF-021 joined them on 2026-11-17), and 6 of the 16 questions: BW-08, BW-09, BW-10, BW-13, BW-14 and BW-15. Volunteers check them by hand, and the Questions filter shows those questions as "No red flag points here yet". The checks: RF-004 No watershed or drainage master plan; RF-005 Edited geotagged photos; RF-006 Not complete set of plans; RF-007 No identified water source; RF-008 No identified purpose; RF-011 Repeated awards to the same contractor; RF-012 Repeated awards despite poor performance; RF-013 Unsubstantiated pumping capacity; RF-014 Inconsistent or unsupported project quantities; RF-015 Unclear discharge or outfall arrangement; RF-019 Unclear physical scope and capacity; RF-020 Unrealistic construction duration; RF-021 Project not ready for implementation; RF-026 Conflicting document dates; RF-027 Project plans are not signed and sealed; RF-028 At least one of the professionals who signed and sealed the plans are not in the database of PRC; RF-030 Apparent multi-phased project might have issues; RF-031 Unjustified embankment boulder-fill quantities; RF-032 Unsubstantiated quarry sources and hauling  costs; RF-036 Conflicting document dates; RF-037 Uncommon pay item; RF-042 Master Plan; RF-043 Feasibility Study. RF-042 and RF-043 still appear on a project when a Master Plan or Feasibility Study is among its files.

Other ways checks come in:

- **Documents.** The document-specific reviews (registry rows 46–52) join the checklist when the document is on file: BP 202 → RF-038, POW → RF-039, Geotagged photos → RF-040, Certificate of Implementability → RF-041, Development Council → RF-044. A Proposal file typed Master Plan or Feasibility Study brings in RF-042 or RF-043.
- **Project type.** `classifyProject` reads the DPWH PAP and the title and returns roads, bridge, flood, buildings, water or rainwater; BIP "Access Roads and/or Bridges" lines are split by title. A project gets the "Applicable to all" checks plus those of its types. 31 projects (ports, septage) match no type and get only "Applicable to all". The 216 "Rainwater Collector System" rows in our data are office lump sums, not projects, so they are not in the review set.
- **Stage.** RF-011 and RF-012 (contractor awards) are "Not yet due at the budget stage". Their own safeguards say they apply only once work is awarded.

## The form

For each project (since 2026-11-17; see "Three answers and 16 questions"):

1. **The final status** comes first: **Satisfactory** (the documents support the project), **Needs attention** (something is missing, unclear or doesn't add up, and needs a follow-up) or **Needs immediate attention** (a serious problem: the team should look at it first). It is the field the team reports, and the project's status everywhere. Choosing one saves at once.
2. **Final remarks**, a text box under it (`notes`), saved with **Save**.
3. **Questions:** the ones this project's red flags suggest, and BW-16 (the documents) always, come first without a heading; then "More questions" and "Not yet due", folded. Each question shows its id and title, "Flags:" (the red flags behind it), the same three answers as buttons (click the chosen one again to clear it), and **Remark**, folded, with the team's "what to check" above the box. BW-16 also says which key documents we found ("Found: POW 2 · BP 202 · … Not found: Dev. council").
4. **Documents on file** (RF-033): not asked. Each of the 5 key documents' availability is filled in from what we detected (`available` when found, else `unknown`), so it doesn't count as an edit; `matches_project` stays in the payload.
5. The name comes from the sign-in.

Answers to the 44 checks saved before 2026-11-17 stay in the review (`flags`, with their evidence) and show under their question as "Earlier: RF-040 Geotagged photos: Concern confirmed". The form no longer edits them.

**Save** sends the review.

The **Questions** filter in the bar keeps projects whose detector flags suggest any checked question. Each option shows how many projects it would keep. Links from before it name checks (`team:RF-024`); they read as the question that groups each (`team:BW-06`).

## The payload (`CaseReview`, schema `bettergov.hgab-review/1`)

```json
{
 "schema": "bettergov.hgab-review/1",
 "case_id": "6f1c…",
 "kind": "review",
 "verifies_case_id": null,
 "revision": null,
 "registry": {
  "version": "Volunteer-ready draft v2 — 12 November 2026",
  "sha256": "d6fb880d…",
  "mapping": "Proposed by BetterGov, 2026-11-12, revised 2026-11-17 · pending team review",
  "questions_sha256": "73d7eeb2…"
 },
 "verdict": "needs_attention",
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
 "questions": [
  {
   "question_id": "BW-06",
   "flag_ids": [
    "RF-024"
   ],
   "detector_rule_ids": [
    "potential-nep-insertion"
   ],
   "rating": "needs_attention",
   "remark": "No NEP line with this title, office or amount.",
   "updated_at": "2026-11-17T10:00:00Z"
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
 "notes": "Final remarks: the increase needs DPWH's justification.",
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
- `registry.sha256` pins which registry the `flag_id`s mean; `registry.questions_sha256` pins which questions the `question_id`s mean ("" in reviews from before them).
- `verdict` is the final status: `satisfactory`, `needs_attention`, `needs_immediate_attention` or null. A stored `unsatisfactory` (the two-way scale of 2026-11-14 to 2026-11-17) reads as `needs_attention` (`readVerdict`), in the status API, `GET …/mine` (`upgradeCaseReview`) and intake; the stored copy and its revisions keep what they had.
- Only answered questions (an answer or a remark) are in `questions`. Each keeps the checks its question groups (`flag_ids`), so no check is lost if the questions change. `notes` is the final remarks.
- `project.hgab_id` is the stable key. `project_id` is ours and positional, so treat it as a hint.
- `case_id` and each `evidence_id` are random UUIDs (`newId`), made once by the page and kept for life. Older ids in the `<time>-<random>` form stay as they are.
- `kind` is `review`, or `verification` for a check of another member's case (`verifies_case_id`; not open yet). Reviews saved before these fields existed are read as reviews.
- `reviewer_id` is the member's id (ours), set by the API. `display_name` is optional.
- `flags` holds answers to the 44 checks from before the questions; the form no longer adds to it.
- `revision` and `submitted_at` are set by the API on each accepted save: the save's number (1, 2, …) and its time. Both are null before the first save.

## Validation (`validateCaseReview`; the API should run the same)

Errors block "Ready for independent review". The rules come from the workbook's safeguards and handoff rules:

- The schema and registry version must match, every `question_id` must be one of the questions and every `flag_id` in the registry, each listed once, and every answer on the scale.
- Every value must be in its vocabulary, and a `task_id` must be in the role catalog.
- Volunteers can't record "Referred with approval", which belongs to the review committee (step 8).
- A check marked "Not yet due" or "Not applicable" can't be a "Verified concern" ("No red flag from missing not-yet-required approval"). Neither can a stage-gated check (RF-011, RF-012).
- "Verified concern" and "Cleared / explained" need at least one piece of evidence. "Verified concern" and "Unresolved / evidence gap" need the observed facts.
- Evidence must name a document or give an http(s) link.
- A case in independent review or completed needs at least one outcome.
- Warnings, which don't block: a check started but without an outcome; available evidence with no page, table or cell.

## Downloads

One CSV (UTF-8 with BOM), one row per review (`verdictRows`, `VERDICT_COLUMNS`): House bill row, project, office, region, amount, final status, final remarks, answers ("BW-06 Possible NEP-to-GAB allocation change: Needs attention (remark); …", `answerText`), reviewer, and when it was last saved. (Until 2026-11-17 the columns were final status, reviewer, checks with an outcome and notes.) **Download (CSV)** under a review gives that review; **Download my reviews (CSV)** in **My reviews** gives all of the member's own. (Until 2026-11-15 there were also JSON and the team workbook's CASE INTAKE and CASE EVIDENCE rows, `caseIntakeRows` and `caseEvidenceRows`. Nobody used them, so they went.)

**My reviews** (the clipboard in the bar, with a count) has, besides that download, **Show my reviews**: a funnel step ("My reviews", `s=mine:yes`) that keeps only the projects the member has reviewed. Then **Sign out**.

## Sending reviews

Members sign in with Clerk using their email and a one-time code, with no password (set in the Clerk dashboard). Only the reviewer page loads Clerk (`HgabReviewMember.tsx`). After signing in or up, Clerk returns to the page it was opened from, with the same project and funnel. The page forces this, because the production instance's "after sign-in" address is the home page. Signed out, the Review tab, "Start the review" and the bar ask the visitor to sign in; the projects, documents, red flags and everyone's status stay open to all. Signed in, **Save draft** and **Ready for independent review** send the review.

Routes (`src/worker/hgab-reviews.ts`). These are internal to the site, like `/api/hearings`, and not part of the read-only, CORS-open `/api/v1`:

- `GET /api/hgab/2027/reviews/status` is public. It returns a `ReviewStatusIndex` (`src/lib/hgab-review.ts`): for every project with a review, the furthest status any member's review has reached, how many members have one, and the last save. It names no one. It feeds the list's status chips, the review-status filter and sort, the "Nobody has started" preset, and the note on a project that others are reviewing. The page reloads it every two minutes while the tab is in view, and whenever the tab comes back into view.
- `GET /api/hgab/2027/reviews/mine` returns the signed-in member's reviews.
- `POST /api/hgab/2027/reviews` takes a `CaseReview` and returns the stored copy and the project's new status.
- `DELETE /api/hgab/2027/reviews/:case_id` withdraws one of your reviews. The page calls it when you clear a review you had sent.

Rules:

- **Several members can review one project, but each member has one review per project**, which they keep editing. A review sent from a second window or device keeps the case id the first send got.
- **Ids are preserved: never rewritten, reused or deleted.**
  - A case keeps its id, project, member and kind for life.
  - Withdrawing marks the case withdrawn. It isn't deleted, and sending it again brings it back under the same id.
  - Every accepted save and withdrawal is a numbered, append-only revision.
  - Database triggers enforce all of this.
- **Members are ours** (`member_id`, a UUID), not Clerk's. Each sign-in account a member uses is recorded by issuer (the Clerk instance) and Clerk user id. A sign-in account we haven't seen is linked by its verified email to the member who already has that email. So moving to a Clerk production instance, or any new instance, keeps everyone's reviews.
- **Two saves at the same moment:** each save only applies to the revision it read. If two land together, one wins and the other gets 409 ("reload and try again"). No revision is lost or doubled.
- **Team check ids:** intake accepts any `RF-000`-style id, so a draft keeps its checks when the registry changes. Whether a check is in today's registry is a workbook rule: it blocks sending for independent review, not saving.
- **Verification** (`kind: verification`) has its columns and rules, but the API refuses it (403) until the team sets up verifier roles and decides who may see others' reviews.
- **The project's status is its final status** (see "The final status"). Without one, a project with a member's saved review shows "Reviewed" (until 2026-11-17, "In progress"), so members can split the work: the status on each project, the "Not yet reviewed" preset, and the note on a project someone else is reviewing. Nothing is locked. The case stage each review stores (`status` in D1, the furthest of a project's reviews in the status API) no longer shows in the page.
- **Sign-in:** the page sends the Clerk session token as `Authorization: Bearer`. The Worker checks it with `CLERK_SECRET_KEY`. The token must have been issued to the site's own origin (its `azp` claim). `CLERK_AUTHORIZED_PARTIES` (comma-separated) overrides that. Tokens minted with the Backend API carry no `azp` and are refused.
- **Intake** (`readCaseReview`) rebuilds the review from known fields only. It checks types, vocabularies, registry flag ids, http(s) links and lengths (20,000 characters of text, 40 pieces of evidence per check, 512 KB per request). Anything off is refused with 400, listing the problems.
- **The workbook's rules** (`validateCaseReview`): a draft may break them. A case sent for independent review may not (422 with the issues). Volunteers can't set "AI candidate" or "Completed" (403).
- **Withdrawing, or sending another member's case id:** you can only touch your own reviews (403/404).
- **Status** counts reviews only (not verifications), and not withdrawn ones.
- **Nothing is kept in the browser.** If a save fails, the edits stay in the open form with the error, ready to save again. Leaving the page with unsaved edits asks first. On load the page removes the keys earlier versions kept reviews under (`RETIRED_STORES`: `hgab-review:v1`, `hgab-review:v2`, `hgab-review:reviewer`); those drafts were never sent and are not migrated. The only reviewer key left in the browser is `hgab-review:split`, the width of the project beside the document.
- **Privacy:** the members table keeps each member's email from Clerk for the team. No route returns another member's email. The review report's route returns every member's reviews, by name, to anyone with its address (see "The review report"). Before anyone else sees reviews (the independent verifier, say), decide who may see them. The workbook asks that case notes and personal data stay with authorized reviewers.

Storage (`scripts/hgab-review/reviews-schema.sql`, additive and safe to re-run):

- `review_members`: member id, verified email (unique, private), display name.
- `review_member_logins`: issuer and subject of each sign-in account, and its member.
- `review_cases`: one row per member, project and kind. It holds the status, stage, outcomes count, registry hash, `rev`, `withdrawn_at`, the verification link, and the `CaseReview` as `payload`. Its checks are `json_each(payload, '$.flags')`.
- `review_case_revisions`: case id, revision number, member, action (create, update, withdraw or restore), and the case as it stood after the change.

**These tables hold volunteers' work: never drop, rebuild or reload them.** They are named `review_*` on purpose. The `hgab_*` tables are House bill data that `build:hgab-d1` drops and reloads, and `verify:hgab` expects exactly 12 of them. Erasing anything is a deliberate act, such as a member's request under the Data Privacy Act or removing spam. Drop the trigger that blocks it, make the change, then recreate the trigger from the schema file.

Setup:

- Local: `.env.local` gets `VITE_CLERK_PUBLISHABLE_KEY` and `.dev.vars` gets `CLERK_SECRET_KEY` (see `.env.example`, `.dev.vars.example`). Then `npm run db:hgab-reviews` creates the tables in the local D1.
- Production: run `npx wrangler secret put CLERK_SECRET_KEY` on the `budget` Worker; set `VITE_CLERK_PUBLISHABLE_KEY` in the Workers Builds build variables (it is public); and run `npx wrangler d1 execute budget --remote --file=scripts/hgab-review/reviews-schema.sql`. Use a Clerk production instance for `budget.bettergov.ph`: a development instance shows "Development mode" and caps its users.
- Without the publishable key, the page has no sign-in and so no reviewing. Without the secret, or before the tables exist, the API answers 503 and the review section says reviewing isn't open yet. Browsing works either way.
- Testing: Clerk test emails (`name+clerk_test@example.com`, code `424242`) sign in without sending email. Clerk's bot protection blocks sign-up in headless browsers, so create test users with the Backend API first.

## Phones and tablets

- **Up to 900 px: four tabs at the bottom.** Projects (with the filters, shown only here), Project (the summary, red flags, and buttons to the documents and the review), Documents, Review. Each tab has an icon, a label and a badge: the number of projects, the number of files, ✓ once you have a review. Opening a project from the list, or a `?p=` link, lands on Project. The project's title and Prev / Next stay on top of Project, Documents and Review, compact, so a long title (K-station road names run 4 lines) doesn't push the project off the screen. The title is cut to 2 lines on Project and 1 on Documents and Review, and a tap shows it whole (a button with `aria-expanded`). On those two tabs the amount, office and region also fit on one line. The review form stays in the page, hidden, while another tab shows, so an unsaved review survives switching. Rating buttons, document tabs and Prev / Next are at least 40 px tall.
- **Documents drawn by PDF.js on touch screens.** Phone browsers don't show a PDF inside a page (Android shows nothing; iPhone shows only page 1), and tablets are poor at it. So on phones and any `(pointer: coarse)` screen, the viewer draws the pages itself (`src/components/HgabPdfPages.tsx`, `pdfjs-dist`, lazy-loaded so computers never download it). Pages are drawn as they scroll near, at the screen's width; zoom goes 100–300% and scrolls sideways. If a file can't be read, the tab offers "Open in a new tab". Desktop is unchanged: the browser's own viewer in a frame.
- **DPWH Transparency files come through our Worker.** Their host (s3.infrawatch.ph) sends no CORS headers, so the page can't read them directly. `GET /api/hgab/2027/document?u=<url>` (`src/worker/hgab-document-proxy.ts`) passes them on, but only PDFs under `https://s3.infrawatch.ph/nep/fy2027/` (`proxiedDocument`, tested), with byte ranges and a day's edge cache. Our own files (budget-assets, CORS open) are read directly. Senate copies still open only once redacted.

## How to review a project (the guide, and the explainer video)

`/hgab/2027/review/how-to` walks a new volunteer through the reviewer in 11 steps, each with a screenshot: open the reviewer, sign in, pick projects nobody has reviewed (House insertions), narrow the list, open a project, read the documents, look at the red flags, answer the questions, give the final status, go to the next project, find your reviews. Then "Good to know" (keys, red flags are candidates, wrong matches, where reviews go) and the disclaimer. The reviewer links to it from the button at the top right of its bar (since 2026-11-18, in words, where the ⓘ "How it works" icon was), its welcome panel, its sign-in box and "How it works".

- **One source for the page and the video:** `HOWTO_STEPS` (`src/lib/hgab-review-howto.ts`): `key`, `title`, `text` (one short sentence each, read aloud as narration; the page joins them into a paragraph) and `alt`. `scripts/hgab-review-howto.test.ts` checks every step has its screenshot and that sentences stay short and follow the copy rules.
- **Screenshots:** `npm run build:hgab-review-howto` writes `public/screenshots/how-to-review/<key>.webp` (1600×900, 16:9) from a 1440×810 window at 4/3 scale; `--png=<dir>` also keeps the 1920×1080 PNGs and `marks.json` (each step's highlighted areas, as fractions of the frame) for the video, which pans and zooms toward them; `--only=` writes only some. Bump `HOWTO_SHOTS_TAKEN` in the same commit; the page says when they were taken. Retake them whenever the reviewer changes visibly.
- **How the script stays harmless:** it starts its own Vite dev server, where a `resolve.alias` swaps `src/components/HgabReviewMember.tsx` for `scripts/hgab-review-howto/demo-member.tsx` (a signed-in "Juan dela Cruz", or signed out), so the app has no demo code. It answers `/api/hgab/2027/reviews/*` in the browser: the status list is production's (public, no names) plus the example review; saving keeps the example in the script's memory only. Which Senate copies can open is asked of production, so only copies production serves as redacted are shown. Example answers and remarks say "Example", and those screenshots carry the label "Example answers for this guide, not a real review".
- **The video:** `HOWTO_VIDEO`, beside the intro and first in the step list. It is the same steps, narrated in Taglish (2:01, captions burned in, example answers labelled), made with the reels engine outside the repo (`scripts/video/how-to-review-tl/` in the main checkout: script.json, scene.template.html, `pad.py 0.5`, `render.mjs --tempo=1.12`). It is published in the campaign gallery (`hgab/2027/campaign/how-to-review-taglish-1920x1080.mp4`, campaign "How to review a project", 18 Nov 2026). R2 has no purge, so a new take gets a new `?v=`.
- **Demo project:** `HOWTO_DEMO_PROJECT`, HB10858-3-0592-009483 (Construction of Road, Barangay 15, Dolores, Eastern Samar; ₱20M; House insertion; all 5 key documents; Senate copies redacted; no member review when picked on 2026-11-18). If it gets reviewed or its copies change, pick another the same way.

## The review report (hidden, team only): the hand-over site

`/hgab/2027/review/report` is the team's report: red flags, documents and members' reviews of the House bill's DPWH projects, easy to scan and download. Since 2026-11-18 it is a set of pages (the maintainer: "instead of a long page, make them individual pages. This will be our hand over site"), not one long page. It is not linked from any menu or page, not in the sitemap, and every page under it is `noindex`.

- **Who can read it.** Anyone with the address, for now, with no sign-in (the maintainer, 2026-11-17): the pages are simply not linked from anywhere. The Worker route `GET /api/hgab/2027/reviews/report` is open like the status list (503 while reviewing isn't set up). Before linking it anywhere, decide whether it should need a sign-in or a list of the team's emails.
- **What the route sends:** every live review (`kind = 'review'`, not withdrawn), upgraded to today's form (`upgradeCaseReview`), with the member's id, the name they last gave, the review status, how many saves and the first and last save; and the automatic reviews (`review_auto`). No emails.
- **The data.** The shell (`src/pages/HgabReviewReport.tsx`) loads `documents/review.json` (every project: office, legislative districts, region, program, House insertion, red flags, key documents, files, automatic review) and the reviews, and shares them with the pages (`useReport`, `src/lib/hgab-report-data.ts`). The public pages work without the reviews: if they fail to load, a line says so and final statuses show the automatic review only.
- **Final status, every project** (`reportProjects(cases, projects, true)`, `groupIndex`): the most serious final status any member gave; else "No final status yet" when a member has a review; else "Needs attention · auto-reviewed" when the automatic rule marked it (group `auto`); else "Not reviewed". A member's review takes over from the automatic one, as in the reviewer. Until 2026-11-18 the report left the automatic reviews out of its totals.
- **Pages** (`REPORT_PAGES`; `src/components/HgabReportPages.tsx`, shared parts in `HgabReportParts.tsx`):
  - **Overview:** projects, red flags, needs attention, reviewed by members; every project's final status as a bar and a table, each linking to the filtered project list.
  - **Automatic red flags** (`automatic`): each rule in `AUTO_REVIEW` (today one: no key document and no file), what it checks, the team's checks and questions it points to, the projects it marked, their final status now, and by region; then how many red flags of each kind were computed on every project. `automatic/:code` lists a rule's projects.
  - **Red flags** (`flags`): every red flag in `review.json`, by family, with who computes it (research.bettergov.ph, or BetterGov for our NEP comparison and missing key documents), projects, budget, how many need attention and how many members reviewed (`flagTallies`). `flags/:code` lists a flag's projects, with the flag's note where it is ours.
  - **Documents** (`documents`): the House bill's documents (Senate copies) and the NEP's (DPWH Transparency) kept apart (the maintainer, 2026-11-18: "we need the separation for NEP and HGAB (senate docs)"). Cards: documents found (`documents/manifest.json`: 69,085 = 22,748 Senate copies + 46,337 DPWH Transparency), Senate copies open (the dataset manifest: redacted ones), projects with a file, and with 4 or 5 key documents. Then a side-by-side table (House bill, NEP, either): files, projects with a file, with 4 or 5 key documents, and with each key document; and where each project's files come from. A switch, "Count documents from" (`from=`: either, `senate`, `nep`; `DOC_FROM`, `docsFrom`), sets the tables below it: the five key documents (with links to the projects missing each, for either source), how many of the five (all three sources side by side), House insertions vs NEP only, and by region (`docTally`, `docTallies`, `DOC_LEVELS`). Then the public dataset's downloads.
  - **By region** (`regions`): final status by House insertion, region and DPWH office (legislative districts first, as the copy rules ask), the automatic review included.
  - **Questions** (`questions`): the 16 questions, and the 44 checks answered before them.
  - **Projects** (`projects`): every project, most serious final status first, with its key documents in the House bill's documents and in the NEP's as two columns. Filters for final status, region, House insertion, key documents (either source), where its files come from (House bill only, NEP only, both, none) and search, a sort, and 50 a page, all in the URL (`st=`, `region=`, `src=`, `docs=`, `from=`, `q=`, `sort=`, `pg=`). The flag and rule pages use the same list. On phones each project is a stacked row.
  - **One project** (`project/:hgabId`): the bill line (amount, office and districts, region, program, House bill page, NEP and House bill record, reviewer link), its final status and automatic review, every member's review, its red flags with the research site's evidence and our notes, and its documents in two sections, the House bill's (Senate copies) and the NEP's (DPWH Transparency), each with its five key documents, its notes and its files. Senate copies link only when the status route says they are redacted (`available`); any other shows "Not available yet". DPWH Transparency files link to their address.
- **Members** show by the name they gave, else "Member N", numbered by their first review (`memberNames`).
- **Downloads** (the menu): reviews CSV (`REPORT_REVIEW_COLUMNS`, one row per member's review, with the reviewer link) and answers CSV (`REPORT_ANSWER_COLUMNS`, one row per question answered or earlier check). Printing a page leaves out the bar, menu, filters and pager. A PDF export is for later (the maintainer, 2026-11-18).
- **Tests:** `scripts/hgab-review-report.test.ts` (in `npm run test:hgab-review`).

## Senate copies: public once redacted

The documents DPWH gave the Senate ("Senate copies", 22,748 files on 6,000-odd projects; 34,424 in the folder) open for everyone, signed in or not, **once their signatures are redacted**. DPWH Transparency files are on `s3.infrawatch.ph` and open to everyone.

- **Redacted only, so no personal information leaks.** The redacted files replace the originals on R2, and each one the uploader writes carries R2 custom metadata `redacted` ("signatures and handwriting, bettergov.ph 2026-11"; docs/senate-redaction.md). A Senate copy opens in the reviewer only if:
  1. it carries that mark, and
  2. its region isn't held back by hand (below).

  Anything else stays closed: the files the redaction skipped (PDFs of 20+ pages, damaged files, non-PDFs, PDFs without a `.pdf` extension). The pane shows "This Senate copy isn't available yet. We're redacting the signatures in this copy first, for privacy." There is no frame and no link, and the file list tags it "not yet available". A file opens by itself once the redaction uploads it.
- **How:** when a project opens, the page asks `POST /api/hgab/2027/senate-copies/status` (public, `{ paths }`, up to 200; a project has at most 80) which of its Senate copies can open (`src/worker/hgab-senate-copies.ts`). The Worker reads each file's metadata through the R2 binding (`DATA_BUCKET`, key `hgab/2027/dpwh/supporting-documents/<path>`) and answers `available`, `held`, `not_redacted` or `missing`. Until the answer comes, the files show "checking…"; if it fails, none opens. The project opens on a file that can be shown when it has one. A copy that can open loads from its public address on `budget-assets.bettergov.ph` (`documentHref` in `src/lib/hgab-review-api.ts`), and evidence links in the form use the same address.
- **The manual switch:** `SENATE_REGIONS_HELD_BACK` in `src/lib/senate-copies-held-back.ts`, one line per region, by the first folder name in `supporting-documents-file-links.jsonl` `region`. It keeps a region closed even where files are marked, for example while a region's upload is being checked, and the dataset then gives its copies no link. **Empty since 2026-11-15.** To hold a region back, add its line and merge; to show it again, delete the line. The page, the Worker and the dataset share the list. `npm run test:hgab-review` fails if a name matches no Senate folder.
- **History:**
  - 2026-11-13: Senate copies opened only for signed-in members, through the Worker with an hour-long grant (`/api/hgab/2027/senate-copies/grant`).
  - 2026-11-14: only redacted copies opened. NCR, Region III, Region IV-A, Region V, Region X and Region XII were held back, because the file list had no redacted copy for any of them. The maintainer named five; Region IV-A was also unredacted, since its detection had finished but nothing was uploaded.
  - 2026-11-15: every region was redacted (31,093 of the 34,424 files; the rest are the skipped files above), so the maintainer made them public. The grant and the Worker's file route went (they answer 404), and the hold list is empty.
- **Local preview:** the local R2 store has only the files you put in it. wrangler's `r2 object put --local` percent-encodes keys with spaces, so put test files with `getPlatformProxy` instead, with the `redacted` metadata. Production keys have real spaces.

## Browser storage, retired

Earlier versions kept reviews in the browser: first-version reviews (`hgab-review:v1`), cases (`hgab-review:v2`) and the volunteer's profile (`hgab-review:reviewer`). Since 2026-11-13 reviewing needs a sign-in and the page removes those keys on load, without sending or migrating them. The reviewer was never public, so only preview drafts were affected.

## Automatic review and the red flag score (provisional)

Some projects are red flags plainly enough that volunteers need not open them first. `build:hgab-documents` applies the rules in `AUTO_REVIEW` (`src/lib/hgab-documents.ts`) to every row. It writes the result to `review.json` `auto` (method, rules, bands, and each project's rule indexes and score) and puts the counts in the manifest's `reviewer.auto_review`. `verify:hgab` recomputes it.

- **Rule `no-key-documents`, weight 100:** none of the five key documents and no other file, in the Senate copies or on DPWH Transparency. This covers 2,119 bill lines, ₱63.5B. It points to team checks RF-033 (Incomplete documents) and RF-021 (Project not ready for implementation).
- **Score:** the sum of the matched rules' weights, capped at 100. Bands: High from 70, Medium from 40, Low from 1. A project the rules mark has the status "red flag".
- **In the reviewer:** the project shows "Needs attention · auto-reviewed · score 100" in the list (2026-11-14 to 2026-11-17 "Unsatisfactory · auto-reviewed"; before that, "Red flag · auto-reviewed") and a banner on its Overview. It counts as reviewed: faded in the list, left out by **Hide reviewed**, after work still to do in the review-status sort, first in the red-flag-score sort. The **Review status** filter has the list statuses (see "The final status").
- **A member's review takes over.** Once anyone saves a review of an auto-reviewed project, the list shows "Reviewed", or the members' final status once one is given (`listStatus`); the banner stays.
- **In D1 as well.** `npm run sync:hgab-auto-reviews` writes `review.json`'s automatic reviews to D1's `review_auto`, one row per project, so the reviews database holds every project's status: members' reviews in `review_cases`, automatic ones in `review_auto`. Each run is logged in `review_auto_runs` (append-only: method, the `review.json` it read and its MD5, and how many rows it added, changed, withdrew and restored). It changes only the difference. A project that stops meeting the rules is withdrawn (`withdrawn_at`), not deleted, and comes back under the same row; triggers refuse deletes. Statements go in small batches of plain queries, not a `--file` import. Run it after every `build:hgab-documents` that changes `auto` (local by default; `--remote` for production, with a token that can edit D1; `--dry-run` shows the plan). **Production, 2026-11-13:** the tables were created (the new statements only, as a plain query) and the first remote run added 2,119 rows from `review.json` MD5 `80b090e6…`.
- **The status API carries it.** `GET /api/hgab/2027/reviews/status` adds `auto: { score, method }` to each project's entry (`withAutoReviews`), and an entry for projects with only an automatic review (`not_started`, 0 reviews); `meta.auto` counts them. If `review_auto` isn't there yet, the list works without it.
- **The page** shows a project as auto-reviewed when D1 says so, or, where D1 hasn't been synced, when `review.json` does. A member's review still takes over (`listStatus`). `ListStatus` is the final status, `in_progress`, `not_started` or `auto_red_flag`; `review_cases` stores only members' reviews.

Querying D1: every project's status, members' and automatic, is `review_cases` (kind `review`, not withdrawn) plus `review_auto` (not withdrawn). For example: `SELECT hgab_id, 'red_flag' AS status, score FROM review_auto WHERE withdrawn_at IS NULL AND hgab_id NOT IN (SELECT hgab_id FROM review_cases WHERE kind = 'review' AND withdrawn_at IS NULL)` lists the projects only the automatic review has marked.

**Provisional.** The team has not approved a scoring method, and its workflow says "no unapproved thresholds or weights" (step 6). Its own safeguard for RF-033 says "Do not score missing optional/later-stage records as violation". This rule only marks projects where *nothing at all* was found; the label, the banner and the note say the score is provisional.

When the team settles the method, answers in members' reviews can add weighted components: outcomes per check, document availability, priority. Members' scores would join the rules here under a new `method`. Projects keep their rule codes, so earlier scores can be explained.

## Three answers and 16 questions (2026-11-17)

The maintainer asked to simplify the answering: one scale, **Satisfactory / Needs attention / Needs immediate attention**, for the final status (with a final remarks box) and for each detailed question, each with an optional remark that folds open. The questions are the team's 16 (their 44-to-16 consolidation proposal, sent 2026-11-16).

- **Replaced:** the 44 check cards with their four outcomes ("Needs an expert", "Concern confirmed", "Cleared", "Evidence missing"), "Applies now?", the evidence picker, "What you found", the minimum evidence and the safeguard line. Each question's remark box carries the team's one-line "what to check".
- **Kept:** every earlier answer, as stored (`flags`, evidence included); the case stage and validation rules in the payload and API; the automatic review (its rules are for later).
- **The project's status** is the most serious final status its members gave (`projectVerdict`): immediate attention over attention over satisfactory. List statuses, in sort order: Not started, Needs immediate attention, Needs attention, Needs attention · auto-reviewed, Reviewed, Satisfactory. The report preset is "Needs attention: the report" (both attention statuses and the automatic ones); a link with `status:unsatisfactory` reads as both attention statuses.
- **Colours:** satisfactory green, needs attention orange (`--rv-attention`, #b45309, 5:1 against white), needs immediate attention red. Auto-reviewed projects are orange, faded.
- **A saved review is a review** (the maintainer, same day): a project a member has saved a review of, without a final status, shows **Reviewed** (blue), not "In progress". It counts as reviewed everywhere: faded in the list, left out by **Hide reviewed** and "Not yet reviewed", and counted as reviewed in the progress cards (blue in the bar, "reviewed, no final status" on hover). A link with `status:in_progress` reads as `status:reviewed`. "Nobody has started" went, as it was now the same as "Not yet reviewed".
- **The final status buttons** are one per row in a narrow pane and side by side from 560 px (a container query), so words never break.
- **Production had** 13 live reviews when this changed: one final status (satisfactory; no live "Unsatisfactory", so no project's status changes) and 45 answers to checks (29 on the document checks). Those answers show under their questions as "Earlier: …".

## One pane, fewer words (2026-11-14)

- **Overview and Review are one page:** the compact overview, then the review form (or the sign-in box). There are no tabs, no "Start the review" button and no disclaimer in the pane.
- **Shorter form text:**
  - "Checks" instead of "Review checklist".
  - Group names: "Documents", "More checks", "Not yet due".
  - "Applies now?" instead of "Does this check apply to the project now?".
  - "Needs:" with the minimum evidence as chips; the "What to check" heading is gone, and its text stays.
  - "Flags:" without the "On file" line.
  - "Still needed:" for what an outcome lacks.
  - "What you found" has a "Facts only" placeholder instead of a description.
  - Short labels in the evidence details.
  - No hint under Save; one "Download (CSV)" under the review.

## The final status (2026-11-14)

Superseded on 2026-11-17 by three answers ("Three answers and 16 questions"); kept here as it was.

The maintainer asked for one status per review, the field the team reports: **Satisfactory** or **Unsatisfactory**, where unsatisfactory is the red flag.

- **In the review:** a compact pair of buttons, first in the review section (`FinalStatus` in `HgabReviewForm.tsx`). Choosing one saves the review at once. A line beside the heading says whether it is saved, and screen readers announce it. "Clear" removes it; a review with nothing else in it is then withdrawn.
- **Accessibility:** they are toggle buttons (`aria-pressed`), not radios, so moving between them with the keyboard never saves. Each is named by its label alone. Its hint ("The documents support the project." / "Red flag: something is missing, wrong or doesn't add up.") is the description screen readers give and the tooltip, not shown on screen. Each target is 44 px tall, with text next to the colour and the icon, and a 3 px focus ring. They sit side by side when each gets 150 px. The Save button is 48 px tall.
- **In the data:** `CaseReview.verdict` is `satisfactory`, `unsatisfactory` or null (`VERDICTS` in `src/lib/hgab-redflags-team.ts`). Reviews from before it was added read as null. A final status alone is enough to send a review (`caseTouched`). It is in the payload only, so D1 needed no change; the status API reads it with `json_extract(payload, '$.verdict')`.
- **A project's final status** (`projectVerdict`): **unsatisfactory if any member found it unsatisfactory** (a red flag stands until it is resolved), satisfactory if every final status given is satisfactory. The status API returns `verdict` and `verdicts` (how many of each) per project.
- **The list status** (`listStatus`), in sort order:
  1. Not started
  2. In progress (a member's review without a final status)
  3. Unsatisfactory
  4. Unsatisfactory · auto-reviewed (no key document and no file, until a member gives a final status)
  5. Satisfactory

  The last three count as reviewed, for **Hide reviewed**, the faded rows and the progress cards. The badge adds "· N reviews" when several members reviewed a project; its hover text says how they split.
- **The report:** the "Unsatisfactory: red flags" preset lists members' and automatic red flags. **Download my reviews (CSV)** in **My reviews**, and **Download (CSV)** under each review, give one row per review (see "Downloads").
- **Everyone's final statuses, from D1:** `SELECT hgab_id, json_extract(payload, '$.verdict') AS final_status, json_extract(payload, '$.reviewer.display_name') AS reviewer, updated_at FROM review_cases WHERE kind = 'review' AND withdrawn_at IS NULL`.
- **Unchanged:** the case stage and "Ready for independent review" are still in the payload, the API and its rules (`validateCaseReview` for cases sent for independent review). The form no longer offers them. On 2026-11-14 production had one member review, marked ready for independent review with no final status; it shows "In progress" until a final status is given.

## Fewer clicks (2026-11-13)

- **Choices are buttons, not dropdowns:** outcome, applicability, the three evidence questions, case stage and suggested priority (`Seg` in `HgabReviewForm.tsx`). Clicking the chosen button again clears it. The buttons use plain words ("Needs an expert", "Concern confirmed", "Cleared", "Evidence missing"; "Working on it", "Waiting for evidence", "On hold"). Each button's tooltip, the payload and the exports keep the workbook's own labels and codes.
- **Outcome buttons sit on every check**, visible without opening it, so a check can take one click. Choosing an outcome that needs facts or evidence opens the check and says what is missing, by the same rules the API applies.
- **Evidence is one click:** a button per file of the project, and one for any other document or link.
- **The name comes from the sign-in.** It is the account's full name or username, else the part of the email before "@" (`memberLabel`), and is sent as `reviewer.display_name` with every save. There is no name field.
- **Removed from the form:** the role field, "Next action", and the hint about the review committee. "Referred with approval" is still not offered, because it belongs to the committee (workflow step 8). Existing values stay in the review.
- **Save** stays pinned at the bottom of the review. (Until 2026-11-14 there were "Save draft" and "Ready for independent review", and a case-stage row; the final status replaced them.)

## Review progress (2026-11-13)

Beside the funnel strip, **Review progress** counts every project, whatever the funnel, auto-reviewed ones included (`reviewProgress`, `PROGRESS_GROUPS`).

| Card | Bill lines | Budget | Who they are |
| --- | ---: | ---: | --- |
| **House insertions** | 6,192 | ₱171.3B | In the House bill only by our comparison (`house-bill-only-our-comparison`), as our House bill pages count them; 1,795 are auto-reviewed |
| **NEP only** | 9,787 | ₱369.5B | Matched to an NEP line by our comparison; 324 auto-reviewed |
| All projects | 15,979 | ₱541B | Every DPWH line in the House bill |

Each card is compact: its name, a bar, then pending of total, % reviewed and the pending budget. Hovering gives the full description and the breakdown. The bar shows auto-reviewed (orange, faded), members' final statuses (red, orange, green) and reviews without a final status (blue). Until 2026-11-17 a review without a final status was "started" (sand) and still pending. Clicking a card lists its pending projects: the insertion flag, or its negation for NEP only, then "Not yet reviewed". The funnel step reads "House insertions" or "NEP only". The funnel's steps are cards of the same height (`--rv-card-h`).

The Documents filter has "Where the documents come from" (`SOURCE_GROUPS`). `review.json` row element 10 is a bitmask: 1 for Senate copies, 2 for DPWH Transparency. The groups are Senate copies (4,253; nearly all House insertions), DPWH Transparency (9,299), both (90) and no file found (2,337; 2,119 auto-reviewed).

The filter bar starts with a "Filter" label.

## Not taken in

- The 24 draft indicators. Promoting any of them is the team's decision.
- Steps 6–9 (scoring, prioritising, routing, closing). They need approved rubrics and authority; the form only suggests a priority.
- Assignment and routing status from LIVE FLAG ROUTING. Members can now sign in, but there are no roles: anyone signed in is a volunteer, and the project status is how work is shared.
