# Plan: the HGAB tab

Bring the FY2027 House General Appropriations Bill (HGAB) workbench, currently
the GitHub Pages site built from csiiiv/DPWH-NEP-HB-2027-ANALYSIS, into this
portal as a section beside the NEP, the GAA and the hearings. Data lives on
Cloudflare like everything else here. We own both repositories.

Companion: `docs/dpwh-nep-hb-2027-review.md` (what the workbench contains and
how it reconciles to our NEP CSV).

## Approach: move the existing app, then integrate incrementally

The workbench already ships as one static package. Its `build_pages.py`
writes `_site/` with the React bundle under `app/`, the JSON payloads under
`analysis/`, the PDFs under `pdfs/`, `HB_BUDGET/` and `HB_BUDGET_3rd_reading/`,
and the annex evidence under `other-analysis/`, `analysis-nia/`,
`analysis-hfep/` and `gps-analysis/`. Vite builds with `base: "./"` and every
fetch goes through `siteUrl()`, which resolves relative to the app URL. Nothing
in it assumes a GitHub Pages host. Hosted under `/hgab/`, every hash route and
every PDF byte-range request works unchanged.

So the plan is: host that package on Cloudflare, add the tab, gate publishing
on our reconciliation checks, and only then decide what deserves deeper
integration. A rebuild on our components is not required to ship and is
listed at the end as optional follow-up work.

## Scope at launch

The four programs where HB 10858 prints project-level detail, as the
workbench has them today.

| Dataset | NEP | HGAB (3rd reading) | Grain |
| --- | ---: | ---: | --- |
| DPWH national pipeline | ₱642,612,015,000 (11,420 rows) | ₱654,102,015,000 (16,275 operations rows) | Named project with chainage, region, implementing office |
| DA farm-to-market roads | ₱16,000,000,000 (704) | ₱19,628,100,000 (964) | Project with printed coordinates |
| DOH Health Facilities Enhancement Program | ₱14,472,659,000 (464) | ₱10,021,659,000 (513) | Facility with four funding columns |
| NIA irrigation | ₱17,598,181,000 (791) | ₱17,999,305,000 (828) | Project under six sub-programs |

The tab says plainly that this is not the whole House bill.

## Site outline

### Primary navigation

```
National Expenditures 2027 · House Appropriations Bill 2027 · Budget Hearings · General Appropriations 2020–2026 · Learn
```

The new tab is a plain link to `/hgab/`. The masthead coverage label reads
"FY 2027 HGAB" while the reader is under `/hgab/`.

### What the reader sees under `/hgab/`

The workbench as it exists today, with its own workspace header, served from
our domain. Deep links keep their current shape:

| URL | Workspace |
| --- | --- |
| `/hgab/app/#overview` | Landing: five-group bridge per dataset (House-only, NEP-only, Unchanged, Increased, Decreased, segment-scope review), stage totals, record-grain labels |
| `/hgab/app/#home`, `#highlights`, `#compare`, `#analysis`, `#house`, `#nep`, `#transparency` | DPWH: home, media highlights, stage comparison with PDF pane, analysis (candidates, adjustments, chainage, groupings), source trees |
| `/hgab/app/#fmr/…`, `#hfep/…`, `#nia/…` | Annex workspaces with the same tab pattern; FMR includes the map |
| `/hgab/app/#geo/…` | Geolocation map |
| `/hgab/app/#sources`, `#about`, `#disclaimer` | Dataset catalogue with downloads, suite introduction, full disclaimer |

The Congress workspace stays hidden as it is upstream.

Two small additions land with the move:

- A thin portal bar above their header: BetterGov logo and a link back to the
  budget portal. Injected by the packager the same way it already injects
  `SITE_CONFIG`, so their source is untouched.
- Cross-links from our side: `/2027/d/18`, `/2027/d/05`, `/2027/d/13` and
  `/2027/d/35` get a "House bill" call-out linking to the matching workspace,
  and the hearing pages for DPWH, DA, DOH and NIA link to the same.

## Hosting on Cloudflare

| Where | What | Why |
| --- | --- | --- |
| R2 `budget`, prefix `hgab/` | The whole `_site/` tree: `app/` bundle, `analysis/*.json`, PDFs, annex evidence, CSV exports. About 450 MB including 164 MB of PDFs | Workers static assets cap files at 25 MiB; the PDFs and the 50 MB project payload cannot live there. R2 honours Range requests, which PDF.js needs |
| Worker route `/hgab/*` | Streams `hgab/<path>` from R2 with Range and content-type passthrough; `/hgab/` and `/hgab/app/` fall back to `app/index.html` | Same pattern the hearings already use to read R2 content; add an R2 binding to `wrangler.jsonc` rather than going through the public host |
| D1 | Nothing at launch | Their app reads static JSON. D1 only becomes useful for a public API, which is follow-up work |

Edge caching: immutable hashed bundle files cache for a year; JSON payloads
and PDFs cache with a short TTL keyed on the manifest commit so a republish
invalidates cleanly.

## Pipeline and publishing

