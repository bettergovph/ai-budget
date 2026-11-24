"""Links DPWH contracts (infra years 2016-2026) to the schools in the registry, for each school's project history
(`/schools/:id`). Writes data/schools/dpwh-import.sql: `schools_dpwh_contracts` (the school-related contracts that
link to a school) and `schools_dpwh_links` (contract x school, with how the link was made).

    npm run build:schools-d1          (first: writes data/schools/registry-names.csv)
    npm run build:schools-dpwh
    npx wrangler d1 execute budget --local --file=data/schools/dpwh-import.sql

DPWH rarely writes the School ID, so most links come from the school's name. Each link says how it was made;
`confident` = 1 only for the first three, and pages show the rest apart, as possible matches to check:

  school_id               the contract quotes the School ID and the registry name agrees
  school_id_name_differs  the contract quotes the School ID; the name is spelt differently or names another school
  name                    the school's full registry name is in the description, and it is the only school with that
                          name in the contract's province (or in the town / nearest by GPS, when several share it)
  name_annex              as `name`, but the description says "annex" and the school's name doesn't (likely its annex)
  several                 several schools fit the name and nothing tells them apart (one row per candidate)
  near_name               the contract's GPS is within 300 m of the school and the school's distinctive name words
                          are in the description
  near                    the contract's GPS is within 150 m of the school and no other school is close

Names are compared after normalising (upper case, no punctuation, ES/NHS/IS/CS... spelt out). A name is only used
when it has a word that is not generic ("Central Elementary School" alone never matches), and a matched name inside a
longer matched name is dropped ("San Jose ES" when "San Jose ES Annex" also matched). The contract's office
("Cagayan 2nd DEO") gives the province; regional and city offices map to theirs, or to the whole country when unknown.
"""

import collections
import csv
import json
import math
import os
import re
import sys
from datetime import datetime, timezone

import duckdb

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT_DIR = os.path.join(ROOT, "data", "schools")
CONTRACTS = os.path.join(ROOT, "data", "dpwh-contracts", "contracts.parquet")
REGISTRY = os.path.join(OUT_DIR, "registry-names.csv")
MAX_STATEMENT = 95_000


def fail(msg):
    sys.exit(f"build_dpwh_links: {msg}")


ABBR = [(r"\bNHS\b", "NATIONAL HIGH SCHOOL"), (r"\bCES\b", "CENTRAL ELEMENTARY SCHOOL"), (r"\bES\b", "ELEMENTARY SCHOOL"),
        (r"\bE S\b", "ELEMENTARY SCHOOL"), (r"\bCS\b", "CENTRAL SCHOOL"), (r"\bC S\b", "CENTRAL SCHOOL"),
        (r"\bIS\b", "INTEGRATED SCHOOL"), (r"\bHS\b", "HIGH SCHOOL"), (r"\bPS\b", "PRIMARY SCHOOL"),
        (r"\bMES\b", "MEMORIAL ELEMENTARY SCHOOL"), (r"\bNTS\b", "NATIONAL TRADE SCHOOL"), (r"\bSHS\b", "SENIOR HIGH SCHOOL"),
        (r"\bELEM\b", "ELEMENTARY"), (r"\bSCH\b", "SCHOOL"), (r"\bSHCOOL\b", "SCHOOL"), (r"\bNATL\b", "NATIONAL"),
        (r"\bNAT\b", "NATIONAL"), (r"\bSTO\b", "SANTO"), (r"\bSTA\b", "SANTA"), (r"\bPRES\b", "PRESIDENT")]


