#!/usr/bin/env python3
"""Before | after gallery for one redacted region, for checking in a browser (Tailscale only: it shows originals).

  build_gallery.py REGION_DIR      REGION_DIR/{src,pass1,redacted} → REGION_DIR/gallery/*.jpg + index.html
  build_gallery.py --index ROOT    ROOT/index.html listing every region's gallery and numbers
"""
import html
import json
import os
import re
import sys
import urllib.parse

import pymupdf
from PIL import Image


def pair(src_page, dst_page, out):
    ims = []
    for p in (src_page, dst_page):
        pix = p.get_pixmap(dpi=80, colorspace=pymupdf.csRGB)
        ims.append(Image.frombytes("RGB", (pix.width, pix.height), pix.samples))
    w, h = sum(i.width for i in ims) + 10, max(i.height for i in ims)
    sheet = Image.new("RGB", (w, h), (90, 90, 90))
    sheet.paste(ims[0], (0, 0))
    sheet.paste(ims[1], (ims[0].width + 10, 0))
    sheet.save(out, quality=78)


def region(rdir):
    changed = {}
    for stage in ("pass1", "redacted"):
        f = os.path.join(rdir, stage, "_changed.json")
        if os.path.exists(f):
            for rel, pages in json.load(open(f)).items():
                changed.setdefault(rel, set()).update(pages)
    review = []
    f = os.path.join(rdir, "pass1", "_review.json")
    if os.path.exists(f):
        review = json.load(open(f))
    flagged = {(r["path"], p) for r in review for p in r["pages"]}
    for rel, p in flagged:
        changed.setdefault(rel, set()).add(p)
    gdir = os.path.join(rdir, "gallery")
    os.makedirs(gdir, exist_ok=True)
    rows = []
    for rel in sorted(changed):
        s, d = pymupdf.open(os.path.join(rdir, "src", rel)), pymupdf.open(os.path.join(rdir, "redacted", rel))
        for pg in sorted(changed[rel]):
            name = re.sub(r"[^\w.-]+", "_", rel)[-110:] + f"__p{pg}.jpg"
            if not os.path.exists(os.path.join(gdir, name)):
                pair(s[pg - 1], d[pg - 1], os.path.join(gdir, name))
            rows.append((rel, pg, name, (rel, pg) in flagged))
        s.close()
        d.close()
    manifest = json.load(open(os.path.join(rdir, "manifest.json")))
    title = manifest["region"]
    parts = [f"<!doctype html><meta charset=utf-8><title>{html.escape(title)} redaction check</title>",
             "<style>body{font:14px system-ui;margin:16px;background:#f4f4f4}figure{margin:0 0 28px}"
             "img{max-width:100%;border:1px solid #bbb;background:#fff}figcaption{margin:4px 0}"
             ".flag{background:#ffe08a;padding:1px 6px}a{color:#0645ad}</style>",
             f"<h1>{html.escape(title)}: before | after</h1>",
             f"<p>{manifest['kept']} PDFs ({manifest['kept_pages']} pages) redacted; {len(rows)} pages changed or "
             f"flagged, shown below (left: original, right: redacted). {sum(1 for r in rows if r[3])} pages "
             f"<span class=flag>flagged</span> for a person to check. <a href='../index.html'>All regions</a></p>"]
    for rel, pg, name, flag in rows:
        pdf = "redacted/" + "/".join(urllib.parse.quote(x) for x in rel.split("/"))
        parts.append(f"<figure><figcaption>{'<span class=flag>check</span> ' if flag else ''}"
                     f"<a href='{pdf}#page={pg}'>{html.escape(rel)}</a> p{pg}</figcaption>"
                     f"<img loading=lazy src='gallery/{html.escape(name)}'></figure>")
    with open(os.path.join(rdir, "index.html"), "w") as fh:
        fh.write("\n".join(parts))
    return len(rows)


def index(root):
    rows = []
    for d in sorted(os.listdir(root)):
        m = os.path.join(root, d, "manifest.json")
        st = os.path.join(root, d, "stats.json")
        if os.path.exists(m) and os.path.exists(os.path.join(root, d, "index.html")):
            mf, s = json.load(open(m)), (json.load(open(st)) if os.path.exists(st) else {})
            rows.append(f"<tr><td><a href='{d}/index.html'>{html.escape(mf['region'])}</a></td><td>{mf['kept']}</td>"
                        f"<td>{mf['kept_pages']}</td><td>{s.get('pages_changed', '')}</td><td>{s.get('sweep_pages', '')}</td>"
                        f"<td>{s.get('review', '')}</td><td>{s.get('finished', '')}</td></tr>")
    with open(os.path.join(root, "index.html"), "w") as fh:
        fh.write("<!doctype html><meta charset=utf-8><title>Senate copies: signature redaction</title>"
                 "<style>body{font:14px system-ui;margin:16px}td,th{padding:4px 10px;border-bottom:1px solid #ddd}"
                 "</style><h1>Senate copies: signature redaction (PDFs of 19 pages or fewer)</h1>"
                 "<p>Private check pages (Tailscale only). Nothing here is uploaded.</p><table><tr><th>Region</th>"
                 "<th>PDFs</th><th>Pages</th><th>Pages barred</th><th>Sweep fixes</th><th>To check</th><th>Finished</th></tr>"
                 + "".join(rows) + "</table>")


if __name__ == "__main__":
    if sys.argv[1] == "--index":
        index(sys.argv[2])
    else:
        print(region(sys.argv[1]), "pages in gallery")
