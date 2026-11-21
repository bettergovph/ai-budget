"""The Senate committee report dataset, downloadable and verifiable: <site>/downloads/ (published by upload:senate).

  senate-2027-projects.csv / .parquet      every project of the four programs (DPWH, FMR, HFEP, NIA): NEP, House
                                           bill and Senate amounts, status, and the pages that print each amount
  senate-2027-annex-a.csv / .parquet       Annex A, the line-by-line amendments, as printed, with House bill pages
  senate-2027-general-summary.csv / .parquet  the General Summary by department and agency, in pesos
  senate-2027-provisions.csv / .parquet    Annex B, the amendments to the special and general provisions
  senate-2027-checks.csv                   every check this build ran: our sums against the report's printed totals
  README.md                                what each file and column holds, and how to check it yourself
  manifest.json                            the source PDFs and every file, with row counts and SHA-256
  SHA256SUMS.txt                           the files' and the source PDFs' SHA-256 (`sha256sum -c SHA256SUMS.txt`)
  senate-2027-dataset.zip                  the CSVs, the checks, the README, the manifest and SHA256SUMS.txt

A failed check is written to the checks file and stops the build (exit 1): nothing is published that doesn't add up.

Usage: build_downloads.py <senate-cr out dir> <site dir (data/senate/2027)>
"""
import csv
import glob
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import zipfile
from datetime import datetime, timezone

import duckdb
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_versions import EXPECT  # noqa: E402
from page_check import Pages, prints  # noqa: E402

SITE_URL = "https://budget.bettergov.ph"
ASSETS = "https://budget-assets.bettergov.ph"
STEM = "senate-2027"
PROGRAMS = {"dpwh": "DPWH projects (Annex A-4)", "fmr": "DA farm-to-market roads (Annex A-1)",
            "hfep": "DOH Health Facilities Enhancement Program (Annex A-2)", "nia": "NIA projects (Annex A-3)"}
STATUS_LABEL = {"cut": "Removed", "reduced": "Reduced", "raised": "Raised", "added": "Documented addition",
                "restored": "Restored from the NEP",
                "renamed": "Renamed", "unchanged": "Unchanged", "nep_only": "NEP only"}
ANNEX_STATUS = {
    "exact": "matched to the House bill line the report cites",
    "exact_nearby": "matched to a House bill line a page or a few lines from the one cited",
    "new": "not in the House bill: the Senate inserts it",
    "new_class": "a new expense class on an existing House bill line",
    "unmatched": "the House bill line it cites was not found",
    "ref_only": "the House amount the report prints differs from the House bill's",
    "no_hb_table": "no House bill table to match it to",
}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def present(v):
    return v is not None and not pd.isna(v) and v != ""


def txt(v):
    return v if isinstance(v, str) else None


def pdf_url(prefix, doc, page):
    if not present(doc):
        return None
    return f"{ASSETS}/{prefix}/pdf/{doc}.pdf" + (f"#page={int(page)}" if present(page) and page else "")


