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

0. **The final status** comes first: **Satisfactory** (the documents support the project) or **Unsatisfactory** (a red flag). It is the field the team reports, and the project's status everywhere. See "The final status" below.
1. **Documents on file** (RF-033): not asked. Each of the 5 key documents' availability is filled in from what we detected (`available` when found, else `unknown`), so it doesn't count as an edit; `matches_project` stays in the payload.
2. **The checklist**, in groups: the checks this project's red flags suggest come first, without a heading; then the documents on file, other checks for this kind of project (collapsed), and not yet due (collapsed). A suggested check has no status label until a volunteer starts it. Each check shows:
   - its lead role, what to check, the minimum evidence and the **safeguard**;
   - then the volunteer's answers: does it apply now, what you found (facts only), evidence, and the outcome.
3. **Evidence is picked, not filled in:** a toggle per file of the project ("POW · Senate", "BP 202 · DPWH"), and "+ Other link" for any other document. Each picked document can take optional **Details**, folded away: page, table or cell; what it says; your observation; availability; whether it applies at this stage; your check of the extract. Under the evidence comes one **What you found** for the check.
4. The name comes from the sign-in. Since 2026-11-14 the form has no "The case" section (suggested priority, notes) and no lead line or registry note. Values already in a review stay in its data and exports.

