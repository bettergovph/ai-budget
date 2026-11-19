# Project records from the Senate documents

One structured record per FY2027 House bill DPWH project, read from its Senate-provided documents, and the red flags
built on them. Scripts: `scripts/senate-extract/`. Everything is read from the **redacted** copies
(`docs/senate-redaction.md`), never the originals: OCR would turn handwriting back into text.

## Records (`extract_projects.py`)

- Coverage: 4,083 projects (of 4,342 with Senate files; 15,979 House bill DPWH rows in all).
- Reads the BP 202 (up to 3 pages), POW page 1 (Jason, 2026-11-14: "the POW's first page details are good enough"),
  page 1 of the certificate of implementability and council endorsement, and a vision model's description of the
  geotagged photos. Text layer for typed pages, GLM-OCR for scans, glm-5.1 for the record.
- Fields: full title, office, tier, location (barangay, municipality, province, coordinates, site name), category,
  facility, at a school, classroom, size (storeys, classrooms, floor area, km, physical target), purpose,
  description, beneficiaries, cost (BP 202 total, POW estimate, POW direct), schedule, endorsements, a title mismatch
  and its kind (different facility, location or office, amount, detail), confidence and quotes. No personal names.
- Category and facility follow what the documents say will be built, not the House bill title (schema v3).
- Long BP 202 / POW files (20+ pages) were read from excerpts (`page1_excerpts.py`, an extraction-only folder that is
  never uploaded).
- Output: `/data/senate-extract/all/records.{jsonl,csv}` on the dev VM. Cost about $0.013 a project.

## Red flags for research.bettergov.ph (`build_evr_additions.py`)

Companion data for the research site's
[HGAB allocation vs TOTAL ESTIMATED COST](https://research.bettergov.ph/static/nep-preview/expectation-vs-reality.html)
page, in its own row shape and thresholds (Jason, 2026-11-19). Published at
`https://budget-assets.bettergov.ph/hgab/2027/dpwh/expectation-vs-reality-additions.json` (and `.csv`); the page's
maintainers merge it, its code is not in our repositories.

- `projects`: House bill projects the page doesn't have; `supplements`: for rows it has, our estimate where it has
  none, a review note where our flag differs (the page's figure is kept), and document flags.
- Document flags: different facility, location or office, BP 202 amount, classrooms under another label, and
  documents of another project (a data problem).
- Guards, after folder mix-ups produced false flags in the first build: the documents must be this project's (name or
  description shares half its distinctive words with the bill title, or the municipality matches; barangay names
  repeat across the country, and BP 202s often print a program heading instead of the project name) and the
  estimate must be printed on POW page 1.
- First build (2026-11-19): 65 double red and 95 red flags on new projects, 22 + 38 on the page's not-comparable rows,
  52 disagreements for review, 344 different facility, 283 location or office, 80 BP 202 amount, 22 classroom, 5
  documents of another project.

## Multi-purpose buildings

The question that started this (Jason, 2026-11-14: are multi-purpose buildings really classrooms?): of 718
"multi-purpose" lines read first, most are halls or covered courts; few are classrooms (Mina National High School, 14
classrooms; Middle Quirino Hill, Baguio), and some are something else entirely (a slaughterhouse in New Bataan, a
hospital, a market). `classify_mpb.py` is the earlier trial.
