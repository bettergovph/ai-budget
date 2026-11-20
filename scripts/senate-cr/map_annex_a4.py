"""Join Annex A-4 (Senate DPWH project changes) to our House bill DPWH projects.

Each Senate row prints the House bill project name and amount (column "FY 2027 GAB (HB 10858)") and,
when the Senate renames it, a "Revised Project Name". So the House-side name + amount identify the
House row; the revised name is what the project is called in the Senate version.

Usage: map_annex_a4.py <annex_a4.json> <dpwh projects.parquet> <out.csv>
Passes, each one-to-one (a House row is used once), ties broken by same office, then nearest page:
  exact        same name (letters and digits only) and same House amount
  fuzzy        name >= 90 similar, same House amount, same office
  prefix       one name starts with the other, same House amount (same office, or the only such row)
  amount_unique  a House amount of at least 100M that only one unused House row prints
  house_row_split  two printed House lines that our House data holds as one row (amounts added)
  amount_only  same House amount, same office, House page within the Senate's cited range, only one such row
  new          no House name and no House amount (a Senate insertion)
  unmatched    none of the above
"""
import csv
import json
import re
import sys
from collections import defaultdict

import duckdb
from rapidfuzz import fuzz

PAGE_OFFSET = 8  # Vol I-C printed page = PDF page - 8


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def office_key(s):
    s = (s or "").lower().replace("district engineering office", "deo").replace("engineering office", "eo")
    return re.sub(r"[^a-z0-9]", "", s)


