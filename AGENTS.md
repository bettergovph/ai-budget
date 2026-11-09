# AGENTS.md

This file is for anyone who works on this repository, human or AI agent. It covers how we work, what has been built, and what is in progress. [README.md](README.md) covers setup, commands and the public API; `docs/` holds one file per workstream. Read this first.

**Keep it current.** When you ship something, start something or learn a rule the hard way, update the matching section in the same PR. The "In progress" section is a dated snapshot, so re-date it when you edit it. A future contributor should never have to dig through old chats or PRs to learn why something is the way it is.

## What this is

[budget.bettergov.ph](https://budget.bettergov.ph) is BetterGov.ph's read-only portal for the Philippine national budget.

- **Stack:** React + TypeScript + Vite on a Cloudflare Worker (`src/worker/`). The Worker uses D1 (database `budget`) for queryable tables. The browser reads larger JSON and Parquet from R2 at `https://budget-assets.bettergov.ph` (bucket `budget`). DuckDB-Wasm runs in-browser analysis.
- **Sections:**
  - GAA 2020–2026 and the GAA Explorer 2000–2026 (`/`, `/d/:id`, `/gaa`)
  - FY2027 NEP (`/2027`)
  - FY2027 House bill (`/hgab/2027`)
  - Budget hearings (`/hearings`)
  - Citizen Reports, Learn and Glossary
  - Public API (`/api/v1`), its docs (`/docs`) and MCP (`/mcp`)
- **People:** work is done with the People's Budget Coalition (PBC). Campaign material credits "People's Budget Coalition × BetterGov.PH" unless a piece is BetterGov-only.

## How we work

### Git, branches and PRs

- **Several agent sessions work in parallel**, each in its own git worktree: `~/.paseo/worktrees/241ehmra/*` and `/tmp/wt-*` on the dev VM. Some worktrees are shared, and another session may switch their branch under you. Before committing, run `git branch --show-current`, `git status` and `git log origin/main..HEAD`. Never commit files you didn't write; untracked posters and scripts from other sessions are common. To build a PR cleanly, use a scratch worktree: `git worktree add /tmp/wt-<name> -b <branch> origin/main`, then symlink `data` and `node_modules` into it. To preview it with `vite`, also symlink `public/data` to `~/projects/ai-reports/data` and `.wrangler` to `~/projects/ai-reports/.wrangler` (the local D1). Without them the NEP 2027 and department pages fail ("Assets are being served from the local public/data tree…", HTTP 500 from `/api`).
- **Never use a bare `git stash`.** The stash stack is shared by every worktree.
- **No stacked PRs.** PR #35 merged into #34's branch 18 s after #34 merged, so it never reached main and had to be re-landed as #36. Branch every PR from main, or retarget it to main before merging.
- **Check `gh pr view <n> --json state` before pushing more commits to a PR branch.** Commits pushed after a merge are lost (#43 → re-sent as #45).
- Commit, push, open PRs, upload and deploy only when the maintainer asks. Production data and D1 reloads always need a go-ahead.
- Split work into several small commits that each type-check (`npx tsc -b`). Before a PR, run `npm run lint`, `npm run build` and the relevant verifier.

### Data integrity

- **Numbers:**
  - Amounts are **integer pesos**.
  - `null` is not `0`. Missing stays missing.
  - Budget stages (NEP, House bill, Senate, GAA) are **compared, never summed**.
  - Unmatched rows are **candidates**, not findings.
- **Every builder has a verifier, and builders fail rather than publish totals that don't reconcile to the peso.** `npm run verify:hgab` is the gate for everything under `/hgab/2027`: several hundred checks, and section verifiers are wired into `scripts/verify-hgab.ts`. Add checks with every feature, and mutation-test them where cheap.
- **Upstream work is pinned, not re-derived.** The FY2027 House bill comparison comes from the BetterGov [DPWH-NEP-HB-2027-ANALYSIS](https://github.com/csiiiv/DPWH-NEP-HB-2027-ANALYSIS) workbench at a pinned commit. We run its own builders, carry its statuses verbatim and never vendor the 1.4 GB repo. The pinned commits and the review are in `docs/hgab-data.md` and `docs/dpwh-nep-hb-2027-review.md`.
- **Look for local copies before downloading any budget document or dataset.** On the dev VM, check:
  - `data/`
  - `~/projects/2027-budget` (NEP CSV)
  - `~/projects/2026-budget` (PBC FY2026 stage sheets)
  - `~/projects/floodlens-ph/data/dpwh` (DPWH contracts mirror)
  - `~/projects/transparency-dashboard`
  - `~/.paseo/uploads` (House bill volumes I-A, I-B, I-C and II)

  If you download anything, say so.
- Rebuild download bundles **after** committing, so each `manifest.json` names a real commit.
- **Never change a published figure silently. Log it on the page.** When a fix, rebuild or new rule changes a figure readers have already seen:
  - **Changes to this page:** add a dated entry to the page's "Changes to this page" list, newest first. Say what changed, with one before-and-after example in pesos, and whether the total or change shown moved.
  - **As of:** the page's "As of" line gives when its data was built, what it compares, and "Updated <date>", linking to that list. It reads the latest entry, so adding the entry updates it.
  - **What's new:** add the same correction to the "What's new" changelog on `/docs` (`src/worker/docs.ts`), and say whether the API or the data files changed.
  - The pattern is `PAGE_CHANGES`, `AsOf` and `PageChanges` in `src/pages/HgabDistricts.tsx` (styles in `src/hgab-districts.css`). A page that has neither gets both with its first correction. Lift them into a shared component the second time a page needs them.
  - New pages, and figures that are only added, need no entry; "What's new" covers those.

### Where data lives

- `data/` is gitignored and several GB. On the dev VM every worktree symlinks it to `~/projects/ai-reports/data`, so all branches share one data tree. Some large entries (`dpwh-contracts`, `gaa-history`, `budget.sqlite`, `budget.sql`) point further to `/data/backups/projects/ai-reports/data`.
- Most `/hgab` data is built into `data/hgab/2027/` and served from R2 under `hgab/2027/`. The site reads R2, not the deploy bundle; a local `vite build` skips `public/data`.
- R2 credentials are the `R2_*` keys in the main checkout's `.env` (`~/projects/ai-reports/.env` on the dev VM); load only those keys. Never commit credentials.

### Publishing data to R2

- `npm run upload:hgab` publishes `data/hgab/2027/`, **the whole tree unless you pass `--only=<dir or file,…>`**. That tree also holds other branches' work (campaign posters, unreviewed builds), so always use `--only`. Add `--skip-verify` only right after a full `verify:hgab` pass. After uploading, check that the live ETag equals the local MD5 and that CORS is `*`.
- **Order matters:**
  - Upload new or backward-compatible data **before** the merge that needs it. Otherwise the deployed page 404s; this happened with the party pages and #51.
  - When the old live code would misread the new data, merge first, then upload (#48).
- **Caching:** JSON and HTML are cached for 5 min, and PNG, PDF, ZIP and TXT for 1 day. Cloudflare forces 4 h on `.csv` and `.zip`. Our tokens **can't purge the cache**, so a rebuilt file keeps its name and links to it carry `?v=<hash>`. Download links get the checksum from their manifest; posters and og images carry a hard-coded `v`, so update it when you re-render.
- D1 loads: `npm run build:hgab-d1` writes `data/hgab/2027/d1-import.sql`, which is never uploaded to R2. A remote `--file` import makes the whole D1 return 500s for about 10 s, so schedule it off-peak and with a go-ahead.

### Deploying

- Production is the Worker `budget`. It deploys through **Cloudflare Workers Builds** on every merge to main; branch pushes get preview versions. There are no GitHub Actions. Check the "Workers Builds: budget" status on the commit.
- Build logs are only in the Cloudflare dashboard. To reproduce a failing build, run `npm ci && npm run build && npx wrangler deploy --dry-run`. If a clean repro passes, check https://www.cloudflarestatus.com (the failures on 2026-11-03 were a Cloudflare incident).

### Reader-facing copy

**`docs/hgab-copy.md` is the rulebook. Follow it for every new page, card, image, letter, API description and MCP description.** The rules people most often get wrong:

- **Names:**
  - Say "NEP", never "the President's proposal".
  - Say "House bill", not "HGAB", in prose.
  - Say "as published", not "as printed".
- **Say "budget", not "money"** ("largest … budget"). Older API and MCP text still says "money".
- **Say "Lone" and "Shared" offices, never "Tier A" and "Tier B".** The `tier` and `attribution` codes stay A and B in data and the API. Use the helpers in `src/lib/hgab-districts.ts` and `hgab-leaderboard.ts`.
- **A DEO number is not a legislative district number** (Davao de Oro 1st DEO serves the 2nd district). A one-district row shows the district + rep + "DPWH office: X DEO"; a shared row shows "DPWH X DEO" + each rep's district. Never write "X district office".
- **A row's headline is a place, never a person.** Every ranking or total says that the documents don't say who asked for a project, and that a total is not evidence of wrongdoing.
- **Disclaimers come from `src/lib/hgab-disclaimers.ts`**, verbatim, on every page, card and API response. Letters are the exception: they state the disclaimers in plain words and link to Methodology.
- **Unprogrammed appropriations (₱111,984,494,000) are the same in the NEP and the House bill.** Never call them a House addition. The explorer's NEP "—" only means its NEP data has no unprogrammed lines.
- Write "school facilities" and "health facilities", never just "schools" or "health". Don't write "PDF" in reader copy; the verifier bans it.
- **Plain language for ordinary readers.** Technical text goes under "Details for analysts" or on Methodology.
- Pages are compact; flag any section that takes a screen to say little.
- Headings are factual, with the number in them.
- Bylines and credits name only who the source names publicly.
- Party data: compare a party's seats and budget **on the same offices**. Credit Dynasties / Open Halalan. Say that members switch parties.

### Terms of Service and the first-visit agreement

- `/terms-of-service` and `/disclaimer` (`src/pages/TermsOfService.tsx`, `Disclaimer.tsx`) are the site's legal text: an agreement between the reader and **the People's Budget Coalition and BetterGov.ph**, credited "People's Budget Coalition × BetterGov.PH". Their paths, effective date, versions, licences, repository URL and the AI models the site names (`CLAUDE_MODELS`, `GPT_MODELS`, used by the footer, Methodology and the Disclaimer) live in `src/lib/site-legal.ts`.
- **Every page of the app sits behind an agreement** (`src/components/TermsGate.tsx`) until the reader ticks "I have read and agree" and selects "I agree". Escape and clicks outside don't dismiss it. "I do not agree" closes the site: the tab closes if the browser allows it, otherwise the page goes blank. On the two legal pages it is a bar under the page instead, so they can be read first. Accepting in one tab closes it in the others.
- The acceptance is kept in the reader's browser only (localStorage `bettergov-budget:terms`: the version and the time). Nothing is sent to the server, and the Privacy section says so.
- **Bump `TERMS_VERSION` with any material change to either page, and add the change to `TERMS_CHANGES`** (listed on the Terms page). Everyone is asked again on their next visit. A second change on the same day takes a suffix (`2026-11-08.2`); `TERMS_EFFECTIVE` is the date shown. Keep the modal's short points (`POINTS` in `TermsGate.tsx`) in step with the pages. The modal ends with "Be a citizen budget reviewer" (AI-assisted and reviewed by people; Discord, report an error, email); the maintainer wants AI mentioned there, not among the points.
- **Scripts that open the site in a browser must accept the terms first:** `await acceptTerms(page)` from `scripts/lib/accept-terms.mjs`, before the first `goto`. Otherwise the modal covers screenshots and blocks clicks. Pages built with `setContent` (the posters) are not affected.
- Pages outside the app don't show it: `/docs`, the API, the MCP server and the static pages on R2 (such as "We are not ignorant" and the campaign gallery). The terms still cover them.

### Images and posters

- Never let an image model render data or text. Headlines and figures are typeset in code (Playwright or canvas).
- Keep every generated variant; don't delete alternatives.
- Posters live in `data/hgab/2027/campaign/`. The public gallery (`campaign/index.html` + ZIP on R2) is hand-made. Add new posters with `?v=<md5>` links, and upload the ZIP before `index.html`.

### Dev VM gotchas

- Ports are reserved in `~/projects/ports.md`:
  - 5130: the main dev server
  - 5131–5138: preview worktrees
  - 5132: transparency-portal

  Release a port when its branch merges. Harness-launched servers die after 2 h; use `setsid nohup` for long ones.
- Python `urllib`'s default user agent gets 403 from `budget-assets.bettergov.ph` and `statistics.bettergov.ph`. Set a user agent, or use curl or Node.
- YouTube blocks media downloads from the VM (bot check), so hearing audio must come from cookies or another machine. See `docs/budget-hearings.md`.
- Scripts can't import `src/lib/hgab.ts` (it uses `import.meta.env`). Several builders read constants such as `REGION_ORDER` from it **as text**, so don't move those.
- DuckDB runs out of memory reading the large DPWH API page dumps; stream them to JSONL first.
- Don't `pkill -f` by a name your own shell command contains; match exact args from `ps -eo pid=,args=`.

## What's been built

Newest work is listed last within each area. PR numbers are on [bettergovph/ai-budget](https://github.com/bettergovph/ai-budget/pulls?q=is%3Apr).

### GAA 2020–2026 portal (the original site)

- National overview, department pages (`/d/:id/*`: programs, objects, line items, reports, budget cycle), `/explore` and `/methodology`.
- Data comes from the [GAA dataset on Hugging Face](https://huggingface.co/datasets/bettergovph/gaa), through Parquet and SQLite into D1 and R2. See README "Commands".
- Budget-cycle comparison: `docs/budget-cycle-import.md`.

### GAA Explorer, FY2000–2026

- `/gaa`, `/gaa/:year` and record search: 27 years of GAA line items rebuilt from DBM originals (#44). Docs: `docs/gaa-explorer.md`. The yearly data release is described in `docs/gaa-history.md`, which is in PR #74.
- National and per-department trend charts run FY2000–2026 from `gaa-explorer/series.json` (#56; `npm run build:gaa-series`). Rebuild and re-upload `series.json` whenever the Explorer manifest changes.
- Known quirk: the department extract files special purpose funds under department 01. So `/d/01` shows Congress at about ₱294B (FY2020), while the Explorer shows ₱27B. The chart carries a note; this is not fixed upstream.

### FY2027 NEP microsite (`/2027`)

- The NEP measured line by line against the FY2026 GAA. Docs: `docs/nep-2027-import.md`; commands `import:nep2027`, `verify:nep2027`, `upload:nep2027`.
- `/` lands on the NEP overview, so its hero opens with a notice: where the 2027 budget is now (the House bill, HB 10858, approved on third reading; the Senate next) and a button to the House bill (2026-11-09). The stages live in `src/lib/budget-stage.ts`, shared with the House bill section's timeline (`HgabStageStrip`). **When the budget moves on, move `current` there and rewrite the notice's words** (`StageNotice` in `src/pages/Nep2027Story.tsx`).

### Budget hearings (`/hearings`)

- House budget hearings, transcribed with speakers and summarised. The pipeline is a separate project (`~/projects/transcriptions` on the dev VM). Docs: `docs/budget-hearings.md`.
- Transcription is Cloudflare Whisper words + Nova-3 speaker turns. Summaries go through the AI Gateway `hearings`, with an OpenRouter fallback.

### Public API, docs and MCP

- `/api/v1` covers GAA, NEP 2027, budget cycle, hearings and the House bill (#10). `/docs` has a "What's new" log (#55). `/mcp` has its tools listed in the README.
- House bill API notes: `docs/hgab-api.md`. Several datasets are published as files only, without endpoints; `/docs` lists them.

### FY2027 House bill (`/hgab/2027`)

The House bill is HB 10858 at second and third reading, compared with the NEP. Start with `docs/hgab-plan.md` (routes and plan), `docs/hgab-data.md` (sources, pins, reconciliation) and `docs/hgab-copy.md` (wording).

- **Foundation (#6–#20, 2026-10-25/26).** `npm run import:hgab` reads the pinned workbench into `data/hgab/2027/`. It covers four programs with project-level detail: DPWH, farm-to-market roads (FMR), the Health Facilities Enhancement Program (HFEP) and NIA. The section has:
  - an overview (the landing page) with candidate changes, and program hubs (`?view=` dropdowns);
  - record pages with PDF evidence, maps (`docs/hgab-geo.md`), Sources and Methodology;
  - plain-language copy, and disclaimers everywhere.

  The House bill's official source is the Senate Budget Transparency Portal, which blocks automated downloads.
- **Districts and offices.**
  - `districts.json`: 254 legislative districts and about 200 DPWH offices, from the workbench's DEO-to-district crosswalk. It holds each office's GAA history for FY2020–2026 and its FY2027 figures. Representatives come from bills.juris.ph.
  - Browse by office (#16).
  - Projects placed in each district (#54, from the workbench's location lens; `locations.json`).
  - One card per shared office (#59).
  - Menu names "District Engineering Offices" and "Legislative Districts" (#64).
  - "Lone" and "Shared" wording (#61).
  - **2027 NEP figures, corrected 2026-11-07.** District cards and the region table set the NEP's whole-office listing beside the House bill's named projects, so the two figures did not subtract to the change shown (Abra ₱730.2M → now ₱689.5M, beside ₱839.5M). Both 2027 figures now count named projects (`fy2027.nep_php`). The page has an "As of" line and a "Changes to this page" list. The API `headline.fy2027_nep_php` is still the whole office; `fy2027_vs_proposal` is the like-for-like pair.
- **Leaderboards and share images.**
  - `/hgab/2027/leaderboard`: 17 office boards (#12).
  - Whole-bill boards (#35/#36, #37; one direction per board).
  - Pre-rendered link previews in R2 `share/`, built by `build:hgab-share`.
- **"We are not ignorant" (#21, #22):** every inserted and adjusted project. It is a static page regenerated by `build:hgab-not-ignorant`; edits go live on upload, with no deploy.
- **Letters to representatives (#26, #33):** `/hgab/2027/letter`, one letter per district (JSON, TXT and PDF), copying the Speaker, the Majority Leader and the Appropriations chair. Built by `build:hgab-letters`.
- **The whole bill, line by line (#34, #36, #38–#42, #57, #58).**
  - `/hgab/2027/explorer`: every line of the bill against the NEP, with downloads (`explorer/downloads/` + `manifest.json`) and NEP and House bill page links on every row. The pipeline is `npm run build:hgab-lines`; see `docs/hgab-non-infra-lines.md`.
  - **It carries an "Under citizen review" banner (`LINES_UNDER_REVIEW` in `src/lib/hgab-explorer.ts`). Remove the banner only when the maintainer says the review is done.**
  - The DPWH pages lead with all of DPWH; projects are the breakdown (#58).
  - The Explainer (`/intro`) is hidden for now.
- **Multi-purpose buildings (MPB).**
  - Budget by year, FY2020 to the 2027 House bill, with a poster (#29, #30, #32).
  - Map of every MPB line from FY2015 (#43, #45, #52, #73). Placement follows a fixed order: GPS in the title, then PSGC from the title, then DEO, then region, then a catch-all. Docs: `docs/hgab-mpb-years.md`.
  - Top contractors and leaderboards, with no legislators on the district board (#47, #48). Docs: `docs/hgab-mpb-boards.md`.
  - NEP vs House bill side by side (#65), region-by-year grids with a shareable image (#67), "About this data" (#68) and party by year (#69). Docs: `docs/hgab-mpb-compare.md`.
- **Flood control (#66–#69):** `/hgab/2027/flood-control`, with the 2025 GAA, the 2026 GAA, and the 2027 NEP and House bill on one map, plus a 2015–2027 region grid. It is built by `build:hgab-flood-compare`.
- **DPWH contractors (#46, #47, #49):** `/hgab/2027/contractors` and contractor pages. GAA lines are linked to their DPWH contracts: for FY2020–2025, 72% of lines, with about 1 wrong link in 100 on a hand check. FY2026 is lower because many contracts are still for procurement. There are links to the DPWH transparency portal and downloads with a manifest. Docs: `docs/dpwh-contracts.md`.
- **By party (#50, #51, #69, #71):**
  - `/hgab/2027/parties`: each district's May 2025 party against its DPWH budget, with party pages listing every line.
  - Party-by-year grids, and "How we read parties" (`/parties/by-congress`) with sources and disclaimers.
  - Docs: `docs/hgab-parties.md`.
- **₱1 trillion in red flags (#60, #63):** PBC's red-flag basket, at `/hgab/2027/1T-redflags`. #63 hid the tab and removed the poster downloads; #69 made the tab visible again (`NAV_HIDDEN` in `HgabBits.tsx` is now empty).
- **Foreign-assisted projects (#62):** `/hgab/2027/foreign-assisted`, NEP ₱416.6B → House ₱285.9B, plus every budget since FY2021 from DBM BESF Table B.13. Docs: `docs/hgab-fap.md`. The poster is in #72 (open).
- **Campaign posters:**
  - "We are not ignorant", "Insertions ranked", "Multi-purpose buildings", "Publish the documents", "Write to your representative", "The budget line by line", "Insertions by party", "₱1 trillion in red flags", "Cut year after year" and others.
  - Builders are `scripts/build-hgab-poster*.ts`; several still sit untracked in worktrees (see In progress).

### Citizen Reports (`/citizen-reports`, #53)

Cards for budget analyses on other sites, with screenshots (`npm run build:citizen-reports`). The list is in `src/lib/citizen-reports.ts`. Bylines name only people the site names publicly.

### Outside this repo

- **Philippine Statistics Explorer:** [statistics.bettergov.ph](https://statistics.bettergov.ph), code in `~/projects/psa`. It mirrors 3,660+ PSA OpenSTAT tables, with REST and MCP. It is used by the budget-vs-statistics work (PR #75, `docs/budget-vs-statistics.md`).
- **Transparency portal kit:** [bettergovph/transparency-portal](https://github.com/bettergovph/transparency-portal). A forkable FY2027 portal for an LGU or DEO, built over `/api/v1/hgab/2027`.
- **Hugging Face datasets** ([bettergovph](https://huggingface.co/bettergovph)): `gaa-2000-2026` and `house-budget-hearings-2027` have been live since 2026-11-07 (CC0). The publishing pipeline is in PR #74 (`scripts/hf/publish.py`, `docs/hf-datasets.md`). Still to do: `house-bill-2027` and `dpwh-contracts-2016-2026`.
- **Upstream and source projects:**
  - the csiiiv FY2027 workbench (DPWH-NEP-HB-2027-ANALYSIS)
  - `api.dpwh.bettergov.ph` (our proxy of the DPWH transparency API, repo bettergovph/api.dpwh)
  - Dynasties (`~/projects/dynasty`, dynasties.bettergov.ph; party and election data and the province outlines)
  - bills.juris.ph (House members)

## In progress (snapshot 2026-11-08)

Re-check before relying on any of this: `gh pr list`, plus `git worktree list` and `git status` in each worktree.

**Open PRs:**
- #75: budget vs PSA statistics, a first exploratory pass (`scripts/stats-psa/`, `docs/budget-vs-statistics.md`)
- #74: GAA FY2000–2026 pipeline + Hugging Face publishing
- #72: foreign-assisted poster
- #27: link-preview images for every House bill page (cards already on R2)
- #25: "Insertions ranked" poster
- #4: repo scaffolding (CI, contributing guide, llms.txt)

**Uncommitted work in worktrees on the dev VM:**

| Work | Where | State |
|---|---|---|
| Budget vs PSA statistics | PR #75 (branch `budget-vs-statistics`) | First pass committed; exploratory, unreviewed, no page |
| Party members page (`/hgab/2027/parties/members`) | worktree `ordinary-hyena`, `src/pages/HgabPartyMembers.tsx` + party builder edits | Built; data already on R2; needs its own branch from main + PR |
| Poster builders: line by line, parties, receipts, reviewer | `ordinary-hyena`, untracked `scripts/build-hgab-poster-*.ts` | Posters published; scripts never committed |
| MPB and flood control tables by DEO (`office-matrix.ts`) | worktree `mpb-nep-house`, branch `hgab-deo-tables` | Built; needs a `flood-compare/summary.json` upload + PR |
| Shared-office cards showing each district's own amount | worktree `placements`, branch `hgab-shared-amounts` | Built; awaiting a PR decision |
| Disclaimer, Terms of Service and the first-visit agreement | #78 merged 2026-11-08. Follow-up branch `site-terms-pbc` (worktree `/tmp/wt-terms`, preview :5142): PBC as a party, footer credit, models, repo URL | PR open; the licence choice and a lawyer's read are still open |
| "Publish the documents" and "We demand answers" poster builders | worktree `hgab-programs`, untracked | The first is published; the second is not approved |
| Districts 2027 NEP correction + As of + change log | worktree `headline-basis`, branch `hgab-district-headline-basis` (preview :5140) | Committed, not pushed; needs a PR |
| GAA history scripts (`scripts/gaa-history/`, `docs/gaa-history.md`) | main checkout `~/projects/ai-reports`, untracked | Committed in PR #74 |

**Open questions for the maintainer:**
- the licence for content, data and code;
- a Philippine lawyer's review of the Terms of Service and the Disclaimer, and the legal name of the BetterGov.ph entity that is party to them;
- when the line-by-line review ends (it lifts the banner);
- whether budget vs statistics becomes a page;
- copy for parties whose seats are all in shared offices ("These 0 lines…").
