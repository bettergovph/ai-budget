# House bill line by line (HB 10858 against the NEP)

Status: built 2026-10-31 and run locally. The explorer at `/hgab/2027/explorer` is not yet deployed,
and its data is not yet uploaded to R2.

| | |
| --- | --- |
| Code | `scripts/hgab-lines/` (Python, PyMuPDF and DuckDB in a uv venv at `/tmp/hgab-lines-venv`) |
| Run | `npm run build:hgab-lines` (`scripts/hgab-lines/run.sh`, about 2 minutes) |
| Working outputs | `data/hgab-lines/2027/`, deliberately not under `data/hgab/2027/`, which `upload:hgab` publishes wholesale |
| Explorer data | `data/hgab/2027/explorer/`, published with the next `upload:hgab` |
| UI | `src/pages/HgabExplorer*.tsx`, `src/components/HgabExplorerBits.tsx`, `src/lib/hgab-explorer.ts`, `src/hgab-explorer.css` |

Every money line in the House bill's appropriation tables is set beside the NEP line it matches,
in the shape of the GAA/NEP extract. That covers every agency's tables, the special purpose funds,
GOCC subsidies and LGU allocations. DPWH's project list (Vol I-C), farm-to-market roads, HFEP and NIA
irrigation keep their workbench pages. Their lines appear here too, tagged with a link to those pages.

## Sources

HB 10858 as published for the 3rd reading, Vols I-A and I-B. These are byte-identical to
`hgab/2027/pdf/hb10858-3r-vol-i{a,b}.pdf` and to the workbench's `HB_BUDGET_3rd_reading/`. The 2nd
reading is the workbench's `HB_BUDGET/` copy. The NEP side is `NEP-FY2027.csv`, fund 101\* (new
appropriations).

| Volume | Holds | Parsed |
| --- | --- | --- |
| I-A | Congress to DND (I–XXI) | three money tables per agency |
| I-B | DPWH to CHR (XXII–XXXV); special purpose funds, GOCCs and LGUs (XXXVI–XLIII); the Summary of New Appropriations (p. 637); annexes | tables, plus the DepEd and barangay development annexes. FMR, HFEP and NIA stay with the workbench |
| I-C | DPWH project detail | no (workbench) |
| II | Performance indicators, no pesos | no |

The bill prints no UACS codes. Per agency it publishes three tables:

- by program;
- by activity, broken down by region, operating unit and (for DepEd) school, with foreign-assisted
  projects split into loan proceeds and GOP counterpart;
- by object of expenditure, in thousands.

The special purpose funds and LGU allocations print "by Purpose" tables instead.

## Parser (`parse_hb.py`, `flatten.py`)

The parser reads PyMuPDF word boxes, strips the printed line numbers in both margins, and assigns
amounts to columns by each table's own headers. It types every row as section, class, program,
sub-program, activity, region, office, sub-unit or fund. Indent alone is unreliable: DA drifts about
3pt, and programs print at the same indent as their activities. Wrapped names are rejoined, including:

- hanging indents of up to 12pt, or 14pt for a "(" continuation;
- names whose amounts sit on the first line;
- three-line school names;
- labels ending in "-".

Source quirks it absorbs:

- "Regional I - Ilocos"
- "National Island Region (NIR)"
- "TOTAL NEW APPOPRIATIONS"
- "117,681,000.0"
- "1295" with no comma
- a subtotal printed without "Total"
- DPWH labels printed twice
- Coast Guard districts named like regions
- fund splits above the region (DSWD) and below the office (DAR)

`flatten.py` writes one row per leaf and expense class, in integer pesos. Each row keeps its
volume, PDF page, the page number shown on the page and the line. The columns map onto the GAA
extract: department, agency, P/A/P path, region, operating unit (division and school for DepEd),
fund source, `uacs_exp_cd` and amount.

## Checks (all pass)

| Check | Result |
| --- | --- |
| Every printed parent = sum of its children; every table's leaves = its TOTAL NEW APPROPRIATIONS | 1,110 tables, both readings |
| Per agency: program table = activity table = object table × 1,000 = line items | 370 / 370 |
| Agency and department lines of the bill's own Summary of New Appropriations | 378 equal (the other 54 are group headings); all 440 Summary lines identical in both readings |
| Grand total | ₱4,606,066,495,000, both readings, equal to the Summary |
| Without Unprogrammed Appropriations (₱111,984,494,000) | ₱4,494,082,001,000 = NEP new appropriations, to the peso |
| DepEd annex: schools sum to divisions, divisions to regions, regions to its Grand Total | 221 divisions, 8,573 schools; all 663 division values equal the main table's "Division Office - Proper" lines |
| Barangay development annex | 1,948 barangays, numbered 1–1,948 with no gaps, as the special provision says |
| Object comparison: bill leaves = TOTAL NEW APPROPRIATIONS; NEP objects = NEP agency totals | 370 / 370; 368 / 368 |
| Explorer: every agency tree sums to its NEP and House bill totals | 370 / 370 |

## Matching (`compare.py`)

**Agencies.** Matched by name: 351 directly. Another 10 match under a different department; for
example, the bill files NAPC and PCUP under OEOs and the NEP files them under DSWD. Special purpose
funds match their NEP section-2 names.

**Activities.** Each bill leaf is matched at the deepest P/A/P level it prints. GOCC subsidies
print only the program, matched through NEP's code hierarchy (program = 4 digits, sub-program = 6).
Methods, in order:

