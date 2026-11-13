#!/usr/bin/env python3
"""Black out handwritten signatures and initials in the House bill's Senate copies (signatory privacy).

Adapted from the NEP signature stripper on vm3-server (`~/projects/dpwh`: strip_signatures.py, model_scan_boxes.py,
process_corpus.py). That pipeline sent only full-page scans to the vision model; here EVERY page goes, because the
Senate copies mix scans, born-digital pages with pasted signature images, and scans placed with margins.

Three removals per PDF, originals never touched:
  1. objects   pasted / hidden signature images (exact removal, pixel heuristics from strip_signatures.py)
  2. boxes     a vision model (GLM on Z.ai) boxes each handwritten mark on the rendered page; boxes that sit on
               pen-weight ink are blacked out with apply_redactions(images=PIXELS): the pixels under the box are
               rewritten, vector strokes wholly inside are removed, printed text is kept
  3. annots    Ink / Stamp annotations dropped with pikepdf (PyMuPDF annot deletion corrupts surviving FreeText
               appearances: see the vm3 HANDOVER.md); green highlighter is kept

  detect   SRC → cache/<model>/<sha256>.json   (one call per page per model; cached, so re-runs cost nothing)
  verify   each candidate box cropped and put to the verifier: handwriting, YES or NO (cache/verify-<model>/)
  apply    SRC + cache → DST/<same path>       plus DST/_qa/<file>__pN.png (before | after) for every changed page
  sweep    DST: each redacted page back to the model, "what handwriting is still visible outside the bars?"
           then `apply DST DST2 --sweep glm-5v-turbo` bars what it found (tails, thin loops, strokes between bars)

Usage:
  set -a; source ~/.bettergovph/.env; set +a
  redact_signatures.py detect SRC [--models glm-5v-turbo,glm-4.6v] [--concurrency 6] [--dpi 150] [--all-pages]
  redact_signatures.py verify SRC [--models …] [--verifier glm-5v-turbo]
  redact_signatures.py apply SRC DST [--models …] [--verifier …] [--style black|white]
"""

import base64
import colorsys
import hashlib
import io
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import pymupdf

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.environ.get("SIG_CACHE", os.path.join(HERE, "cache"))
GLM_URL = os.environ.get("GLM_API_ENDPOINT", "https://api.z.ai/api/paas/v4").rstrip("/") + "/chat/completions"
PROMPT_VERSION = 2              # cache dirs are <model>.p<version>
PROMPT = ("Find every handwritten pen mark in this image: signatures (including fast scrawls, loops and long "
          "diagonal strokes or slashes drawn over printed names), initials (often small, in margins or page "
          "corners), and handwritten names, dates or numbers. Exclude printed or typed text, logos, rubber stamps "
          "and green marks. Include signature images pasted onto typed documents. Give each mark one bounding box "
          "covering ALL of its strokes, in the format <|begin_of_box|>[xmin,ymin,xmax,ymax]<|end_of_box|> with "
          "coordinates normalized to 0-1000 relative to image size, top-left origin. Output boxes only. If there "
          "are none, output NONE.")
SWEEP_PROMPT = ("Black bars on this page hide signatures. Find any handwriting still visible OUTSIDE the black bars: "
                "pieces of signatures, loops or tails sticking out of a bar, strokes between bars, initials, "
                "handwritten names, dates or numbers. Ignore the bars themselves, printed or typed text, logos, "
                "rubber stamps and green marks. For each mark output its bounding box in the format "
                "<|begin_of_box|>[xmin,ymin,xmax,ymax]<|end_of_box|> with coordinates normalized to 0-1000 "
                "relative to image size, top-left origin. Output boxes only. If there is none, output NONE.")
DPI = 150
JPEG_QUALITY = 85
MAX_TOKENS = 2000
RETRIES = 6                   # with backoff up to ~2 min: Z.ai throttles in bursts (429, code 1302)

# box filters (from model_scan_boxes.py)
MAX_BOX_PAGE_FRAC = 0.35      # a "signature" covering a third of the page is a miss
MIN_BOX_PT = 8.0              # smaller than any initial -> speckle
MIN_STROKE_SHARE = 0.004      # box must hold some pen-weight ink
GREEN_DROP_SHARE = 0.50       # green-dominated ink is reviewer highlighter
MARGIN = 6.0                  # pt added round each kept box (tails and loops escape tight boxes)
ROW_GAP = 12.0                # fuse same-row boxes this close into one bar (black style)
FILL = (0, 0, 0)

# pasted signature images (from strip_signatures.py)
MIN_PT, MAX_PT = 14, 400
MAX_PAGE_FRAC = 0.08
MIN_WHITE = 0.50
INK_RANGE = (0.008, 0.30)
HUE_MONO = 0.75
HEADER_BAND = 0.15             # top share of the page treated as letterhead


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def pdfs_under(root):
    out = []
    for dp, _ds, fs in os.walk(root):
        out += [os.path.join(dp, f) for f in fs if f.lower().endswith(".pdf")]
    return sorted(out)


# ---------------------------------------------------------------- model

def render(page, dpi=DPI):
    pix = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csRGB)
    from PIL import Image
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=JPEG_QUALITY)
    return buf.getvalue(), pix


HTTP_RETRIES = {}  # status -> count, for the run summary


