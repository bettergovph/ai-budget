# The review form: the volunteer team's red-flag checklist

The project reviewer (`/hgab/2027/review`) asks volunteers to work through the volunteer team's red-flag registry for each project. A review is a `CaseReview`. Anyone can browse the projects. **Reviewing needs a sign-in**, and reviews are kept only on the server (D1; see "Sending reviews" below), never in the browser. Members can download their reviews as JSON or as rows for the team's workbook.

Code: `src/lib/hgab-redflags-team.ts` (pure: registry, crosswalk, checklist, payload, intake, validation, workbook rows), `src/components/HgabReviewForm.tsx` (the form), `src/lib/hgab-review-export.ts` (downloads), `src/worker/hgab-reviews.ts` (the API), `src/components/HgabReviewMember.tsx` (sign-in). Tests: `npm run test:hgab-review`.

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

**Our NEP comparison is a detector too.** Our House bill pages count 6,193 DPWH rows (6,196 bill lines) as in the House bill only. That is the analysis workbench's House-only group: no NEP pair, a fuzzy match or an ambiguous one. research.bettergov.ph flags 5,548 lines as "Potential NEP insertion", because it leaves out lines where its newer matching sees a possible NEP counterpart it can't confirm ("pairing is ambiguous" 548, "needs scope review" 192). Both lists are candidates, so the reviewer carries both:

- `house-bill-only-our-comparison`, "In the House bill only (our comparison)": 6,192 lines. Four House-only rows are outside the research site's 15,979.
- `nep-match-sources-disagree`, "Sources disagree on the NEP match": 862 lines. 753 are ours but not theirs; 109 are theirs, but our comparison pairs them with an NEP line (47 with the same amount, 37 on different stretches of the same road, 14 raised, 11 cut). These are the lines a person should settle first. They have a "Start from" preset.

Both suggest RF-024 and appear on each project's Overview under "From our comparison". The manifest's `reviewer.nep_comparison` and `verify:hgab` keep the counts.

22 of the 44 checks have no detector yet. Volunteers check them by hand, and the Team checklist filter shows them as "No red flag points here yet": RF-004 No watershed or drainage master plan; RF-005 Edited geotagged photos; RF-006 Not complete set of plans; RF-007 No identified water source; RF-008 No identified purpose; RF-011 Repeated awards to the same contractor; RF-012 Repeated awards despite poor performance; RF-013 Unsubstantiated pumping capacity; RF-014 Inconsistent or unsupported project quantities; RF-015 Unclear discharge or outfall arrangement; RF-019 Unclear physical scope and capacity; RF-020 Unrealistic construction duration; RF-026 Conflicting document dates; RF-027 Project plans are not signed and sealed; RF-028 At least one of the professionals who signed and sealed the plans are not in the database of PRC; RF-030 Apparent multi-phased project might have issues; RF-031 Unjustified embankment boulder-fill quantities; RF-032 Unsubstantiated quarry sources and hauling  costs; RF-036 Conflicting document dates; RF-037 Uncommon pay item; RF-042 Master Plan; RF-043 Feasibility Study. RF-042 and RF-043 still appear on a project when a Master Plan or Feasibility Study is among its files.

Other ways checks come in:

- **Documents.** The document-specific reviews (registry rows 46–52) join the checklist when the document is on file: BP 202 → RF-038, POW → RF-039, Geotagged photos → RF-040, Certificate of Implementability → RF-041, Development Council → RF-044. A Proposal file typed Master Plan or Feasibility Study brings in RF-042 or RF-043.
- **Project type.** `classifyProject` reads the DPWH PAP and the title and returns roads, bridge, flood, buildings, water or rainwater; BIP "Access Roads and/or Bridges" lines are split by title. A project gets the "Applicable to all" checks plus those of its types. 31 projects (ports, septage) match no type and get only "Applicable to all". The 216 "Rainwater Collector System" rows in our data are office lump sums, not projects, so they are not in the review set.
- **Stage.** RF-011 and RF-012 (contractor awards) are "Not yet due at the budget stage". Their own safeguards say they apply only once work is awarded.

## The form

For each project:

