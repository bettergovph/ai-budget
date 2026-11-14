#!/usr/bin/env python3
"""One structured record per House bill DPWH project, read from its Senate documents (Jason, 2026-11-14: "extract
metadata for each project … then we can filter from there").

Evidence comes from the REDACTED copies only (/data/senate-redact): BP 202, POW, plans, certifications and council
endorsements as text (text layer, or GLM-OCR for scans), geotagged photos as a vision model's site description. A GLM
text model fills the schema below and quotes the documents for the key fields. No personal names are extracted.

  extract_projects.py sample OUT [--seed 3]       a mixed trial sample (multi-purpose, roads, flood, bridges, other)
  extract_projects.py run OUT [--ids a,b]         extract OUT/sample.json (or the given project ids)
  extract_projects.py all OUT                     every project whose Senate PDFs are all redacted locally
Outputs: OUT/records.jsonl (one JSON per project), OUT/records.csv (flattened), cache in /data/senate-redact/cache.
Env: GLM_API_KEY (~/.bettergovph/.env).
"""
import csv
import json
import os
import random
import re
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

import pymupdf
import pyarrow.parquet as pq

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import classify_mpb as c  # noqa: E402  (document reading, OCR, photo description, cache)

MODEL = os.environ.get("EXTRACT_MODEL", "glm-5.1")
SCHEMA_VERSION = 3  # 2: lean evidence (POW page 1, Jason 2026-11-14) + mismatch_kind; 3: category from documents
# v3 only changed the prompt for records whose documents describe a different facility, so a v2 record without that
# mismatch is reused as is (its category already matches the documents).
CATEGORIES = ["classroom or school building", "other school facility", "multi-purpose hall", "covered court or gym",
              "barangay hall or government office", "health facility", "evacuation center",
              "senior citizens or day care center", "market or commercial", "road", "bridge",
              "flood control or drainage", "water supply or sanitation", "other building", "other", "unclear"]
# doc type → pages read
# Jason (2026-11-14): "the POW's first page details are good enough"
PAGES = {"BP 202": 3, "POW": 1, "plan": 1, "Certificate of Implementability": 1, "Development Council": 1,
         "Geotagged photos": 2}
ORDER = ["BP 202", "POW", "plan", "Certificate of Implementability", "Development Council", "Geotagged photos"]
NEEDED = ("BP 202", "POW")  # a project is ready once these are redacted; long endorsements don't hold it back

PROMPT = """Extract a record for one Philippine DPWH infrastructure project in the FY2027 House budget bill, using ONLY the
documents below (DPWH BP 202 profile, program of work, plans, certifications, council endorsements, site photo
descriptions). Never output personal names of people. Use null when the documents don't say. Amounts in pesos as
numbers (the BP 202 is often in thousands of pesos, "P'000": convert to pesos). Dates as YYYY-MM-DD when possible.
"category", "facility", "classroom" and "size" describe what the BP 202 description and POW scope say will be BUILT,
even when the House bill title calls it something else (a "multi-purpose building" that the documents describe as a
slaughterhouse is category "market or commercial", facility "slaughterhouse").

House bill title: {title}
House bill amount: {amount} pesos
DPWH office: {office}

Return JSON only, exactly these keys:
{{"title_full": the full project name as written in the BP 202 or POW,
  "implementing_office": str,
  "tier": "Tier 1" | "Tier 2" | null,
  "location": {{"barangay": str|null, "municipality": str|null, "province": str|null, "region": str|null,
               "coordinates": [lat, lon] | null, "site_name": school, hospital or facility name at the site | null}},
  "category": one of {cats},
  "facility": short plain description of what will be built, e.g. "2-storey 8-classroom school building",
  "at_school": "yes" | "no" | "unclear",
  "classroom": "yes" | "no" | "unclear",
  "title_mismatch": null, or one sentence when the documents differ from the House bill title,
  "mismatch_kind": null | "different facility" (a different kind of thing is built) | "location or office" |
                   "amount" | "detail" (minor: station numbers, wording, spelling),
  "size": {{"storeys": int|null, "classrooms": int|null, "floor_area_sqm": number|null, "length_km": number|null,
           "physical_target": the BP 202 physical target as written | null}},
  "purpose": the stated purpose, verbatim or near-verbatim | null,
  "description": the stated project description | null,
  "beneficiaries": the stated beneficiaries | null,
  "cost": {{"total_project_cost_php": number|null, "pow_estimated_cost_php": number|null,
           "pow_direct_cost_php": number|null}},
  "schedule": {{"start": str|null, "finish": str|null, "contract_duration_days": number|null}},
  "endorsements": [short items, e.g. "RDC resolution no. 14-05 (s. 2026)", "LGU certificate of no objection, 2026-08-24"],
  "documents_seen": [document types present],
  "confidence": "high" | "medium" | "low",
  "quotes": {{"facility": verbatim quote, "purpose": verbatim quote, "cost": verbatim quote, "location": verbatim quote}}}}

Documents:
{evidence}"""