def call_glm(model, jpeg, prompt, max_tokens=MAX_TOKENS):
    body = {"model": model, "max_tokens": max_tokens, "temperature": 0, "thinking": {"type": "disabled"},
            "messages": [{"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()}},
                {"type": "text", "text": prompt}]}]}
    payload = json.dumps(body).encode()
    last = None
    for attempt in range(RETRIES + 1):
        req = urllib.request.Request(GLM_URL, data=payload, method="POST", headers={
            "Authorization": f"Bearer {os.environ['GLM_API_KEY']}", "Content-Type": "application/json"})
        t0 = time.time()
        try:
            with urllib.request.urlopen(req, timeout=240) as resp:
                r = json.load(resp)
            choice = (r.get("choices") or [{}])[0]
            return {"raw": (choice.get("message") or {}).get("content") or "", "finish": choice.get("finish_reason"),
                    "secs": round(time.time() - t0, 1), "usage": r.get("usage")}, None
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}: {e.read().decode()[:200]}"
            HTTP_RETRIES[e.code] = HTTP_RETRIES.get(e.code, 0) + 1
            if e.code not in (408, 429, 500, 502, 503, 504, 524, 529):
                break
        except Exception as e:  # noqa: BLE001 - network errors retry
            last = f"{type(e).__name__}: {e}"
        time.sleep(min(120, 4 * 2 ** attempt) * (0.5 + random.random()))
    return None, last


NUM = r"\s*(\d+(?:\.\d+)?)\s*"


def parse_boxes(text):
    """[xmin,ymin,xmax,ymax] in 0-1000 units, or None when the reply is neither NONE nor readable boxes.

    glm-5v-turbo sometimes wraps boxes as <a,b,c,d>, <bbox>a b c d</bbox> or [a, b, c, d] with prose around them.
    A box in 0-1 fractions is scaled up; one that mixes scales (seen: [1, 0.453, 0.32, 0.538]) is unreadable.
    """
    text = text or ""
    boxes, bad = [], 0
    for m in re.findall(r"[\[<(]" + r"[,\s]".join([NUM] * 4) + r"[\]>)]", text.replace("<bbox>", "<").replace("</bbox>", ">")):
        v = [float(x) for x in m]
        if all(x < 1.0 for x in v):
            v = [x * 1000 for x in v]
        if any(0 < x < 1 for x in v) or max(v) > 1000 or v[0] >= v[2] or v[1] >= v[3]:
            bad += 1
            continue
        boxes.append([int(round(x)) for x in v])
    if boxes:
        return boxes
    if bad or not re.search(r"\bNONE\b|\bno (?:such )?handwritten\b|found no\b", text, re.I):
        return None
    return []


def ask(model, jpeg, prompt=None):
    """One page to the model; an unreadable reply is asked again (up to 2 more times)."""
    for _try in range(3):
        res, err = call_glm(model, jpeg, prompt or PROMPT)
        if err or parse_boxes(res["raw"]) is not None:
            break
    return res, err


def detect_file(path, model, dpi, all_pages=False, pool=None):
    """Every page through the model; pages are asked in parallel through `pool` (one per model, sized to the
    model's concurrency limit)."""
    pool = pool or ThreadPoolExecutor(1)
    digest = sha256(path)
    out = os.path.join(CACHE, f"{model}.p{PROMPT_VERSION}", digest + ".json")
    cached = {}
    if os.path.exists(out):
        with open(out) as fh:
            cached = {p["page"]: p for p in json.load(fh)["pages"]}
    doc = pymupdf.open(path)
    pages, pending, dirty = [], [], not cached
    for pno, page in enumerate(doc):
        entry = cached.get(pno + 1)
        if not all_pages and not page.get_image_info() and \
                not any(a.type[1] not in ("Link", "Popup") for a in page.annots() or []):
            # typed page, nothing pasted on it: a signature would need to be drawn as vector strokes, which the
            # trial never saw (164 image-less pages, 0 signatures); saves about a third of the model calls
            pages.append({"page": pno + 1, "skipped": "no images or annotations"})
            continue
        if entry and not entry.get("error") and parse_boxes(entry.get("raw")) is not None:
            pages.append(entry)
            continue
        dirty = True
        jpeg, pix = render(page, dpi)
        entry = {"page": pno + 1, "render": [pix.width, pix.height], "dpi": dpi}
        pending.append((entry, pool.submit(ask, model, jpeg)))
        pages.append(entry)
    doc.close()
    for entry, fut in pending:
        res, err = fut.result()
        if err:
            entry["error"] = err
        else:
            entry.update(res)
    result = {"sha256": digest, "model": model, "pages": pages}
    if dirty:
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w") as fh:
            json.dump(result, fh, indent=1)
    return result


# ---------------------------------------------------------------- box checks (model_scan_boxes.py)

def ink_masks(pix, dpi):
    """(ink, thick, green): ink is markedly darker than the page median; thick keeps pen-weight strokes
    (~2.5-5 pt vs ~1-1.5 pt print) via distance transform; green flags highlighter."""
    import cv2
    import numpy as np
    img = (np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3]
           .astype(np.int16))
    r, g, b = img[:, :, 0], img[:, :, 1], img[:, :, 2]
    lum = 0.30 * r + 0.59 * g + 0.11 * b
    ink = lum < min(215.0, float(np.median(lum)) - 40.0)
    thick = cv2.distanceTransform(ink.astype(np.uint8), cv2.DIST_L2, 3) * 72.0 / dpi >= 0.9
    green = ink & (g > r + 10) & (g > b + 10)
    return ink, thick, green


