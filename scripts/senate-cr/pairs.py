"""Telling a Senate insertion apart from a renamed House project, a restored NEP project or a possible duplicate.

The project annexes print a corrected House project as a removal plus an insertion, and an NEP project the House
dropped and the Senate puts back as an insertion (Jason, 2026-11-21: "Some FMRs, NIA, DOH are showing inserted
instead of renamed or have potential duplicates"). These helpers pair them, one to one:

  rename_pairs   Senate insertion <-> removed House project (FMR, NIA): the same project under a revised name
  restore_pairs  Senate insertion <-> NEP project the House bill doesn't have
  near           the closest House project to an insertion that stays one (a possible duplicate, or for HFEP the
                 same facility's other component)
"""
import re

from rapidfuzz import fuzz


def norm(s):
    """A project name for comparing: "Brgy. No. 56-A" = "Brgy 56-A", "Sto." = "Santo", coordinates and stations out."""
    s = (s or "").lower()
    s = re.sub(r"\b(brgy|barangay)\.?\s*(no\.?\s*)?", "brgy ", s)
    s = re.sub(r"\bsto\b\.?", "santo", s)
    s = re.sub(r"\bsta\b\.?(?!\s*[\d+])", "santa", s)
    s = re.sub(r"\d+\.\d{3,}", " ", s)  # coordinates
    s = re.sub(r"\bsta\.?\s*[\d+.\s-]+", " ", s)  # stations
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def place(s):
    """The last two comma-separated parts of an FMR name: municipality and province."""
    parts = [norm(p) for p in (s or "").split(",") if norm(p)]
    return tuple(parts[-2:]) if len(parts) >= 2 else None


def facility(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def score(a, b):
    return fuzz.token_sort_ratio(norm(a), norm(b))


def _greedy(cands):
    """One to one, best score first, a same-amount pair before another at the same score."""
    used_a, used_b, out = set(), set(), []
    for s, same, ia, ib in sorted(cands, key=lambda t: (-t[0], not t[1])):
        if ia in used_a or ib in used_b:
            continue
        used_a.add(ia)
        used_b.add(ib)
        out.append((ia, ib, s))
    return out


def rename_pairs(inserted, removed, region, title_a, title_b, amount_a, amount_b, linked=None):
    """Pairs (i, j, score) of indexes into `inserted` and `removed`: the annex's own link first (`linked(i)` = j),
    then the same region and a name >= 85 similar, or >= 75 with the same amount and the same municipality."""
    out, taken_a, taken_b = [], set(), set()
    if linked:
        for i, a in enumerate(inserted):
            j = linked(i)
            if j is not None and j not in taken_b:
                out.append((i, j, 100.0))
                taken_a.add(i)
                taken_b.add(j)
    cands = []
    for i, a in enumerate(inserted):
        if i in taken_a:
            continue
        for j, b in enumerate(removed):
            if j in taken_b or region(a) != region(b):
                continue
            s = score(title_a(a), title_b(b))
            same = amount_a(a) == amount_b(b)
            if s >= 85 or (s >= 75 and same and place(title_a(a)) and place(title_a(a)) == place(title_b(b))):
                cands.append((s, same, i, j))
    return out + _greedy(cands)


def restore_pairs(inserted, nep_only, hfep=False):
    """Pairs (i, j, score): a Senate insertion that is an NEP project the House dropped. Same region; a name >= 90
    similar, or >= 85 with the NEP amount; for HFEP the same facility and component."""
    cands = []
    for i, a in enumerate(inserted):
        for j, b in enumerate(nep_only):
            if a["region"] != b["region"]:
                continue
            if hfep:
                if facility(a["title"]) == facility(b["title"]) and a["pap"] == b["pap"]:
                    cands.append((100.0, a["senate_php"] == b["nep_php"], i, j))
                continue
            s = score(a["title"], b["title"])
            same = a["senate_php"] == b["nep_php"]
            if s >= 90 or (s >= 85 and same):
                cands.append((s, same, i, j))
    return _greedy(cands)


def near(a, pool, hfep=False):
    """The House project an insertion most resembles, if close: (row, score) or None. HFEP: the same facility."""
    best = None
    for b in pool:
        if a["region"] != b["region"]:
            continue
        if hfep:
            if facility(a["title"]) == facility(b["title"]) or facility(a["title"]) == facility(b.get("hb_title")):
                return b, 100.0
            continue
        s = max(score(a["title"], b["title"]), score(a["title"], b.get("hb_title") or ""))
        if s >= 90 and (best is None or s > best[1]):
            best = (b, s)
    return best