def senate_files():
    files = defaultdict(list)
    for f in pq.read_table(os.path.join(c.DATA, "documents", "files.parquet")).to_pylist():
        if f["source"] == "senate" and f["path"]:
            files[f["project_id"]].append(f)
    return files


def projects():
    return {p["project_id"]: p for p in pq.read_table(os.path.join(c.DATA, "documents", "projects.parquet")).to_pylist()}


def kind(title):
    t = title.lower()
    for k, pat in [("multi-purpose", r"multi.?purpose"), ("flood", r"flood|drainage|revetment|dike|seawall|river"),
                   ("bridge", r"bridge"), ("road", r"road|street|highway|k\d{4}")]:
        if re.search(pat, t):
            return k
    return "other"


def local_projects(loc, files, projs):
    """Projects whose BP 202 and POW files are all redacted locally."""
    out = []
    for pid, p in projs.items():
        need = [f for f in files.get(pid, []) if f["doc_type"] in NEEDED and f["path"].lower().endswith(".pdf")]
        if need and all(f["path"] in loc for f in need):
            out.append(p)
    return out


def evidence(fs, loc):
    by_type = defaultdict(list)
    for f in fs:
        if not f["path"].lower().endswith(".pdf") or f["path"] not in loc:
            continue
        t = f["doc_type"]
        if t == "Other" and c.PLAN_WORDS.search(f["name"] or ""):
            t = "plan"
        if t in PAGES:
            by_type[t].append((loc[f["path"]], f["name"]))
    parts, seen = [], []
    for t in ORDER:
        for pdf, name in by_type.get(t, [])[:2]:
            seen.append(t)
            try:
                n = min(pymupdf.open(pdf).page_count, PAGES[t])
            except Exception:  # noqa: BLE001
                continue
            if t == "Geotagged photos":
                e = c.photo_text(pdf, list(range(n)))
                parts.append(f"## Geotagged photos ({name}), described by a vision model\n{e['text']}")
            else:
                for p in range(n):
                    e = c.page_text(pdf, p)
                    parts.append(f"## {t} ({name}, page {p + 1})\n{e['text'][:4000]}")
    return "\n\n".join(parts)[:30000], sorted(set(seen))


def extract(p, fs, loc):
    ev, seen = evidence(fs, loc)
    prompt = PROMPT.format(title=p["title"], amount=p["amount_php"], office=p["office"], cats=json.dumps(CATEGORIES),
                           evidence=ev or "(no readable documents)")

    def ask():
        res, err = c.post("chat/completions", {"model": MODEL, "max_tokens": 2500, "temperature": 0,
                                               "thinking": {"type": "disabled"},
                                               "messages": [{"role": "user", "content": prompt}]})
        txt = ((res or {}).get("choices") or [{}])[0].get("message", {}).get("content", "") if res else ""
        m = re.search(r"\{.*\}", txt, re.S)
        try:
            return {"record": json.loads(m.group(0)) if m else None, "usage": (res or {}).get("usage"), "error": err}
        except json.JSONDecodeError:
            return {"record": None, "raw": txt[:2000], "error": err or "unparseable"}
    prev = os.path.join(c.CACHE, "extract", re.sub(r"[^\w.-]+", "_", f"v2-{MODEL}-{p['project_id']}")[-180:] + ".json")
    if os.path.exists(prev):
        old = json.load(open(prev))
        if old.get("record") and old["record"].get("mismatch_kind") != "different facility":
            out = old
            return {"project_id": p["project_id"], "hgab_id": p["hgab_id"], "house_title": p["title"],
                    "house_amount_php": p["amount_php"], "office": p["office"], "region": p["region"],
                    "senate_folders": p["senate_folders"], "documents_read": seen, **out["record"], "error": None}
    out = c.cached("extract", f"v{SCHEMA_VERSION}-{MODEL}-{p['project_id']}", ask)
    return {"project_id": p["project_id"], "hgab_id": p["hgab_id"], "house_title": p["title"],
            "house_amount_php": p["amount_php"], "office": p["office"], "region": p["region"],
            "senate_folders": p["senate_folders"], "documents_read": seen, **(out.get("record") or {}),
            "error": out.get("error")}