def page_boxes(model_boxes, pix, dpi, min_stroke=MIN_STROKE_SHARE):
    """0-1000 model boxes → kept page-view rects (72 dpi), plus the dropped ones with a reason."""
    w, h = pix.width, pix.height
    pw, ph = w * 72.0 / dpi, h * 72.0 / dpi
    ink, thick, green = ink_masks(pix, dpi)
    kept, dropped = [], []
    for x0, y0, x1, y1 in model_boxes:
        x0, x1 = sorted((x0, x1))
        y0, y1 = sorted((y0, y1))
        r = pymupdf.Rect(x0 / 1000 * pw, y0 / 1000 * ph, x1 / 1000 * pw, y1 / 1000 * ph) & pymupdf.Rect(0, 0, pw, ph)
        px = (max(int(x0 / 1000 * w), 0), max(int(y0 / 1000 * h), 0), min(int(x1 / 1000 * w), w), min(int(y1 / 1000 * h), h))
        reason = None
        if r.is_empty or px[2] <= px[0] or px[3] <= px[1]:
            reason = "empty"
        elif r.width < MIN_BOX_PT or r.height < MIN_BOX_PT:
            reason = "tiny"
        elif r.get_area() > MAX_BOX_PAGE_FRAC * pw * ph:
            reason = "oversize"
        else:
            region = (slice(px[1], px[3]), slice(px[0], px[2]))
            n_ink = int(ink[region].sum())
            if float(thick[region].mean()) < min_stroke:
                reason = "no pen-weight ink"
            elif n_ink == 0 or int(green[region].sum()) / n_ink > GREEN_DROP_SHARE:
                reason = "green"
        (dropped if reason else kept).append(([round(v, 1) for v in r], reason) if reason else [round(v, 1) for v in r])
    return kept, dropped


GROW_DPI = 100
GROW_MAX = 1.5                # a box may grow by at most this share of its larger side on each edge


def grow(page, rects):
    """Stretch each box over the pen strokes it touches: model boxes are often tight or cover half a signature,
    and loops and tails that escape stay readable. Only pen-like ink spreads a box: coloured ink (blue or black
    ballpoint on a scan reads as tinted) or pen-weight strokes, so printed names, table rules and text lines that
    a signature crosses don't drag the box across the page."""
    import cv2
    import numpy as np
    if not rects:
        return rects
    pix = page.get_pixmap(dpi=GROW_DPI, colorspace=pymupdf.csRGB)
    ink, thick, _green = ink_masks(pix, GROW_DPI)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3].astype(np.int16)
    colored = ink & ((img.max(axis=2) - img.min(axis=2)) > 40)
    k = GROW_DPI / 72.0
    out = []
    for b in rects:
        r = pymupdf.Rect(b)
        x0, y0, x1, y1 = (max(0, int(r.x0 * k)), max(0, int(r.y0 * k)), int(r.x1 * k) + 1, int(r.y1 * k) + 1)
        box_ink = ink[y0:y1, x0:x1].sum()
        # blue / coloured signature: follow the colour; black one: follow pen-weight strokes only
        pen = colored if box_ink and colored[y0:y1, x0:x1].sum() > 0.3 * box_ink else thick
        m = cv2.dilate(pen.astype(np.uint8), np.ones((3, 3), np.uint8))
        n, labels, stats, _c = cv2.connectedComponentsWithStats(m, connectivity=8)
        lim = max(r.width, r.height) * GROW_MAX
        cap = pymupdf.Rect(r.x0 - lim, r.y0 - lim, r.x1 + lim, r.y1 + lim)
        grown = pymupdf.Rect(r)
        for lab in np.unique(labels[y0:y1, x0:x1]):
            if lab == 0:
                continue
            cx, cy, cw, ch, area = stats[lab]
            comp = pymupdf.Rect(cx / k, cy / k, (cx + cw) / k, (cy + ch) / k)
            if comp.width > 0.5 * pix.width / k or comp.height > 0.5 * pix.height / k:
                continue  # a page-sized blob: photo, frame or scan border
            if area > 0.45 * cw * ch and cw * ch > 400:
                continue  # a solid block (filled table header, logo, stamp pad), not a pen stroke
            grown |= comp & cap
        out.append([round(v, 1) for v in grown])
    return out


def bars(rects, page_rect, row_gap=ROW_GAP):
    """Enlarge by MARGIN, merge overlaps, fuse same-row neighbours into one bar."""
    rs = sorted(((pymupdf.Rect(b) + (-MARGIN, -MARGIN, MARGIN, MARGIN)) & page_rect for b in rects),
                key=lambda r: (r.y0, r.x0))
    out = []
    for r in rs:
        for i, m in enumerate(out):
            if r.intersects(m) or (r.y0 <= m.y1 and r.y1 >= m.y0 and min(abs(r.x0 - m.x1), abs(m.x0 - r.x1)) <= row_gap):
                out[i] = pymupdf.Rect(m) | r
                break
        else:
            out.append(pymupdf.Rect(r))
    return out


VERIFY_PROMPT = ("Does this image contain handwriting made with a pen: a signature, initials, or a handwritten "
                 "name, date or number? Printed or typed text, numbers in table cells, table lines, logos, rubber "
                 "stamps and highlighter do not count. Answer only YES or NO.")
