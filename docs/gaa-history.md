# GAA historical backfill and consolidated analysis baseline

The backfill covers **2000–2019**. The existing 2020–2026 extracts are retained,
so the consolidated span is **2000–2026, 27 fiscal years**. This is an offline
analysis dataset; it does not change application or production data.

## Deliverables

All generated data lives in `data/gaa-history`, a symlink to
`/data/backups/projects/ai-reports/data/gaa-history`:

| File | Contents |
| --- | --- |
| `gaa-2000-2026.parquet` | Consolidated, nonoverlapping analysis baseline |
| `parquet/gaa-YYYY.parquet` | One consistently typed file per fiscal year |
| `coverage.json`, `coverage.parquet` | Coverage, grain, scope and limitations by year |
| `manifest.json` | Every discovered source link, download status, bytes and SHA-256 |
| `unavailable-sources.csv` | Broken links and their errors |
| `quality/source-audit.json` | Download integrity and availability audit |
| `quality/release-validation.json` | Consolidated counts, schema, uniqueness and checksum |
| `quality/edition-comparison-2019.json` | Department-level comparison of the differing FY2019 editions |
| `sources/`, `unpacked/`, `text/` | Original downloads, archive members and extracted text |

The official source is the [DBM GAA archive](https://www.dbm.gov.ph/index.php/budget-documents-archives#gaa).
Discovery follows the GAA panel and linked article bodies, including technical
editions, annexes, staffing schedules and accompanying BESF tables. Alternate
editions and schedules are downloaded but are not automatically monetary facts.

## What the baseline contains

| Years | Selected monetary source and grain |
| --- | --- |
| 2000, 2002, 2003, 2005 | Printed agency/fund controls; exact reconciled program or purpose partitions replace the corresponding control where possible |
| 2001, 2004, 2006 | Empty fact files with explicit reenactment coverage records |
| 2007–2008 | Published agency summaries and explicitly listed automatic annex items |
| 2009–2013 | Published legacy CSVs, with program, area and expense-class detail |
| 2014 | Scanned published agency summary, reconciled to all 46 department/fund controls, plus the automatic-appropriation aggregate |
| 2015 | Consolidated technical CSV recovered from the official ZIP, plus the separate conditional Unprogrammed Fund total |
| 2016 | Technical spreadsheet object detail for new appropriations, supplemented by missing ALGU, JLEC and BSGC-Others controls; full automatic aggregate |
| 2017 | Technical spreadsheet detail, with DA, DepEd and DND replaced by published agency-summary partitions because their spreadsheet totals differ; full automatic aggregate |
| 2018 | Consolidated technical spreadsheet, plus the separate conditional Unprogrammed Fund total |
| 2019 | Agency/object tables from the technical PDFs, four special-fund summary controls, unprogrammed appropriations and the automatic aggregate |
| 2020–2026 | Existing extracts normalized into the shared schema, preserving monetary counts and totals exactly |

**This is a baseline with varying detail, not a claim that every year has modern
program × operating-unit × fund × object microdata.** The early years remain
marked `partial_historical_coverage`. Some automatic schedules are absent and
full national coverage is not established. Available detailed candidates and
rejected tables are retained separately for further refinement.

For 2019, all 37 technical department totals were compared with the Volume I
summary. Only DPWH differs: PHP454,016,273,000 in the technical edition versus
PHP549,390,514,000 in the summary. The baseline selects the technical edition and
records the difference. It does not insert a balancing amount or assert that
the entire difference is a particular legal adjustment.

The 2014 summary and replacement 2017 partitions carry their OCR/review status.
The pipeline retains source images, model responses, explicit corrections and
arithmetic checks. An arithmetic match is not proof of a complete manual review.
No truncated or malformed model response becomes a fact.

## Schema and interpretation

The 40-column schema follows the newer import structure in
`scripts/import-nep-2027.ts`: fiscal year, department/agency, P/A/P, program,
operating unit, division, region, fund, expense class, object, and monetary values.
`amount` is an exact signed **integer PHP** value; `amount_thousands` is the
convenience representation. Unpublished dimensions remain null.

Every fact has `record_id`, `grain`, `budget_scope`, `source_year`,
`budget_status`, `quality_status` and source location fields. Historical sources
also retain URL, archive member, document SHA-256 and page/line where available.
Existing extracts retain their local source filename and record ID. Historical
organizational codes are not silently crosswalked to current UACS. Older object
codes remain in `source_object_code` where they are not modern UACS codes.

Budget scopes matter:

- `unprogrammed_appropriations` is conditional and must be kept separate from
  programmed appropriations.
- Early published new-appropriation categories sometimes include IRA or debt
  interest. These names are source categories, not a harmonized legal-authority
  classification across decades.
- FY2003 first-preference and second-preference appropriations retain separate
  source scopes. They are not interchangeable duplicate editions.
- `existing_gaa_extract_scope` preserves the scope of the existing 2020–2026
  files without reinterpreting it.
- Appropriations are not expenditures, obligations, allotments or releases.
  Debt principal-amortization annexes and separate corporation operating budgets
  are excluded from the appropriation baseline.

No file in `candidate-parquet/`, `program-parquet/`, `summary-parquet/`,
`totals-parquet/`, `csv-parquet/` or `spreadsheet-parquet/` should be unioned with
the release: these are overlapping intermediate representations. Use only
`gaa-2000-2026.parquet` or the files in `parquet/` for the selected baseline.

## Reenacted years

DBM confirms that **2001, 2004 and 2006 had no new GAA release**, using the 2000,
2003 and 2005 GAAs respectively. See the
[DBM FOI response](https://www.foi.gov.ph/requests/gaa-for-1987-2006/).

Their empty fact files mean **no separately observed new GAA**, not zero budget
or spending. `coverage.parquet` includes these years with a null monetary total.
No prior-year amount is copied into a later year as an invented observation.

## Querying

Run from the repository directory with DuckDB or use absolute paths:

```sql
-- Inspect coverage before comparing years.
SELECT * FROM read_parquet('data/gaa-history/coverage.parquet') ORDER BY year;

-- Compare only explicitly selected scopes/grains appropriate to the question.
SELECT fy, budget_scope, grain, count(*) AS records, sum(amount) AS pesos
FROM read_parquet('data/gaa-history/gaa-2000-2026.parquet')
GROUP BY ALL ORDER BY fy, budget_scope, grain;

-- Inspect an agency and its evidence; summary totals have null object codes.
SELECT fy, department_dsc, agency_dsc, fpap_dsc, object_dsc,
       amount, grain, budget_scope, quality_status, source_url, source_page
FROM read_parquet('data/gaa-history/gaa-2000-2026.parquet')
WHERE fy = 2017 AND department_dsc ILIKE '%national defense%';
```

## Pipeline and validation

```bash
uv venv /tmp/gaa-archive-env
uv pip install --python /tmp/gaa-archive-env/bin/python -r scripts/gaa-history/requirements.txt
/tmp/gaa-archive-env/bin/python scripts/gaa-history/download.py
/tmp/gaa-archive-env/bin/python scripts/gaa-history/extract.py --year 2000
/tmp/gaa-archive-env/bin/python scripts/gaa-history/parse_programs.py --year 2000
/tmp/gaa-archive-env/bin/python scripts/gaa-history/parse_totals.py --year 2000
/tmp/gaa-archive-env/bin/python scripts/gaa-history/build_release.py
/tmp/gaa-archive-env/bin/python scripts/gaa-history/audit_sources.py
/tmp/gaa-archive-env/bin/python scripts/gaa-history/validate_release.py
/tmp/gaa-archive-env/bin/python -m unittest discover -s scripts/gaa-history -p test_parsers.py
```

The release builder consumes the retained intermediate files, reviewed summaries
and `quality/edition-comparison-2019.json`. The examples above illustrate stages;
they are not a one-command reconstruction of every historical format. Other
parsers are `parse_legacy_csv.py`, `parse_csv_2015.py`,
`parse_spreadsheets.py`, `parse_objects.py`, `parse_summary.py` and
`normalize_existing.py`; each exposes CLI arguments through `--help`.
`ocr.py` uses local Tesseract. The optional `vision_summary.py` reads only the
NYOLAB endpoint/key from the BetterGov environment and sends public source pages.
Credentials and environment contents are never stored in artifacts.

The mirror uses resumable atomic downloads, signature and SHA-256 checks.
`download_large.py` adds verified byte ranges and ZIP CRC checks; do not run a
second writer for the same year while it is active. Archive extraction rejects
path traversal and symlinks. Source failures remain explicit in the manifest.

Release checks enforce a common schema, unique record IDs, non-null monetary
facts/grains/scopes, nonoverlapping source selection, exact existing-year
preservation and consolidated/yearly count and sum equality. Published controls
are checked where available; coverage limits are not disguised as passing
national reconciliation. Regression tests exercise subtotal exclusion, units,
negative amounts, agency attribution, purpose tables and summary hierarchy.