**Save** sends the review. Choosing a final status saves at once.

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
- **The project's status is its final status** (see "The final status"). Without one, a project with a member's review shows "In progress", so members can split the work: the status on each project, the "Nobody has started" preset, and the note on a project someone else is reviewing. Nothing is locked. The case stage each review stores (`status` in D1, the furthest of a project's reviews in the status API) no longer shows in the page.
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
- Without the publishable key, the page has no sign-in and so no reviewing. Without the secret, or before the tables exist, the API answers 503 and the review section says reviewing isn't open yet. Browsing works either way.
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
- **Only redacted Senate copies open (2026-11-14), so no personal information leaks.** Signatures in the Senate copies are being redacted, and the redacted files replace the originals on R2. Each one the uploader writes carries R2 custom metadata `redacted` ("signatures and handwriting, bettergov.ph 2026-11"). A Senate copy opens in the reviewer only if:
  1. it carries that mark, and
  2. its region isn't held back by hand (below).

  Anything else stays closed: regions not done yet, and in finished regions the files the redaction skipped (PDFs of 20+ pages, damaged files, non-PDFs, PDFs without a `.pdf` extension). It shows "This Senate copy isn't available yet. We're redacting signatures in <region>'s Senate copies first, for privacy." There is no frame and no link, and the file list tags it "not yet available". A file opens by itself once the redaction uploads it. DPWH Transparency files are unaffected.
  - **How:** when a project opens, the page asks `POST /api/hgab/2027/senate-copies/status` (public, `{ paths }`, up to 200; a project has at most 80) which of its Senate copies can open. The Worker reads each file's metadata through the R2 binding and answers `available`, `held`, `not_redacted` or `missing`. Until the answer comes, the files show "checking…"; if it fails, none opens. The file route refuses the same files (403, "Not available yet"), grant or not, so a link doesn't work either. The project opens on a file that can be shown when it has one.
  - **The manual switch:** `SENATE_REGIONS_HELD_BACK` in `src/lib/senate-copies-held-back.ts`, one line per region, by the first folder name in `supporting-documents-file-links.jsonl` `region`. It keeps a region closed even where files are marked, for example while a region's upload is being checked. **To show a region again, delete its line and merge.** The page and the Worker share the list. `npm run test:hgab-review` fails if a name matches no Senate folder.
  - **Held back on 2026-11-14:** NCR, Region III, Region IV-A, Region V, Region X and Region XII. The file list had no redacted copy for any of them. The maintainer named five; Region IV-A was also unredacted, since its detection had finished but nothing was uploaded.
  - **Not covered:** the same files stay public at their `budget-assets.bettergov.ph` addresses, which research.bettergov.ph links to.

## Browser storage, retired

Earlier versions kept reviews in the browser: first-version reviews (`hgab-review:v1`), cases (`hgab-review:v2`) and the volunteer's profile (`hgab-review:reviewer`). Since 2026-11-13 reviewing needs a sign-in and the page removes those keys on load, without sending or migrating them. The reviewer was never public, so only preview drafts were affected.

## Automatic review and the red flag score (provisional)

Some projects are red flags plainly enough that volunteers need not open them first. `build:hgab-documents` applies the rules in `AUTO_REVIEW` (`src/lib/hgab-documents.ts`) to every row. It writes the result to `review.json` `auto` (method, rules, bands, and each project's rule indexes and score) and puts the counts in the manifest's `reviewer.auto_review`. `verify:hgab` recomputes it.

- **Rule `no-key-documents`, weight 100:** none of the five key documents and no other file, in the Senate copies or on DPWH Transparency. This covers 2,119 bill lines, ₱63.5B. It points to team checks RF-033 (Incomplete documents) and RF-021 (Project not ready for implementation).
- **Score:** the sum of the matched rules' weights, capped at 100. Bands: High from 70, Medium from 40, Low from 1. A project the rules mark has the status "red flag".
- **In the reviewer:** the project shows "Unsatisfactory · auto-reviewed · score 100" in the list (until 2026-11-14, "Red flag · auto-reviewed") and a banner on its Overview. It counts as reviewed: faded in the list, left out by **Hide reviewed**, after work still to do in the review-status sort, first in the red-flag-score sort. The **Review status** filter has the list statuses (see "The final status").
- **A member's review takes over.** Once anyone saves a review of an auto-reviewed project, the list shows "In progress", then the members' final status (`listStatus`); the banner stays.
- **In D1 as well.** `npm run sync:hgab-auto-reviews` writes `review.json`'s automatic reviews to D1's `review_auto`, one row per project, so the reviews database holds every project's status: members' reviews in `review_cases`, automatic ones in `review_auto`. Each run is logged in `review_auto_runs` (append-only: method, the `review.json` it read and its MD5, and how many rows it added, changed, withdrew and restored). It changes only the difference. A project that stops meeting the rules is withdrawn (`withdrawn_at`), not deleted, and comes back under the same row; triggers refuse deletes. Statements go in small batches of plain queries, not a `--file` import. Run it after every `build:hgab-documents` that changes `auto` (local by default; `--remote` for production, with a token that can edit D1; `--dry-run` shows the plan). **Production, 2026-11-13:** the tables were created (the new statements only, as a plain query) and the first remote run added 2,119 rows from `review.json` MD5 `80b090e6…`.
- **The status API carries it.** `GET /api/hgab/2027/reviews/status` adds `auto: { score, method }` to each project's entry (`withAutoReviews`), and an entry for projects with only an automatic review (`not_started`, 0 reviews); `meta.auto` counts them. If `review_auto` isn't there yet, the list works without it.
- **The page** shows a project as auto-reviewed when D1 says so, or, where D1 hasn't been synced, when `review.json` does. A member's review still takes over (`listStatus`). `ListStatus` is the final status, `in_progress`, `not_started` or `auto_red_flag`; `review_cases` stores only members' reviews.

Querying D1: every project's status, members' and automatic, is `review_cases` (kind `review`, not withdrawn) plus `review_auto` (not withdrawn). For example: `SELECT hgab_id, 'red_flag' AS status, score FROM review_auto WHERE withdrawn_at IS NULL AND hgab_id NOT IN (SELECT hgab_id FROM review_cases WHERE kind = 'review' AND withdrawn_at IS NULL)` lists the projects only the automatic review has marked.

**Provisional.** The team has not approved a scoring method, and its workflow says "no unapproved thresholds or weights" (step 6). Its own safeguard for RF-033 says "Do not score missing optional/later-stage records as violation". This rule only marks projects where *nothing at all* was found; the label, the banner and the note say the score is provisional.

When the team settles the method, answers in members' reviews can add weighted components: outcomes per check, document availability, priority. Members' scores would join the rules here under a new `method`. Projects keep their rule codes, so earlier scores can be explained.

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
  - No hint under Save; "Export:" for the downloads.

## The final status (2026-11-14)

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
- **The report:** the "Unsatisfactory: red flags" preset lists members' and automatic red flags. "Final status of each (CSV)" in **My reviews**, and "final status" under each review, download one row per review: House bill row, project, office, region, amount, final status, reviewer, checks with an outcome, notes, and when it was last saved (`verdictRows`). The team's workbook rows are unchanged; the workbook has no column for it.
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

Each card is compact: its name, a bar, then pending of total, % reviewed and the pending budget. Hovering gives the full description and the breakdown. The bar shows auto-reviewed (red), reviewed by members (with a verifier or completed, green) and started (in progress or on hold, sand). Clicking a card lists its pending projects: the insertion flag, or its negation for NEP only, then "Not yet reviewed". The funnel step reads "House insertions" or "NEP only". The funnel's steps are cards of the same height (`--rv-card-h`).

The Documents filter has "Where the documents come from" (`SOURCE_GROUPS`). `review.json` row element 10 is a bitmask: 1 for Senate copies, 2 for DPWH Transparency. The groups are Senate copies (4,253; nearly all House insertions), DPWH Transparency (9,299), both (90) and no file found (2,337; 2,119 auto-reviewed).

The filter bar starts with a "Filter" label.

## Not taken in

- The 24 draft indicators. Promoting any of them is the team's decision.
- Steps 6–9 (scoring, prioritising, routing, closing). They need approved rubrics and authority; the form only suggests a priority.
- Assignment and routing status from LIVE FLAG ROUTING. Members can now sign in, but there are no roles: anyone signed in is a volunteer, and the project status is how work is shared.