VERIFY_DPI = 200
VERIFY_PAD = 12.0             # pt of context round the crop


def candidates(path, models):
    """{page: [{"rect": [..], "by": [models]}]}: every model's boxes that pass the ink checks, near-duplicates merged."""
    digest = sha256(path)
    dets = []
    for m in models:
        with open(os.path.join(CACHE, f"{m}.p{PROMPT_VERSION}", digest + ".json")) as fh:
            dets.append((m, {p["page"]: p for p in json.load(fh)["pages"]}))
    doc = pymupdf.open(path)
    out = {}
    for pno, page in enumerate(doc):
        raws = []
        for m, by_page in dets:
            e = by_page.get(pno + 1) or {}
            if e.get("error"):
                if m == models[0]:  # no answer from the primary model: hold the file back
                    raise RuntimeError(f"{m} page {pno + 1}: {e['error']}")
                raws.append((m, e, []))  # second model failed (e.g. 400 code 1210): primary's boxes, flagged
                continue
            raws.append((m, e, [] if e.get("skipped") else parse_boxes(e.get("raw"))))
        if not any(b for _m, _e, b in raws):
            continue
        pix = page.get_pixmap(dpi=DPI, colorspace=pymupdf.csRGB)
        cands = []
        for m, e, boxes in raws:
            for r in page_boxes(boxes or [], pix, DPI)[0]:
                r = pymupdf.Rect(r)
                for c in cands:
                    inter = (c["r"] & r).get_area()
                    if inter > 0.5 * min(c["r"].get_area(), r.get_area()):
                        c["r"] |= r
                        c["by"].append(m)
                        break
                else:
                    cands.append({"r": r, "by": [m]})
        if cands:
            out[pno + 1] = [{"rect": [round(v, 1) for v in c["r"]], "by": c["by"]} for c in cands]
    doc.close()
    return out


def sweep_file(path, pages, model, pool):
    """Ask `model` what handwriting is still visible outside the bars on the given (already redacted) pages."""
    digest = sha256(path)
    out = os.path.join(CACHE, f"sweep-{model}.p{PROMPT_VERSION}", digest + ".json")
    if os.path.exists(out):
        with open(out) as fh:
            cached = json.load(fh)
        if all(not e.get("error") and parse_boxes(e.get("raw")) is not None for e in cached["pages"]):
            return cached
    doc = pymupdf.open(path)
    pending = []
    for pg in pages:
        jpeg, pix = render(doc[pg - 1])
        entry = {"page": pg, "render": [pix.width, pix.height], "dpi": DPI}
        pending.append((entry, pool.submit(ask, model, jpeg, SWEEP_PROMPT)))
    doc.close()
    for entry, fut in pending:
        res, err = fut.result()
        entry.update(res or {"error": err})
    result = {"sha256": digest, "model": model, "pages": [e for e, _f in pending]}
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as fh:
        json.dump(result, fh, indent=1)
    return result


def sweep_cands(path, model):
    """Sweep boxes as apply_file candidates. No pen-weight check: what's left over is often a thin loop or tail."""
    out = os.path.join(CACHE, f"sweep-{model}.p{PROMPT_VERSION}", sha256(path) + ".json")
    if not os.path.exists(out):
        return {}
    with open(out) as fh:
        entries = json.load(fh)["pages"]
    doc = pymupdf.open(path)
    cands = {}
    for e in entries:
        boxes = parse_boxes(e.get("raw"))
        if not boxes:
            continue
        pix = doc[e["page"] - 1].get_pixmap(dpi=DPI, colorspace=pymupdf.csRGB)
        kept = page_boxes(boxes, pix, DPI, min_stroke=0)[0]
        if kept:
            cands[e["page"]] = [{"rect": r, "by": ["sweep"]} for r in kept]
    doc.close()
    return cands


def unreadable_pages(path, models):
    """Pages where a model's reply stayed unreadable or failed after retries: the other model's boxes still apply,
    but a person should look."""
    digest, out = sha256(path), set()
    for m in models:
        with open(os.path.join(CACHE, f"{m}.p{PROMPT_VERSION}", digest + ".json")) as fh:
            for e in json.load(fh)["pages"]:
                if not e.get("skipped") and (e.get("error") or parse_boxes(e.get("raw")) is None):
                    out.add(e["page"])
    return sorted(out)


