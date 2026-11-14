#!/usr/bin/env python3
"""What is a "multi-purpose building" line really building? Read its Senate documents and classify it.

Jason (2026-11-14): check whether House bill multi-purpose buildings are really classrooms. Trial first, not all lines.

Per line (data/hgab/2027/mpb.csv → documents/projects.parquet → the Senate files of its folder):
  * documents: POW, BP 202, geotagged photos, plans/perspectives, always the REDACTED copies (/data/senate-redact)
  * typed pages: their text layer; scanned pages: GLM-OCR (`layout_parsing`); photo pages: glm-5v-turbo describes
    the site and reads signage
  * a GLM text model reads it all and returns a category, classroom yes/no/unclear, confidence and verbatim quotes

  classify_mpb.py sample OUT [--n 20] [--seed 7]     pick a trial sample (random "Other or not stated" + controls)
  classify_mpb.py run OUT                             read + classify the sample, OUT/results.{json,csv}, OUT/report.md
Env: GLM_API_KEY (~/.bettergovph/.env). Data: ~/projects/ai-reports/data/hgab/2027.
"""
import base64
import csv
import io
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

import pymupdf
import pyarrow.parquet as pq

DATA = os.path.expanduser("~/projects/ai-reports/data/hgab/2027")
REDACTED = "/data/senate-redact"
API = os.environ.get("GLM_API_ENDPOINT", "https://api.z.ai/api/paas/v4").rstrip("/")
TEXT_MODEL = os.environ.get("MPB_TEXT_MODEL", "glm-5.1")
VISION_MODEL = "glm-5v-turbo"
CACHE = os.path.join(REDACTED, "cache", "mpb-classify")
DOC_TYPES = ("POW", "BP 202", "Geotagged photos")
PLAN_WORDS = re.compile(r"plan|perspective|design|layout|drawing", re.I)
MAX_PAGES = {"POW": 6, "BP 202": 3, "Geotagged photos": 2, "plan": 3}
CATEGORIES = ["classroom or school building", "other school facility (school covered court, gym, stage, library, "
              "canteen, school MPB)", "covered court or gym (not at a school)", "barangay hall or government office",
              "health facility", "evacuation center", "senior citizens or day care center",
              "community multi-purpose hall", "other", "unclear"]

PHOTO_PROMPT = ("These are geotagged site photos from a Philippine public works project file. Describe the site in "
                "2-4 sentences: what existing buildings and surroundings are visible, whether it looks like a school "
                "campus (classrooms in a row, flagpole, school name board, pupils), a barangay hall, a covered court, "
                "a health center, an open lot, etc. Quote any readable signage exactly. Plain text.")

CLASSIFY_PROMPT = """You are checking what a Philippine DPWH project labelled "multi-purpose building" will actually build.
Use ONLY the evidence below (project title, program of work items, BP 202 profile, site photo descriptions, plans).

Answer with JSON only:
{{"category": one of {cats},
  "classroom": "yes" | "no" | "unclear",   // yes = the structure is (or mainly contains) classrooms / a school instructional building
  "at_school": "yes" | "no" | "unclear",   // the site is a school (elementary, high school, college, DepEd)
  "confidence": "high" | "medium" | "low",
  "evidence": [up to 5 short verbatim quotes from the evidence that decided it],
  "reason": one or two sentences}}

Title: {title}
Office: {office}

Evidence:
{evidence}"""


