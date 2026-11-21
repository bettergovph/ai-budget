"""Join Annex A-1 (FMR) or A-3 (NIA) project rows to our House bill projects, and link replacements.

Matching a Senate row that has a House amount to our House row (one-to-one, by region when we know it):
  exact   same name (letters and digits only) and same House amount
  fuzzy   name >= 90 similar and same House amount
  prefix  one name starts with the other and same House amount
Senate rows with no House amount are insertions (match "new").

The Senate often revises a House project by cutting it to zero and inserting a new row (new coordinates,
corrected barangay, a new name). Such an insertion is linked to the cut row it replaces ("replaces_row")
when, in the same region, the cut row is the nearest one before it (within 40 rows) that names the same
municipality and whose site words (the places and features before the municipality; not the generic
"Construction of Brgy ... FMR") are >= 80 similar. Different barangays in one town are not linked. A looser rule (adjacent rows, same amount) linked roads in different provinces, so it is not used.

Usage: map_projects.py fmr|nia <annex json> <projects.parquet> <out.csv>
"""
import csv
import json
import re
import sys
from collections import defaultdict

import duckdb
from rapidfuzz import fuzz


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


GENERIC = re.compile(r"\b(construction|concreting|rehabilitation|improvement|repair|of|the|and|to|from|in|at|along|"
                     r"fmr|farm|market|road|roads|brgy|barangay|barangays|sitio|purok|phase|ris|cis|nis|irrigation|"
                     r"system|systems)\b\.?", re.I)


def distinct(s):
    """The words that tell two project names apart: places and features, not the generic work words."""
    return re.sub(r"\s+", " ", GENERIC.sub(" ", re.sub(r"[^\w\s]", " ", s or ""))).strip().lower()


def site(s):
    """The distinctive words of the part before the municipality and province (the last two comma parts)."""
    parts = [p for p in (s or "").split(",") if p.strip()]
    return distinct(",".join(parts[:-2]) if len(parts) >= 3 else s)


def same_place(a, b):
    """The municipality (the next-to-last comma part) of one name appears in the other."""
    for x, y in ((a, b), (b, a)):
        parts = [p.strip() for p in (x or "").split(",") if p.strip()]
        if len(parts) >= 3 and norm(parts[-2]) and norm(parts[-2]) in norm(y):
            return True
    return False


def main(kind, annex, parquet, out):
    rows = json.load(open(annex))
    sen = []
    for r in rows:
        if r["kind"] == "project":
            r["region"] = next((p for p in reversed(r["path"]) if re.match(
                r"^(REGION|CORDILLERA|NATIONAL CAPITAL|BANGSAMORO|NEGROS ISLAND|MARIIS|UPRIIS)", p.upper())), "")
            r["province"] = r["path"][-1] if kind == "nia" and r["path"] else ""
            sen.append(r)
    con = duckdb.connect()
    hb = [dict(zip(("id", "title", "region", "pap", "php"), h)) for h in con.execute(
        f"select id, title, region, pap, hgab3_php from '{parquet}' where hgab3_php is not null").fetchall()]
    by_key, by_amt = defaultdict(list), defaultdict(list)
    for h in hb:
        h["_n"] = norm(h["title"])
        by_key[(h["_n"], h["php"])].append(h)
        by_amt[h["php"]].append(h)
    used, match = set(), {}

    def take(i, cands, how):
        cands = [h for h in cands if h["id"] not in used]
        if not cands:
            return
        reg = norm(sen[i]["region"])[:8]
        cands.sort(key=lambda h: norm(h["region"])[:8] != reg)
        used.add(cands[0]["id"]); match[i] = (cands[0], how)

    for i, r in enumerate(sen):
        if r["gab"]:
            take(i, by_key.get((norm(r["hb_title"]), r["gab"]), []), "exact")
    for i, r in enumerate(sen):
        if r["gab"] and i not in match:
            sc = [(fuzz.token_sort_ratio(r["hb_title"], h["title"]), h) for h in by_amt.get(r["gab"], []) if h["id"] not in used]
            sc = [h for s, h in sorted(sc, key=lambda t: -t[0]) if s >= 90]
            take(i, sc[:1], "fuzzy")
    for i, r in enumerate(sen):
        if r["gab"] and i not in match and len(norm(r["hb_title"])) >= 25:
            a = norm(r["hb_title"])
            c = [h for h in by_amt.get(r["gab"], []) if h["_n"].startswith(a) or a.startswith(h["_n"])]
            take(i, c, "prefix")

    # Insertions that replace a cut row.
    replaces = {}
    taken = set()
    for i, r in enumerate(sen):
        if r["gab"]:
            continue
        name = r["senate_title"] or r["hb_title"]
        best = None
        for j in range(i - 1, max(-1, i - 40), -1):
            c = sen[j]
            if c["region"] != r["region"]:
                break
            if not c["gab"] or c["sv"] or j in taken:
                continue
            old = c["senate_title"] or c["hb_title"]
            sim = fuzz.token_set_ratio(site(name), site(old))
            if sim >= 80 and same_place(name, old):
                best = (j, sim)
                break
        if best:
            taken.add(best[0])
            replaces[i] = best

    out_rows = []
    stats = defaultdict(int)
    for i, r in enumerate(sen):
        h, how = match.get(i, (None, "new" if not r["gab"] else "unmatched"))
        stats[how] += 1
        rep = replaces.get(i)
        st = r["senate_title"] or r["hb_title"]
        out_rows.append({
            "row": i, "senate_pdf_page": r["pdf_page"], "region": r["region"], "province": r["province"],
            "path": " > ".join(r["path"]),
            "hb_title": r["hb_title"], "senate_title": st,
            "renamed": int(bool(r["hb_title"]) and bool(r["senate_title"]) and norm(r["senate_title"]) != norm(r["hb_title"])),
            "hb_coords": " ".join(r["hb_coords"]), "senate_coords": " ".join(r["senate_coords"]),
            "hb_php": r["gab"] or 0, "increase_php": r["inc"] or 0, "decrease_php": r["dec"] or 0,
            "net_php": r["net"] or 0, "senate_php": r["sv"] or 0,
            "match": how, "hgab_id": h["id"] if h else "", "hgab_title": h["title"] if h else "",
            "replaces_row": rep[0] if rep else "", "replaces_similarity": round(rep[1]) if rep else "",
            "replaces_hgab_id": (match.get(rep[0], (None,))[0] or {}).get("id", "") if rep else "",
            "replaces_hb_title": sen[rep[0]]["hb_title"] if rep else "",
        })
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out_rows[0]))
        w.writeheader()
        w.writerows(out_rows)
    print(dict(stats), f"of {len(sen)}; House rows used {len(used)} of {len(hb)}; insertions linked to a cut row: "
          f"{len(replaces)} of {sum(1 for r in sen if not r['gab'])}", file=sys.stderr)


if __name__ == "__main__":
    main(*sys.argv[1:5])