def verify_file(path, models, verifier):
    """Ask `verifier` about each candidate crop; cached by page + rect."""
    digest = sha256(path)
    out = os.path.join(CACHE, f"verify-{verifier}.p{PROMPT_VERSION}", digest + ".json")
    cache = {}
    if os.path.exists(out):
        with open(out) as fh:
            cache = json.load(fh)
    cands = candidates(path, models)
    doc = pymupdf.open(path)
    dirty = False
    from PIL import Image
    for pg, cs in cands.items():
        page, full = doc[pg - 1], None
        for c in cs:
            key = f"{pg}:{','.join(str(v) for v in c['rect'])}"
            if key in cache and cache[key].get("answer") in ("YES", "NO"):
                c["verdict"] = cache[key]["answer"]
                continue
            if full is None:  # the rendered view, so rotated pages crop where the model looked
                pix = page.get_pixmap(dpi=VERIFY_DPI, colorspace=pymupdf.csRGB)
                full = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            k = VERIFY_DPI / 72.0
            x0, y0, x1, y1 = c["rect"]
            crop = full.crop((max(0, int((x0 - VERIFY_PAD) * k)), max(0, int((y0 - VERIFY_PAD) * k)),
                              min(full.width, int((x1 + VERIFY_PAD) * k)), min(full.height, int((y1 + VERIFY_PAD) * k))))
            buf = io.BytesIO()
            crop.save(buf, format="JPEG", quality=90)
            res, err = call_glm(verifier, buf.getvalue(), VERIFY_PROMPT, max_tokens=20)
            ans = "ERROR" if err else ("YES" if re.search(r"\byes\b", res["raw"], re.I) else
                                       "NO" if re.search(r"\bno\b", res["raw"], re.I) else "UNCLEAR")
            cache[key] = {"answer": ans, "raw": (res or {}).get("raw", err), "usage": (res or {}).get("usage")}
            c["verdict"] = ans
            dirty = True
    doc.close()
    if dirty:
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w") as fh:
            json.dump(cache, fh, indent=1)
    return cands


# ---------------------------------------------------------------- pasted signature images (strip_signatures.py)

def image_stats(doc, xref):
    try:
        pix = pymupdf.Pixmap(doc, xref)
    except Exception:  # noqa: BLE001
        return None
    if pix.colorspace and pix.colorspace.n > 3:
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    while pix.width > 150 and pix.height > 150:
        pix.shrink(1)
    mask = None
    m = re.search(rb"/SMask\s+(\d+)\s+0\s+R", doc.xref_object(xref, compressed=True).encode())
    if m:
        try:
            mask = pymupdf.Pixmap(doc, int(m.group(1)))
            while mask.width > 150 and mask.height > 150:
                mask.shrink(1)
        except Exception:  # noqa: BLE001
            mask = None
    w, h, n, smp = pix.width, pix.height, pix.n, pix.samples
    white = ink = colored = total = 0
    hue_bins = [0] * 6
    for y in range(h):
        for x in range(w):
            i = (y * w + x) * n
            r, g, b = (smp[i], smp[i + 1], smp[i + 2]) if n >= 3 else (smp[i],) * 3
            if mask and x < mask.width and y < mask.height and mask.samples[(y * mask.width + x) * mask.n] < 128:
                r = g = b = 255
            total += 1
            lum = 0.3 * r + 0.59 * g + 0.11 * b
            if lum > 225:
                white += 1
            elif max(r, g, b) - min(r, g, b) > 45:
                ink += 1
                colored += 1
                hue_bins[int(colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)[0] * 6) % 6] += 1
            elif lum < 110:
                ink += 1
    if not total:
        return None
    return white / total, ink / total, colored / total, (max(hue_bins) / colored) if colored else 0.0


def is_signature_image(doc, xref, rect, page_area):
    if not (MIN_PT <= rect.width <= MAX_PT and MIN_PT <= rect.height <= MAX_PT):
        return False
    if rect.get_area() > MAX_PAGE_FRAC * page_area:
        return False
    st = image_stats(doc, xref)
    if st is None:
        return False
    white, ink, colored, dom_hue = st
    return white >= MIN_WHITE and INK_RANGE[0] <= ink <= INK_RANGE[1] and (colored <= 0.03 or dom_hue >= HUE_MONO)


KEEP_ANNOTS = {"/Link", "/Highlight", "/Underline", "/StrikeOut", "/Squiggly", "/Popup"}


def has_image(xobj, depth=0):
    """Whether an appearance stream draws an image (directly or through nested forms)."""
    try:
        xs = xobj.get("/Resources", {}).get("/XObject", {})
        for k in list(xs.keys()):
            x = xs[k]
            if x.get("/Subtype") == "/Image" or (x.get("/Subtype") == "/Form" and depth < 3 and has_image(x, depth + 1)):
                return True
    except Exception:  # noqa: BLE001 - odd appearance dicts are skipped
        return False
    return False


def remove_annots(path, hits):
    """Drop signature-bearing annotations with pikepdf (PyMuPDF deletion corrupts surviving FreeText appearances):
      Ink (not green highlighter, not white masks), Stamp, signature fields, any annotation whose appearance draws
      an image (signatures pasted as Square or FreeText "image stamps" sit above the page, over the bars), and any
      non-markup annotation that `hits` says overlaps a redaction box.
    hits: {page index: set of annotation object numbers}."""
    import pikepdf
    removed = 0
    with pikepdf.open(path, allow_overwriting_input=True) as pdf:
        for pno, page in enumerate(pdf.pages):
            annots = page.get("/Annots", None)
            if annots is None:
                continue
            keep = pikepdf.Array()
            for a in annots:
                st = str(a.get("/Subtype", ""))
                drop = False
                if st == "/Ink":
                    c = a.get("/C", None)
                    r, g, b = (float(c[i]) for i in range(3)) if c is not None and len(c) == 3 else (0.0, 0.0, 0.0)
                    drop = not ((g > r + 0.10 and g > b + 0.10) or min(r, g, b) > 0.85)
                elif st == "/Stamp" or (st == "/Widget" and str(a.get("/FT", "")) == "/Sig"):
                    drop = True
                elif st not in KEEP_ANNOTS:
                    ap = a.get("/AP", None)
                    n = ap.get("/N", None) if ap is not None else None
                    drop = (n is not None and isinstance(n, pikepdf.Stream) and has_image(n)) or \
                        (a.is_indirect and a.objgen[0] in hits.get(pno, ()))
                if drop:
                    removed += 1
                else:
                    keep.append(a)
            if len(keep) != len(annots):
                page["/Annots"] = keep
        pdf.save(path)
    return removed


