#!/usr/bin/env python3
"""Companion data for research.bettergov.ph's "HGAB allocation vs TOTAL ESTIMATED COST" page (Jason, 2026-11-19).

The page reads expectation-vs-reality-data.json (allocation vs the POW's page-1 I. TOTAL ESTIMATED COST, exact title
matches only). This adds, from our per-project records (extract_projects.py, read from the REDACTED Senate copies):

  projects     rows for House bill projects the page doesn't have, in the page's row shape and flag rules
  supplements  for rows it has (by hgabId): our estimate where it has none, a review note where our flag differs,
               and document flags
  document flags (new): the documents describe a different facility; location or office differs; the BP 202 total
               project cost differs from the allocation; classrooms under another label

Amounts read from the documents by a model: each row links its redacted PDFs, so a reader can check the figure. An
amount that is exactly 1,000 times off the allocation (a thousands-of-pesos slip) is left out, not flagged.

  build_evr_additions.py OUT.json [--baseline expectation-vs-reality-data.json] [--csv OUT.csv]
"""
import csv
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
from collections import Counter, defaultdict

import pyarrow.parquet as pq

DATA = os.path.expanduser("~/projects/ai-reports/data/hgab/2027")
RECORDS = "/data/senate-extract/all/records.jsonl"
BASE_URL = "https://research.bettergov.ph/static/nep-preview/expectation-vs-reality-data.json"
ASSETS = "https://budget-assets.bettergov.ph/hgab/2027/dpwh/supporting-documents/"
RED, DOUBLE = 50_000, 500_000  # the page's thresholds (flagging.thresholdsPesos)
LABELS = {"double_red_flag": "Double red flag (allocation exceeds estimate by more than ₱500,000)",
          "red_flag": "Red flag (difference above ₱50,000; above-allocation estimates remain red)",
          "no_flag": "No flag (difference at or below ₱50,000)",
          "not_comparable": "Not comparable (difference unavailable)"}
DOC_FLAGS = {
    "different_facility": "The documents describe a different facility or kind of work than the House bill title",
    "location_or_office": "The location or implementing office in the documents differs from the House bill",
    "bp202_amount": "The BP 202 total project cost differs from the House bill allocation by more than ₱50,000",
    "classroom_other_label": "Classrooms, though the House bill title names another kind of building",
    "documents_other_project": "The documents in this project's folder appear to belong to another project "
                               "(a data problem, not a finding about the project)",
}


def num(x):
    return float(x) if isinstance(x, (int, float)) and x > 0 else None


def unit_slip(a, b):
    """True when b is a thousand times a (or the reverse): a P'000 figure read as pesos."""
    if not a or not b:
        return False
    r = a / b if a > b else b / a
    return 990 <= r <= 1010


def flag(alloc, est):
    if alloc is None or est is None or unit_slip(alloc, est):
        return "not_comparable"
    if alloc - est > DOUBLE:
        return "double_red_flag"
    if abs(est - alloc) > RED:
        return "red_flag"
    return "no_flag"


STOP = set("of the and at in along to from for barangay brgy sta construction completion rehabilitation improvement "
           "multi purpose building road city province municipality district phase including with on de del la".split())


def title_sim(a, b):
    """Token overlap of two project names (place names and specifics count, boilerplate words don't)."""
    ta = {w for w in re.findall(r"[a-z0-9]+", (a or "").lower()) if w not in STOP and len(w) > 2}
    tb = {w for w in re.findall(r"[a-z0-9]+", (b or "").lower()) if w not in STOP and len(w) > 2}
    return len(ta & tb) / len(ta | tb) if ta and tb else 0.0


GENERIC = re.compile(r"organizational outcome|convergence and special support|basic infrastructure program|^oo\d|"
                     r"ensure safe and reliable|protect lives and properties", re.I)


def same_project(r):
    """(similarity, place matches, generic name) for the documents vs the House bill title. The documents' own name
    can be a program heading ("ORGANIZATIONAL OUTCOME 1 …"), so the description and the place count too."""
    house = r.get("house_title") or ""
    sim = max(title_sim(house, r.get("title_full")), title_sim(house, r.get("description")))
    loc = r.get("location") or {}
    places = {w for k in ("municipality",) for w in re.findall(r"[a-z]+", (loc.get(k) or "").lower())
              if len(w) > 3 and w not in {"city", "municipality", "barangay", "poblacion"}}
    htoks = set(re.findall(r"[a-z]+", house.lower()))
    return sim, bool(places & htoks), bool(GENERIC.search(r.get("title_full") or ""))


_text_cache = {}


def printed(amount, files, loc, doc_type):
    """Whether `amount` is printed on page 1 of the project's `doc_type` file (text layer or the cached OCR)."""
    import classify_mpb as c
    if not amount:
        return False
    want = {f"{amount:,.2f}", f"{amount:,.0f}", f"{amount / 1000:,.2f}", f"{amount / 1000:,.3f}", f"{amount / 1000:,.0f}"}
    for f in files:
        if f["doc_type"] != doc_type or f["path"] not in loc:
            continue
        key = loc[f["path"]]
        if key not in _text_cache:
            try:
                _text_cache[key] = c.page_text(key, 0).get("text") or ""
            except Exception:  # noqa: BLE001
                _text_cache[key] = ""
        text = _text_cache[key].replace(" ", "")
        if any(w.replace(" ", "") in text for w in want):
            return True
    return False