def main(src, site):
    out = f"{site}/downloads"
    os.makedirs(out, exist_ok=True)
    for f in glob.glob(f"{out}/*"):
        os.remove(f)
    built = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        commit = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        commit = None
    site_manifest = json.load(open(f"{site}/manifest.json"))
    checks = []

    def check(what, ours, printed, source, note="", blocking=True):
        ok = ours == printed
        checks.append({"check": what, "ours": ours, "printed": printed, "difference": (ours - printed) if isinstance(ours, int) and isinstance(printed, int) else None,
                       "ok": ok, "source": source, "note": note, "blocking": blocking})
        return ok

    # --- The source PDFs: the copies we publish are the bytes we read. ---------------------------------------------
    sources = []
    for d in site_manifest["documents"]:
        path = f"{site}/pdf/{d['key']}.pdf"
        got = sha256(path)
        check(f"Source PDF {d['key']}.pdf: SHA-256 of the copy published", got, d["sha256"], d["file"],
              "the file the pipeline read (its SHA-256 recorded at build) and the copy at budget-assets are the same bytes")
        sources.append({"key": d["key"], "title": d["title"], "original_file": d["file"], "sha256": d["sha256"],
                        "bytes": os.path.getsize(path), "url": pdf_url("senate/2027", d["key"], None)})

    # --- Projects --------------------------------------------------------------------------------------------------
    con = duckdb.connect()
    frames = []
    for key in PROGRAMS:
        df = con.execute(f"select * exclude (search_text) from '{site}/{key}/projects.parquet'").df()
        df.insert(0, "program_key", key)
        frames.append(df)
        rows = df[df.status != "nep_only"]
        want_house, want_senate = EXPECT[key]
        check(f"{PROGRAMS[key]}: House bill total", int(rows.house_php.fillna(0).sum()), want_house,
              f"{site_manifest['documents'][[d['key'] for d in site_manifest['documents']].index(PROGRAM_DOC[key])]['title']}, printed total")
        check(f"{PROGRAMS[key]}: Senate total", int(rows.senate_php.fillna(0).sum()), want_senate,
              f"{site_manifest['documents'][[d['key'] for d in site_manifest['documents']].index(PROGRAM_DOC[key])]['title']}, printed total")
        bad = rows[(rows.house_php.fillna(0) + rows.change_php) != rows.senate_php]
        check(f"{PROGRAMS[key]}: House bill + change = Senate, every project", len(rows) - len(bad), len(rows), "row arithmetic")
    p = pd.concat(frames, ignore_index=True)

    # Every page link in the project lists opens a page that prints the project (page_check.py). Reported, with the
    # misses listed to check; not blocking, as a miss can be the source's own misprint or OCR.
    pages, misses = Pages(), []
    hgab_pdf = os.path.join(os.path.dirname(os.path.abspath(site)), "..", "hgab", "2027", "pdf")
    hgab_pdf = os.path.normpath(hgab_pdf)
    for key in PROGRAMS:
        rows = p[p.program_key == key]
        for doc_label, dcol, pcol, path_of, names in (
            ("Senate committee report", "senate_doc", "senate_page", lambda d: f"{site}/pdf/{d}.pdf", lambda r: (r.title, txt(r.hb_title))),
            ("House bill", "house_doc", "house_page", lambda d: f"{hgab_pdf}/{d}.pdf", lambda r: (txt(r.hb_title) or r.title,)),
            ("NEP", "nep_doc", "nep_page", lambda d: f"{hgab_pdf}/{d}.pdf", lambda r: (txt(r.hb_title) or r.title,)),
        ):
            n = ok = 0
            for r in rows.itertuples():
                doc, pg = getattr(r, dcol), getattr(r, pcol)
                if not present(doc) or not present(pg):
                    continue
                res = prints(pages, path_of(doc), int(pg), *names(r))
                if res is None:
                    continue
                n += 1
                ok += bool(res)
                if not res:
                    misses.append({"program": key, "document": doc_label, "id": r.id, "title": names(r)[0], "doc": doc, "page": int(pg),
                                   "pdf_url": pdf_url("senate/2027" if dcol == "senate_doc" else "hgab/2027", doc, pg)})
            check(f"{PROGRAMS[key]}: {doc_label} page links print their project", ok, n, f"{doc_label} PDFs, page by page",
                  "misses in senate-2027-page-misses.csv" if ok != n else "", blocking=False)
    projects = pd.DataFrame({
        "program": p.program_key,
        "id": p.id,
        "house_id": p.house_id,
        "status": p.status,
        "status_label": p.status.map(STATUS_LABEL),
        "title": p.title,
        "house_title": p.hb_title,
        "renamed": p.renamed,
        "region": p.region,
        "office": p.office,
        "program_line": p.program,
        "pap": p.pap,
        "nep_php": p.nep_php,
        "house_php": p.house_php,
        "senate_php": p.senate_php.where(p.status != "nep_only"),
        "vs_house_php": p.change_php.where(p.status != "nep_only"),
        "vs_nep_php": (p.senate_php - p.nep_php).where(p.status != "nep_only"),
        "inserted_by_house": p.nep_php.isna() & p.house_php.notna(),
        "replaces_id": p.replaces_id,
        "senate_doc": p.senate_doc,
        "senate_page": p.senate_page,
        "senate_pdf_url": [pdf_url("senate/2027", d, pg) for d, pg in zip(p.senate_doc, p.senate_page)],
        "house_doc": p.house_doc,
        "house_page": p.house_page,
        "house_pdf_url": [pdf_url("hgab/2027", d, pg) for d, pg in zip(p.house_doc, p.house_page)],
        "nep_doc": p.nep_doc,
        "nep_page": p.nep_page,
        "nep_pdf_url": [pdf_url("hgab/2027", d, pg) for d, pg in zip(p.nep_doc, p.nep_page)],
        "page_url": [f"{SITE_URL}/senate/2027/{k}/p/{i}" for k, i in zip(p.program_key, p.id)],
        "matched_by": p.matched_by,
        "check_id": p.check_id,
        "check_note": p.check_note,
    })

    # What to check: every insertion we paired with a removed House project or an NEP project, and every one that
    # looks like a House project (Jason, 2026-11-21: "It needs further checking").
    review = projects[projects.matched_by.isin(["rename_pair", "restored_nep", "possible_duplicate", "same_facility"])].copy()
    other = projects.set_index("id")
    review["paired_title"] = [other.title.get(c) if isinstance(c, str) and c in other.index else h
                              for c, h in zip(review.check_id, review.house_title)]
    review = review[["program", "matched_by", "status", "status_label", "id", "title", "paired_title", "house_title", "region", "pap",
                     "nep_php", "house_php", "senate_php", "check_note", "senate_page", "senate_pdf_url", "page_url"]]

    # --- Annex A, as printed ---------------------------------------------------------------------------------------
    arows = []
    for f in sorted(glob.glob(f"{site}/lines/*.json")):
        x = json.load(open(f))
        for r in x["rows"]:
            doc, pdf, printed, line = (r.get("hb") or [None] * 4)
            arows.append({
                "department_id": x["id"], "department_no": x.get("roman"), "department": x["name"],
                "agency_no": r.get("agency_no"), "agency": r.get("agency"), "kind": r["kind"],
                "is_total_row": r["kind"] == "class" and r["label"].upper() == "TOTAL",
                "label": r["label"], "printed_heading": (r.get("context") or "").replace(" > ", " / ") or None,
                "house_bill_path": r.get("hb_path"), "status": r["status"], "status_meaning": ANNEX_STATUS.get(r["status"]),
                "deleted": bool(r.get("deleted")), "instruction": r.get("instruction"),
                "nep_php": r.get("nep"), "house_php": r.get("house"), "increase_php": r.get("increase"),
                "decrease_php": r.get("decrease"), "net_php": r.get("net"), "senate_php": r.get("senate"),
                "house_doc": doc, "house_pdf_page": pdf, "house_printed_page": printed, "house_line": line,
                "house_pdf_url": pdf_url("hgab/2027", doc, pdf), "senate_page": r["senate_page"],
                "senate_pdf_url": pdf_url("senate/2027", "senate-cr-annex-a", r["senate_page"]),
            })
    annex = pd.DataFrame(arows)
    has = annex[annex.house_php.notna() & annex.senate_php.notna() & annex.net_php.notna()]
    ok_rows = int(((has.house_php + has.net_php) == has.senate_php).sum())
    check("Annex A: House bill + net change = Senate, every row that prints all three", ok_rows, len(has), "Annex A, row arithmetic")
    has = annex[annex.net_php.notna()]
    ok_rows = int(((has.increase_php.fillna(0) + has.decrease_php.fillna(0)) == has.net_php).sum())
    check("Annex A: increase + decrease = net change, every row", ok_rows, len(has), "Annex A, row arithmetic")

    # --- General Summary --------------------------------------------------------------------------------------------
    gs = json.load(open(f"{site}/departments.json"))
    grows = []
    for name, t in gs["totals"].items():
        grows.append({"level": "total", "department_no": None, "department": name, "agency_no": None, "agency": None,
                      "nep_php": None, **{f"{k}_php": t.get(k) for k in ("house", "increase", "decrease", "net", "senate")}})
    bad_agencies = []
    amt = lambda x: {f"{k}_php": x.get(k) for k in ("house", "increase", "decrease", "net", "senate")}
    for d in gs["departments"]:
        ags = d.get("agencies") or []
        if not d.get("roman") and d["name"].upper().startswith("BUDGETS OF DOE-ATTACHED CORPORATIONS"):
            # Printed after the departments: the corporate budgets of three DOE-attached corporations, not
            # appropriations. The reader takes its first corporation's line for the heading; regrouped here.
            total = next((a for a in ags if a["name"].lower() == "total"), None)
            grows.append({"level": "corporate budgets", "department_no": None, "department": "BUDGETS OF DOE-ATTACHED CORPORATIONS",
                          "agency_no": None, "agency": None, "nep_php": None, **amt(total or {})})
            corp = [{"no": "I", "name": d["name"].split(" I. ", 1)[-1], **{k: d.get(k) for k in ("house", "increase", "decrease", "net", "senate")}}]
            corp += [{**a, "name": re.sub(r"^[IVX]+\.\s*", "", a["name"])} for a in ags if a is not total]
            for a in corp:
                grows.append({"level": "agency", "department_no": None, "department": "BUDGETS OF DOE-ATTACHED CORPORATIONS",
                              "agency_no": a["no"], "agency": a["name"], "nep_php": None, **amt(a)})
            if total:
                for k in ("house", "senate"):
                    if sum(a.get(k) or 0 for a in corp) != (total.get(k) or 0):
                        bad_agencies.append(f"{d['name']} ({k})")
            continue
        grows.append({"level": "department", "department_no": d.get("roman"), "department": d["name"], "agency_no": None, "agency": None,
                      "nep_php": d.get("nep"), **amt(d)})
        for a in ags:
            no = a.get("no") or ""
            # "G.1" breaks agency G down; a row without a letter (SUCs' "Region IV - Southern Tagalog and Palawan")
            # heads agencies already listed.
            level = "sub-agency" if "." in no else "agency" if re.fullmatch(r"[A-Z]{1,2}", no) else "group heading"
            grows.append({"level": level, "department_no": d.get("roman"), "department": d["name"], "agency_no": a.get("no"),
                          "agency": a["name"], "nep_php": None, **amt(a)})
        top = [a for a in ags if re.fullmatch(r"[A-Z]{1,2}", a.get("no") or "")]
        if top:
            for k in ("house", "net", "senate"):
                if sum(a.get(k) or 0 for a in top) != (d.get(k) or 0):
                    bad_agencies.append(f"{d['name']} ({k})")
        if (d.get("house") or 0) + (d.get("net") or 0) != (d.get("senate") or 0):
            bad_agencies.append(f"{d['name']} (house + net)")
    summary = pd.DataFrame(grows)
    n_dept = sum(1 for d in gs["departments"] if d.get("agencies"))
    check("General Summary: each department's agencies (level agency) add up to the department (House bill, net change, Senate)",
          n_dept - len({b.split(' (')[0] for b in bad_agencies}), n_dept, "General Summary", "; ".join(bad_agencies))
    t = gs["totals"]
    check("General Summary: departments + special purpose funds = programmed appropriations (Senate)",
          t["DEPARTMENTS"]["senate"] + t["SPECIAL PURPOSE FUNDS"]["senate"], t["PROGRAMMED APPROPRIATIONS"]["senate"], "General Summary, printed totals")
    check("General Summary: programmed + unprogrammed = total new appropriations (Senate)",
          t["PROGRAMMED APPROPRIATIONS"]["senate"] + t["UNPROGRAMMED APPROPRIATIONS"]["senate"], t["TOTAL NEW APPROPRIATIONS"]["senate"], "General Summary, printed totals")

    # Our Senate amount for every House bill line (the line-by-line pages) adds up to the General Summary.
    mism = []
    by_id = {d["id"]: d for d in gs["departments"] if d.get("id")}
    n = 0
    for f in sorted(glob.glob(f"{site}/explorer/*.json")):
        e = json.load(open(f))
        d = by_id.get(e["id"])
        if not d:
            continue
        n += 1
        if e.get("senate") != d.get("senate") or e.get("house") != d.get("house"):
            mism.append(e["id"])
    check("Line by line: each department's lines, with their Senate amounts, add up to its General Summary total (House bill and Senate)",
          n - len(mism), n, "General Summary; Annex A", "; ".join(mism))

    # --- Provisions ---------------------------------------------------------------------------------------------------
    prov = json.load(open(f"{site}/provisions.json"))["amendments"]
    provisions = pd.DataFrame([{
        "part": x["part"], "department": x.get("dept"), "agency": x.get("agency"), "volume": x.get("volume"),
        "house_printed_page": x.get("hb_page"), "house_lines": x.get("line_ref"), "instruction": x.get("instruction"),
        "amended_text": x.get("amended_text") or None, "house_doc": x.get("hb_doc"), "house_pdf_page": x.get("hb_pdf_page"),
        "house_pdf_url": pdf_url("hgab/2027", x.get("hb_doc"), x.get("hb_pdf_page")), "senate_page": x.get("senate_pdf_page"),
        "senate_pdf_url": pdf_url("senate/2027", "senate-cr-annex-b", x.get("senate_pdf_page")),
    } for x in prov])

    # --- Write ----------------------------------------------------------------------------------------------------------
    tables = [
        ("projects", projects, "Every project of the four programs the report details: NEP, House bill and Senate amounts, what the Senate does to it, and the pages that print each amount."),
        ("annex-a", annex, "Annex A, the line-by-line amendments, as printed: one row per amount the report changes, tied to the House bill line it cites."),
        ("general-summary", summary, "The General Summary: House bill, increase, decrease, net change and Senate amount by department and agency, in pesos (the report prints thousands)."),
        ("provisions", provisions, "Annex B: the amendments to the special and general provisions, each with the House bill page and lines it changes."),
        ("pairings", review, "Insertions we read as a renamed House project, a restored NEP project, a possible duplicate, or the same facility's other component: to check."),
    ]
    files = []
    for name, df, about in tables:
        for c in df.columns:
            if c.endswith("_php") or c.endswith("_page") or c in ("house_line",):
                df[c] = pd.to_numeric(df[c], errors="coerce").astype("Int64")
        stem = f"{STEM}-{name}"
        df.to_csv(f"{out}/{stem}.csv", index=False, encoding="utf-8-sig", quoting=csv.QUOTE_MINIMAL)
        df.to_parquet(f"{out}/{stem}.parquet", index=False, compression="zstd")
        files.append({"name": name, "about": about, "rows": len(df), "columns": list(df.columns)})

    failed = [c for c in checks if not c["ok"] and c["blocking"]]
    pd.DataFrame(misses, columns=["program", "document", "id", "title", "doc", "page", "pdf_url"]).to_csv(
        f"{out}/{STEM}-page-misses.csv", index=False, encoding="utf-8-sig")
    pd.DataFrame(checks).to_csv(f"{out}/{STEM}-checks.csv", index=False, encoding="utf-8-sig")
    readme = README.format(built=built, commit=commit or "unknown", n_projects=len(projects), n_annex=len(annex),
                           n_summary=len(summary), n_prov=len(provisions), n_checks=len(checks), n_ok=sum(c["ok"] for c in checks),
                           sources="\n".join(f"- {s['title']}: `{s['original_file']}`, SHA-256 `{s['sha256']}`, {s['url']}" for s in sources),
                           programs="\n".join(f"| {k} | {v} |" for k, v in PROGRAMS.items()),
                           statuses="\n".join(f"| `{k}` | {v} |" for k, v in STATUS_LABEL.items()),
                           annex_statuses="\n".join(f"| `{k}` | {v} |" for k, v in ANNEX_STATUS.items()))
    open(f"{out}/README.md", "w").write(readme)

    # Order matters: the manifest, then SHA256SUMS.txt (which covers the manifest), then the zip (which holds both),
    # then index.json, the site's listing of every file with the zip's checksum.
    listed = sorted(os.listdir(out))
    entries = [{"file": x, "bytes": os.path.getsize(f"{out}/{x}"), "sha256": sha256(f"{out}/{x}"), "url": f"{ASSETS}/senate/2027/downloads/{x}"} for x in listed]
    manifest = {
        "title": "FY2027 Senate committee report on HB 10858: projects, amendments, General Summary and provisions",
        "built_at": built, "source_commit": commit, "build": "npm run build:senate-cr (scripts/senate-cr/run.sh)",
        "repository": "https://github.com/bettergovph/ai-reports", "site": f"{SITE_URL}/senate/2027/data",
        "sources": sources, "tables": files, "files": entries,
        "checks": {"run": len(checks), "passed": sum(c["ok"] for c in checks), "blocking_failed": len(failed), "file": f"{STEM}-checks.csv"},
        "under_citizen_review": True,
    }
    json.dump(manifest, open(f"{out}/manifest.json", "w"), indent=1, ensure_ascii=False)
    sums = [f"{sha256(f'{out}/{x}')}  {x}" for x in sorted(os.listdir(out))]
    sums += [f"{s['sha256']}  ../pdf/{s['key']}.pdf" for s in sources]
    open(f"{out}/SHA256SUMS.txt", "w").write("\n".join(sums) + "\n")
    with zipfile.ZipFile(f"{out}/{STEM}-dataset.zip", "w", zipfile.ZIP_DEFLATED) as z:
        for x in sorted(os.listdir(out)):
            if x.endswith(".csv") or x in ("README.md", "manifest.json", "SHA256SUMS.txt"):
                z.write(f"{out}/{x}", f"{STEM}-dataset/{x}")
    index = {k: manifest[k] for k in ("title", "built_at", "source_commit", "sources", "tables", "checks", "under_citizen_review")}
    index["files"] = [{"file": x, "bytes": os.path.getsize(f"{out}/{x}"), "sha256": sha256(f"{out}/{x}"), "url": f"{ASSETS}/senate/2027/downloads/{x}"}
                      for x in sorted(os.listdir(out)) if x != "index.json"]
    index["check_rows"] = checks
    json.dump(index, open(f"{out}/index.json", "w"), indent=1, ensure_ascii=False)

    print(f"downloads: {len(projects):,} projects, {len(annex):,} Annex A rows, {len(summary)} summary rows, "
          f"{len(provisions)} provisions; checks {sum(c['ok'] for c in checks)}/{len(checks)} passed; page misses {len(misses)}", file=sys.stderr)
    for c in (c for c in checks if not c["ok"]):
        print(f"  {'✗' if c['blocking'] else '·'} {c['check']}: ours {c['ours']} vs printed {c['printed']} {c['note']}", file=sys.stderr)
    if failed:
        sys.exit(1)