def annots_hit(path, boxes):
    """{page index: object numbers of annotations overlapping any redaction box} in the saved file."""
    hits = {}
    doc = pymupdf.open(path)
    for pno, rects in boxes.items():
        for annot in doc[pno].annots() or []:
            if any(annot.rect.intersects(r) for r in rects):
                hits.setdefault(pno, set()).add(annot.xref)
    doc.close()
    return hits


# ---------------------------------------------------------------- apply

def qa_pair(src_page, dst_page, out_path, kept_view, dropped_view):
    """before (kept boxes red, dropped orange) | after, side by side at 72 dpi."""
    from PIL import Image, ImageDraw
    a = src_page.get_pixmap(dpi=72, colorspace=pymupdf.csRGB)
    b = dst_page.get_pixmap(dpi=72, colorspace=pymupdf.csRGB)
    ia = Image.frombytes("RGB", (a.width, a.height), a.samples)
    ib = Image.frombytes("RGB", (b.width, b.height), b.samples)
    d = ImageDraw.Draw(ia)
    for r in dropped_view:
        d.rectangle(r, outline=(255, 150, 0), width=1)
    for r in kept_view:
        d.rectangle(r, outline=(255, 0, 0), width=2)
    sheet = Image.new("RGB", (ia.width + ib.width + 8, max(ia.height, ib.height)), (90, 90, 90))
    sheet.paste(ia, (0, 0))
    sheet.paste(ib, (ia.width + 8, 0))
    sheet.save(out_path)


FLAT_DPI = 200
FLAT_JPEG = 80


def image_based(page):
    """Scans and pasted page images: images cover >= 80% of the page, together. Scanners that save a page as a
    photo plus 1-bit text layers (MRC) split it over many images, so coverage is summed on a coarse grid."""
    import numpy as np
    pr = page.rect * page.derotation_matrix if page.rotation else page.rect
    grid = np.zeros((60, 60), bool)
    for info in page.get_image_info():
        r = pymupdf.Rect(info["bbox"]) & page.cropbox
        if r.is_empty:
            continue
        gx0, gx1 = (int((v - page.cropbox.x0) / page.cropbox.width * 60) for v in (r.x0, r.x1))
        gy0, gy1 = (int((v - page.cropbox.y0) / page.cropbox.height * 60) for v in (r.y0, r.y1))
        grid[max(gy0, 0):min(gy1 + 1, 60), max(gx0, 0):min(gx1 + 1, 60)] = True
    return pr.get_area() > 0 and grid.mean() >= 0.80


def flatten(page, marks, style):
    """The page as one JPEG with the bars painted in: nothing under a bar survives in any layer (scan, MRC text
    masks, OCR text, annotations). Rendered without annotations; signature annotations go with them."""
    from PIL import Image, ImageDraw
    pix = page.get_pixmap(dpi=FLAT_DPI, colorspace=pymupdf.csRGB, annots=False)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    d = ImageDraw.Draw(img)
    k = FLAT_DPI / 72.0
    for r in marks:
        box = [r[0] * k, r[1] * k, r[2] * k, r[3] * k]
        if style == "black":
            d.rectangle(box, fill=(0, 0, 0))
        else:
            d.rectangle(box, fill=(255, 255, 255), outline=(150, 150, 150))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=FLAT_JPEG)
    return buf.getvalue(), page.rect.width, page.rect.height