1. **Documents on file** (RF-033): not asked. Each of the 5 key documents' availability is filled in from what we detected (`available` when found, else `unknown`), so it doesn't count as an edit; `matches_project` stays in the payload.
2. **The checklist**, in groups: the checks this project's red flags suggest come first, without a heading; then the documents on file, other checks for this kind of project (collapsed), and not yet due (collapsed). A suggested check has no status label until a volunteer starts it. Each check shows:
   - its lead role, what to check, the minimum evidence and the **safeguard**;
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
 "kind": "review",
 "verifies_case_id": null,
 "revision": null,
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
- `case_id` and each `evidence_id` are random UUIDs (`newId`), made once by the page and kept for life. Older ids in the `<time>-<random>` form stay as they are.
- `kind` is `review`, or `verification` for a check of another member's case (`verifies_case_id`; not open yet). Reviews saved before these fields existed are read as reviews.
- `reviewer_id` is the member's id (ours), set by the API. `display_name` is optional.
- Only checks a volunteer touched are in `flags`.
- `revision` and `submitted_at` are set by the API on each accepted save: the save's number (1, 2, …) and its time. Both are null before the first save.

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

## Sending reviews

Members sign in with Clerk using their email and a one-time code, with no password (set in the Clerk dashboard). Only the reviewer page loads Clerk (`HgabReviewMember.tsx`). After signing in or up, Clerk returns to the page it was opened from, with the same project, tab and funnel. The page forces this, because the production instance's "after sign-in" address is the home page. Signed out, the Review tab, "Start the review" and the bar ask the visitor to sign in; the projects, documents, red flags and everyone's status stay open to all. Signed in, **Save draft** and **Ready for independent review** send the review.

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
- **The project's status is the furthest of its reviews:** completed > in independent review > in progress > on hold. A saved draft counts as in progress. That status is how members split the work: the status chip on each project, the "Nobody has started" preset, and the note on a project someone else is reviewing. Nothing is locked.
- **Sign-in:** the page sends the Clerk session token as `Authorization: Bearer`. The Worker checks it with `CLERK_SECRET_KEY`. The token must have been issued to the site's own origin (its `azp` claim). `CLERK_AUTHORIZED_PARTIES` (comma-separated) overrides that. Tokens minted with the Backend API carry no `azp` and are refused.
- **Intake** (`readCaseReview`) rebuilds the review from known fields only. It checks types, vocabularies, registry flag ids, http(s) links and lengths (20,000 characters of text, 40 pieces of evidence per check, 512 KB per request). Anything off is refused with 400, listing the problems.
- **The workbook's rules** (`validateCaseReview`): a draft may break them. A case sent for independent review may not (422 with the issues). Volunteers can't set "AI candidate" or "Completed" (403).
- **Withdrawing, or sending another member's case id:** you can only touch your own reviews (403/404).
- **Status** counts reviews only (not verifications), and not withdrawn ones.
- **Nothing is kept in the browser.** If a save fails, the edits stay in the open form with the error, ready to save again. Leaving the page with unsaved edits asks first. On load the page removes the keys earlier versions kept reviews under (`RETIRED_STORES`: `hgab-review:v1`, `hgab-review:v2`, `hgab-review:reviewer`); those drafts were never sent and are not migrated. The only reviewer key left in the browser is `hgab-review:split`, the width of the project beside the document.
- **Privacy:** the members table keeps each member's email from Clerk for the team. No route returns another member's email or review. Before anyone else sees reviews (the independent verifier, say), decide who may see them. The workbook asks that case notes and personal data stay with authorized reviewers.

Storage (`scripts/hgab-review/reviews-schema.sql`, additive and safe to re-run):

- `review_members`: member id, verified email (unique, private), display name.
- `review_member_logins`: issuer and subject of each sign-in account, and its member.
- `review_cases`: one row per member, project and kind. It holds the status, stage, outcomes count, registry hash, `rev`, `withdrawn_at`, the verification link, and the `CaseReview` as `payload`. Its checks are `json_each(payload, '$.flags')`.
- `review_case_revisions`: case id, revision number, member, action (create, update, withdraw or restore), and the case as it stood after the change.

**These tables hold volunteers' work: never drop, rebuild or reload them.** They are named `review_*` on purpose. The `hgab_*` tables are House bill data that `build:hgab-d1` drops and reloads, and `verify:hgab` expects exactly 12 of them. Erasing anything is a deliberate act, such as a member's request under the Data Privacy Act or removing spam. Drop the trigger that blocks it, make the change, then recreate the trigger from the schema file.

