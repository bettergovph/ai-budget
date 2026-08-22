# Budget-cycle import and normalization

This importer converts `Compiled_-_NEP-GAA-SAAODB-ByPAPLabelled.xlsx` into a lossless source layer, normalized budget-cycle facts, and a relationship table to the portal's existing GAA hierarchy.

It keeps the imported figures separate from the current portal GAA amounts. The workbook describes **Current New Appropriations** and uses full Philippine pesos, while the portal's existing GAA series has a broader scope. Imported GAA values therefore must not overwrite the existing GAA fields.

## Run the import

```bash
npm run import:cycle -- \
  --input=/absolute/path/to/Compiled_-_NEP-GAA-SAAODB-ByPAPLabelled.xlsx \
  --force
npm run verify:cycle
```

The default output directory is `data/budget-cycle/`. It is ignored by Git because it contains generated data.

## Captured data

Every used source column is recorded in `source-columns.ndjson`, including columns that are not recognized as budget metrics. Every included row is recorded in `source-rows.ndjson`; its `raw_json` retains every cell, including blank headers, formulas with cached results, and worksheet-specific helper columns.

Recognized metric columns are also unpivoted into `values.ndjson` using:

- `subject_id` and source row identity
- fiscal year
- cycle stage: `nep`, `gaa`, `authorized_appropriation`, `adjusted_appropriation`, `adjusted_allotment`, `obligations`, or `disbursements`
- expense class: `ps`, `mooe`, `finex`, `co`, or `total`
- `amount_pesos`
- `is_reported`

An explicit source zero remains a reported zero. A blank source cell becomes `amount_pesos = NULL` and `is_reported = false`; it is not converted to zero.

The generated SQLite database contains these tables:

- `budget_cycle_source_columns`
- `budget_cycle_source_rows`
- `budget_cycle_values`
- `budget_cycle_crosswalk`
- `budget_cycle_subjects`
- `budget_cycle_quality_flags`
- `budget_cycle_manifest`

Equivalent NDJSON files and a JSON manifest are written beside the database for inspection and rebuilds.

## Application serving layer

The portal does not send the lossless archive to the browser. After importing and verifying the workbook, build and load a cycle-only D1 migration:

```bash
npm run dump:cycle-sql
npm run load:cycle-local
```

For a production release, apply `data/budget-cycle/d1-import.sql` to the remote `budget` D1 database before deploying the Worker. The migration replaces only tables prefixed `budget_cycle_`; it does not alter the existing GAA tables.

`dump:cycle-sql` writes `data/budget-cycle/d1-import.sql`. The serving tables retain all 771 production crosswalk rows and all 78,577 reported production facts. Explicit zeros are included. Unreported `NULL` facts and audit-only worksheet rows remain in the lossless archive but are omitted from D1 because absence has the same not-reported meaning in the API.

The department endpoint is `GET /api/dept/:id/budget-cycle`. Canonically related rows are returned under the current portal department. A row without a canonical match falls back to its source department, ensuring that unmatched historical rows remain discoverable.

The department portal exposes this endpoint at `/d/:id/budget-cycle`, with:

- the seven-stage flow for a selected year and expense class
- GAA-to-NEP, obligation, and disbursement ratios
- a multi-year stage matrix that distinguishes not reported from zero
- agency filtering and P/A/P-level relationship details
- code, organization-history, label, and review relationship badges

## How source rows relate to the portal

Relationships are deterministic and are attempted in this order:

1. **Exact structural code.** Build the portal agency ID as `DEPARTMENT-AGENCY`, and the portal P/A/P code as the 12-digit `PREXC_SUBPROG` plus `000`.
2. **Organization history.** Apply a documented old-to-canonical agency relationship, then match the same P/A/P code.
3. **Exact normalized agency name plus P/A/P code.** Punctuation, spacing, and case are removed only for comparison.
4. **Exact normalized agency name plus exact normalized P/A/P label.** This handles a small number of code changes while requiring the names to agree.
5. **Review queue.** Ambiguous and unmatched rows are retained with candidates and notes. Amount similarity is never used as a relationship key because the datasets have different scopes.

Both historical and canonical IDs are retained in `budget_cycle_crosswalk`. This lets the UI show a row under its current portal organization without losing the agency and department codes printed in the source year.

### Known organization relationships

| Source relationship | Canonical portal agency | Treatment |
| --- | --- | --- |
| PCW `26-029` | PCW `14-010` | Organization-history mapping |
| TESDA `26-041` | TESDA `16-009` | Organization-history mapping |
| TESDA `22-009` | TESDA `16-009` | Resolved through the agency's normalized name and retained in subject history |
| Judiciary / Supreme Court `29-001` | `29-001` | Direct structural mapping; the absence of execution columns is recorded as not reported |

Department-name discrepancies, such as historical or workbook labels that do not match the current portal department description, are flagged without changing the source text.

### Current import result

The import retains all 771 production P/A/P rows:

- 746 exact structural-code matches
- 21 organization-history matches
- 3 exact normalized agency-and-label matches
- 1 unmatched historical row

The unmatched row is DepEd `310200100008`, **Site Development Plan**, reported only for 2018–2019. The portal data begins in 2020 and has no corresponding `...008` P/A/P, so this row remains discoverable in the normalized dataset without an invented portal relationship.

## Quality and verification

`npm run verify:cycle` checks table presence, manifest counts, crosswalk coverage, fact referential integrity, duplicate source facts, duplicate positive canonical TOTAL facts, and negative production amounts. Published anomalies remain in the data and are listed in `budget_cycle_quality_flags`; values are not clamped or silently corrected.

The two negative cells currently found are in the non-production `DA Discrepancy` audit sheet. They are preserved as warnings and do not affect production facts.