1. exact names;
2. names within 0.88 similarity;
3. a bill name whose words all appear in exactly one NEP name (DPWH drops "...and Other Related
   Activities -");
4. the 2nd reading's label for anything the 3rd reading renamed. DOH's "Medical Assistance Program
   (MAP)" is MAIFIP in the 2nd reading, with the same amounts.

**Locations.** Matching runs in three passes:

1. exact names;
2. office and school names within 0.85 similarity inside the same office or division;
3. DepEd division offices take whatever their division has left.

**DepEd.** The bill's main table names only implementing-unit schools. The annex
(`parse_annex_deped.py`) splits each division-office line into the office and its schools, the
grain the NEP uses.

**Outputs.**

| File | Contents |
| --- | --- |
| `hb_vs_nep_lines.csv` | every bill line (49,084 after the annex split), with NEP amount, status and how it was matched |
| `nep_only_lines.csv` | NEP rows no bill line claims |
| `activity_rollup.csv` | per activity and expense class; separates money that changed from money moved between offices |
| `rename_candidates.csv` | bill-only and NEP-only pairs in the same agency |
| `review_matches.csv` | 309 lines to look at before publishing (fuzzy or unmatched) |

**Results** (non-infra scope, 47,519 lines, ₱3.94T):

| Status | Lines | House bill | NEP |
| --- | ---: | ---: | ---: |
| same, to the peso | 46,877 | ₱2,946.58B | ₱2,946.58B |
| lower | 257 | ₱541.06B | ₱655.54B |
| higher | 86 | ₱315.12B | ₱238.11B |
| House bill only (activity found, location not) | 242 | ₱11.09B | — |
| House bill only (no such activity in the NEP) | 51 | ₱17.05B | — |
| unprogrammed (not in the NEP extract) | 5 | ₱111.98B | — |

NEP coverage overall: ₱4,488.43B of ₱4,494.08B claimed (99.87%). There are 257 NEP-only rows (₱5.66B).

**By activity.** 4,559 activity × expense-class pairs are the same. 58 are higher (+₱75.40B) and 73
lower (−₱111.86B). Another 15 keep the same total but move money between offices (₱303.87B, mostly
DepEd schools; also PDEA's regional pay, now under its Central Office). 15 are House-bill-only
(₱7.37B) and 6 NEP-only (₱0.95B).

**By department** (against full NEP totals):

| Department | Change |
| --- | ---: |
| DOTr | −₱40.45B |
| DSWD | +₱22.17B |
| DOH | +₱12.23B |
| DA | +₱11.15B |
| DOLE | +₱6.19B |
| DepEd | −₱6.17B |
| Congress | +₱5.00B |
| DICT | −₱4.17B |

**Largest single lines** (checked against the PDF text):

| Line | NEP | House bill | Change |
| --- | ---: | ---: | ---: |
| DSWD crisis assistance (Protective Services) | ₱33.23B | ₱58.04B | +₱24.81B |
| DOH MAP/MAIFIP | ₱24.23B | ₱48.19B | +₱23.97B |
| NSCR loan proceeds | ₱97.61B | ₱82.61B | −₱15.00B |
| Metro Manila Subway loan proceeds | ₱26.71B | ₱11.71B | −₱15.00B |
| DA Presidential Assistance for Farmers and Fisherfolk | none | ₱10.00B | +₱10.00B |
| Pension and Gratuity Fund | | | −₱10.00B |
| NDRRMF rehabilitation | | | −₱7.75B |

## Other comparisons

**2nd vs 3rd reading** (`compare_readings.py`, `reading_changes.csv`). Five lines change, a gross
₱768M, all within one agency each:

- DPWH right-of-way −₱134M, against +₱68M and +₱66M for the Metro Manila 3rd DEO;
- DOTr Service Contracting moves ₱250M from operating expenses to capital outlays.

DOH's MAIFIP is renamed MAP with the same amounts.

**Objects** (`compare_objects.py`, `object_compare.csv`, thousands). Bill object lines map to NEP
7-digit objects by name, by UACS sub-object names, and by sum evidence across agencies. 99.90% of
House bill thousands land in comparable units:

| Status | Units | Change |
| --- | ---: | ---: |
| same | 10,667 | — |
| increased | 134 | +₱123.80B |
| decreased | 116 | −₱128.11B |
| bill-only | 17 | ₱4.48B |
| NEP-only | 3 | ₱0.21B |

The biggest moves:

- DOTr infrastructure outlay −₱42.0B
- DPWH buildings +₱42.0B against infrastructure −₱30.5B
- DOH financial assistance +₱22.7B
- DSWD subsidies +₱22.0B

**Barangay development program** (`parse_annex_sbdp.py`, `sbdp_barangays.csv`). The annex lists the
1,948 NTF-ELCAC-cleared barangays that share ₱9,740,000,000. It prints no amount per barangay, so
none is assigned.

## The explorer (`/hgab/2027/explorer`)

`build_explorer.py` writes `index.json` (43 departments) and one file per department under
`d/<id>.json`. DepEd is the largest, at 4.4 MB (0.6 MB compressed).

- **Index ("Line by line" in the sub-nav).** Departments with NEP, House bill, change and the
  number of lines that differ.
- **Department page.** Agencies, then the bill's own hierarchy down to expense classes, built from
  the existing NEP and HGAB components:
  - status chips: Same, Higher, Lower, House bill only, NEP only, Unprogrammed;
  - "Same total, moved within" on rolled-up rows;
  - a search box, and an "Only lines that differ" toggle (on by default; `?all=1` turns it off);
  - a CSV download per agency;
  - every House bill line links to its PDF page.
- Copy follows `docs/hgab-copy.md`, and every page carries the comparison disclaimer.

## Open

- Review `review_matches.csv` (309 lines) before publishing: fuzzy agency, activity, office and
  school names, and 51 House-bill-only activities.
- Deploy: merge the branch, then publish `data/hgab/2027/explorer/` with `npm run upload:hgab`.
  That uploads the whole `hgab/2027` tree.
- Not yet in the D1 API or MCP.