The extraction repository stays the pipeline. Transfer it to the bettergovph
organisation, add MIT and CC BY 4.0, and keep its Python checks, frontend
tests and browser checks there. Its own commands already produce the package:

```
npm ci --prefix analysis/web
npm run build --prefix analysis/web        # prebuild regenerates every payload
python scripts/build_pages.py              # writes _site/, validates manifests and hashes
```

This repository adds two scripts:

```
npm run verify:hgab   scripts/verify-hgab.ts         reconciliation gate (below); exits non-zero on failure
npm run upload:hgab   scripts/upload-hgab-site.ts    _site/ → R2 hgab/ with ETag-checked PUTs, writes hgab/manifest.json
```

The verifier reads the package's committed ledgers and asserts the checks
from the review against our FY2027 NEP data: DPWH total minus RLIP and NBCDF,
capital outlays, the six operations programs and the 45 PAPs once FAP is split
out; FMR activity `310203206315000`; HFEP activity `350202100002000` capital
outlays; the six NIA sub-programs under agency `35-005`. It also asserts the
five-group bridge identity per dataset and the +₱134,000,000 reading delta.
If a check fails, nothing uploads. The verifier output is written into the
package as `analysis/reconciliation.json` so the methodology surface can show
it later.

A refresh is: pull the extraction repo, build, verify, upload. Pin the commit
in `hgab/manifest.json`.

## Phases

| Phase | Deliverable | Effort |
| --- | --- | --- |
| 1 · Move | Build `_site/` from the pinned commit; R2 binding and `/hgab/*` route with Range passthrough and SPA fallback; upload script; nav tab and coverage label; portal bar | 1–2 days |
| 2 · Gate and links | Reconciliation verifier wired before upload; cross-links from `/2027/d/` pages and hearings; redirect the GitHub Pages site here | 1 day |
| 3 · Follow-ups, each optional | Public API and MCP tools reading the overview and project payloads from R2 (about a day); SEO landing pages for the hubs so search engines see something behind the hash routes (a day); Learn and Glossary entries (half a day) | as wanted |
| Later · Rebuild | Re-skin pages on `Nep2027Bits`, move the project index into D1, path routes with per-record pages. Only if the design mismatch or the hash routing turns out to matter to readers | 2–3 weeks, deferred |

Phases 1 and 2 put the tab live in about three days.

## What the move does not give us, and why that is acceptable for now

- **Design consistency.** Their header and styles differ from ours. The
  portal bar keeps the reader oriented; a re-skin is the deferred track.
- **Per-page SEO.** Hash routes are one URL to a crawler. Follow-up 3 adds
  static landing pages for the few hubs that matter.
- **A public API for HGAB data.** Nothing in the app needs it. The payloads
  are already downloadable from the Sources workspace, and a thin Worker
  layer over the same JSON is a day when wanted.

## Repository actions

1. Transfer csiiiv/DPWH-NEP-HB-2027-ANALYSIS to bettergovph and add the
   licence files.
2. Tag the commit this portal pins, starting with `a0caa77`.
3. Point its README at this repository's `upload:hgab` so contributors know
   how a build reaches the portal, and change its GitHub Pages workflow to a
   redirect once Phase 2 ships.

## Open decisions

Defaults are stated; say so if you want a different call.

1. Serve the app from R2 through the Worker (default) or copy only the small
   `app/` bundle into Workers static assets and keep data and PDFs on R2.
   The default is one code path; the alternative saves a few milliseconds.
2. Nav label "House Appropriations Bill 2027" (default) or "HGAB 2027".
3. Retire the GitHub Pages site with a redirect after Phase 2 (default) or
   keep both.
4. Which follow-ups in Phase 3 to take, if any.

## Implementation notes (25 October 2026)

What was built, measured against the plan above.

**Path taken.** The plan's default was to host the workbench's static package
under `/hgab/` and leave a re-skin for later. Jason chose the deferred track
after all: the section is rebuilt on this portal's own components and routes,
reading a data tree our own importer emits, so it reads like `/2027` and the
hearings rather than like an embedded site. The reasons were the ones the plan
listed as costs of the move — design mismatch, one-URL hash routing, no
per-record pages, nothing for a crawler behind the hashes — plus one it did
not list: once the figures sit in our `overview.json`, `summary.json` and
parquet, they are the same figures a public API and the MCP tools can serve
later without a second pipeline.

**What is carried, what is not.** The importer does not re-derive matching.
Every status, pairing and amount comes from the workbench's own builders at
the pinned commit (`a0caa77` unless `manifest.json` says otherwise), so a
number on `/hgab` is a number in their ledgers. The candidate framing, the
segment-scope rule and the status vocabulary are carried verbatim
(`TRACE_LABELS`, `BRIDGE_LABELS`, `MATCH_LABELS`, `READING_LABELS` in
`src/lib/hgab.ts`). The workbench's SPA, PDF.js viewer, MapLibre map and Node
payload builders are not ported; evidence links open the source PDFs at the
cited page through the browser's own viewer.

**Route shape** (`src/App.tsx`):

