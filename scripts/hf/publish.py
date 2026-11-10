"""Stage, check and publish our datasets on Hugging Face (bettergovph/*).

    uv venv /tmp/hf-venv && uv pip install --python /tmp/hf-venv/bin/python -r scripts/hf/requirements.txt
    /tmp/hf-venv/bin/python scripts/hf/publish.py gaa-2000-2026             # stage + dry run
    /tmp/hf-venv/bin/python scripts/hf/publish.py gaa-2000-2026 --upload    # publish, tag, check

Staging goes to /tmp/hf-<dataset>/ (or --out); DATA_DIR overrides the data/ directory. Nothing is
uploaded without --upload. Uploading reads only HUGGINGFACE_ACCESS_TOKEN from ~/.bettergov/.env.
See docs/hf-datasets.md.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import duckdb
import pyarrow as pa
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


def column_type(values):
    """Arrow type for one column of plain JSON values; None when it has to be stored as JSON text."""
    seen = {type(v) for v in values if v is not None}
    if not seen:
        return pa.string()
    if seen == {str}:
        return pa.string()
    if seen == {bool}:
        return pa.bool_()
    if seen == {int}:
        if any(abs(v) >= 2 ** 63 for v in values if v is not None):
            return None
        return pa.int64()
    if seen <= {int, float}:
        return pa.float64()
    if seen == {list}:
        items = {type(x) for v in values if v for x in v}
        if items <= {str}:
            return pa.list_(pa.string())
        if items == {int}:
            return pa.list_(pa.int64())
    return None


def write_table(rows, out, rel):
    """Rows of JSON values as Parquet. Columns of objects or mixed lists become JSON text."""
    names = list(dict.fromkeys(k for r in rows for k in r))
    arrays = []
    for name in names:
        values = [r.get(name) for r in rows]
        t = column_type(values)
        if t is None:
            t = pa.string()
            values = [None if v is None else json.dumps(v, ensure_ascii=False) for v in values]
        arrays.append(pa.array(values, type=t))
    path = out / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_arrays(arrays, names=names), path, compression="zstd")
    return rel


def remote_sha256(url):
    """SHA-256 of a public file, or None when the host doesn't serve it."""
    # The data host's bot rules refuse urllib's default user agent.
    req = urllib.request.Request(url, headers={"User-Agent": "bettergov-hf-publish/1"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            h = hashlib.sha256()
            for chunk in iter(lambda: r.read(1 << 20), b""):
                h.update(chunk)
            return h.hexdigest()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


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


# ------------------------------------------------------------------------------------ house-budget-hearings-2027

HEARINGS_HOST = "https://budget-assets.bettergov.ph/hearings"
HEARING_FILES = ["meta.json", "transcript.json", "sections.json", "brief.json"]


def stage_hearings(out, args):
    src = Path(args.src or DATA / "hearings").resolve()
    vids = sorted(d.name for d in src.iterdir() if d.is_dir())

    # Publish what the site serves: every file must equal its public copy on the data host.
    local = [(v, f) for v in vids for f in HEARING_FILES if (src / v / f).exists()]
    with ThreadPoolExecutor(8) as pool:
        remote = list(pool.map(lambda vf: remote_sha256(f"{HEARINGS_HOST}/{vf[0]}/{vf[1]}"), local))
    stale = [f"{v}/{f}" for (v, f), r in zip(local, remote) if r is not None and sha256(src / v / f) != r]
    if stale:
        fail(f"{len(stale)} hearing files differ from the site's copies: {stale[:8]}")
    # A file the site never published (a record held back, say) stays out of the dataset too.
    published = {vf for vf, r in zip(local, remote) if r is not None}
    held_back = sorted(f"{v}/{f}" for v, f in set(local) - published)
    for f in held_back:
        print(f"  not on the site, left out: {f}")

    hearings, segments, speakers, sections, topics = [], [], [], [], []
    exchanges, figures, actions, briefs = [], [], [], []
    files = []
    for v in vids:
        d = src / v
        load = lambda name: json.loads((d / name).read_text()) if (v, name) in published else None
        meta, tr, rec, brief = (load(f) for f in HEARING_FILES)
        for f in HEARING_FILES:
            if (v, f) in published:
                files.append(copy(d / f, out, f"raw/{v}/{f}"))
        segs = tr["segments"]
        for i, g in enumerate(segs):
            segments.append({"video_id": v, "seq": i, "start_ms": int(g["startMs"]), "end_ms": int(g["endMs"]),
                             "start": g.get("startTimeText"), "chunk": g.get("chunk"),
                             "speaker_label": g.get("speaker"), "speaker_name": g.get("speaker_name"),
                             "text": g.get("text")})
        if rec:
            for sp in rec.get("speakers") or []:
                speakers.append({"video_id": v, **sp})
            for sec in rec["sections"]:
                n = sec["index"]
                sections.append({"video_id": v, "section": n,
                                 **{k: sec.get(k) for k in ["start_seconds", "end_seconds", "start", "end", "kind",
                                                            "title", "summary", "participants", "topics"]}})
                exchanges += [{"video_id": v, "section": n, **e} for e in sec.get("exchanges") or []]
                figures += [{"video_id": v, "section": n, **e} for e in sec.get("figures") or []]
                actions += [{"video_id": v, "section": n, **e} for e in sec.get("actions") or []]
            for i, t in enumerate(rec.get("topics") or []):
                topics.append({"video_id": v, "topic_no": i, **t})
        if brief:
            briefs.append({"video_id": v, **{k: val for k, val in brief.items() if k not in ("videoId", "slug")}})
        ext = (rec or {}).get("extraction") or {}
        hearings.append({
            "video_id": v,
            "url": meta.get("url"),
            "title": meta.get("title"),
            "agenda": meta.get("description"),
            "channel": meta.get("channelTitle"),
            "published_at": (meta.get("publishedTime") or "")[:10] or None,
            "duration_seconds": int(meta.get("lengthSeconds") or 0) or None,
            "fiscal_year": 2027,
            "agency": ((brief or {}).get("agency") or (rec or {}).get("agency")
                       or next(iter(re.findall(r"\(([^()]+)\)\s*$", meta.get("title") or "")), None)),
            "phase": (brief or {}).get("phase"),
            "overview": (rec or {}).get("overview"),
            "transcript_engine": (tr.get("engine") or {}).get("text"),
            "speaker_engine": (tr.get("engine") or {}).get("speakers"),
            "transcript_generated_at": tr.get("generated_at"),
            "segments": len(segs),
            "segments_named": sum(1 for g in segs if g.get("speaker_name")),
            "record_model": (rec or {}).get("model"),
            "record_method": ext.get("method"),
            "record_generated_at": (rec or {}).get("generated_at"),
            "sections": len((rec or {}).get("sections") or []),
            "topics": len((rec or {}).get("topics") or []),
            "has_brief": brief is not None,
        })

    # `amount` is the model's reading of `amount_text`, which is as transcribed. A garbled transcript gives
    # readings past int64 ("5,000,000,005 billion"); those are blanked here and kept in raw/ and topics.
    over = [f for f in figures if isinstance(f.get("amount"), int) and f["amount"] >= 2 ** 63]
    for f in over:
        f["amount"] = None
    parsed = [f["amount"] for f in figures if isinstance(f.get("amount"), int)]

    tables = {"hearings": hearings, "segments": segments, "speakers": speakers, "sections": sections,
              "topics": topics, "exchanges": exchanges, "figures": figures, "actions": actions, "briefs": briefs}
    counts = {name: len(rows) for name, rows in tables.items()}
    table_files = [write_table(rows, out, f"{name}.parquet") for name, rows in tables.items()]
    for name, rel in zip(tables, table_files):
        if pq.read_metadata(out / rel).num_rows != counts[name]:
            fail(f"{rel} row count")
    dates = sorted(h["published_at"] for h in hearings if h["published_at"])
    facts = {
        "hearings": len(hearings),
        "hours": round(sum(h["duration_seconds"] or 0 for h in hearings) / 3600, 1),
        "first": dates[0], "last": dates[-1],
        "rows": counts,
        "briefs_date_differs": sum(1 for b in briefs
                                   if b.get("hearing_date") != next(h["published_at"] for h in hearings
                                                                    if h["video_id"] == b["video_id"])),
        "record_models": sorted({h["record_model"] for h in hearings if h["record_model"]}),
        "transcript_engines": sorted({h["transcript_engine"] for h in hearings if h["transcript_engine"]}),
        "held_back": held_back,
        "figures_with_amount": len(parsed) + len(over),
        "figures_amount_blanked": len(over),
        "figures_amount_over_100t": sum(1 for a in parsed if a > 10 ** 14),
    }
    return {
        "title": "House Committee on Appropriations: FY2027 budget hearings, transcripts and records",
        "files": table_files + files,
        "facts": facts,
        "card": card_hearings(facts, hearings),
        "pipeline": {"scripts": "the transcriptions pipeline (scrape.py, transcribe.py, record.py, sync_to_site.py; "
                                "not public yet); this script reads the files it published to the site",
                     "transcriptions_commit": commit_of(Path.home() / "projects" / "transcriptions"),
                     "docs": "docs/budget-hearings.md", "commit": commit_of(ROOT)},
    }


def card_hearings(f, hearings):
    rows = "\n".join(
        f"| {h['published_at'] or '—'} | [{h['video_id']}]({h['url']}) | {h['agency'] or '—'} | "
        f"{(h['duration_seconds'] or 0) / 3600:.1f} h | {h['segments']:,} | {h['sections']} | {h['topics']} | "
        f"{'yes' if h['has_brief'] else '—'} |"
        for h in sorted(hearings, key=lambda h: (h["published_at"] or "", h["video_id"])))
    r = {k: f"{n:,}" for k, n in f["rows"].items()}
    tmpl = (HERE / "cards" / "house-budget-hearings-2027.md").read_text()
    return tmpl.format(hearing_rows=rows, hearings=f["hearings"], hours=f["hours"], first=f["first"],
                       last=f["last"], briefs_date_differs=f["briefs_date_differs"],
                       record_models=", ".join(f["record_models"]), year=dt.date.today().year,
                       figures_with_amount=f"{f['figures_with_amount']:,}",
                       figures_amount_blanked=f["figures_amount_blanked"],
                       figures_implausible=f["figures_amount_over_100t"] + f["figures_amount_blanked"],
                       held_back=len(f["held_back"]),
                       pipeline_repo=PIPELINE_REPO, **{f"n_{k}": v for k, v in r.items()})


# ---------------------------------------------------------------------------------------------- philgeps-v2

PHILGEPS_REPO = "https://github.com/csiiiv/philgeps_data_v2"
PHILGEPS_DRIVE = "https://drive.google.com/drive/folders/1Km2gqIfaY_9ZotjvePFZVSMEuxud6WWA"
PHILGEPS_ROWS = 18_515_260
# Names of private individuals: the government staff who posted each notice, and each supplier's
# contact person. Left out of the public release (Jason, 2026-11-10).
PHILGEPS_WITHHELD = ["created_by", "awardee_contact_person"]


def stage_philgeps(out, args):
    src = Path(args.src or "/data/downloads/philgeps-v2").resolve()
    files = {"normalized": src / "normalized" / "philgeps_normalized.parquet",
             "cleaned": src / "cleaned" / "philgeps_cleaned.parquet"}
    catalog_path = Path(args.catalog or "/tmp/philgeps-v2-docs/source_catalog.json")
    catalog = json.loads(catalog_path.read_text())
    source_sha = {k: sha256(v) for k, v in files.items()}
    for k, v in files.items():
        if pq.read_metadata(v).num_rows != PHILGEPS_ROWS:
            fail(f"{v.name}: expected {PHILGEPS_ROWS:,} rows")

    con = duckdb.connect()
    # This host shares its memory with other services; cap DuckDB and let it spill to the staging disk.
    con.execute(f"SET temp_directory = '{out}/.duckdb-tmp'")
    con.execute("SET memory_limit = '4GB'")
    con.execute("SET threads = 4")
    # Rewrite each layer without the withheld columns, then prove every other value and the row order are
    # unchanged: an order-sensitive fingerprint (row position + every kept column) must match the source's.
    rewritten = {"normalized": "philgeps-2000-2025.parquet", "cleaned": "philgeps-2000-2025-typed.parquet"}
    for key, name in rewritten.items():
        dst = out / name
        excl = ", ".join(PHILGEPS_WITHHELD)
        con.execute(f"COPY (SELECT * EXCLUDE ({excl}) FROM read_parquet('{files[key]}')) TO '{dst}' "
                    "(FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000)")
        a = con.execute(f"SELECT count(*), bit_xor(hash(t)) FROM (SELECT * EXCLUDE ({excl}) FROM "
                        f"read_parquet('{files[key]}', file_row_number = true)) t").fetchone()
        b = con.execute(f"SELECT count(*), bit_xor(hash(t)) FROM (SELECT * FROM "
                        f"read_parquet('{dst}', file_row_number = true)) t").fetchone()
        if a != b:
            fail(f"{name}: rows/fingerprint {b} != source {a}")
        kept = [(f.name, str(f.type)) for f in pq.read_schema(files[key]) if f.name not in PHILGEPS_WITHHELD]
        if kept != [(f.name, str(f.type)) for f in pq.read_schema(dst)]:
            fail(f"{name}: column names or types changed")
        print(f"  {name}: {a[0]:,} rows, every kept value and the row order match {files[key].name}")
    shutil.rmtree(out / ".duckdb-tmp", ignore_errors=True)

    norm = out / rewritten["normalized"]
    typed = out / rewritten["cleaned"]
    withheld_counts = {c: con.execute(f"SELECT count({c}), count(DISTINCT {c}) FROM read_parquet('{files['cleaned']}')")
                       .fetchone() for c in PHILGEPS_WITHHELD}
    per_file = dict(con.execute(f"SELECT _source_file_id, count(*) FROM read_parquet('{norm}') GROUP BY 1").fetchall())

    # The source-file table: one row per export, keyed by the `_source_file_id` on every row.
    sources = []
    for f in catalog["source_files"]:
        sheet = (f.get("sheets") or [{}])[0]
        sources.append({
            "source_file_id": f["source_file_id"],
            "file_name": f.get("title"),
            "period": f.get("normalized_file_name", "").rsplit(".", 1)[0] or None,
            "format": f.get("format"),
            "size_bytes": f.get("size_bytes"),
            "sha256": f.get("sha256"),
            "schema_id": sheet.get("schema_id"),
            "header_present": sheet.get("header_present"),
            "rows": per_file.get(f["source_file_id"], 0),
            "urls": [u["url"] for u in f.get("urls") or []],
        })
    if sum(r["rows"] for r in sources) != PHILGEPS_ROWS or len(per_file) != len(sources):
        fail("source catalog does not account for every row")
    out_files = [rewritten["normalized"], rewritten["cleaned"], write_table(sources, out, "sources.parquet"),
                 copy(catalog_path, out, "source-catalog.json")]

    layouts = con.execute(f"SELECT _source_schema_id, count(DISTINCT _source_file_id), count(*) FROM "
                          f"read_parquet('{norm}') GROUP BY 1 ORDER BY 3 DESC").fetchall()
    flags = con.execute(f"SELECT issue, count(*) FROM (SELECT unnest(_cleaning_issues) AS issue FROM "
                        f"read_parquet('{typed}')) GROUP BY 1 ORDER BY 2 DESC").fetchall()
    flagged = con.execute(f"SELECT count(*) FROM read_parquet('{typed}') WHERE _cleaning_issue_count > 0").fetchone()[0]
    span = con.execute(f"SELECT min(bid_published_date)::DATE, max(bid_published_date)::DATE, "
                       f"min(award_date)::DATE, max(award_date)::DATE FROM read_parquet('{typed}')").fetchone()
    # Counted in the typed layer: the normalized layer keeps blanks and "NULL" literals as published strings.
    nonnull = dict(con.execute("SELECT * FROM (UNPIVOT (SELECT count(COLUMNS(*)) FROM read_parquet('" + str(typed) +
                               "')) ON COLUMNS(*) INTO NAME col VALUE n)").fetchall())
    typed_types = {f.name: str(f.type) for f in pq.read_schema(typed)}
    norm_types = {f.name: str(f.type) for f in pq.read_schema(norm)}
    facts = {
        "rows": PHILGEPS_ROWS,
        "source_files": len(sources),
        "periods": [sources and min(r["period"] for r in sources), max(r["period"] for r in sources)],
        "bid_published": [str(span[0]), str(span[1])],
        "award_date": [str(span[2]), str(span[3])],
        "drive_sha256": {files[k].name: v for k, v in source_sha.items()},
        "withheld": {c: {"rows": n, "distinct": d} for c, (n, d) in withheld_counts.items()},
        "rows_flagged": flagged,
    }
    card = card_philgeps(facts, layouts, flags, nonnull, norm_types, typed_types, rewritten)
    return {
        "title": "PhilGEPS procurement notices and awards, 2000–2025 (v2)",
        "files": out_files,
        "facts": facts,
        "card": card,
        "pipeline": {"source": PHILGEPS_REPO, "source_commit": args.source_commit, "drive": PHILGEPS_DRIVE,
                     "this_step": "scripts/hf/publish.py philgeps-v2 (drops the withheld columns, renames)",
                     "commit": commit_of(ROOT)},
    }


PHILGEPS_EXTRA = {
    "_source_file_id": "The export the row came from; joins `sources.source_file_id` (SHA-256 of the file).",
    "_source_sheet": "Worksheet in that export (null for CSV).",
    "_source_row_number": "Row in that export, as a spreadsheet shows it.",
    "_source_schema_id": "Which of the four export layouts the row was read with.",
    "_extra_values": "Unexpected trailing values on the row (none in this release).",
    "procuring_entity_name_key": "Upper-case comparison key for grouping names; entities are not merged.",
    "client_agency_key": "Upper-case comparison key for `client_agency`.",
    "awardee_organization_name_key": "Upper-case comparison key for `awardee_organization_name`.",
    "_replacement_character_columns": "Columns on the row that contain U+FFFD (encoding damage, kept as is).",
    "_cleaning_issues": "Findings for review on this row, not corrections: see the flags table.",
    "_cleaning_issue_count": "Number of findings on the row.",
}


def card_philgeps(f, layouts, flags, nonnull, norm_types, typed_types, names):
    aliases = json.loads(Path("/tmp/philgeps-v2-docs/schema_registry.json").read_text())["column_aliases"]
    headers = {}
    for h, c in aliases.items():
        headers.setdefault(c, []).append(h)
    rows = []
    for col in typed_types:
        desc = PHILGEPS_EXTRA.get(col) or ("PhilGEPS: " + ", ".join(f"“{h}”" for h in sorted(headers.get(col, [])))
                                            if headers.get(col) else "")
        n = nonnull.get(col)
        rows.append(f"| `{col}` | {'✓' if col in norm_types else '—'} | `{typed_types[col]}` | "
                    f"{'' if n is None else f'{n:,}'} | {desc} |")
    layout_rows = "\n".join(f"| `{s}` | {nf} | {n:,} |" for s, nf, n in layouts)
    flag_rows = "\n".join(f"| `{k}` | {n:,} |" for k, n in flags)
    w = f["withheld"]
    tmpl = (HERE / "cards" / "philgeps-v2.md").read_text()
    return tmpl.format(
        rows=f"{f['rows']:,}", source_files=f["source_files"], first_period=f["periods"][0],
        last_period=f["periods"][1], bid_first=f["bid_published"][0], bid_last=f["bid_published"][1],
        award_first=f["award_date"][0], award_last=f["award_date"][1], layout_rows=layout_rows,
        flag_rows=flag_rows, rows_flagged=f"{f['rows_flagged']:,}", column_rows="\n".join(rows),
        created_by_rows=f"{w['created_by']['rows']:,}", created_by_people=f"{w['created_by']['distinct']:,}",
        contact_rows=f"{w['awardee_contact_person']['rows']:,}",
        contact_people=f"{w['awardee_contact_person']['distinct']:,}",
        normalized=names["normalized"], typed=names["cleaned"], philgeps_repo=PHILGEPS_REPO,
        drive=PHILGEPS_DRIVE, year=dt.date.today().year, n_norm_cols=len(norm_types),
        n_typed_cols=len(typed_types))


DATASETS = {
    "gaa-2000-2026": stage_gaa_history,
    "house-budget-hearings-2027": stage_hearings,
    "philgeps-v2": stage_philgeps,
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
    ap.add_argument("--catalog", help="philgeps-v2: csiiiv's DATA_NORMALIZATION/artifacts/source_catalog.json")
    ap.add_argument("--source-commit", help="philgeps-v2: the csiiiv/philgeps_data_v2 commit the catalog is from")
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