Setup:

- Local: `.env.local` gets `VITE_CLERK_PUBLISHABLE_KEY` and `.dev.vars` gets `CLERK_SECRET_KEY` (see `.env.example`, `.dev.vars.example`). Then `npm run db:hgab-reviews` creates the tables in the local D1.
- Production: run `npx wrangler secret put CLERK_SECRET_KEY` on the `budget` Worker; set `VITE_CLERK_PUBLISHABLE_KEY` in the Workers Builds build variables (it is public); and run `npx wrangler d1 execute budget --remote --file=scripts/hgab-review/reviews-schema.sql`. Use a Clerk production instance for `budget.bettergov.ph`: a development instance shows "Development mode" and caps its users.
- Without the publishable key, the page has no sign-in and so no reviewing. Without the secret, or before the tables exist, the API answers 503 and the Review tab says reviewing isn't open yet. Browsing works either way.
- Testing: Clerk test emails (`name+clerk_test@example.com`, code `424242`) sign in without sending email. Clerk's bot protection blocks sign-up in headless browsers, so create test users with the Backend API first.

## Senate copies: signed-in members only

The documents DPWH gave the Senate ("Senate copies", 22,748 files on 6,000-odd projects) open only for signed-in members. DPWH Transparency files are on `s3.infrawatch.ph` and stay open to everyone.

- **Signed out:** the viewer lists the Senate copies, tagged "sign in". Picking one shows "Senate copies are for signed-in members" and a sign-in button instead of the document. There is no "Open in a new tab" link.
- **Signed in:** the page gets a grant (`POST /api/hgab/2027/senate-copies/grant`), good for an hour and renewed before it ends. Each Senate copy then opens at `/api/hgab/2027/senate-copies/<path>?grant=…`. The Worker checks the grant and streams the file from R2 (binding `DATA_BUCKET`, bucket `budget`, key `hgab/2027/dpwh/supporting-documents/<path>`), with Range requests for the PDF viewer (`src/worker/hgab-senate-copies.ts`).
- **The grant** is `<member_id>.<expiry>.<HMAC-SHA256>`. Its key is derived from `CLERK_SECRET_KEY`, so there is no other secret, and rotating that one voids every grant. The grant goes in the address, so the frame, a new tab and a download all work. Responses are `Cache-Control: private` and `noindex`, with no referrer. A copied link stops working within the hour.
- **Without a good grant** (none, expired or altered), the file route answers with a short "sign in" page (401). Paths outside the folder are refused.
- **What the data keeps:** the detail shards and the reviews keep each file's public address (`budget-assets.bettergov.ph/hgab/2027/dpwh/supporting-documents/…`) as its id. The page turns it into the gated address (`documentHref` in `src/lib/hgab-review-api.ts`), and evidence links in the form do the same.
- **The same files are still public on budget-assets.bettergov.ph** until that path is blocked there, so for now the gate covers our page only. research.bettergov.ph's `hgab-document-coverage.json` links 20,647 of them, and `supporting-documents-file-links.jsonl` (public, beside them) lists all 34,424. Blocking the path, for example with a WAF rule on `/hgab/2027/dpwh/supporting-documents/*`, would break those links. That is the maintainer's call. The Worker reads through the R2 binding, so a block on the domain doesn't affect it.
- **Local preview:** the local R2 store has only the files you put in it. wrangler's `r2 object put --local` percent-encodes keys with spaces, so put test files with `getPlatformProxy` instead. Production keys have real spaces.

## Browser storage, retired

Earlier versions kept reviews in the browser: first-version reviews (`hgab-review:v1`), cases (`hgab-review:v2`) and the volunteer's profile (`hgab-review:reviewer`). Since 2026-11-13 reviewing needs a sign-in and the page removes those keys on load, without sending or migrating them. The reviewer was never public, so only preview drafts were affected.

## Not taken in

- The 24 draft indicators. Promoting any of them is the team's decision.
- Steps 6–9 (scoring, prioritising, routing, closing). They need approved rubrics and authority; the form only suggests a priority.
- Assignment and routing status from LIVE FLAG ROUTING. Members can now sign in, but there are no roles: anyone signed in is a volunteer, and the project status is how work is shared.
