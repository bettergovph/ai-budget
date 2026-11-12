# House bill documents and review flags, per project

Data for the planned **Review** button on each DPWH project of the FY2027 House bill: the project's supporting documents (Senate-provided files and DPWH Transparency "Proposal" files) and the research site's review flags, tied to our project rows.

`npm run build:hgab-documents -- --fetch` → `data/hgab/2027/documents/` (checked by `npm run verify:hgab`, section "documents/"). Contract: `src/lib/hgab-documents.ts`.

Published to R2 on 2026-11-12: `projects.parquet`, `files.parquet`, `review.json`, `detail/` and `manifest.json`. `sources/` (263 MB of third-party snapshots) is not uploaded. Re-upload with:

```
npm run upload:hgab -- --only=documents/projects.parquet,documents/files.parquet,documents/review.json,documents/detail,documents/manifest.json --skip-verify
```

R2 caches Parquet for a day and isn't purged, so link it with `?v=<md5>` from `manifest.json` `outputs`. JSON is cached for 5 minutes.

## Sources

All snapshotted under `documents/sources/` with their SHA-256 in `manifest.json`. The in-depth shards are checked against the SHA-256 the in-depth file publishes.

| Source | What we use |
| --- | --- |
| [hgab-document-coverage.json](https://research.bettergov.ph/static/nep-preview/hgab-document-coverage.json) | 15,979 House bill DPWH rows: Proposal document types, Senate files tied to the row |
| [flags.json](https://research.bettergov.ph/static/nep-preview/flags.json) | Same rows: review flags with evidence, missing-document flags |
| [dpwh-in-depth-data.json](https://research.bettergov.ph/static/nep-preview/dpwh-in-depth-data.json), shards `projects-*` | 11,034 Proposal records (`2027DPWH-Proposal-NNNNN`) with DPWH Transparency file links on `s3.infrawatch.ph` |
| same, shards `hgabPowResults-*` | The research site's first-page title scan of 6,259 Senate POWs |
| [supporting-documents-file-links.jsonl](https://budget-assets.bettergov.ph/hgab/2027/dpwh/supporting-documents-file-links.jsonl) | 34,424 Senate files in 6,673 folders `2027DPWH-HGAB-<code>` (141 files have no code: zips, office-wide certifications) |
| `Region IV-A/R4A_FY 2027 DPWH HGAB Tracker and List.xlsx` (inside the Senate files) | Region IV-A's own list of folder codes with title, amount and office (905 codes). No other region sent one. |

## Keys

- **`hgabId` = `HB10858-3-PPPP-NNNNNN`**: House Bill 10858, third reading, PDF page `PPPP` of Volume I-C, row `NNNNNN` of the bill. The middle number is a page, not a project ID.
- **Our row**: `project_id` in `dpwh/projects.parquet` (`house-reading:N`). Those IDs are positional and can change on re-import, so store `hgab_id`.
- **Senate folder code** (`2027DPWH-HGAB-10712`) is DPWH's numbering, not the bill row. It follows the bill's order in long runs, but placing a folder by that sequence lands on a neighbouring project in 11 of 59 checkable cases, so we don't use it.
- **Proposal code** (`2027DPWH-Proposal-36944`) is `record_json.api.id` in our DPWH rows, from the pinned workbench's pairing.

## How a research row reaches our row

Page + amount + exact title: 15,968. Same page and amount after cleaning stray PDF characters or a doubled title: 5. **Merged duplicates**: 6 bill lines that are one project printed twice, which our import keeps as 3 rows (₱12M + ₱12M = our ₱24M Guagua road; Lanao del Sur MPB 75 + 75; Taysan MPB 15 + 10). These must add up to the peso or the build fails.

## How files reach a row (`link_method`)

| Method | Rows / folders | Rule |
| --- | --- | --- |
| `research` | 3,980 folders | The coverage file's own ties, with its file list and types |
| `reviewed` | 15 folders | The coverage file and the R4A tracker disagree; settled by reading the POW (`FOLDER_REVIEWS`, with what each POW says). Tracker right 8 times, coverage file 7. **8 folders moved** (e.g. 12253 Banlic and 12254 Makiling were both on Milagrosa). The build fails on a new dispute until someone reads it. |
| `pow_title` | 53 folders | The research site's POW scan names a row by **exact** title, the coverage file left the folder untied, and the row had no Senate files. Relaxed matches are excluded (12254's relaxed match was wrong). |
| `tracker` | 351 folders | R4A tracker lists the code with one row's exact title and amount, no POW scan names another row, and the row had no Senate files |
| `proposal` | 9,389 rows | The paired Proposal record (9,378) or one with the row's exact title (11), **only when its file types equal the types the research site lists for the row** |

A hand check of 30 tracker and 10 POW-title folders against their POWs (text or OCR) found none wrong (36 confirmed by title, amount or place; 4 unreadable or without a POW).

## Per-row fields worth knowing

- `named_present_upstream`, `missing_flags_upstream`, `complete_upstream` reproduce the research site exactly. The build fails unless the missing flags equal `flags.json` on every row and all 215 flag counts in its summary are reproduced. The five named types and the "4 of 5 is complete" rule follow the research site, including which Proposal labels count (`PROPOSAL_TYPE_MAP`: MDC, CDC and "G.photos" don't).
- `named_present`, `missing_flags`, `complete` add our links. Complete rows go from 11,891 to 12,183. A row that lost a folder on review counts only the files it still has.
- `review_flags`: the research site's flags in its order, with `code` (slug), `value` (pesos for "Allocation increase/decrease: N pesos") and deduplicated `evidence`. 281 flags have no evidence (the flags overview lists them without the detailed queue).
- `notes`:
  - `proposal_documents_via_nep_counterpart` (8,826): the row has the flag "No listed DPWH Transparency documents", yet has Proposal files through its NEP counterpart. Explain this on the Review screen; it reads like a contradiction.
  - `proposal_types_without_files` (188): the research site's newer NEP pairing found Proposal documents that our pinned pairing can't reach. Ask the research site to publish the Proposal code per `hgabId`.
  - `senate_matched_without_files` (170): Senate types counted upstream, but no file list.
  - `senate_folder_moved_to/from_another_row`, `several_senate_folders`.

## Gaps

- 2,274 Senate folders (about 11,700 files) are still untied. Most have a POW the research site's scan couldn't match (scanned images, or titles that differ from the bill). Tying them needs OCR of the POW's first page; DPWH's trackers for the other regions would settle most of them.
- The coverage file's own folder ties are wrong about 1.5% of the time where the R4A tracker lets us check (8 of 536). Expect about 60 wrong ties nationwide. The Review form is a good place to collect "these documents belong to another project".
- 112 rows have a Proposal record in our pairing that the research site doesn't count; we don't attach them.
- Having a file doesn't verify what's in it.

## The project reviewer (`/hgab/2027/review`)

A workspace for volunteers, with its own full-height layout (a slim bar, no site masthead). Code: `src/pages/HgabReview.tsx`, logic `src/lib/hgab-review.ts` (pure; `npm run test:hgab-review`), styles `src/hgab-review.css`.

- **Data.** `review.json` (2.9 MB, about 490 KB gzipped) has every project as one positional row: ids, title, office, region, program, amount, flag indexes, a bitmask of the 5 key documents found, and a file count. Offices carry the legislative districts they serve (from `districts.json`; the build fails if a DEO resolves to none). `detail/NN.json` (500 bill rows each, about 55 KB gzipped) has each project's files, flags with evidence and notes. The page loads it when a project opens.
- **Filters and the funnel.** A bar of dropdowns with checkboxes: Start from (ready-made funnels, `PRESETS`), Red flags, Documents, Region, DPWH office, Budget, and a search box. Every checked red flag is its own step, and projects must pass them all; "Leave out" makes a flag step drop the projects that have it. Checked regions, offices, programs and document counts are one step each, keeping projects that match any checked value. Under the bar, the funnel strip shows every step left to right, with the projects and budget left and how many it dropped. Each option shows how many projects it would keep. Steps live in the URL (`s=` repeated; several values joined by `|`), with `p=` (open project) and `sort=`. Filter changes are computed from the latest steps (`stepsRef`), because react-router commits the URL asynchronously and a quick second click would otherwise undo the first.
- **Missing-document flags** in the funnel are ours, computed with our links. Hover shows the research site's own count.
- **Words.** Flag labels and evidence are the research site's, with "HGAB" shown as "House bill" (`readerText`). A DPWH office always appears with the districts it serves.
- **The project pane** has tabs: Overview, Documents, Red flags and Review. All four stay mounted, so an unsaved review survives switching. The tab is in the URL (`tab=`) and stays as you move between projects; keys 1–4 switch tabs, and j and k move between projects. At 1280 px and wider, documents show beside the project, with a divider you can drag or move with the arrow keys (double-click resets it; the width is kept in `hgab-review:split`). Narrower screens open documents over the page. Both PDF hosts allow framing. Each file says where it came from and how it was matched; tracker matches are marked weaker.
- **Reviews** follow the volunteer team's red-flag registry: see `docs/hgab-review-form.md`. They stay in the browser (`localStorage` key `hgab-review:v2`) and download as JSON or as the team's workbook rows from "My reviews". **Submissions need a backend decision** (for example a D1 table behind the Worker).
- Not in the section's sub-nav or the sitemap yet.
