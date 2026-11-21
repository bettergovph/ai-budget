"""Every page link in the project lists, checked: the PDF page it opens prints the project (Jason, 2026-11-21: "we need
to display their page numbers in the lists, we need to make it trustworthy").

A page prints a project when most of the project's distinctive words (4+ letters, not "construction", "road", ...) are
on it, or on the page before or after (a row can break across pages). Spaces are ignored, as some PDFs set names with
spaces inside words ("Cam arines Nort e"), and a word may be misread by the NEP's OCR ("Juanita" for "Juanito",
"Osmefia" for "Osmeña"): when the exact words fall short, a word counts if the page has it within one or two letters.
The Senate page is checked against the Senate's name and the House's
(HFEP prints a facility's own spelling); the House and NEP pages against the House bill's name.
"""
import re

import pymupdf
from rapidfuzz import fuzz

STOP = set("construction concreting improvement rehabilitation repair establishment provision of the and to brgy barangay "
           "fmr with for in at sitio purok phase road roads project projects system irrigation unit units including".split())


class Pages:
    def __init__(self):
        self.docs, self.text = {}, {}

    def get(self, path, pg):
        k = (path, pg)
        if k not in self.text:
            d = self.docs.get(path) or self.docs.setdefault(path, pymupdf.open(path))
            self.text[k] = re.sub(r"[^a-z0-9]", "", fold(d[pg - 1].get_text())) if 0 < pg <= len(d) else ""
        return self.text[k]


def fold(t):
    """Lower case, "ñ" as "n" (one document prints "Osmeña", another "Osmena")."""
    return (t if isinstance(t, str) else "").lower().replace("ñ", "n")


def words(t):
    return list(dict.fromkeys(w for w in re.findall(r"[a-z]{4,}", fold(t)) if w not in STOP))[:8]


def prints(pages, path, pg, *names):
    """True if page `pg` (or the one before or after) prints one of `names`; None if no name has words to look for."""
    seen = False
    text = pages.get(path, pg) + pages.get(path, pg - 1) + pages.get(path, pg + 1)
    for name in names:
        ws = words(name)
        if not ws:
            continue
        seen = True
        if sum(w in text for w in ws) / len(ws) >= 0.6:
            return True
        # OCR misreadings: the closest stretch of the page's text, at least 75 similar.
        if sum(w in text or fuzz.partial_ratio(w, text, score_cutoff=75) > 0 for w in ws) / len(ws) >= 0.6:
            return True
    return False if seen else None
