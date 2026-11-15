# Multi-purpose buildings or classrooms?

`/hgab/2027/multi-purpose/documents`, "What the documents say" in the Multi-purpose buildings menu. Jason (2026-11-15):
"From the extracted Senate document data from the pdfs, I need a new tally for the MPBs and their projects. Create a new
page under multi-purpose buildings for their breakdown. I want a poster too 'multi-purpose buildings or classrooms?'"

## The projects and the reading

- **Projects:** the multi-purpose building lines the House inserted into the House bill, those with no matching NEP line
  (Jason: "We read the documents of 2,066* multi-purpose projects inserted by the house … include the total house
  insertions"). The map's lines (`mpb-years/lines.json`, FY2027, class `house_only`): 3,308 of its 5,807 House bill
  multi-purpose building lines, ₱48.2 billion. Lines read that are in the NEP too (31) are left out of the tally.
- **All House insertions:** every DPWH line the House inserted, of any kind (Jason: "Our other data says 6000+ insertions
  though"): `dpwh/projects.parquet` traces `house_only_candidate`, `fuzzy_candidate` and `ambiguous`, the 6,193 (₱172.1
  billion) `overview.json` counts as House-only. The 3,308 are among them.
- **Documents:** the Senate's copies of each project's DPWH documents, joined by `documents/files.parquet`
  (`source = senate`): 4,169 of the 6,193 insertions have them (21,824 files), 2,212 of the 3,308 multi-purpose buildings
  (11,569 files).
- **Reading:** `scripts/senate-extract/extract_projects.py` (branch `senate-redact`), one record per project from the
  REDACTED copies only: the BP 202 project profile (first pages), the program of work (first page), plans, certifications,
  endorsements, and geotagged photos described by a vision model. A text model (glm-5.1, schema v3) fills a fixed schema
  and quotes the documents. It is told to describe what will be BUILT even when the title calls it something else. No
  personal names are read. Output `/data/senate-extract/all/records.jsonl`. On 2026-11-15, 2,035 of the 2,212
  multi-purpose building insertions with documents had been read (92.0%); the rest wait on long files still being redacted.

## The build (`npm run build:mpb-documents`)

`scripts/build-mpb-documents.ts` (`--records`, `--out`) joins the records to the map's lines by project id and writes
`data/hgab/2027/mpb-documents/`:

- `summary.json`: coverage (all DPWH insertions with and without documents; the House bill's MPB lines; the MPB
  insertions with and without documents; read; read but in the NEP too), each category's projects, amount and those at a school,
  classroom yes/no/unclear, at a school, documents that differ from the title by kind, confidence, the build's checks and
  the outputs' checksums;
- `projects.json`: one row per project read (`MPB_DOCS_COLS`, src/lib/mpb-documents.ts);
- `projects.csv`: the same with the quotes and links to each project's record and documents.

Amounts are the map's line amounts. One record (house-reading:15005) reads ₱75M where the line is ₱150M: the comparison
merged two printed rows of ₱75M; the check allows exactly that.

Checks (the build stops on any): the DPWH insertions match `overview.json` and hold every MPB insertion; with and without
documents add up to the insertions; every record read has Senate copies; the categories, classroom and at-school splits add up
to the projects read; amounts equal the line or a merged row of it; no reading failed. verify:hgab
(`scripts/verify-hgab-mpb-documents.ts`) recomputes the summary from projects.json, checks every project is an MPB line the
House inserted at the map's amount, the DPWH insertions against `overview.json`, the checksums, and the CSV's rows.

## Which projects (Jason: "Be clear of the 2066. Are they MPBs? Also include the total number of insertions, documents")

The page's "Which" table and its starred note ("* Documents available …"), as one chain:

| | Projects | Amount | Senate files |
| --- | --- | --- | --- |
| DPWH projects inserted by the House, all kinds | 6,193 | ₱172.1B | 21,824 |
| … with documents in the Senate's copies | 4,169 | ₱116.3B | 21,824 |
| … with no documents | 2,024 | ₱55.9B | — |
| … multi-purpose buildings | 3,308 | ₱48.2B | 11,569 |
| … … with documents in the Senate's copies | 2,212 | ₱32.4B | 11,569 |
| … … with no documents | 1,096 | ₱15.8B | — |
| … … whose documents we have read so far | 2,035 | ₱29.2B | 10,820 |
| For reference: all MPB projects in the House bill, inserted or in the NEP | 5,807 | ₱86.3B | 11,748 |

All 2,035 are multi-purpose buildings in the House bill (the map's rule): 1,992 on its multi-purpose building line with
that title, 38 on the line under another title, 5 titled so under another line. Documents read: 8,550 (2,025 programs of
work, 1,957 BP 202 project profiles, 1,898 certificates of implementability, 1,787 sets of geotagged photos, 879
development council endorsements, 4 plans). 31 more MPB lines whose documents were read are in the NEP too, so not
insertions; they are left out (`read_not_inserted`). `summary.json` carries these as `coverage` (`dpwh`, `house`,
`insertions`, `with_documents`, `without_documents`, `read`, `read_not_inserted`), `listed` and `documents_read`.

## First tally (2026-11-15)

Of the 2,035 House insertions read (₱29.2 billion): 1,307 multi-purpose halls (₱18.8B), 474 covered courts or gyms
(₱4.3B), 100 barangay halls or government offices, 25 evacuation centers, 24 other buildings, 23 health facilities, 22
senior citizens or day care centers, **21 classrooms or school buildings (₱424.5M)**, 14 other school facilities, 13
markets, 11 roads, 1 water supply. 314 are at a school, mostly halls or courts on school grounds. 252 (₱5.0B) have
documents describing a different facility from their title: hospitals, a public market, a municipal building, a ₱200M farm-to-market road.

## The page and the poster

- The page: a strip of four figures, the breakdown (click a kind to list its projects), the 21 classrooms and the
  projects whose documents describe something else (with the documents' quotes), every project read (filters, search,
  links to the record and to the documents in the reviewer, `/hgab/2027/review?p=<id>`), "About this data", the CSV,
  the disclaimer.
- The poster (Jason: "use our paper themed poster instead of the dark ones"): `npm run build:hgab-poster-mpb-classrooms`
  (`CHROMIUM_PATH` for a local headless shell) → `campaign/mpb-or-classrooms-1080x1350.png` (post), `-1080x1920.png`
  (story), `-1200x630.png` (link preview). The paper style of "We are not ignorant" and "Multi-purpose buildings": a wall of
  the projects read, largest first, each tagged with what its documents say it is (CLASSROOM in red); on paper, the
  question; "We read the documents of 2,035* multi-purpose building projects inserted by the House. 21 are classrooms.";
  every kind of building in the "Hosting ASEAN" poster's bar chart panel (Jason: "Use the bar chart style we have similar
  to Hosting ASEAN"; tab, name and amount, projects on the right, bars to scale, classrooms in red, a total line; beside
  the headline in the link preview); the starred note on the documents available (all 6,193 DPWH insertions, 4,169 with
  documents; the 3,308 MPB insertions, 2,212 with documents, 1,096 with none; 2,035 read); a red call to action. The dark
  footer defines the 2,035. Every figure from `mpb-documents/`; the build fails when a name is cut, the panel shrinks
  below its floor, or the headline runs into the footer.
- The Taglish street poster (Jason: "Can we try a different style? More taglish and more impact? Revolutionary, grunge
  style"): `npm run build:hgab-poster-mpb-classrooms-taglish` → `campaign/mpb-or-classrooms-taglish-{1080x1350,1080x1920,
  1200x630}.png`, beside the paper one (not replacing it). Newsprint in red, black and cream; headline type worn by an SVG
  filter; "O CLASSROOM?" on a torn red strip with "ANO BA TALAGA?" beside it (Jason's title: "Multi-purpose building o
  classroom? Ano ba talaga?"); "21 LANG ANG CLASSROOM" with a giant out-of-register 21 over halftone, "sa
  sample na 2,035* … ayon sa sarili nilang mga dokumento"; the breakdown as a typed sheet taped on, "Ano laman ng mga
  dokumento", each label in bold black over a red highlighter band to scale (label and bar as one; the band sits low
  so the words stay readable), the classrooms circled, "21 lang?!"; the
  2,035 called the sample throughout (and, in the fine print, not a random one: those read of the 2,212 with documents);
  the call to action "Ikaw, ano sa tingin mo?"; the starred note and fine print in Taglish. Same figures, same files.

## Refresh

Re-run `extract_projects.py all` after more Senate copies are redacted, then `npm run build:mpb-documents`, the poster,
and upload `mpb-documents/` (and the posters) before the page's deploy.