def doc_links(files):
    out = []
    for f in sorted(files, key=lambda f: (f["doc_type"] not in ("POW", "BP 202"), f["doc_type"] or "", f["path"])):
        if f["path"]:
            out.append({"type": f["doc_type"], "url": ASSETS + "/".join(urllib.parse.quote(p) for p in f["path"].split("/"))})
    return out[:8]


def doc_flags(r, alloc, sim, files, loc, place, generic):
    flags = []
    if sim < 0.25 and not place and not generic:  # the documents name another project: a folder mix-up
        return [{"code": "documents_other_project", "label": "The documents in this project's folder appear to belong "
                 "to another project", "detail": f"Documents name: {r.get('title_full')}"}]
    kind, note, q = r.get("mismatch_kind"), r.get("title_mismatch"), r.get("quotes") or {}
    if sim < 0.25 and not place:
        return flags  # can't tell whether the documents are this project's; no finding either way
    if kind == "different facility":
        flags.append({"code": "different_facility", "label": DOC_FLAGS["different_facility"], "detail": note,
                      "documentsDescribe": r.get("facility"), "category": r.get("category"),
                      "evidence": [x for x in (q.get("facility"), q.get("purpose")) if x]})
    if kind == "location or office":
        flags.append({"code": "location_or_office", "label": DOC_FLAGS["location_or_office"], "detail": note,
                      "evidence": [x for x in (q.get("location"),) if x]})
    bp = num((r.get("cost") or {}).get("total_project_cost_php"))
    if bp and alloc and abs(bp - alloc) > RED and not unit_slip(bp, alloc) and sim >= 0.5 \
            and printed(bp, files, loc, "BP 202"):
        flags.append({"code": "bp202_amount", "label": DOC_FLAGS["bp202_amount"],
                      "detail": f"BP 202 total project cost ₱{bp:,.0f} vs allocation ₱{alloc:,.0f}",
                      "bp202TotalProjectCostPesos": bp, "differencePesos": round(bp - alloc, 2),
                      "evidence": [x for x in (q.get("cost"),) if x]})
    title = r.get("house_title") or ""
    if r.get("classroom") == "yes" and not re.search(r"class ?room|school building|instructional", title, re.I):
        size = r.get("size") or {}
        flags.append({"code": "classroom_other_label", "label": DOC_FLAGS["classroom_other_label"],
                      "detail": r.get("facility"), "classrooms": size.get("classrooms"),
                      "evidence": [x for x in (q.get("facility"),) if x]})
    return flags