def apply_file(src, dst, cands, qa_dir, rel, style="black", primary="glm-5v-turbo"):
    """cands from verify_file(). A box is blanked when the primary model found it, both models found it, or the
    verifier didn't say NO. The verifier is no veto on its own: it says NO to a real signature cropped tight over a
    printed name, so it only screens the second model's extra boxes (mostly bold figures and printed names).

    Scan pages (image_based) that get a box are flattened to one image with the bars painted in. Typed pages keep
    their objects: pasted signature images are removed, pixels and pen strokes under each box are wiped.
    style black: solid black bars, and on typed pages the text under a bar is deleted too (no copyable names)
    style white: whited out with a thin grey frame, printed text on typed pages left visible
    """
    fill = FILL if style == "black" else False
    stats = {"pages": 0, "sig_images": 0, "boxes": 0, "verifier_no": 0, "annots": 0, "pages_changed": 0,
             "flattened": 0}
    doc = pymupdf.open(src)
    if doc.needs_pass:
        raise RuntimeError("password-protected")
    plan, boxes_unrot, flat = {}, {}, {}
    for pno, page in enumerate(doc):
        stats["pages"] += 1
        marks, objs = [], []
        cs = cands.get(pno + 1, [])
        # 1. pasted signature images: the whole image object goes. Letterheads put small one-colour logos in the
        # top band (the trial lost a blue DEPDev seal), so up there an image goes only when a model boxed it too.
        seen = set()
        top = page.cropbox.y0 + HEADER_BAND * page.cropbox.height
        boxed = [(pymupdf.Rect(c["rect"]) * page.derotation_matrix).normalize() for c in cs]
        for info in page.get_image_info(xrefs=True):
            xref, rect = info.get("xref"), pymupdf.Rect(info["bbox"])
            if rect.y1 <= top and not any(rect.intersects(b) for b in boxed):
                continue
            if xref and xref not in seen and is_signature_image(doc, xref, rect, page.rect.get_area()):
                seen.add(xref)
                objs.append(rect)
                marks.append(rect * page.rotation_matrix)
                stats["sig_images"] += 1
        # 2. model boxes the verifier didn't reject
        keep = [primary in c["by"] or len(set(c["by"])) > 1 or c.get("verdict") != "NO" for c in cs]
        kept = grow(page, [c["rect"] for c, k in zip(cs, keep) if k])
        rejected = [c["rect"] for c, k in zip(cs, keep) if not k]
        stats["verifier_no"] += len(rejected)
        for r in bars(kept, page.rect, ROW_GAP if style == "black" else -1):
            objs.append((r * page.derotation_matrix).normalize())
            marks.append(r)
            stats["boxes"] += 1
        if marks:
            stats["pages_changed"] += 1
            if image_based(page):
                flat[pno] = flatten(page, marks, style)
                stats["flattened"] += 1
            else:
                for r in objs:
                    page.add_redact_annot(r, fill=fill)
                boxes_unrot[pno] = objs
                page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_PIXELS,
                                      graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED,
                                      text=pymupdf.PDF_REDACT_TEXT_REMOVE if style == "black"
                                      else pymupdf.PDF_REDACT_TEXT_NONE)
                if style == "white":
                    shape = page.new_shape()
                    for r in marks:
                        shape.draw_rect((pymupdf.Rect(r) * page.derotation_matrix).normalize())
                    shape.finish(color=(0.6, 0.6, 0.6), width=0.6, dashes="[2 2] 0")
                    shape.commit()
        if marks or rejected:
            plan[pno] = (kept, rejected)
        if marks:
            stats.setdefault("_changed", []).append(pno + 1)
    if flat:
        # a fresh page list: deleting and re-inserting pages in place left a loop in some files' /Pages tree
        # (Cebu 7th DEO PDCs), which pikepdf then refuses to read
        out = pymupdf.open()
        for pno in range(doc.page_count):
            if pno in flat:
                jpeg, w, h = flat[pno]
                out.new_page(width=w, height=h).insert_image(pymupdf.Rect(0, 0, w, h), stream=jpeg)
            else:
                out.insert_pdf(doc, from_page=pno, to_page=pno)
        doc.close()
        doc = out
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    n_pages = doc.page_count
    # garbage=2 drops unreferenced objects (removed signature images are gone from the file) without garbage=3+'s
    # duplicate-object merging, which looped the /Pages tree of some Cebu 7th DEO files
    doc.save(dst, garbage=2, deflate=True, clean=True)
    doc.close()
    try:
        stats["annots"] = remove_annots(dst, annots_hit(dst, boxes_unrot))
        import pikepdf
        with pikepdf.open(dst) as check, pymupdf.open(dst) as check2:
            if len(check.pages) != n_pages or check2.page_count != n_pages:
                raise RuntimeError(f"output has {len(check.pages)}/{check2.page_count} pages, source {n_pages}")
    except Exception:
        os.remove(dst)  # never leave a file whose annotations weren't stripped or that doesn't read back whole
        raise
    if plan and qa_dir:
        os.makedirs(qa_dir, exist_ok=True)
        s, d = pymupdf.open(src), pymupdf.open(dst)
        for pno, (kept, rejected) in plan.items():
            name = re.sub(r"[^\w.-]+", "_", rel)[-120:] + f"__p{pno + 1}.png"
            qa_pair(s[pno], d[pno], os.path.join(qa_dir, name), kept, rejected)
        s.close()
        d.close()
    return stats


def apply_one(job):
    """One file in a worker process: (rel, stats, error, unreadable pages)."""
    p, src, dst, models, verifier, qa_dir, style, sweep = job
    rel = os.path.relpath(p, src)
    try:
        if sweep:
            cands = sweep_cands(p, sweep)
            if not cands:
                import shutil
                os.makedirs(os.path.dirname(os.path.join(dst, rel)), exist_ok=True)
                shutil.copy2(p, os.path.join(dst, rel))
                return rel, {"pages": 0, "sig_images": 0, "boxes": 0, "verifier_no": 0, "annots": 0,
                             "pages_changed": 0, "flattened": 0}, None, []
            return rel, apply_file(p, os.path.join(dst, rel), cands, qa_dir, rel, style, "sweep"), None, []
        st = apply_file(p, os.path.join(dst, rel), verify_file(p, models, verifier), qa_dir, rel, style, models[0])
    except Exception as e:  # noqa: BLE001
        return rel, None, str(e), []
    return rel, st, None, unreadable_pages(p, models)


def opt(args, name, default):
    return args[args.index(name) + 1] if name in args else default