def post(path, body, retries=5):
    last = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(f"{API}/{path}", data=json.dumps(body).encode(), method="POST", headers={
            "Authorization": f"Bearer {os.environ['GLM_API_KEY']}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=240) as r:
                return json.load(r), None
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}: {e.read().decode()[:200]}"
            if e.code not in (408, 429, 500, 502, 503, 504, 524, 529):
                break
        except Exception as e:  # noqa: BLE001
            last = f"{type(e).__name__}: {e}"
        time.sleep(min(60, 4 * 2 ** attempt))
    return None, last


def cached(kind, key, fn):
    path = os.path.join(CACHE, kind, re.sub(r"[^\w.-]+", "_", key)[-180:] + ".json")
    if os.path.exists(path):
        return json.load(open(path))
    val = fn()
    if val.get("error") is None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        json.dump(val, open(path, "w"), indent=1)
    return val


def jpeg(page, dpi=110):
    from PIL import Image
    pix = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csRGB)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=80)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def page_text(pdf, pno):
    """Text layer when it has words, else GLM-OCR markdown."""
    doc = pymupdf.open(pdf)
    page = doc[pno]
    txt = page.get_text().strip()
    if len(re.findall(r"[A-Za-z]{3,}", txt)) >= 30:
        return {"text": txt, "via": "text layer", "error": None}

    def ocr():
        r, err = post("layout_parsing", {"model": "glm-ocr", "file": jpeg(page, 150)})
        return {"text": (r or {}).get("md_results") or "", "via": "glm-ocr", "error": err}
    return cached("ocr", f"{pdf}#{pno}", ocr)


def photo_text(pdf, pages):
    doc = pymupdf.open(pdf)

    def look():
        content = [{"type": "image_url", "image_url": {"url": jpeg(doc[p], 90)}} for p in pages]
        r, err = post("chat/completions", {"model": VISION_MODEL, "max_tokens": 400, "temperature": 0,
                                           "thinking": {"type": "disabled"},
                                           "messages": [{"role": "user", "content": content + [
                                               {"type": "text", "text": PHOTO_PROMPT}]}]})
        txt = ((r or {}).get("choices") or [{}])[0].get("message", {}).get("content", "") if r else ""
        return {"text": txt, "via": VISION_MODEL, "error": err}
    return cached("photo", f"{pdf}#{','.join(map(str, pages))}", look)


def local_files():
    """Senate path → local redacted file, from every redacted region's manifest (duplicates point at the kept copy)."""
    out = {}
    for slug in os.listdir(REDACTED):
        m = os.path.join(REDACTED, slug, "manifest.json")
        if not os.path.exists(m) or not os.path.exists(os.path.join(REDACTED, slug, "stats.json")):  # finished regions only
            continue
        for f in json.load(open(m))["files"]:
            if f["status"] == "kept":
                for p in [f["path"]] + f.get("same_as", []):
                    out[p] = os.path.join(REDACTED, slug, "redacted", f["path"])
    return out


def lines():
    rows = list(csv.DictReader(open(os.path.join(DATA, "mpb.csv"), encoding="utf-8-sig")))
    files = defaultdict(list)
    for f in pq.read_table(os.path.join(DATA, "documents", "files.parquet")).to_pylist():
        if f["source"] == "senate" and f["path"]:
            files[f["project_id"]].append(f)
    for r in rows:
        m = re.search(r"/p/([^?#]+)$", r["record_url"])
        r["project_id"] = urllib.parse.unquote(m.group(1)) if m else None
        r["senate_files"] = files.get(r["project_id"], [])
    return rows


def sample(out, n, seed):
    loc = local_files()
    rows = [r for r in lines() if r["senate_files"] and all(f["path"] in loc for f in r["senate_files"]
                                                             if f["path"].lower().endswith(".pdf"))]
    random.seed(seed)
    pick = random.sample([r for r in rows if r["subtype"] == "Other or not stated"], n)
    pick += random.sample([r for r in rows if r["subtype"] == "School or classroom"], 5)
    pick += random.sample([r for r in rows if r["subtype"] in ("Covered court", "Barangay hall")], 5)
    os.makedirs(out, exist_ok=True)
    json.dump([{k: r[k] for k in ("project_id", "title", "subtype", "region", "dpwh_office", "house_php",
                                  "record_url")} for r in pick], open(os.path.join(out, "sample.json"), "w"), indent=1)
    print(f"{len(rows)} lines have all their Senate PDFs redacted locally; sample of {len(pick)} in {out}/sample.json")


