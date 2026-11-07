# Hugging Face datasets

We publish our datasets under the [bettergovph](https://huggingface.co/bettergovph) organization on Hugging Face, as Parquet with a dataset card and a `manifest.json`. `scripts/hf/publish.py` stages, checks and uploads one dataset at a time.

| Repo | Contents | Built from |
| --- | --- | --- |
| [bettergovph/gaa-2000-2026](https://huggingface.co/datasets/bettergovph/gaa-2000-2026) | The GAA FY2000–2026 baseline (5,432,425 rows), coverage, the trend-chart series, the source-document list, quality reports | `data/gaa-history` ([docs/gaa-history.md](gaa-history.md)), `data/gaa-explorer/series.json` |
| [bettergovph/house-budget-hearings-2027](https://huggingface.co/datasets/bettergovph/house-budget-hearings-2027) | The FY2027 House Committee on Appropriations hearings: machine transcripts, sections, topic records, figures, actions, speakers, briefs. Only files the site serves are included, checked by SHA-256 | `data/hearings` (published by the transcriptions pipeline, [docs/budget-hearings.md](budget-hearings.md)) |

The older `bettergovph/gaa` (the FY2020–2026 extract) and `bettergovph/nep-2027` (the raw NEP CSV) repos are left as they are. New repos are named for the years they cover.

## Run

```bash
uv venv /tmp/hf-venv
uv pip install --python /tmp/hf-venv/bin/python -r scripts/hf/requirements.txt

# stage + dry run: /tmp/hf-<dataset>/, with README.md (the card) and manifest.json
/tmp/hf-venv/bin/python scripts/hf/publish.py gaa-2000-2026

# publish, tag, and check the remote files against the manifest
/tmp/hf-venv/bin/python scripts/hf/publish.py gaa-2000-2026 --upload --tag 2026-11-07
```

- `data/` is ignored by Git. When you run from a scratch worktree, set `DATA_DIR` to the checkout that has the data, for example `DATA_DIR=~/projects/ai-reports/data`.
- Staging refuses to run if the source doesn't match its own validation record: SHA-256, row counts, totals.
- The upload reads only `HUGGINGFACE_ACCESS_TOKEN` from `~/.bettergov/.env`, which needs write access to bettergovph. Every repo is public.
- `manifest.json` records the commit that built the data. Commit before you stage, so the manifest names a real commit.
- Card templates live in `scripts/hf/cards/`. The tables of counts, totals and columns are filled in from the data when the dataset is staged.
- Each dataset carries the same notices as the site: independent and unofficial, appropriations are not spending, and AI-written text is labelled as such.
- License: CC0 1.0. Data we take from others keeps its credit on the card.