def main(annex, parquet, out):
    rows = json.load(open(annex))
    # Fund summary rows under an office (not under a project) are totals of the per-project fund rows.
    # Fund rows (GOP / Loan Proceeds) are parts of a foreign-assisted project, or, under an office, the
    # totals of those parts: neither is a project of its own.
    sen = [r for r in rows if r["kind"] == "project"]
    con = duckdb.connect()
    hb = con.execute(f"""select id, title, office, region, program, pap, hgab3_php, hgab3_page, nep_php, house_match
                         from '{parquet}' where hgab3_php is not null""").fetchall()
    cols = ["id", "title", "office", "region", "program", "pap", "hgab3_php", "hgab3_page", "nep_php", "house_match"]
    hb = [dict(zip(cols, h)) for h in hb]
    by_key = defaultdict(list)
    by_amt = defaultdict(list)
    for h in hb:
        h["_n"] = norm(h["title"])
        h["_o"] = office_key(h["office"])
        by_key[(h["_n"], h["hgab3_php"])].append(h)
        by_amt[h["hgab3_php"]].append(h)
    used = set()
    match = {}

    def pick(r, cands):
        cands = [h for h in cands if h["id"] not in used]
        if not cands:
            return None
        o = office_key(r.get("office"))
        page = r["hb_page"] or 0
        cands.sort(key=lambda h: (h["_o"] != o, abs((h["hgab3_page"] - PAGE_OFFSET) - page)))
        return cands[0]

    # Pass 1: exact name + amount. Do the unambiguous ones first so ties do not steal each other's rows.
    order = sorted(range(len(sen)), key=lambda i: len(by_key.get((norm(sen[i]["hb_title"]), sen[i]["gab"]), [])))
    for i in order:
        r = sen[i]
        h = pick(r, by_key.get((norm(r["hb_title"]), r["gab"]), []))
        if h:
            used.add(h["id"]); match[i] = (h, "exact")
    # Pass 2: fuzzy name, same amount, same office.
    for i, r in enumerate(sen):
        if i in match or not r["gab"]:
            continue
        o = office_key(r.get("office"))
        cands = [h for h in by_amt.get(r["gab"], []) if h["id"] not in used and h["_o"] == o]
        scored = sorted(((fuzz.token_sort_ratio(r["hb_title"], h["title"]), h) for h in cands), key=lambda t: -t[0])
        if scored and scored[0][0] >= 90:
            h = scored[0][1]
            used.add(h["id"]); match[i] = (h, "fuzzy")
    # Pass 2b: one name starts with the other (our House titles sometimes carry the coordinates, or the next
    # printed line, on the end), same amount; same office preferred, else the only such row.
    for i, r in enumerate(sen):
        if i in match or not r["gab"] or len(norm(r["hb_title"])) < 25:
            continue
        a = norm(r["hb_title"])
        cands = [h for h in by_amt.get(r["gab"], []) if h["id"] not in used and (h["_n"].startswith(a) or a.startswith(h["_n"]))]
        o = office_key(r.get("office"))
        same = [h for h in cands if h["_o"] == o]
        h = same[0] if len(same) == 1 else (cands[0] if len(cands) == 1 else None)
        if h:
            used.add(h["id"]); match[i] = (h, "prefix")
    # Pass 3: same amount and office, near the cited page, exactly one candidate left.
    for i, r in enumerate(sen):
        if i in match or not r["gab"]:
            continue
        o = office_key(r.get("office"))
        page = r["hb_page"] or 0
        cands = [h for h in by_amt.get(r["gab"], []) if h["id"] not in used and h["_o"] == o
                 and -1 <= (h["hgab3_page"] - PAGE_OFFSET) - page <= 8]
        if len(cands) == 1:
            used.add(cands[0]["id"]); match[i] = (cands[0], "amount_only")
    # Pass 4: a large amount that only one unused House row prints (the PDF draws a few titles twice, on
    # top of each other, which garbles them).
    for i, r in enumerate(sen):
        if i in match or not r["gab"] or r["gab"] < 100_000_000:
            continue
        cands = [h for h in by_amt.get(r["gab"], []) if h["id"] not in used]
        if len(cands) == 1:
            used.add(cands[0]["id"]); match[i] = (cands[0], "amount_unique")
    # Pass 5: our House data sometimes holds two printed lines as one row (same place, amounts added). Two
    # unmatched Senate rows in one office whose House amounts add up to one unused House row there, with a
    # name >= 90 similar to either, both point to that row.
    left = [i for i, r in enumerate(sen) if i not in match and r["gab"]]
    for a in left:
        for b in left:
            if a >= b or a in match or b in match:
                continue
            ra, rb = sen[a], sen[b]
            if office_key(ra.get("office")) != office_key(rb.get("office")):
                continue
            cands = [h for h in by_amt.get(ra["gab"] + rb["gab"], []) if h["id"] not in used
                     and h["_o"] == office_key(ra.get("office"))
                     and max(fuzz.token_sort_ratio(ra["hb_title"], h["title"]),
                             fuzz.token_sort_ratio(rb["hb_title"], h["title"])) >= 90]
            if len(cands) == 1:
                used.add(cands[0]["id"])
                match[a] = (cands[0], "house_row_split")
                match[b] = (cands[0], "house_row_split")
    out_rows = []
    stats = defaultdict(int)
    for i, r in enumerate(sen):
        h, how = match.get(i, (None, None))
        if not how:
            how = "new" if not r["hb_title"] and not r["gab"] else "unmatched"
        stats[how] += 1
        senate_title = r["senate_title"] or r["hb_title"]
        renamed = bool(r["senate_title"]) and norm(r["senate_title"]) != norm(r["hb_title"])
        out_rows.append({
            "senate_pdf_page": r["pdf_page"], "senate_hb_page": r["hb_page"],
            "region": r.get("region") or "", "office": r.get("office") or "", "path": " > ".join(r.get("path", [])),
            "hb_title": r["hb_title"], "senate_title": senate_title, "renamed": int(renamed),
            "rename_similarity": round(fuzz.token_sort_ratio(r["hb_title"], senate_title)) if renamed else 100,
            "hb_coords": " ".join(r["hb_coords"]), "senate_coords": " ".join(r["senate_coords"]),
            "hb_php": r["gab"], "increase_php": r["inc"], "decrease_php": r["dec"], "net_php": r["net"],
            "senate_php": r["sv"] if r["sv"] is not None else 0,
            "match": how,
            "hgab_id": h["id"] if h else "", "hgab_title": h["title"] if h else "",
            "hgab_office": h["office"] if h else "", "hgab_php": h["hgab3_php"] if h else "",
            "hgab_pdf_page": h["hgab3_page"] if h else "", "hgab_house_match": h["house_match"] if h else "",
            "nep_php": h["nep_php"] if h and h["nep_php"] is not None else "",
        })
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out_rows[0]))
        w.writeheader()
        w.writerows(out_rows)
    print(dict(stats), f"of {len(sen)}; House rows used {len(used)} of {len(hb)}", file=sys.stderr)


if __name__ == "__main__":
    main(*sys.argv[1:4])