def main():
    args = sys.argv[1:]
    out = args[0]
    base_path = args[args.index("--baseline") + 1] if "--baseline" in args else None
    base = json.load(open(base_path)) if base_path else json.loads(
        subprocess.run(["curl", "-sf", BASE_URL], capture_output=True, text=True, check=True).stdout)
    theirs = {p["hgabId"]: p for p in base["projects"]}
    files = defaultdict(list)
    for f in pq.read_table(os.path.join(DATA, "documents", "files.parquet")).to_pylist():
        if f["source"] == "senate":
            files[f["project_id"]].append(f)
    recs = [json.loads(l) for l in open(RECORDS)]
    recs = {r["hgab_id"]: r for r in recs if not r.get("error")}

    projects, supplements = [], []
    c_new, c_fill, c_doc, c_conflict = Counter(), Counter(), Counter(), 0
    import classify_mpb as c
    loc = c.local_files()
    for h, r in sorted(recs.items()):
        alloc = num(r.get("house_amount_php"))
        est = num((r.get("cost") or {}).get("pow_estimated_cost_php"))
        pf = files.get(r["project_id"], [])
        sim, place, generic = same_project(r)
        same = sim >= 0.5 or (place and sim >= 0.15)
        verified = same and printed(est, pf, loc, "POW")
        f = flag(alloc, est) if verified else "not_comparable"
        dflags = doc_flags(r, alloc, sim if not (place and sim >= 0.15) else max(sim, 0.5), pf, loc, place, generic)
        for d in dflags:
            c_doc[d["code"]] += 1
        links = doc_links(files.get(r["project_id"], []))
        common = {"documentFlags": dflags, "facility": r.get("facility"), "category": r.get("category"),
                  "documentsProjectName": r.get("title_full"), "titleAgreement": round(sim, 2),
                  "documents": links, "extraction": {"confidence": r.get("confidence"),
                                                     "powEstimateQuote": (r.get("quotes") or {}).get("cost")}}
        if h not in theirs:
            row = {"hgabId": h, "title": r.get("house_title"), "office": r.get("office"), "region": r.get("region"),
                   "allocationPesos": alloc, "powEstimatePesos": est if f != "not_comparable" else None,
                   "differencePesos": round(est - alloc, 2) if f != "not_comparable" else None,
                   "differencePct": round((est - alloc) / alloc * 100, 2) if f != "not_comparable" else None,
                   "status": "comparable_total_estimated_cost" if f != "not_comparable" else "not_comparable",
                   "flag": f, "flagLabel": LABELS[f], "source": "budget.bettergov.ph senate-extract", **common}
            projects.append(row)
            c_new[f] += 1
            continue
            # (rows the page has fall through to supplements below)
        t = theirs[h]
        sup = {"hgabId": h}
        if t.get("flag") == "not_comparable" and f != "not_comparable":
            sup.update(powEstimatePesos=est, differencePesos=round(est - alloc, 2),
                       differencePct=round((est - alloc) / alloc * 100, 2), flag=f, flagLabel=LABELS[f],
                       note="The page has no comparable estimate; this one was read from the POW's first page.")
            c_fill[f] += 1
        elif t.get("flag") not in (None, "not_comparable") and f != "not_comparable" and f != t["flag"]:
            sup.update(reviewNote=f"Our reading of the POW gives ₱{est:,.0f} ({f.replace('_', ' ')}); the page has "
                                  f"₱{(t.get('powEstimatePesos') or 0):,.0f} ({t['flag'].replace('_', ' ')}). "
                                  "Check the POW; the page's figure is kept.",
                       ourPowEstimatePesos=est)
            c_conflict += 1
        if dflags:
            sup.update(common)
        if len(sup) > 1:
            supplements.append(sup)

    doc = {
        "generatedAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "scope": "Companion to expectation-vs-reality-data.json: FY2027 House bill DPWH projects read from their "
                 "Senate-provided documents (BP 202, POW page 1, certifications, endorsements, geotagged photos).",
        "baseline": {"url": BASE_URL, "generatedAtUtc": base.get("generatedAtUtc"),
                     "gitCommit": (base.get("flagging", {}).get("sourceSnapshot") or {}).get("gitCommit")},
        "method": "Per-project records extracted by a model (glm-5.1, with GLM-OCR for scans and a vision model for "
                  "photos) from the redacted Senate copies, joined to House bill rows by hgabId. Amount flags use the "
                  "page's own thresholds: red when the POW estimate and the allocation differ by more than ₱50,000; "
                  "double red when the allocation exceeds the estimate by more than ₱500,000. Rows the page already "
                  "has keep the page's figures; differences are listed as review notes, never overrides.",
        "limitations": [
            "Figures were read by a model from scanned and typed documents; each row links its source PDFs for checking.",
            "An amount exactly 1,000 times off the allocation (a figure in thousands read as pesos) is treated as not comparable.",
            "Document flags compare the documents with the House bill title; a differing title can be a filing error, "
            "a mismatched folder, or a project changed after the documents were made.",
            "POW estimates are estimates, not contract prices or proof of work done.",
            "Only projects with Senate-provided BP 202 / POW files are covered (4,082 of 15,979 House bill DPWH rows).",
            "Amount flags count only when the documents are this project's (their name or description shares at least half "
            "its distinctive words with the House bill title, or the barangay/municipality matches) and the amount is "
            "found printed on page 1 of the POW (or BP 202); otherwise the row is not comparable. Folders whose documents "
            "name a specific other project are listed as documents_other_project.",
        ],
        "flagging": {"thresholdsPesos": {"doubleRedFlagAbove": DOUBLE, "redFlagAbove": RED}, "labels": LABELS,
                     "documentFlags": DOC_FLAGS},
        "summary": {"newProjects": len(projects), "newProjectFlags": dict(c_new),
                    "baselineNotComparableNowComparable": dict(c_fill), "flagDisagreementsForReview": c_conflict,
                    "documentFlags": dict(c_doc), "supplementRows": len(supplements)},
        "projects": projects,
        "supplements": supplements,
    }
    json.dump(doc, open(out, "w"), ensure_ascii=False, indent=1)
    if "--csv" in args:
        with open(args[args.index("--csv") + 1], "w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["hgabId", "in_baseline", "title", "region", "allocationPesos", "powEstimatePesos", "flag",
                        "document_flags", "documents_describe", "first_document"])
            for p in projects:
                w.writerow([p["hgabId"], "no", p["title"], p["region"], p["allocationPesos"], p["powEstimatePesos"],
                            p["flag"], "; ".join(d["code"] for d in p["documentFlags"]), p.get("facility"),
                            (p["documents"] or [{}])[0].get("url")])
            for s in supplements:
                t = theirs[s["hgabId"]]
                w.writerow([s["hgabId"], "yes", t.get("title"), t.get("region"), t.get("allocationPesos"),
                            s.get("powEstimatePesos", s.get("ourPowEstimatePesos")), s.get("flag", t.get("flag")),
                            "; ".join(d["code"] for d in s.get("documentFlags", [])), s.get("facility"),
                            (s.get("documents") or [{}])[0].get("url")])
    print(json.dumps(doc["summary"], indent=1))


if __name__ == "__main__":
    main()