PROGRAM_DOC = {"dpwh": "senate-cr-annex-a4", "fmr": "senate-cr-annex-a1", "nia": "senate-cr-annex-a3", "hfep": "senate-cr-annex-a2"}

README = """# FY2027 Senate committee report on HB 10858: the dataset

Built {built} by budget.bettergov.ph from commit `{commit}` of github.com/bettergovph/ai-reports
(`npm run build:senate-cr`). Pages: https://budget.bettergov.ph/senate/2027/overview

Independent and unofficial: our reading of the Senate Committee on Finance's report, not an official record.
**Under citizen review**: we have not finished checking every figure. Before you cite one, open the page of the
report it gives (`senate_pdf_url`). Amounts are as published, not spending. The NEP, the House bill and the Senate
committee report are versions of one budget: compare them, never add them.

## What's here

| File | Rows | What |
| --- | --- | --- |
| senate-2027-projects.csv / .parquet | {n_projects:,} | every project of the four programs the report details, by version |
| senate-2027-annex-a.csv / .parquet | {n_annex:,} | Annex A, the line-by-line amendments, as printed |
| senate-2027-general-summary.csv / .parquet | {n_summary:,} | the General Summary by department and agency |
| senate-2027-provisions.csv / .parquet | {n_prov:,} | Annex B, the amendments to the provisions |
| senate-2027-pairings.csv / .parquet | | insertions paired or flagged, to check (columns as the projects file's) |
| senate-2027-checks.csv | {n_checks} | the checks this build ran ({n_ok} of {n_checks} passed) |
| senate-2027-page-misses.csv | | page links whose page doesn't print the project's name, to check by hand |
| manifest.json | | sources, files, row counts and SHA-256 |
| senate-2027-dataset.zip | | the CSVs, the checks, this README, the manifest and SHA256SUMS.txt (its own SHA-256 is on the download page and in index.json) |
| SHA256SUMS.txt | | SHA-256 of every file and of the source PDFs |

## Sources

The Senate Committee on Finance's Committee Report on House Bill No. 10858 (FY 2027 General Appropriations Bill):
born-digital PDFs, read from their text (no OCR, no AI). Our copies, byte for byte:

{sources}

The House bill (HB 10858, third reading) and the NEP pages cited are at budget-assets.bettergov.ph/hgab/2027/pdf/.

## How to check this data yourself

1. **The files are the ones we published.** In the folder with the files run
   `sha256sum -c --ignore-missing SHA256SUMS.txt` (macOS: `shasum -a 256 -c --ignore-missing SHA256SUMS.txt`).
   Every file you have should say OK. The list covers the Parquet files and the source PDFs too (put the PDFs in
   `../pdf/` to check them).
2. **The source PDFs are the Senate's.** Each one's SHA-256 is above and in manifest.json; compare it with a copy
   you get from the Senate.
3. **Every amount cites its page.** `senate_pdf_url` opens the report at the page that prints the row;
   `house_pdf_url` and `nep_pdf_url` open the House bill and the NEP at theirs.
4. **Every page link prints its project.** For each project the build opens the Senate, House bill and NEP page it
   cites and looks for the project's name there (allowing for OCR misreadings in the NEP). The checks give how many
   pass; senate-2027-page-misses.csv lists any that don't, to check by hand.
5. **The totals add up.** senate-2027-checks.csv lists every check the build ran: each program's House bill and
   Senate totals against the totals the annexes print, the row arithmetic, the General Summary's own sums, and our
   line-by-line Senate amounts against the General Summary. The build stops if one fails.
6. **Rebuild it.** The code is public: `npm run build:senate-cr` with the report's PDFs in /data/senate-cr-2027/raw
   reproduces these files from commit `{commit}`.

Found a wrong figure? https://github.com/bettergovph/ai-reports/issues (give the file, the row and the page).

## Conventions

- Amounts are integer pesos. The report prints the General Summary and Annex A in thousands; we multiply by 1,000.
- An empty cell means none or not known, not zero.
- Names are as printed, including the documents' spelling. `title` is the report's name for a project.
- CSVs are UTF-8 with a byte-order mark. The Parquet files hold the same rows with their types.
- Pages: `*_page` is the page of the PDF file (what `#page=` opens); `house_printed_page` is the number printed on it.

## senate-2027-projects

The four programs whose projects the report lists one by one: Annex A-1 to A-4.

| program | |
| --- | --- |
{programs}

| Column | Meaning |
| --- | --- |
| program | dpwh, fmr, hfep or nia |
| id | our id for the row (a House bill project's id; `senate-<program>-N` for a Senate insertion) |
| house_id | the House bill project's id; empty for a Senate insertion |
| status, status_label | what the Senate does to it (below) |
| title | the project's name in the Senate committee report (the House bill's when it isn't listed) |
| house_title | the project's name in the House bill |
| renamed | the report gives it a revised name |
| matched_by | how the row was matched: the annex's own name (exact, prefix, fuzzy, ...); `rename_pair`, an insertion paired with the removed House project it revises; `restored_nep`, an insertion that is an NEP project the House bill doesn't have; `possible_duplicate` / `same_facility`, an insertion that looks like a House project (not merged) |
| check_id, check_note | the project it was paired with or looks like, and what to check |
| region, office | where; regions in one form ("Region IV-A", "CAR") |
| program_line, pap | the program line, or (HFEP) the kind of budget |
| nep_php, house_php, senate_php | the amount in each version; empty when the version doesn't have it |
| vs_house_php, vs_nep_php | Senate minus the House bill, Senate minus the NEP |
| inserted_by_house | in the House bill with no NEP line |
| replaces_id | for a Senate insertion that revises a removed House project (a corrected name or coordinates), that project |
| senate_doc, senate_page, senate_pdf_url | the annex and the page that print it |
| house_doc, house_page, house_pdf_url | the House bill volume and page |
| nep_doc, nep_page, nep_pdf_url | the NEP volume and page |
| page_url | the project's page on budget.bettergov.ph |

| status | |
| --- | --- |
{statuses}

The annexes print a corrected House project as a removal plus an insertion, and an NEP project the House dropped as
an insertion. We pair them back: an insertion and the removed House project it revises (same region; names at least
85 similar, or 75 with the same amount and municipality; or the annex's own link) become one renamed, raised or
reduced project; an insertion that is an NEP project (names at least 90 similar, or 85 with the NEP amount; HFEP: the
same facility and component) becomes `restored`. Insertions that still look like a House project are flagged in
`check_note`, not merged. senate-2027-pairings lists them all.

A House bill project the annex doesn't list is unchanged: the annexes list every changed or renamed row. NEP-only
rows are NEP projects with no House bill line; they are in neither the House bill nor the report.

## senate-2027-annex-a

Every row of Annex A, as printed. **Don't add its rows up**: the report prints some amounts at more than one level
(a new project under its heading, its region and its office, each with the same amount), `TOTAL` rows repeat their
expense classes, and `kind` = object rows break a class down by object of expenditure. For department and agency
totals use the General Summary. Two rows print an increase with no name (SUCs: Apayao State College and Ifugao
State University, Annex A pp. 42-43, +1,000 thousand each, above "Supplies and Materials Expenses"); they are kept as
printed, with an empty `label`.

| Column | Meaning |
| --- | --- |
| department_id, department_no, department, agency_no, agency | where in the bill |
| kind | `class` (an expense class: PS, MOOE, CO, ...) or `object` (an object of expenditure under it) |
| is_total_row | a `TOTAL` row, the sum of the classes above it |
| label | the class or object as printed |
| printed_heading | the text the report prints above the row (its line breaks joined with " / ") |
| house_bill_path | the House bill line it matches, as the House bill names it |
| status, status_meaning | how the row matched the House bill (below) |
| deleted | the report strikes the line |
| instruction | the report's instruction for the row ("Between lines 36 and 37, insert ...") |
| nep_php | the same line's amount in the NEP |
| house_php, increase_php, decrease_php, net_php, senate_php | as printed (decrease is negative) |
| house_doc, house_pdf_page, house_printed_page, house_line, house_pdf_url | the House bill line the report cites |
| senate_page, senate_pdf_url | the page of Annex A that prints it |

| status | |
| --- | --- |
{annex_statuses}

## senate-2027-general-summary

| Column | Meaning |
| --- | --- |
| level | total; department; agency (these add up to their department); sub-agency (breaks an agency down: "G.1" under "G"); group heading (a heading over agencies already listed, SUCs' "Region IV - Southern Tagalog and Palawan"); corporate budgets (printed after the departments: three DOE-attached corporations' budgets, not appropriations) |
| department_no, department, agency_no, agency | as printed |
| nep_php | the department's NEP total (departments only) |
| house_php, increase_php, decrease_php, net_php, senate_php | as printed, in pesos |

## senate-2027-provisions

| Column | Meaning |
| --- | --- |
| part | special or general provisions |
| department, agency, volume | where in the House bill |
| house_printed_page, house_lines | the House bill page and lines it amends |
| instruction, amended_text | the amendment, as printed |
| house_doc, house_pdf_page, house_pdf_url | the House bill page |
| senate_page, senate_pdf_url | the page of Annex B |

## senate-2027-checks

| Column | Meaning |
| --- | --- |
| check | what was checked |
| ours | our figure (a sum, or the count of rows that pass) |
| printed | the figure it must equal (the report's printed total, or the count of rows checked) |
| difference, ok | ours minus printed; whether they are equal |
| source, note | where the printed figure comes from; what differs, if anything |
| blocking | a failed blocking check stops the build; page-link checks are reported, with their misses listed |
"""

if __name__ == "__main__":
    main(*sys.argv[1:3])