def coords(loc_):
    """(lat, lon) from whatever the model returned: [lat, lon], {"lat":…, "lon":…}, a "lat, lon" string, or junk."""
    v = loc_.get("coordinates")
    try:
        if isinstance(v, dict):
            v = [v.get("lat") or v.get("latitude"), v.get("lon") or v.get("lng") or v.get("longitude")]
        elif isinstance(v, str):
            v = re.findall(r"-?\d+(?:\.\d+)?", v)
        lat, lon = float(v[0]), float(v[1])
        return (lat, lon) if 4 <= lat <= 22 and 114 <= lon <= 128 else (None, None)  # inside the Philippines
    except (TypeError, ValueError, IndexError):
        return None, None


def flat(r):
    loc_, size, cost, sched, q = (r.get(k) or {} for k in ("location", "size", "cost", "schedule", "quotes"))
    return {"project_id": r["project_id"], "house_title": r["house_title"], "house_amount_php": r["house_amount_php"],
            "region": r["region"], "office": r["office"], "category": r.get("category"), "facility": r.get("facility"), "mismatch_kind": r.get("mismatch_kind"),
            "classroom": r.get("classroom"), "at_school": r.get("at_school"), "title_mismatch": r.get("title_mismatch"),
            "title_full": r.get("title_full"), "barangay": loc_.get("barangay"), "municipality": loc_.get("municipality"),
            "province": loc_.get("province"), "site_name": loc_.get("site_name"),
            "lat": coords(loc_)[0], "lon": coords(loc_)[1],
            "storeys": size.get("storeys"), "classrooms": size.get("classrooms"),
            "floor_area_sqm": size.get("floor_area_sqm"), "length_km": size.get("length_km"),
            "physical_target": size.get("physical_target"), "total_project_cost_php": cost.get("total_project_cost_php"),
            "pow_estimated_cost_php": cost.get("pow_estimated_cost_php"), "tier": r.get("tier"),
            "start": sched.get("start"), "finish": sched.get("finish"), "purpose": r.get("purpose"),
            "beneficiaries": r.get("beneficiaries"), "endorsements": " | ".join(r.get("endorsements") or []),
            "confidence": r.get("confidence"), "quote_facility": q.get("facility"), "quote_purpose": q.get("purpose"),
            "documents_read": " | ".join(r.get("documents_read") or []), "error": r.get("error")}


def run(out, ids):
    loc, files, projs = c.local_files(), senate_files(), projects()
    todo = [projs[i] for i in ids if i in projs]
    t0 = time.time()
    res = list(ThreadPoolExecutor(int(os.environ.get("EXTRACT_THREADS", "8"))).map(
        lambda p: extract(p, files[p["project_id"]], loc), todo))
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "records.jsonl"), "w") as fh:
        for r in res:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    rows = [flat(r) for r in res]
    with open(os.path.join(out, "records.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    print(f"{len(res)} projects in {time.time() - t0:.0f}s, {sum(1 for r in res if r.get('error'))} errors → {out}")


if __name__ == "__main__":
    a = sys.argv[1:]
    out = a[1]
    if a[0] == "sample":
        random.seed(int(a[a.index("--seed") + 1]) if "--seed" in a else 3)
        loc, files, projs = c.local_files(), senate_files(), projects()
        pool = defaultdict(list)
        for p in local_projects(loc, files, projs):
            pool[kind(p["title"])].append(p["project_id"])
        pick = []
        for k, n in [("multi-purpose", 8), ("road", 6), ("flood", 4), ("bridge", 3), ("other", 4)]:
            pick += random.sample(pool[k], min(n, len(pool[k])))
        os.makedirs(out, exist_ok=True)
        json.dump(pick, open(os.path.join(out, "sample.json"), "w"), indent=1)
        print({k: len(v) for k, v in pool.items()}, "→ sample of", len(pick))
    elif a[0] == "run":
        ids = a[a.index("--ids") + 1].split(",") if "--ids" in a else json.load(open(os.path.join(out, "sample.json")))
        run(out, ids)
    elif a[0] == "all":
        loc, files, projs = c.local_files(), senate_files(), projects()
        run(out, [p["project_id"] for p in local_projects(loc, files, projs)])