def norm(s):
    s = (s or "").upper().replace("Ñ", "N").replace("'", "").replace("`", "").replace("’", "")
    s = re.sub(r"[^A-Z0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    for a, b in ABBR:
        s = re.sub(a, b, s)
    return s


NCR_CITIES = ("MANILA", "QUEZON CITY", "CALOOCAN", "LAS PINAS", "MAKATI", "MALABON", "MANDALUYONG", "MARIKINA", "MUNTINLUPA",
              "NAVOTAS", "PARANAQUE", "PASAY", "PASIG", "SAN JUAN", "TAGUIG", "VALENZUELA", "PATEROS")
ALIAS = {
    "DAVAO DE ORO": "COMPOSTELA VALLEY", "COTABATO": "NORTH COTABATO", "SAMAR": "WESTERN SAMAR", "SAMAR WESTERN SAMAR": "WESTERN SAMAR",
    "MINDORO ORIENTAL": "ORIENTAL MINDORO", "SOUTHERN MINDORO": "ORIENTAL MINDORO", "MINDORO OCCIDENTAL": "OCCIDENTAL MINDORO",
    "NORTH MANILA": "NCR", "SOUTH MANILA": "NCR", "NATIONAL CAPITAL REGION": "NCR", "LOWER KALINGA": "KALINGA", "UPPER KALINGA": "KALINGA",
    "DAVAO CITY": "DAVAO DEL SUR", "BUTUAN CITY": "AGUSAN DEL NORTE", "BACOLOD CITY": "NEGROS OCCIDENTAL",
    "ZAMBOANGA CITY": "ZAMBOANGA DEL SUR", "CAGAYAN DE ORO CITY": "MISAMIS ORIENTAL", "CEBU CITY": "CEBU", "ILOILO CITY": "ILOILO",
    "BAGUIO CITY": "BENGUET", "TACLOBAN CITY": "LEYTE", "ISABELA CITY": "CITY OF ISABELA", "COTABATO CITY": "CITY OF COTABATO",
    "ILIGAN CITY": "LANAO DEL NORTE",
}


def prov(s):
    s = norm(s)
    s = re.sub(r"\b(\d+(ST|ND|RD|TH)|FIRST|SECOND|THIRD|FOURTH|LONE)\b", " ", s)
    s = re.sub(r"\b(DEO|DISTRICT ENGINEERING OFFICE|SUB DEO|PROVINCE OF)\b", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    if "NCR" in s or "METRO MANILA" in s or any(s.startswith(c) for c in NCR_CITIES):
        return "NCR"
    return ALIAS.get(s, s)


GENERIC = set(("ELEMENTARY SCHOOL NATIONAL HIGH INTEGRATED CENTRAL PRIMARY SENIOR JUNIOR MEMORIAL ANNEX EXTENSION OF THE AND "
               "DE DEL LA LAS LOS SAN SANTA SANTO CITY COMMUNITY BARANGAY BRGY TRADE VOCATIONAL TECHNICAL COMPREHENSIVE "
               "SCIENCE AGRICULTURAL INDUSTRIAL ACADEMY MAIN EAST WEST NORTH SOUTH I II III IV V").split())


def distinct(name):
    return [t for t in norm(name).split() if t not in GENERIC and len(t) > 2]


def has_words(words, text):
    return bool(words) and all(re.search(r"\b" + t + r"\b", text) for t in words)


RANK = ["school_id", "school_id_name_differs", "name", "name_annex", "several", "near_name", "near"]


def meters(lat1, lon1, lat2, lon2):
    return 6371000 * math.hypot(math.radians(lat2 - lat1), math.radians(lon2 - lon1) * math.cos(math.radians(lat1)))


def main():
    for p in (CONTRACTS, REGISTRY):
        if not os.path.exists(p):
            fail(f"missing input {p}")
    schools = {}
    by_prov = collections.defaultdict(lambda: collections.defaultdict(set))
    grid = collections.defaultdict(list)
    with open(REGISTRY, newline="") as f:
        for r in csv.DictReader(f):
            sid = r["school_id"]
            p = prov(r["province"])
            lat = float(r["latitude"]) if r["latitude"] else None
            lon = float(r["longitude"]) if r["longitude"] else None
            schools[sid] = {"name": r["school_name"], "prov": p, "mun": norm(r["municipality"]), "lat": lat, "lon": lon,
                            "words": distinct(r["school_name"])}
            for n in {r["school_name"], r["shortage_name"], r["coord_name"]}:
                k = norm(n)
                if len(k) >= 12 and distinct(n):
                    by_prov[p][k].add(sid)
            if lat is not None:
                grid[(round(lat, 2), round(lon, 2))].append(sid)
    all_names = collections.defaultdict(set)
    for names in by_prov.values():
        for k, v in names.items():
            all_names[k] |= v

    def near(lat, lon, radius):
        out = []
        for dx in (-0.01, 0, 0.01):
            for dy in (-0.01, 0, 0.01):
                for sid in grid.get((round(lat + dx, 2), round(lon + dy, 2)), []):
                    d = meters(lat, lon, schools[sid]["lat"], schools[sid]["lon"])
                    if d <= radius:
                        out.append((d, sid))
        return sorted(out)

    con = duckdb.connect()
    rows = con.execute(f"""
        SELECT contractId, description, category, status, progress, budget, amountPaid, location.province, location.region,
               contractor, CAST(startDate AS VARCHAR), CAST(completionDate AS VARCHAR), infraYear, programName, sourceOfFunds,
               latitude, longitude
        FROM read_parquet('{CONTRACTS}')
        WHERE description ILIKE '%school%' OR description ILIKE '%classroom%' OR description ILIKE '%SCHOOL BLDG%'
    """).fetchall()
    cols = ["contract_id", "description", "category", "status", "progress", "budget_php", "amount_paid_php", "deo", "region",
            "contractor", "start_date", "completion_date", "infra_year", "program_name", "source_of_funds", "latitude", "longitude"]

    links, contracts = [], {}
    stats = collections.Counter()
    seen_ids = set()
    for row in rows:
        c = dict(zip(cols, row))
        cid = c["contract_id"]
        if not cid or cid in seen_ids:
            stats["skipped_duplicate_or_blank_id"] += 1
            continue
        seen_ids.add(cid)
        d = norm(c["description"])
        p = prov(c["deo"])
        has_gps = c["latitude"] is not None and c["longitude"] is not None and 4 < c["latitude"] < 22 and 116 < c["longitude"] < 127
        nb = near(c["latitude"], c["longitude"], 400) if has_gps else []
        dist = {sid: m for m, sid in nb}
        found = []  # (school_id, match)

        ids = [m for m in dict.fromkeys(re.findall(r"(?<!\d)(\d{6})(?!\d)", c["description"] or "")) if m in schools]
        for sid in ids:
            found.append((sid, "school_id" if has_words(schools[sid]["words"], d) else "school_id_name_differs"))
        if not found:
            names = by_prov.get(p) or all_names
            hits = {name: sids for name, sids in names.items() if name in d and re.search(r"\b" + re.escape(name) + r"\b", d)}
            # a matched name inside a longer matched name is the same mention
            hits = {n: s for n, s in hits.items() if not any(n != m and n in m for m in hits)}
            annex = re.search(r"\b(ANNEX|EXTENSION)\b", d) is not None
            for name, sids in hits.items():
                sids = set(sids)
                if len(sids) > 1:
                    town = {x for x in sids if schools[x]["mun"] and re.search(r"\b" + re.escape(schools[x]["mun"]) + r"\b", d)}
                    if len(town) == 1:
                        sids = town
                    elif nb:
                        close = {x for x in sids if x in dist}
                        if len(close) == 1:
                            sids = close
                if len(sids) == 1:
                    sid = next(iter(sids))
                    found.append((sid, "name_annex" if annex and "ANNEX" not in name and "EXTENSION" not in name else "name"))
                else:
                    found.extend((x, "several") for x in sorted(sids))
        if not found and nb:
            close = [(m, x) for m, x in nb if m <= 300 and has_words(schools[x]["words"], d)]
            if close:
                found.append((close[0][1], "near_name"))
            elif nb[0][0] <= 150 and (len(nb) == 1 or nb[1][0] > 2 * nb[0][0]):
                found.append((nb[0][1], "near"))
        if not found:
            stats["contracts_unplaced"] += 1
            continue
        # one link per school: its strongest match (two spellings of a name can both hit)
        best = {}
        for x, how in found:
            if x not in best or RANK.index(how) < RANK.index(best[x]):
                best[x] = how
        found = list(best.items())
        confident = [x for x, how in found if how in ("school_id", "school_id_name_differs", "name")]
        stats["contracts_linked_confident" if confident else "contracts_linked_possible_only"] += 1
        for x, how in found:
            stats[f"links_{how}"] += 1
            links.append({"contract_id": cid, "school_id": x, "match": how,
                          "confident": int(how in ("school_id", "school_id_name_differs", "name")),
                          "distance_m": round(dist[x]) if x in dist else None})
        c["schools_confident"] = len(set(confident))
        c["infra_year"] = int(c["infra_year"]) if c["infra_year"] and str(c["infra_year"]).isdigit() else None
        c["progress"] = float(c["progress"]) if c["progress"] is not None else None
        c["budget_php"] = float(c["budget_php"]) if c["budget_php"] is not None else None
        c["amount_paid_php"] = int(c["amount_paid_php"]) if c["amount_paid_php"] else None
        if not has_gps:
            c["latitude"] = c["longitude"] = None
        contracts[cid] = c

    stats["contracts_school_related"] = len(seen_ids)
    stats["schools_with_confident_link"] = len({l["school_id"] for l in links if l["confident"]})
    meta = {"built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "source": "data/dpwh-contracts/contracts.parquet",
            "stats": dict(sorted(stats.items()))}

    C_COLS = [("contract_id", "TEXT NOT NULL"), ("description", "TEXT"), ("category", "TEXT"), ("status", "TEXT"), ("progress", "REAL"),
              ("budget_php", "REAL"), ("amount_paid_php", "INTEGER"), ("deo", "TEXT"), ("region", "TEXT"), ("contractor", "TEXT"),
              ("start_date", "TEXT"), ("completion_date", "TEXT"), ("infra_year", "INTEGER"), ("program_name", "TEXT"),
              ("source_of_funds", "TEXT"), ("latitude", "REAL"), ("longitude", "REAL"), ("schools_confident", "INTEGER")]
    L_COLS = [("contract_id", "TEXT NOT NULL"), ("school_id", "TEXT NOT NULL"), ("match", "TEXT NOT NULL"),
              ("confident", "INTEGER NOT NULL"), ("distance_m", "INTEGER")]
    M_COLS = [("key", "TEXT NOT NULL"), ("value", "TEXT")]
    tables = [("schools_dpwh_contracts", C_COLS, list(contracts.values()), "PRIMARY KEY (contract_id)"),
              ("schools_dpwh_links", L_COLS, links, "PRIMARY KEY (contract_id, school_id)"),
              ("schools_dpwh_meta", M_COLS, [{"key": k, "value": v if isinstance(v, str) else json.dumps(v)} for k, v in meta.items()],
               "PRIMARY KEY (key)")]
    out = ["-- Generated by scripts/schools/build_dpwh_links.py; do not edit by hand."]
    out += [f"DROP TABLE IF EXISTS {t};" for t, *_ in tables]
    for t, cs, _, pk in tables:
        out.append(f"CREATE TABLE {t} (\n" + ",\n".join(f"  {n} {ty}" for n, ty in cs) + f",\n  {pk}\n);")
    out.append("CREATE INDEX schools_dpwh_links_school ON schools_dpwh_links (school_id, confident);")
    path = os.path.join(OUT_DIR, "dpwh-import.sql")
    with open(path, "w") as f:
        f.write("\n".join(out) + "\n")
        for t, cs, data, _ in tables:
            head = f"INSERT INTO {t} ({', '.join(n for n, _ in cs)}) VALUES\n"
            batch, size = [], len(head)
            for r in data:
                vals = []
                for n, ty in cs:
                    v = r.get(n)
                    if v is None:
                        if "NOT NULL" in ty:
                            fail(f"{t}.{n}: NULL")
                        vals.append("NULL")
                    elif ty.startswith("TEXT"):
                        vals.append("'" + str(v).replace("'", "''") + "'")
                    elif ty.startswith("INTEGER"):
                        vals.append(str(int(v)))
                    else:
                        vals.append(repr(float(v)))
                tup = "(" + ", ".join(vals) + ")"
                if batch and size + len(tup) + 2 > MAX_STATEMENT:
                    f.write(head + ",\n".join(batch) + ";\n")
                    batch, size = [], len(head)
                batch.append(tup)
                size += len(tup) + 2
            if batch:
                f.write(head + ",\n".join(batch) + ";\n")
    print(json.dumps(meta["stats"], indent=1))
    print(f"wrote {path} ({os.path.getsize(path) / 1e6:.1f} MB): {len(contracts)} contracts, {len(links)} links")


if __name__ == "__main__":
    main()
