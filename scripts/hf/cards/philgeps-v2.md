---
license: cc0-1.0
language:
- en
pretty_name: PhilGEPS procurement notices and awards, 2000–2025 (v2)
tags:
- government
- philippines
- procurement
- public-procurement
- philgeps
- contracts
- open-contracting
size_categories:
- 10M<n<100M
configs:
- config_name: default
  data_files: {normalized}
- config_name: typed
  data_files: {typed}
- config_name: sources
  data_files: sources.parquet
---

# PhilGEPS procurement notices and awards, 2000–2025 (v2)

This dataset holds every row of the 70 notice and award exports published by the Philippine Government Electronic Procurement System (PhilGEPS), covering {first_period} to {last_period}. That is {rows} rows in one schema, one per line item of a bid notice, with its award where one was published. Every row says which export and which row it came from.

> **Independent and unofficial.** This is csiiiv's normalization of the published PhilGEPS exports, published by BetterGov.ph. It is not an official record.
> - Rows are kept as published. Republished quarters overlap, duplicates are kept on purpose, and nothing is corrected.
> - The exports name no currency for their amounts. PHP is assumed but not confirmed.
> - A notice, an award, an amount or a flag does not by itself establish irregularity or wrongdoing by any agency, supplier or official.

## Which file to use

| File | Config | Contents |
| --- | --- | --- |
| `{normalized}` | `default` | **Start here.** The normalized layer: {n_norm_cols} columns, every value a string exactly as published, with the source of each row |
| `{typed}` | `typed` | The same rows and order, typed for analysis: dates are timestamps and amounts are `DECIMAL(38,4)`. Adds three name-comparison keys and per-row cleaning flags ({n_typed_cols} columns) |
| `sources.parquet` | `sources` | The 70 exports: file name, period, format, size, SHA-256, layout, row count, and Drive link |
| `source-catalog.json` | — | csiiiv's full source catalog, including each export's column headers |
| `manifest.json` | — | Every file, with its bytes, SHA-256, row count, and the SHA-256 of csiiiv's original Parquet files |

The default layer keeps blanks and literals such as `NULL` and `N/A` exactly as published. The typed layer turns them into real nulls, so count values there.

Every row carries `_source_file_id`, `_source_sheet` and `_source_row_number`. Join `_source_file_id` to `sources.source_file_id` to find the export and the row a value came from.

## Left out: names of private individuals

The exports, and csiiiv's files, include two columns that name private individuals. We leave both out:
- `created_by` is the government staff member who posted the notice: {created_by_rows} rows, {created_by_people} distinct names.
- `awardee_contact_person` is the supplier's contact person: {contact_rows} rows, {contact_people} distinct names.

Both appear only in the 43-column exports. Every other column, every row and the row order are unchanged. The release check compares an order-sensitive fingerprint of every kept value against csiiiv's files.

Not here either: the raw exports, and the OCDS-shaped tables csiiiv built from the typed layer.

## Before you add anything up

- **One row is a notice line item, not an award.**
  - {rows} rows carry 10,861,545 distinct bid references.
  - 6,970,129 rows carry an award reference, for 4,903,849 distinct awards.
  - An award with several line items repeats its `contract_amount` on every one of them. Of the 456,917 awards spread over more than one row, 456,655 repeat the same amount. Summing `contract_amount` across rows overcounts, so count each award once.
- **Some quarters were exported more than once.** About 2.5 million rows repeat another row's bid reference, line item, award reference, awardee, amount and item name. They are kept, because choosing which copy to keep is a judgment the data can't make for you.
- **The layouts differ, so coverage differs:**
  - Procuring entity location columns exist only in the 46-column CSV exports.
  - `client_agency` exists only in the 43-column exports.
  - A column a layout doesn't have is null for its rows. The column table below shows how many rows have a value.
- **Dates:**
  - Timestamps carry no time zone. Asia/Manila is likely, but the exports don't say.
  - Bid notices run from {bid_first} to {bid_last}.
  - Award dates run from {award_first} to {award_last}, so some are clearly wrong as published. The typed layer flags them; it doesn't fix them.
- **`item_budget` uses `-1` for "not provided".** The typed layer turns it into null and flags the row.
- **Names are kept as printed.** The `*_key` columns group names only by case and spacing. No agency or supplier has been merged with another, and no official identifiers are assigned.
- **74,541 rows name a joint venture that isn't split into its partners.**
- **10 cells contain encoding damage** (U+FFFD, for example `LOS BAÃ‘OS`). They are kept as is and listed in `_replacement_character_columns`.

## Export layouts

| `_source_schema_id` | Exports | Rows |
| --- | ---: | ---: |
{layout_rows}

The 2000–2010 workbooks have their header on row 4. Four 2021–2022 CSVs have no header row and are read by verified column position.

## Cleaning flags (typed layer)

The flags are findings for review, not corrections. {rows_flagged} rows have at least one.

| Flag in `_cleaning_issues` | Rows |
| --- | ---: |
{flag_rows}

## Columns

The "PhilGEPS" notes list the export headers each column was read from.

| Column | In `default` | Type in `typed` | Rows with a value (typed) | Notes |
| --- | :---: | --- | ---: | --- |
{column_rows}

## Use it

```python
from datasets import load_dataset

philgeps = load_dataset("bettergovph/philgeps-v2", split="train", streaming=True)
```

```sql
-- DuckDB: awards by year, counting each award once
WITH awards AS (
  SELECT DISTINCT award_reference_no, year(award_date) AS year, contract_amount
  FROM 'hf://datasets/bettergovph/philgeps-v2/{typed}'
  WHERE award_reference_no IS NOT NULL
)
SELECT year, count(*) AS awards, sum(contract_amount) AS amount
FROM awards GROUP BY year ORDER BY year;
```

## Sources and method

- **Source:** the PhilGEPS exports, quarterly and annual XLSX and CSV files, collected in the [PHILGEPS-V2 Drive folder]({drive}).
- **Pipeline:** [csiiiv/philgeps_data_v2]({philgeps_repo}), at the commit in `manifest.json`.
  - Stage 0 downloads the exports and registers each one by its SHA-256.
  - Stage 1 maps every layout onto one schema by column name. Nothing is dropped, deduplicated or coerced, so the result is the normalized layer.
  - The typed layer then applies `config/cleaning_rules.json`: null literals, date and decimal typing, Unicode NFC and trimming, and the comparison keys.
- **This release:**
  - leaves out the two name columns;
  - renames the files;
  - rewrites them with Zstandard compression in 100,000-row groups;
  - checks the row count, column types and an order-sensitive fingerprint of every kept value against csiiiv's files.

## How this relates to bettergovph/philgeps-data

[bettergovph/philgeps-data](https://huggingface.co/datasets/bettergovph/philgeps-data) is the earlier release: 5,481,161 awards in 12 columns. This one has the full line-item exports, with every published column except the two above, and the source of every row.

## License

[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). PhilGEPS notices are works of the Government of the Philippines, and no copyright subsists in them (Republic Act 8293, section 176). Credit is welcome: "PhilGEPS exports normalized by csiiiv (philgeps_data_v2), published by BetterGov.ph".

## Report a problem

Open a discussion on this dataset's Community tab. Include the `_source_file_id` and `_source_row_number`.

## Citation

```bibtex
@misc{{bettergov_philgeps_v2,
  title        = {{PhilGEPS procurement notices and awards, 2000--2025 (v2)}},
  author       = {{{{BetterGov.ph}} and csiiiv}},
  year         = {{{year}}},
  howpublished = {{\url{{https://huggingface.co/datasets/bettergovph/philgeps-v2}}}}
}}
```