| Route | Page |
| --- | --- |
| `/hgab` | Redirects to `/hgab/2027` |
| `/hgab/2027` | Overview — the four datasets, stage totals, the bridge per dataset, documents, reconciliation against `data/2027` |
| `/hgab/2027/:dataset` | One program's hub (`dpwh`, `fmr`, `hfep`, `nia`); `?view=` selects the tab, the bare path is the overview tab |
| `/hgab/2027/:dataset/p/:id` | One comparison record — stages, status, pairing, PDF evidence |
| `/hgab/2027/sources` | Source documents, hashes, downloads |
| `/hgab/2027/methodology` | Matching vocabulary, the bridge identity, reconciliation, caveats |

The workbench's hash routes are not preserved. The GitHub Pages site stays up
as it is; the redirect under "Repository actions" is still open.

**Data.** `npm run import:hgab` writes `data/hgab/2027/` — `manifest.json`,
`overview.json`, one `summary.json` and one `projects.parquet` per dataset, and
the source PDFs under `pdf/` (layout in the header comment of
`src/lib/hgab.ts`). `npm run verify:hgab` gates `npm run upload:hgab` on the
reconciliation checks from the review and on the bridge identity per dataset.
The browser reads the tree from `VITE_DATA_BASE_URL` under `hgab/2027/`,
exactly as `2027/` is served; in dev, from the `public/data` symlink. Nothing
in D1. Details in `docs/hgab-data.md`.

**File ownership during the build.** Four agents worked one worktree in
parallel, with `src/lib/hgab.ts` written first as the shared contract:

| Owner | Files |
| --- | --- |
| data | The import, verify and upload scripts under `scripts/`, their `package.json` entries, `docs/hgab-data.md` |
| shell | `src/components/SiteHeader.tsx` (nav tab, coverage label), `src/App.tsx` routes, `src/components/HgabBits.tsx`, `src/hgab.css`, `src/pages/HgabOverview.tsx`, `HgabSources.tsx`, `HgabMethodology.tsx`, `src/lib/seo.ts` and `src/worker/seo.ts` |
| hub | `src/pages/HgabDataset.tsx`, `HgabRecord.tsx`, `HgabProjects.tsx`, `HgabEvidence.tsx`, `src/lib/hgab-query.ts` (DuckDB-Wasm over the project parquet) |
| links | `src/pages/Nep2027Department.tsx` call-out, `src/pages/HearingDetail.tsx` related links, `src/hgab-links.css`, `src/lib/glossary-terms.ts`, `src/pages/Learn.tsx`, `README.md`, this section |

**Cross-links shipped.** `/2027/d/18`, `/2027/d/05`, `/2027/d/13` and
`/2027/d/35` show a "House bill for this group" card under the KPI strip: NEP
against the latest House reading of the compared population, the delta and
percentage, the dataset's grain and scope sentence, and links into the hub
(overview, projects, changes). It is driven by a four-entry constant keyed on
department id and by `overview.json`; when the overview is not published it
renders nothing. Hearing pages whose `agency` tag matches DPWH, DA, DOH or NIA
on whole words (so DAR does not match DA, and "DA and NIA" gets two links)
show a related-link block under the title. The glossary gained GAB/HGAB,
second and third reading, insertion and deletion candidate, segment-scope
review, DEO, chainage and FAP, and extended P/A/P; `/learn` gained a
House-stage section between the cycle and the money flow.

**Districts (added the same day).** `/hgab/2027/districts` and
`/hgab/2027/districts/:id` are the DEO lens, rebuilt rather than copied: one
card per legislative district with the serving office(s), that office's
budget history grouped by Congress (18th: FY2020–2022, 19th: FY2023–2025,
20th: FY2026 plus the FY2027 NEP and House bill) with year bars and
per-Congress GAA subtotals, the office's FY2027 bridge, and the seat holder
from our own directory at bills.juris.ph joined on the congress.gov.ph
member code (253 of 254 seats; portraits are its Commons-mirrored, attributed
images). `scripts/build-hgab-districts.ts` writes `districts.json` from the
DEO2LEG crosswalk, `data/18/operating_units.json` (FY2020–2026 GAA),
`data/2027/18/operating_units.json` (FY2027 NEP) and the DPWH parquet; the
verifier grew to 154 checks. The four conditions are rendered, not footnoted:
a tier badge on every figure, shared offices shown undivided with their
co-served districts, the Central Office and regional residual published per
year before any card (about 70% of the FY2027 House total), and the note that
the representative shown holds the 20th Congress seat. Predecessor offices
that were later split stay in the residual rather than being attributed to a
successor; the one alias applied is the Surigao del Norte renumbering the GAA
label itself records. The dev server no longer sends the cross-origin
isolation headers production never had, which is what was blocking the
portraits and the masthead logo locally.

**Deferred.**

- The map — FMR coordinates, the GPS inventory. `has_map` is carried in the
  dataset metadata so the hub can grow a map without a schema change.
- Public API and MCP tools over the HGAB tree. The data is already shaped for
  it; a thin Worker layer over `overview.json` and the parquet is about a day
  when wanted.
- D1. The section is static JSON plus parquet, like the NEP line items;
  nothing needs cross-dataset SQL yet.
- The licence and transfer actions and the GitHub Pages redirect under
  "Repository actions".
