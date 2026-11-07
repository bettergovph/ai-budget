"""Stage, check and publish our datasets on Hugging Face (bettergovph/*).

    uv venv /tmp/hf-venv && uv pip install --python /tmp/hf-venv/bin/python -r scripts/hf/requirements.txt
    /tmp/hf-venv/bin/python scripts/hf/publish.py gaa-2000-2026             # stage + dry run
    /tmp/hf-venv/bin/python scripts/hf/publish.py gaa-2000-2026 --upload    # publish, tag, check

Staging goes to /tmp/hf-<dataset>/ (or --out); DATA_DIR overrides the data/ directory. Nothing is uploaded without --upload. Uploading reads only
HUGGINGFACE_ACCESS_TOKEN from ~/.bettergov/.env. See docs/hf-datasets.md.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import duckdb
import pyarrow.parquet as pq

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
# data/ is ignored by Git; point DATA_DIR at the checkout that has it when running from a scratch worktree.
DATA = Path(os.environ.get("DATA_DIR", ROOT / "data")).resolve()
ORG = "bettergovph"
PIPELINE_REPO = "https://github.com/bettergovph/ai-budget"


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def peso(n):
    return "—" if n is None else f"₱{n:,}"


def copy(src, out, rel):
    dst = out / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return rel


def commit_of(path):
    try:
        return subprocess.run(["git", "-C", str(path), "rev-parse", "HEAD"], capture_output=True,
                              text=True, check=True).stdout.strip()
    except Exception:
        return None


def fail(msg):
    sys.exit(f"CHECK FAILED: {msg}")


# ---------------------------------------------------------------------------------------------- gaa-2000-2026

def stage_gaa_history(out, args):
    src = Path(args.src or DATA / "gaa-history").resolve()
    master = src / "gaa-2000-2026.parquet"
    validation = json.loads((src / "quality" / "release-validation.json").read_text())
    coverage = json.loads((src / "coverage.json").read_text())

    # The release is only staged when it is the release that was validated.
    digest = sha256(master)
    if digest != validation["master_sha256"]:
        fail(f"gaa-2000-2026.parquet sha256 {digest} != release-validation {validation['master_sha256']}")
    con = duckdb.connect()
    rows, pesos = con.execute(f"SELECT count(*), sum(amount) FROM read_parquet('{master}')").fetchone()
    if rows != validation["rows"] or pesos != validation["amount_pesos"]:
        fail(f"{rows} rows / {pesos} pesos != validation {validation['rows']} / {validation['amount_pesos']}")
    by_year = dict(con.execute(f"SELECT fy, count(*) FROM read_parquet('{master}') GROUP BY fy").fetchall())
    yearly_rows = 0
    for c in coverage:
        y = c["year"]
        n = pq.read_metadata(src / "parquet" / f"gaa-{y}.parquet").num_rows
        if n != c["rows"] or n != by_year.get(y, 0):
            fail(f"{y}: yearly file {n} rows, coverage {c['rows']}, consolidated {by_year.get(y, 0)}")
        yearly_rows += n
    if yearly_rows != rows:
        fail(f"yearly files {yearly_rows} rows != consolidated {rows}")
    series_path = DATA / "gaa-explorer" / "series.json"
    series = json.loads(series_path.read_text())
    if series["source"].get("manifest_sha256") != digest:
        fail("gaa-explorer/series.json was not built from this release")

    files = [copy(master, out, "gaa-2000-2026.parquet")]
    for c in coverage:
        files.append(copy(src / "parquet" / f"gaa-{c['year']}.parquet", out, f"by-year/gaa-{c['year']}.parquet"))
    for name in ["coverage.parquet", "coverage.json", "unavailable-sources.csv"]:
        files.append(copy(src / name, out, name))
    files.append(copy(src / "manifest.json", out, "source-documents.json"))
    files.append(copy(series_path, out, "series.json"))
    for q in sorted((src / "quality").glob("*.json")):
        if q.name != "on-disk-validation.json":  # checks this host's files by absolute path
            files.append(copy(q, out, f"quality/{q.name}"))

    source_docs = json.loads((src / "manifest.json").read_text())["files"]
    downloaded = [d for d in source_docs if d["status"] == "downloaded"]
    facts = {
        "rows": rows,
        "amount_pesos": pesos,
        "master_sha256": digest,
        "years": [c["year"] for c in coverage],
        "source_documents": len(downloaded),
        "source_bytes": sum(d.get("bytes") or 0 for d in downloaded),
        "unavailable_links": len(source_docs) - len(downloaded),
        "unavailable_urls": len({d["url"] for d in source_docs if d["status"] != "downloaded"}),
    }
    return {
        "title": "Philippine General Appropriations Act (GAA), FY2000–FY2026",
        "files": files,
        "facts": facts,
        "card": card_gaa_history(facts, coverage, con, master),
        "pipeline": {"scripts": "scripts/gaa-history/", "docs": "docs/gaa-history.md",
                     "commit": commit_of(ROOT)},
    }


GAA_COLUMNS = [
    ("fy", "Fiscal year."),
    ("department_id", "Department code. 2020–2026 use the UACS department code (`SPF` and `AUTO` for the "
                      "special purpose funds and automatic appropriations sections); earlier years keep the "
                      "code or abbreviation the source prints. Codes are not crosswalked across decades."),
    ("department_dsc", "Department name, as published."),
    ("agency_code", "Agency code, where published."),
    ("agency_dsc", "Agency name, as published."),
    ("fpap_code", "Program, activity or project (P/A/P) code, where published."),
    ("fpap_dsc", "Program, activity or project, as published."),
    ("program_code", "The program the P/A/P rolls up to (2020–2026)."),
    ("program_dsc", "That program's name (2020–2026)."),
    ("major_class", "General Administration and Support, Support to Operations, Operations, or Special "
                    "Purpose / Automatic, from the first digit of the P/A/P code (2020–2026)."),
    ("prexc_level", "Level in the program expenditure classification, where published."),
    ("operunit_code", "Operating unit code."),
    ("operunit_dsc", "Operating unit name."),
    ("div_code", "Operating division code."),
    ("div_dsc", "Operating division name."),
    ("region_code", "Region code."),
    ("region_dsc", "Region name."),
    ("fund_code", "Fund code."),
    ("fund_dsc", "Fund name or sub-category."),
    ("expense_code", "Expense class code (1 Personnel Services, 2 MOOE, 3 Financial Expenses, 4 Capital "
                     "Outlays, where modern codes apply)."),
    ("expense_dsc", "Expense class name."),
    ("object_code", "UACS object code. Null on summary rows (program, agency, fund, department totals)."),
    ("object_dsc", "Object of expenditure name."),
    ("amount_thousands", "The amount in thousands of pesos, for convenience."),
    ("amount", "The amount in exact pesos (signed integer). Use this column."),
    ("record_id", "Unique id of the fact."),
    ("grain", "What one row is: `program_operunit_fund_expense_object`, `program_area_expense`, "
              "`agency_object`, `program_total`, `agency_total`, `purpose_total`, `department_total` or "
              "`fund_total`."),
    ("budget_scope", "Which appropriation the amount belongs to. Compare only like scopes; see below."),
    ("source_year", "The GAA the fact was read from."),
    ("budget_status", "`enacted` for every row."),
    ("source_url", "The DBM file the fact was read from (FY2000–2019)."),
    ("source_member", "The file inside that archive, or the extract file (2020–2026)."),
    ("source_sha256", "SHA-256 of the downloaded source file."),
    ("source_document_id", "Id of the source document in `source-documents.json`."),
    ("source_page", "Page in the source, where known."),
    ("source_line", "Line on that page, where known."),
    ("source_text", "The source line as read, where kept."),
    ("source_section_id", "Section of the source the fact came from."),
    ("source_object_code", "The source's own object code where it is not a modern UACS code."),
    ("quality_status", "How far the fact has been checked; see below."),
]


def card_gaa_history(f, coverage, con, master):
    cov_rows = "\n".join(
        f"| {c['year']} | {c['rows']:,} | {peso(c['amount_pesos'])} | `{c['status']}` |" for c in coverage)
    scopes = con.execute(f"SELECT budget_scope, count(*), sum(amount) FROM read_parquet('{master}') "
                         "GROUP BY 1 ORDER BY 2 DESC").fetchall()
    scope_rows = "\n".join(f"| `{s}` | {n:,} | {peso(a)} |" for s, n, a in scopes)
    quality = con.execute(f"SELECT quality_status, count(*), min(fy), max(fy) FROM read_parquet('{master}') "
                          "GROUP BY 1 ORDER BY 2 DESC").fetchall()
    quality_rows = "\n".join(f"| `{q}` | {n:,} | {lo}–{hi} |" if lo != hi else f"| `{q}` | {n:,} | {lo} |"
                             for q, n, lo, hi in quality)
    col_rows = "\n".join(f"| `{c}` | {d} |" for c, d in GAA_COLUMNS)
    tmpl = (HERE / "cards" / "gaa-2000-2026.md").read_text()
    return tmpl.format(
        rows=f"{f['rows']:,}", coverage_rows=cov_rows, scope_rows=scope_rows, quality_rows=quality_rows,
        column_rows=col_rows, master_sha256=f["master_sha256"], source_documents=f"{f['source_documents']:,}",
        source_gb=f"{f['source_bytes'] / 1e9:.1f}", unavailable_links=f["unavailable_links"],
        unavailable_urls=f["unavailable_urls"], pipeline_repo=PIPELINE_REPO, year=dt.date.today().year)


DATASETS = {
    "gaa-2000-2026": stage_gaa_history,
}


# ---------------------------------------------------------------------------------------------------- common

def write_manifest(out, name, staged):
    entries = []
    for rel in staged["files"]:
        p = out / rel
        e = {"file": rel, "bytes": p.stat().st_size, "sha256": sha256(p)}
        if rel.endswith(".parquet"):
            e["rows"] = pq.read_metadata(p).num_rows
        entries.append(e)
    manifest = {
        "schema": 1,
        "dataset": f"{ORG}/{name}",
        "title": staged["title"],
        "built_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "pipeline": {"repo": PIPELINE_REPO, **staged["pipeline"]},
        "facts": staged["facts"],
        "files": entries,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n")
    (out / "README.md").write_text(staged["card"])
    return manifest


def token():
    env = Path.home() / ".bettergov" / ".env"
    for line in env.read_text().splitlines():
        if line.startswith("HUGGINGFACE_ACCESS_TOKEN="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("HUGGINGFACE_ACCESS_TOKEN not found in ~/.bettergov/.env")


def upload(out, repo_id, manifest, tag):
    from huggingface_hub import HfApi
    api = HfApi(token=token())
    api.create_repo(repo_id, repo_type="dataset", private=False, exist_ok=True)
    info = api.upload_folder(folder_path=str(out), repo_id=repo_id, repo_type="dataset",
                             commit_message=f"Publish {manifest['title']} ({manifest['built_at']})")
    print(f"committed {info.oid} {info.commit_url}")
    if tag:
        api.create_tag(repo_id, tag=tag, repo_type="dataset", revision=info.oid, exist_ok=False)
        print(f"tagged {tag}")
    # The published files must be the staged files, byte for byte.
    remote = {f.path: f for f in api.list_repo_tree(repo_id, repo_type="dataset", recursive=True,
                                                     revision=info.oid) if hasattr(f, "size")}
    bad = []
    for e in manifest["files"]:
        r = remote.get(e["file"])
        rsha = r and (r.lfs.sha256 if r.lfs else None)
        if r is None or r.size != e["bytes"] or (rsha and rsha != e["sha256"]):
            bad.append(e["file"])
    if bad:
        fail(f"remote files differ from staging: {bad[:10]}")
    print(f"remote check: {len(manifest['files'])} files match the manifest")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dataset", choices=sorted(DATASETS))
    ap.add_argument("--out", help="staging directory (default /tmp/hf-<dataset>)")
    ap.add_argument("--src", help="override the source directory")
    ap.add_argument("--upload", action="store_true", help="publish the staged folder")
    ap.add_argument("--tag", help="tag the upload, e.g. 2026-11-07")
    args = ap.parse_args()

    out = Path(args.out or f"/tmp/hf-{args.dataset}")
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    staged = DATASETS[args.dataset](out, args)
    manifest = write_manifest(out, args.dataset, staged)

    total = 0
    print(f"\n{ORG}/{args.dataset} — staged in {out}\n")
    for e in manifest["files"] + [{"file": "README.md", "bytes": (out / "README.md").stat().st_size},
                                  {"file": "manifest.json", "bytes": (out / "manifest.json").stat().st_size}]:
        total += e["bytes"]
        rows = f"{e['rows']:>10,}" if "rows" in e else " " * 10
        print(f"  {e['bytes'] / 1e6:9.2f} MB {rows}  {e['file']}  {e.get('sha256', '')[:12]}")
    print(f"\n  {len(manifest['files']) + 2} files, {total / 1e6:.1f} MB")
    if not args.upload:
        print("\nDry run. Read README.md, then rerun with --upload to publish.")
        return
    upload(out, f"{ORG}/{args.dataset}", manifest, args.tag)


if __name__ == "__main__":
    main()