def evidence_for(r, loc):
    parts, used = [], []
    by_type = defaultdict(list)
    for f in r["senate_files"]:
        if not f["path"].lower().endswith(".pdf") or f["path"] not in loc:
            continue
        t = f["doc_type"] if f["doc_type"] in DOC_TYPES else ("plan" if PLAN_WORDS.search(f["name"] or "") else None)
        if t:
            by_type[t].append(loc[f["path"]])
    for t in ("BP 202", "POW", "plan", "Geotagged photos"):
        for pdf in by_type.get(t, [])[:2]:
            n = min(pymupdf.open(pdf).page_count, MAX_PAGES[t])
            if t == "Geotagged photos":
                e = photo_text(pdf, list(range(n)))
                parts.append(f"## Site photos ({os.path.basename(pdf)}), described by a vision model\n{e['text']}")
            else:
                for p in range(n):
                    e = page_text(pdf, p)
                    parts.append(f"## {t} ({os.path.basename(pdf)} p{p + 1}, {e['via']})\n{e['text'][:3500]}")
            used.append(os.path.relpath(pdf, REDACTED))
    return "\n\n".join(parts)[:24000], used


def classify(r, loc):
    ev, used = evidence_for(r, loc)
    prompt = CLASSIFY_PROMPT.format(cats=json.dumps(CATEGORIES), title=r["title"], office=r["dpwh_office"],
                                    evidence=ev or "(no readable documents)")

    def ask():
        res, err = post("chat/completions", {"model": TEXT_MODEL, "max_tokens": 900, "temperature": 0,
                                             "thinking": {"type": "disabled"},
                                             "messages": [{"role": "user", "content": prompt}]})
        txt = ((res or {}).get("choices") or [{}])[0].get("message", {}).get("content", "") if res else ""
        m = re.search(r"\{.*\}", txt, re.S)
        try:
            return {"answer": json.loads(m.group(0)) if m else None, "raw": txt, "error": err}
        except json.JSONDecodeError:
            return {"answer": None, "raw": txt, "error": err or "unparseable"}
    out = cached("classify", f"{TEXT_MODEL}-{r['project_id']}", ask)
    return {**{k: r[k] for k in ("project_id", "title", "subtype", "region", "dpwh_office", "house_php", "record_url")},
            **(out.get("answer") or {}), "documents": used, "error": out.get("error")}


def run(out):
    picked = {s["project_id"] for s in json.load(open(os.path.join(out, "sample.json")))}
    loc = local_files()
    rows = [r for r in lines() if r["project_id"] in picked]
    t0 = time.time()
    res = list(ThreadPoolExecutor(6).map(lambda r: classify(r, loc), rows))
    json.dump(res, open(os.path.join(out, "results.json"), "w"), indent=1, ensure_ascii=False)
    cols = ["project_id", "subtype", "category", "classroom", "at_school", "confidence", "title", "reason",
            "evidence", "house_php", "region", "record_url", "error"]
    with open(os.path.join(out, "results.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in res:
            w.writerow({**r, "evidence": " | ".join(r.get("evidence") or [])})
    md = [f"# Multi-purpose buildings: what the documents say (trial, {len(res)} lines)\n"]
    for r in sorted(res, key=lambda r: (r.get("subtype") != "Other or not stated", r.get("classroom") != "yes")):
        md.append(f"## {r['title']}\n- Our label: {r['subtype']} · Model: **{r.get('category')}** · classroom: "
                  f"**{r.get('classroom')}** · at a school: {r.get('at_school')} · confidence {r.get('confidence')}\n"
                  f"- {r.get('reason')}\n" + "".join(f"  - \"{q}\"\n" for q in (r.get("evidence") or [])) +
                  f"- ₱{int(float(r['house_php'] or 0)):,} · {r['region']} · {r['record_url']}\n")
    open(os.path.join(out, "report.md"), "w").write("\n".join(md))
    c = defaultdict(int)
    for r in res:
        c[(r["subtype"] == "Other or not stated", r.get("classroom"))] += 1
    print(f"{len(res)} lines in {time.time() - t0:.0f}s; errors {sum(1 for r in res if r.get('error'))}")
    for k, v in sorted(c.items(), key=str):
        print(f"  {'Other/not stated' if k[0] else 'controls'} classroom={k[1]}: {v}")


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[0] == "sample":
        sample(a[1], int(a[a.index("--n") + 1]) if "--n" in a else 20, int(a[a.index("--seed") + 1]) if "--seed" in a else 7)
    elif a[0] == "run":
        run(a[1])