def main():
    args = sys.argv[1:]
    if not args or args[0] not in ("detect", "verify", "apply", "sweep"):
        sys.exit(__doc__)
    models = opt(args, "--models", "glm-5v-turbo,glm-4.6v").split(",")
    verifier = opt(args, "--verifier", "glm-5v-turbo")
    # --concurrency 10, or per model: glm-5v-turbo=10,glm-4.6v=10 (Z.ai: 4.6v refuses an 11th call with 429;
    # 5v-turbo is no faster past ~10, and 20 alongside 4.6v's 10 drew 2,347 429s in Region II on 2026-11-13)
    cspec = opt(args, "--concurrency", "glm-5v-turbo=10,glm-4.6v=10")
    limits = {k: int(v) for k, v in (x.split("=") for x in cspec.split(",") if "=" in x)}
    conc = int(cspec) if cspec.isdigit() else max(limits.values())
    dpi = int(opt(args, "--dpi", str(DPI)))
    all_pages = "--all-pages" in args
    src = args[1]
    files = pdfs_under(src)
    t0 = time.time()
    if args[0] in ("detect", "verify", "sweep") and not os.environ.get("GLM_API_KEY"):
        sys.exit("GLM_API_KEY missing: set -a; source ~/.bettergovph/.env; set +a")
    if args[0] == "detect":
        def run(model):
            pool = ThreadPoolExecutor(limits.get(model, conc))
            done = [0]

            def one(p):
                r = detect_file(p, model, dpi, all_pages, pool)
                done[0] += 1
                if done[0] % 25 == 0:
                    print(f"  {model}: {done[0]}/{len(files)} files ({time.time() - t0:.0f}s)", flush=True)
                return r
            # more file workers than calls, so rendering never starves the model's pool
            results = list(ThreadPoolExecutor(2 * limits.get(model, conc) + 2).map(one, files))
            pages = [p for r in results for p in r["pages"]]
            tin = sum((p.get("usage") or {}).get("prompt_tokens", 0) for p in pages)
            tout = sum((p.get("usage") or {}).get("completion_tokens", 0) for p in pages)
            unread = sum(1 for p in pages if not p.get("error") and not p.get("skipped")
                         and parse_boxes(p.get("raw")) is None)
            asked = sum(1 for p in pages if "secs" in p)
            print(f"{model}: {len(files)} files, {len(pages)} pages ({sum(1 for p in pages if p.get('skipped'))} "
                  f"skipped: no images), {sum(1 for p in pages if p.get('error'))} errors, "
                  f"{unread} unreadable, {sum(1 for p in pages if parse_boxes(p.get('raw')))} pages with boxes | "
                  f"tokens {tin:,} in / {tout:,} out | wall {time.time() - t0:.0f}s", flush=True)
        list(ThreadPoolExecutor(len(models)).map(run, models))
        print(f"HTTP retries: {HTTP_RETRIES or 'none'} | wall {time.time() - t0:.0f}s")
    elif args[0] == "sweep":
        model = opt(args, "--model", "glm-5v-turbo")
        with open(os.path.join(src, "_changed.json")) as fh:
            changed = json.load(fh)
        pool = ThreadPoolExecutor(limits.get(model, conc))
        jobs = [(os.path.join(src, rel), pages) for rel, pages in changed.items()]
        res = list(ThreadPoolExecutor(2 * limits.get(model, conc) + 2).map(
            lambda j: sweep_file(j[0], j[1], model, pool), jobs))
        pages = [e for r in res for e in r["pages"]]
        print(f"sweep {model}: {len(pages)} redacted pages looked at, "
              f"{sum(1 for e in pages if parse_boxes(e.get('raw')))} with handwriting left, "
              f"{sum(1 for e in pages if e.get('error'))} errors | wall {time.time() - t0:.0f}s")
    elif args[0] == "verify":
        res = list(ThreadPoolExecutor(conc).map(lambda p: verify_file(p, models, verifier), files))
        from collections import Counter
        c = Counter((tuple(sorted(x["by"])), x.get("verdict")) for r in res for cs in r.values() for x in cs)
        for k, v in sorted(c.items()):
            print(v, *k)
        print(f"wall {time.time() - t0:.0f}s")
    else:
        dst = args[2]
        style = opt(args, "--style", "black")
        qa_dir = os.path.join(dst, "_qa")
        agg, review, changed = {}, [], {}
        from concurrent.futures import ProcessPoolExecutor
        sweep = opt(args, "--sweep", None)  # second pass: SRC is a redacted folder, bars from `sweep` replies
        work = [(p, src, dst, models, verifier, qa_dir, style, sweep) for p in files]
        with ProcessPoolExecutor(max(1, (os.cpu_count() or 2) - 2)) as ex:
            for rel, st, err, unread in ex.map(apply_one, work, chunksize=4):
                if err:
                    print(f"ERROR {rel}: {err}")
                    continue
                changed[rel] = st.pop("_changed", [])
                for k, v in st.items():
                    agg[k] = agg.get(k, 0) + v
                if unread:
                    review.append({"path": rel, "pages": unread, "why": "model reply unreadable"})
                print(f"{'CHANGED' if st['pages_changed'] or st['annots'] else 'clean  '} {rel[:100]}  "
                      f"img={st['sig_images']} boxes={st['boxes']} flat={st['flattened']} "
                      f"verifier_no={st['verifier_no']} annots={st['annots']}", flush=True)
        with open(os.path.join(dst, "_review.json"), "w") as fh:
            json.dump(review, fh, indent=1)
        with open(os.path.join(dst, "_changed.json"), "w") as fh:
            json.dump({k: v for k, v in changed.items() if v}, fh, indent=1)
        print(agg, f"| {sum(len(r['pages']) for r in review)} pages to look at by hand (_review.json) "
                   f"| wall {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
