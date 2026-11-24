"""Basic-education facilities (schools) D1 layer: normalises the
"School Shortage & Project Join Extract" workbook (EDCOM2 / DepEd data pack)
and its field dictionary into `schools_*` tables.

    npm run build:schools-d1 -- [extract.xlsx] [field_dictionary.csv] [shortage.csv]
    npx wrangler d1 execute budget --local --file=data/schools/d1-import.sql

One wide registry row per school becomes one row per *source* that was
attached to it, so a school with no safe ID match simply has no row in that
source's table (the workbook's rule "blank is not zero" holds by construction):

  schools                    registry (school_types_consolidated), one row per School ID
  schools_shortage_2023      shortages 2023            (SHORT_2023_*)
  schools_coordinates_2022   school_coordinates 2022   (COORD_2022_*)
  schools_facilities_2023    facilities 2023           (FAC_2023_*)
  schools_enrollment_2023    enrollment_ratios_2023    (ENR_2023_*)
  schools_sbp_projects_2026  sbp_masterlist, every source project record
  schools_sbp_candidates     review-only candidate schools per project, one row each
  schools_join_review        unmatched / ambiguous joins
  schools_fields             the field dictionary + where each field lives in D1
  schools_meta               source file hashes, counts, build time

The 300 schools on DepEd's SY 2023–2024 shortage list (EDCOM 2's sheet, third input) that are not in the registry
are added to `schools` with `in_registry` = 0 and their shortage row; the sheet must equal every attached school's
shortage rounded to whole classrooms.

It also writes data/schools/registry-names.csv (names, place, 2022 point per school) for build_dpwh_links.py.

The SBP_2026_* roll-ups are not stored: view `schools_sbp_rollup_2026`
recomputes them from the projects, and this build asserts it reproduces the
workbook's values for every school.

Values: '' is NULL everywhere; IDs are text; TRUE/FALSE are 1/0; text is
trimmed and inner whitespace collapsed. Placeholder tokens ('nan', '#N/A',
'-', 'N/A', 'None') become NULL only in ID, address and name fields, and
each replacement is counted in schools_meta. Every other source value is kept
as written. This file only ever drops and recreates `schools_*` tables and
the one view; future public-report tables must use another prefix.
"""

import collections
import csv
import hashlib
import json
import math
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT_DIR = os.path.join(ROOT, "data", "schools")
SCHEMA_PATH = os.path.join(HERE, "schema.sql")
MAX_STATEMENT = 95_000  # D1 limit is 100 KB per statement

XLSX = sys.argv[1] if len(sys.argv) > 1 else "/data/schools-src/school_shortage_allocation_join_extract.xlsx"
DICT_CSV = sys.argv[2] if len(sys.argv) > 2 else "/data/schools-src/field_dictionary.csv"
# DepEd's school-level shortage list, SY 2023–2024, in whole classrooms (EDCOM 2's shortage.xlsx, Sheet1, as CSV).
SHEET = sys.argv[3] if len(sys.argv) > 3 else "/data/schools-src/edcom2-sheet/shortage.csv"

PLACEHOLDERS = {"nan", "#N/A", "-", "N/A", "None", "NaN"}

# ---------------------------------------------------------------------------
# Column maps: (d1 column, source header, type). Types: id (TEXT), text,
# int, real, bool (INTEGER 0/1). `None` source = derived here.
# ---------------------------------------------------------------------------

SCHOOLS = [
    ("school_id", "School_ID_Normalized", "id"),
    ("new_school_id", "New_School_ID_Normalized", "id"),
    ("region", "REGISTRY_Region", "text"),
    ("region_key", None, "text"),
    ("division", "REGISTRY_Division", "text"),
    ("district", "REGISTRY_District", "text"),
    ("school_name", "REGISTRY_School Name", "text"),
    ("street_address", "REGISTRY_Street Address", "addr"),
    ("mother_school_id", "REGISTRY_Mother School ID", "id"),
    ("school_head_name", "REGISTRY_School Head Name", "addr"),
    ("school_head_position", "REGISTRY_School Head Position", "addr"),
    ("province", "REGISTRY_Province", "text"),
    ("municipality", "REGISTRY_Municipality", "text"),
    ("legislative_district", "REGISTRY_Legislative District", "text"),
    ("barangay", "REGISTRY_Barangay", "text"),
    ("sector", "REGISTRY_Sector", "text"),
    ("subclassification", "REGISTRY_School Subclassification", "text"),
    ("school_type", "REGISTRY_School Type", "text"),
    ("implementing_unit", "REGISTRY_Implementing Unit", "text"),
    ("curricular_offering", "REGISTRY_Modified Curricular Offering Classification", "text"),
    ("last_mile_school", "REGISTRY_Last Mile School", "text"),
    ("iped_implementing", "REGISTRY_IPEd Implementing School", "text"),
    ("instructional_classrooms", "REGISTRY_Instructional Classrooms (SY 2023-24)", "int"),
    ("tls", "REGISTRY_Temporary Learning Spaces (TLS)", "int"),
    ("makeshift_rooms", "REGISTRY_Makeshift Rooms (MR)", "int"),
    ("tls_mr", "REGISTRY_TLS + MR", "int"),
    ("total_classrooms_incl_tls_mr", "REGISTRY_Total Classrooms incl. TLS/MR", "int"),
    ("tls_mr_share", "REGISTRY_TLS/MR Share", "real"),
    ("tls_mr_dependent", "REGISTRY_TLS/MR Dependent (>=50%)", "text"),
    ("tls_mr_band", "REGISTRY_TLS/MR Reliance Band", "text"),
    ("join_shortage", "JOIN_shortage_status", "text"),
    ("join_shortage_method", "JOIN_shortage_method", "text"),
    ("join_coordinates", "JOIN_coordinates_status", "text"),
    ("join_coordinates_method", "JOIN_coordinates_method", "text"),
    ("join_facilities", "JOIN_facilities_status", "text"),
    ("join_facilities_method", "JOIN_facilities_method", "text"),
    ("join_enrollment", "JOIN_enrollment_status", "text"),
    ("join_enrollment_method", "JOIN_enrollment_method", "text"),
    ("registry_row", None, "int"),
    ("in_registry", None, "bool"),
]

SHORTAGE = [
    ("school_id", "School_ID_Normalized", "id"),
    ("src_school_id", "SHORT_2023_School ID", "id"),
    ("src_new_school_id", "SHORT_2023_New School ID", "id"),
    ("region", "SHORT_2023_Region", "text"),
    ("division", "SHORT_2023_Division", "text"),
    ("school_name", "SHORT_2023_School Name", "text"),
    ("city_municipality", "SHORT_2023_City/Municipality (24-25)", "text"),
    ("leg_district", "SHORT_2023_Leg District", "text"),
    ("congressional_district", "SHORT_2023_Congressional District", "text"),
    ("level", "SHORT_2023_Level", "text"),
    ("lgu_classification", "SHORT_2023_Classification", "text"),
    ("province", "SHORT_2023_Province", "text"),
    ("barangay", "SHORT_2023_Barangay", "text"),
    ("urban_rural", "SHORT_2023_Urban/Rural", "addr"),
    ("lms", "SHORT_2023_LMS", "text"),
    ("street_address", "SHORT_2023_Street Address", "addr"),
    ("shortage_k10", "SHORT_2023_Shortage_Kto10", "real"),
    ("excess_k10", "SHORT_2023_Excess_Kto10", "real"),
    ("shortage_shs", "SHORT_2023_Shortage_SHS", "real"),
    ("total_shortage", "SHORT_2023_Total_Shortage", "real"),
]

COORDS = [
    ("school_id", "School_ID_Normalized", "id"),
    ("lis_school_id", "COORD_2022_LIS School ID", "id"),
    ("nsbi_school_id", "COORD_2022_NSBI School ID", "id"),
    ("region", "COORD_2022_Region", "text"),
    ("division", "COORD_2022_Division", "text"),
    ("district", "COORD_2022_District", "text"),
    ("remarks", "COORD_2022_Remarks", "text"),
    ("school_name", "COORD_2022_School Name", "text"),
    ("street_address", "COORD_2022_Street Address", "addr"),
    ("province", "COORD_2022_Province", "text"),
    ("municipality", "COORD_2022_Municipality", "text"),
    ("legislative_district", "COORD_2022_Legislative District", "text"),
    ("barangay", "COORD_2022_Barangay", "text"),
    ("sector", "COORD_2022_Sector", "text"),
    ("subclassification", "COORD_2022_School Subclassification", "text"),
    ("curricular_offering", "COORD_2022_Modified Curricular Offering Classification", "text"),
    ("coc_nsbi", "COORD_2022_COC NSBI", "text"),
    ("longitude", "COORD_2022_Longitude", "real"),
    ("latitude", "COORD_2022_Latitude", "real"),
    ("in_ph_bbox", None, "bool"),
]

ENROLLMENT = [
    ("school_id", "School_ID_Normalized", "id"),
    ("src_school_id", "ENR_2023_School ID", "id"),
    ("school_name", "ENR_2023_School Name", "text"),
    ("region", "ENR_2023_Region", "text"),
    ("division", "ENR_2023_Division", "text"),
    ("curricular_offering", "ENR_2023_Modified COC", "text"),
    ("enrolment_es", "ENR_2023_Enrolment ES (K-6 + NG)", "int"),
    ("enrolment_jhs", "ENR_2023_Enrolment JHS (G7-10 + NG)", "int"),
    ("enrolment_shs", "ENR_2023_Enrolment SHS (G11-12)", "int"),
    ("enrolment_total", "ENR_2023_Total Enrolment", "int"),
    ("instr_cr_es", "ENR_2023_Instructional CR - ES", "int"),
    ("instr_cr_jhs", "ENR_2023_Instructional CR - JHS", "int"),
    ("instr_cr_shs", "ENR_2023_Instructional CR - SHS", "int"),
    ("instr_cr_total", "ENR_2023_Total Instructional CR", "int"),
    ("makeshift_es", "ENR_2023_Makeshift - ES", "int"),
    ("makeshift_hs", "ENR_2023_Makeshift - HS", "int"),
    ("tls_es", "ENR_2023_TLS - ES", "int"),
    ("tls_hs", "ENR_2023_TLS - HS", "int"),
    ("total_instr_makeshift_tls", "ENR_2023_Total Instr + Makeshift + TLS", "int"),
    ("ratio_enrolment_instr_cr", "ENR_2023_Enrolment : Instructional CR", "ratio"),
    ("ratio_enrolment_instr_cr_note", None, "text"),
    ("ratio_enrolment_all_rooms", "ENR_2023_Enrolment : Instr + Makeshift + TLS", "ratio"),
    ("ratio_enrolment_all_rooms_note", None, "text"),
]

PROJECTS = [
    ("project_id", "Project_Record_ID", "id"),
    ("source_row", "Source_Row_Number", "int"),
    ("link_status", "Link_Status", "text"),
    ("link_method", "Link_Method", "text"),
    ("school_id", "Linked_School_ID_Normalized", "id"),
    ("school_in_registry", None, "bool"),
    ("candidate_review_method", "Candidate_Review_Method", "text"),
    ("candidate_school_ids_raw", "Candidate_School_IDs_For_Review", "text"),
    ("candidate_school_names_raw", "Candidate_School_Names_For_Review", "text"),
    ("budget_status", "Budget_Status_Interpretation", "text"),
    ("budget_php", "Budget_Amount_Numeric_PHP", "real"),
    ("src_school_id", "SBP_Source_School ID", "id"),
    ("src_school_name", "SBP_Source_School", "text"),
    ("src_province", "SBP_Source_Province", "text"),
    ("src_city_municipality", "SBP_Source_City/Municipality", "text"),
    ("modality", "SBP_Source_Implementation Modality", "text"),
    ("scope_of_work", "SBP_Source_Scope of Work", "text"),
    ("scope_storeys", None, "int"),
    ("scope_classrooms", None, "int"),
    ("classrooms", "SBP_Source_Number of Classroom", "int"),
    ("budget_allocation_raw", "SBP_Source_Budget Allocation (PHP)", "text"),
    ("funding_source_raw", "SBP_Source_Funding Source (GAA-YR)", "text"),
    ("expected_start_raw", "SBP_Source_Expected Start of Construction", "text"),
    ("expected_end_raw", "SBP_Source_Expected End of Construction", "text"),
    ("income_class", "SBP_Source_Income Classification", "text"),
    ("lgu_type", "SBP_Source_LGU Type", "text"),
    ("match_key", "SBP_Source_Match Key", "text"),
]

JOIN_REVIEW = [
    ("review_id", None, "int"),
    ("record_type", "Record_Type", "text"),
    ("source_sheet", "Source_Sheet", "text"),
    ("source_row", "Source_Row_Number", "int"),
    ("primary_id", "Source_Primary_ID_Normalized", "id"),
    ("alternate_id", "Source_Alternate_ID_Normalized", "id"),
    ("join_outcome", "Join_Outcome", "text"),
    ("fallback_method", "Fallback_Review_Method", "text"),
    ("candidate_school_ids_raw", "Candidate_School_IDs", "text"),
    ("candidate_school_names_raw", "Candidate_School_Names", "text"),
]

CANDIDATES = [
    ("project_id", None, "id"),
    ("rank", None, "int"),
    ("school_id", None, "id"),
    ("school_name", None, "text"),
    ("school_in_registry", None, "bool"),
]

FIELDS = [
    ("worksheet", None, "text"),
    ("column_no", None, "int"),
    ("field_name", None, "text"),
    ("field_group", None, "text"),
    ("source_workbook", None, "text"),
    ("source_sheet", None, "text"),
    ("source_fields", None, "text"),
    ("definition", None, "text"),
    ("data_type", None, "text"),
    ("notes", None, "text"),
    ("d1_table", None, "text"),
    ("d1_column", None, "text"),
]

META = [("key", None, "text"), ("value", None, "text")]

SQL_TYPE = {"id": "TEXT", "text": "TEXT", "addr": "TEXT", "int": "INTEGER", "real": "REAL", "ratio": "REAL", "bool": "INTEGER"}

# region label -> key used by the hgab tables (src/lib/hgab.ts REGION_ORDER)
REGION_KEYS = {
    "NCR": "NCR", "CAR": "CAR", "Region I": "I", "Region II": "II", "Region III": "III",
    "Region IV-A": "IV-A", "MIMAROPA": "MIMAROPA", "Region V": "V", "Region VI": "VI",
    "NIR": "NIR", "Region VII": "VII", "Region VIII": "VIII", "Region IX": "IX", "Region X": "X",
    "Region XI": "XI", "Region XII": "XII", "CARAGA": "XIII", "BARMM": "BARMM", "PSO": None,
}

counts = Counter()  # placeholder replacements etc., written to schools_meta


def fail(msg):
    sys.exit(f"build_d1: {msg}")


def clean(value, kind, col):
    """Normalise one cell to a Python value for its column kind."""
    if value is None:
        return None
    if isinstance(value, str):
        s = re.sub(r"\s+", " ", value).strip()
        if s == "":
            return None
        if kind in ("id", "addr") and s in PLACEHOLDERS:
            counts[f"placeholder_null:{col}:{s}"] += 1
            return None
    else:
        s = value
    if kind == "id":
        if isinstance(s, float):
            if not s.is_integer():
                fail(f"{col}: non-integer id {s!r}")
            s = int(s)
        return str(s)
    if kind in ("text", "addr"):
        if isinstance(s, bool):
            return "TRUE" if s else "FALSE"
        if isinstance(s, float) and s.is_integer():
            s = int(s)
        return str(s)
    if kind == "bool":
        if isinstance(s, bool):
            return 1 if s else 0
        if s in ("TRUE", "FALSE"):
            return 1 if s == "TRUE" else 0
        fail(f"{col}: not a boolean {s!r}")
    if kind == "int":
        if isinstance(s, bool):
            fail(f"{col}: boolean in int column")
        if isinstance(s, (int, float)) and float(s).is_integer():
            return int(s)
        if isinstance(s, str) and re.fullmatch(r"-?\d+", s):
            return int(s)
        fail(f"{col}: not an integer {s!r}")
    if kind in ("real", "ratio"):
        if isinstance(s, (int, float)) and not isinstance(s, bool):
            if not math.isfinite(s):
                fail(f"{col}: non-finite {s!r}")
            return s
        if isinstance(s, str):
            try:
                return float(s)
            except ValueError:
                if kind == "ratio":
                    return ("note", s)
        fail(f"{col}: not a number {s!r}")
    fail(f"unknown kind {kind}")


def read_sheet(wb, name):
    ws = wb[name]
    rows = ws.iter_rows(values_only=True)
    header = list(next(rows))
    width = len(header)
    out = []
    for r in rows:
        r = list(r)
        if len(r) > width and any(v not in (None, "") for v in r[width:]):
            fail(f"{name}: values beyond the header")
        r = (r + [None] * width)[:width]
        if all(v is None or v == "" for v in r):
            continue
        out.append(dict(zip(header, r)))
    return header, out


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def project(row, cols, table):
    out = {}
    for col, src, kind in cols:
        if src is None:
            continue
        if src not in row:
            fail(f"{table}: missing source column {src!r}")
        out[col] = clean(row[src], kind, f"{table}.{col}")
    return out


def attached(row, cols):
    """True when any source column (other than the school key) has a value."""
    return any(row.get(src) not in (None, "") for col, src, _ in cols if src and col != "school_id")


def main():
    for p in (XLSX, DICT_CSV, SHEET):
        if not os.path.exists(p):
            fail(f"missing input {p}")
    wb = openpyxl.load_workbook(XLSX, read_only=True, data_only=True)
    ex_header, extract = read_sheet(wb, "School Extract")
    pr_header, projects_src = read_sheet(wb, "Project Records")
    jr_header, review_src = read_sheet(wb, "Join Review")

    # --- every source column is mapped somewhere (or is a known roll-up) ---
    rollup_cols = [h for h in ex_header if h.startswith("SBP_2026_")]
    facility_cols = [h for h in ex_header if h.startswith("FAC_2023_")]
    mapped = {src for cols in (SCHOOLS, SHORTAGE, COORDS, ENROLLMENT) for _, src, _ in cols if src}
    mapped |= set(rollup_cols) | set(facility_cols) | {"REGISTRY_School ID"}
    unmapped = [h for h in ex_header if h not in mapped]
    if unmapped:
        fail(f"School Extract columns not mapped: {unmapped}")
    for cols, header, name in ((PROJECTS, pr_header, "Project Records"), (JOIN_REVIEW, jr_header, "Join Review")):
        want = {src for _, src, _ in cols if src}
        if want != set(header):
            fail(f"{name}: header drift {sorted(set(header) ^ want)}")

    # Facilities: names are already snake_case; ints except the offers_/has_/accessible_ flags.
    FACILITIES = [("school_id", "School_ID_Normalized", "id")]
    for h in facility_cols:
        col = h[len("FAC_2023_"):]
        if col == "school_id":
            col, kind = "src_school_id", "id"
        elif col in ("sector", "school_management"):
            kind = "text"
        elif re.match(r"(offers|es_has|hs_has|es_accessible|hs_accessible)_", col):
            kind = "bool"
        else:
            kind = "int"
        FACILITIES.append((col, h, kind))

    tables = {}

    # --- schools (registry) + one table per attached source ---
    schools, shortage, coords, facilities, enrollment = [], [], [], [], []
    seen = set()
    for i, row in enumerate(extract, start=1):
        s = project(row, SCHOOLS, "schools")
        sid = s["school_id"]
        if sid is None or sid in seen:
            fail(f"schools: blank or repeated School ID at row {i}: {sid!r}")
        seen.add(sid)
        if clean(row["REGISTRY_School ID"], "id", "registry") != sid:
            fail(f"schools: REGISTRY_School ID differs from School_ID_Normalized at {sid}")
        if s["region"] not in REGION_KEYS:
            fail(f"schools: unknown region {s['region']!r}")
        s["region_key"] = REGION_KEYS[s["region"]]
        s["registry_row"] = i
        s["in_registry"] = 1
        schools.append(s)

        def take(cols, status_col, sink, table):
            has = attached(row, cols)
            status = row.get(status_col) if status_col else None
            if status_col and has != (status == "Matched"):
                fail(f"{table}: {sid} has values={has} but join status {status!r}")
            if has:
                sink.append(project(row, cols, table))
            return has

        take(SHORTAGE, "JOIN_shortage_status", shortage, "schools_shortage_2023")
        if take(COORDS, "JOIN_coordinates_status", coords, "schools_coordinates_2022"):
            c = coords[-1]
            lat, lon = c["latitude"], c["longitude"]
            c["in_ph_bbox"] = None if lat is None or lon is None else int(4.2 <= lat <= 21.5 and 116.0 <= lon <= 127.0)
        take(FACILITIES, "JOIN_facilities_status", facilities, "schools_facilities_2023")
        if take(ENROLLMENT, "JOIN_enrollment_status", enrollment, "schools_enrollment_2023"):
            e = enrollment[-1]
            for col in ("ratio_enrolment_instr_cr", "ratio_enrolment_all_rooms"):
                if isinstance(e[col], tuple):
                    e[col + "_note"] = e[col][1]
                    e[col] = None
                else:
                    e[col + "_note"] = None

    # --- DepEd's shortage list: the schools on it that are not in the registry ---
    # EDCOM 2's sheet is the whole list in whole classrooms (47,662 schools). Every school the pack attached must have
    # the sheet's value once rounded half up (as D1's ROUND does); the schools it could not attach (not in the registry,
    # even by New School ID) are added as schools of their own, `in_registry` = 0, with only their shortage row.
    with open(SHEET, encoding="utf-8-sig", newline="") as f:
        sheet = [r for r in csv.DictReader(f)]
    by_src = {r["School ID"].strip(): r for r in sheet}
    if len(by_src) != len(sheet):
        fail("shortage sheet: repeated School IDs")
    reg_by_id = {x["school_id"]: x for x in schools}
    off = 0
    for sh in shortage:
        r = by_src.get(sh["src_school_id"])
        if r is None:
            fail(f"shortage sheet: attached School ID {sh['src_school_id']} is not on the sheet")
        if math.floor(sh["total_shortage"] + 0.5) != float(r["Total_Shortage"]):
            off += 1
    if off:
        fail(f"shortage sheet: {off} attached schools differ from the sheet after rounding")
    counts["shortage_sheet_rows"] = len(sheet)
    # The sheet spells places its own way ("Bacarra", "Zamboanga Del Norte"); the registry's spelling, learnt from the
    # attached schools, is used where known, else the sheet's in capitals.
    up = lambda v: re.sub(r"\s+", " ", (v or "")).strip().upper()
    learn = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))
    for sh in shortage:
        r, x = by_src[sh["src_school_id"]], reg_by_id[sh["school_id"]]
        learn["division"][up(r["Division"])][x["division"]] += 1
        learn["province"][up(r["Province"])][x["province"]] += 1
        learn["muni"][(up(r["Province"]), up(r["City/Municipality (24-25)"]))][x["municipality"]] += 1
        learn["leg"][(up(r["Province"]), up(r["Leg District"]))][x["legislative_district"]] += 1
    known = lambda kind, key: learn[kind][key].most_common(1)[0][0] if learn[kind].get(key) else None
    attached_src = {sh["src_school_id"] for sh in shortage}
    added = 0
    for r in sheet:
        sid = r["School ID"].strip()
        if sid in attached_src:
            continue
        if sid in seen:
            fail(f"shortage sheet: {sid} is in the registry but was not attached")
        region = re.sub(r"\s+", " ", r["Region"]).strip()
        if region not in REGION_KEYS:
            fail(f"shortage sheet: unknown region {region!r}")
        prov = known("province", up(r["Province"])) or up(r["Province"])
        lms = {"LMS": "YES", "Not LMS": "NO"}.get((r["LMS"] or "").strip())
        added += 1
        sch = {
            "school_id": sid, "new_school_id": clean(r["New School ID"], "id", "sheet.new_school_id"), "region": region,
            "region_key": REGION_KEYS[region], "division": known("division", up(r["Division"])) or clean(r["Division"], "text", "x"),
            "district": None, "school_name": clean(r["School Name"], "text", "x"), "street_address": clean(r["Street Address"], "addr", "schools.street_address"),
            "mother_school_id": None, "school_head_name": None, "school_head_position": None, "province": prov,
            "municipality": known("muni", (up(r["Province"]), up(r["City/Municipality (24-25)"]))) or up(r["City/Municipality (24-25)"]),
            "legislative_district": known("leg", (up(r["Province"]), up(r["Leg District"]))) or clean(r["Leg District"], "text", "x"),
            "barangay": clean(r["Barangay"], "text", "x"), "sector": "Public", "subclassification": None, "school_type": None,
            "implementing_unit": None, "curricular_offering": clean(r["Level"], "text", "x"), "last_mile_school": lms,
            "iped_implementing": None, "join_shortage": "Matched", "join_shortage_method": "DepEd shortage list only (not in the registry)",
            "registry_row": len(extract) + added, "in_registry": 0,
        }
        schools.append(sch)
        seen.add(sid)
        shortage.append(project({"School_ID_Normalized": sid, **{f"SHORT_2023_{k}": v for k, v in r.items()}}, SHORTAGE, "schools_shortage_2023"))
    counts["schools_from_shortage_list_only"] = added

    # --- registry names, place and points, for matching other datasets to schools (build_dpwh_links.py) ---
    os.makedirs(OUT_DIR, exist_ok=True)
    by_id = {c["school_id"]: c for c in coords}
    with open(os.path.join(OUT_DIR, "registry-names.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["school_id", "school_name", "shortage_name", "coord_name", "province", "municipality", "latitude", "longitude"])
        alt = {sh["school_id"]: sh["school_name"] for sh in shortage}
        for s in schools:
            c = by_id.get(s["school_id"])
            ok = c is not None and c["in_ph_bbox"] == 1
            w.writerow([s["school_id"], s["school_name"], alt.get(s["school_id"]) or "", (c or {}).get("school_name") or "",
                        s["province"] or "", s["municipality"] or "", c["latitude"] if ok else "", c["longitude"] if ok else ""])

    # --- projects + exploded review candidates ---
    registry_ids = {x["school_id"] for x in schools if x["in_registry"]}
    projects, candidates = [], []
    for row in projects_src:
        p = project(row, PROJECTS, "schools_sbp_projects_2026")
        p["school_in_registry"] = None if p["school_id"] is None else int(p["school_id"] in registry_ids)
        if (p["school_id"] is not None) != (p["link_status"] == "ID-linked"):
            fail(f"projects: {p['project_id']} link status {p['link_status']!r} vs school {p['school_id']!r}")
        m = re.fullmatch(r"(?:(\d+)STY)?(\d+)CL", p["scope_of_work"] or "")
        p["scope_storeys"] = int(m.group(1)) if m and m.group(1) else None
        p["scope_classrooms"] = int(m.group(2)) if m else None
        raw = p["budget_allocation_raw"]
        if (p["budget_php"] is None) != (raw is None or not re.fullmatch(r"[\d.]+", raw)):
            fail(f"projects: {p['project_id']} numeric budget {p['budget_php']!r} vs source {raw!r}")
        if p["candidate_school_ids_raw"]:
            ids = [x.strip() for x in p["candidate_school_ids_raw"].split("|")]
            names = [x.strip() for x in (p["candidate_school_names_raw"] or "").split("|")]
            more_ids = [x for x in ids if x.startswith("...")]
            ids = [x for x in ids if not x.startswith("...")]
            names = [x for x in names if not x.startswith("...")]
            if len(ids) != len(names):
                fail(f"projects: {p['project_id']} candidate ids/names differ in length")
            for rank, (cid, cname) in enumerate(zip(ids, names), start=1):
                candidates.append({"project_id": p["project_id"], "rank": rank, "school_id": cid,
                                   "school_name": cname, "school_in_registry": int(cid in registry_ids)})
            if more_ids:
                counts["candidate_lists_truncated_in_source"] += 1
        projects.append(p)

    review = []
    for i, row in enumerate(review_src, start=1):
        r = project(row, JOIN_REVIEW, "schools_join_review")
        r["review_id"] = i
        review.append(r)

    # --- the roll-ups the view recomputes must equal the workbook's ---
    roll = defaultdict(lambda: {"n": 0, "cr": 0, "crv": 0, "crm": 0, "bud": 0.0, "budn": 0, "bid": 0})
    for p in projects:
        if p["school_id"] is None:
            continue
        r = roll[p["school_id"]]
        r["n"] += 1
        if p["classrooms"] is None:
            r["crm"] += 1
        else:
            r["cr"] += p["classrooms"]; r["crv"] += 1
        if p["budget_php"] is None:
            r["bid"] += int((p["budget_allocation_raw"] or "").startswith("N/A (For Bidding)"))
        else:
            r["bud"] += p["budget_php"]; r["budn"] += 1
    keys = [("n", "project_record_count_ID_linked"), ("cr", "project_classrooms_numeric_sum"),
            ("crv", "project_classroom_value_rows"), ("crm", "project_classroom_missing_rows"),
            ("bud", "known_budget_sum_PHP"), ("budn", "known_budget_rows"), ("bid", "for_bidding_project_count")]
    for row in extract:
        sid = clean(row["School_ID_Normalized"], "id", "x")
        given = {k: row[f"SBP_2026_{src}"] for k, src in keys}
        if all(v in (None, "") for v in given.values()):
            if sid in roll:
                fail(f"rollup: {sid} has projects but no workbook roll-up")
            continue
        mine = roll.get(sid)
        if mine is None:
            fail(f"rollup: {sid} has a workbook roll-up but no linked projects")
        for k, _ in keys:
            a, b = float(given[k] or 0), float(mine[k])
            if abs(a - b) > 0.01:
                fail(f"rollup: {sid} {k} workbook {a} vs recomputed {b}")
    counts["rollup_schools_checked"] = len(roll)

    # A project linked to a shortage-list School ID that the pack attached to a registry school through its New School
    # ID still carries the shortage-list ID; it follows its school to the registry ID (checked above on the pack's links).
    to_school = {sh["src_school_id"]: sh["school_id"] for sh in shortage}
    school_ids = {x["school_id"] for x in schools}
    for p in projects:
        sid = p["school_id"]
        if sid is not None and sid not in school_ids and sid in to_school:
            p["school_id"] = to_school[sid]
            p["link_method"] = f"{p['link_method']}; school ID {sid} is the registry's {to_school[sid]} (New School ID)"
            counts["projects_moved_to_registry_id"] += 1
        p["school_in_registry"] = None if p["school_id"] is None else int(p["school_id"] in registry_ids)
    counts["projects_linked_to_no_school"] = sum(1 for p in projects if p["school_id"] is not None and p["school_id"] not in school_ids)
    counts["projects_linked_outside_registry"] = sum(1 for p in projects if p["school_in_registry"] == 0)

    # --- field dictionary, with each field's D1 home ---
    home = {}
    for table, cols in (("schools", SCHOOLS), ("schools_shortage_2023", SHORTAGE),
                        ("schools_coordinates_2022", COORDS), ("schools_facilities_2023", FACILITIES),
                        ("schools_enrollment_2023", ENROLLMENT)):
        for col, src, _ in cols:
            if src and not (col == "school_id" and table != "schools"):
                home[("School Extract", src)] = (table, col)
    home[("School Extract", "REGISTRY_School ID")] = ("schools", "school_id")
    for src in rollup_cols:
        home[("School Extract", src)] = ("schools_sbp_rollup_2026", src[len("SBP_2026_"):].lower())
    for col, src, _ in PROJECTS:
        if src:
            home[("Project Records", src)] = ("schools_sbp_projects_2026", col)
    for col, src, _ in JOIN_REVIEW:
        if src:
            home[("Join Review", src)] = ("schools_join_review", col)
    fields = []
    with open(DICT_CSV, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            key = (r["Worksheet"], r["Field name (exact)"])
            if key not in home:
                fail(f"dictionary field with no D1 home: {key}")
            t, c = home.pop(key)
            fields.append({
                "worksheet": r["Worksheet"], "column_no": int(r["Column #"]), "field_name": r["Field name (exact)"],
                "field_group": r["Field group"], "source_workbook": r["Source workbook"], "source_sheet": r["Source sheet"],
                "source_fields": r["Source field(s) (exact) / derived basis"], "definition": r["Definition / meaning"],
                "data_type": r["Data type / units"], "notes": r["Interpretation notes"], "d1_table": t, "d1_column": c,
            })
    if home:
        fail(f"columns missing from the dictionary: {sorted(home)}")
    derived = {
        ("schools", "region_key"): "Region key shared with the House bill tables (I, II, … XIII for CARAGA, NIR, BARMM); NULL for PSO (schools abroad).",
        ("schools", "registry_row"): "Row order of the school in the workbook's School Extract sheet (1 = first data row); schools from the shortage list only follow, from 60,205.",
        ("schools", "in_registry"): "1 for a school in DepEd's registry (the data pack's base); 0 for a school only on DepEd's SY 2023–2024 shortage list (EDCOM 2's sheet), added with its shortage row only: no coordinates, facilities or enrolment.",
        ("schools_coordinates_2022", "in_ph_bbox"): "1 when the 2022 coordinates fall inside a rough Philippine bounding box (lat 4.2–21.5, lon 116–127); 0 flags a likely swapped or wrong point.",
        ("schools_enrollment_2023", "ratio_enrolment_instr_cr_note"): "Source text kept when the ratio is not a number (e.g. 'No instr. CR'); the ratio column is then NULL.",
        ("schools_enrollment_2023", "ratio_enrolment_all_rooms_note"): "Source text kept when the ratio is not a number; the ratio column is then NULL.",
        ("schools_sbp_projects_2026", "school_in_registry"): "1 when the ID-linked school is in the registry (schools table); 0 means the link points to a shortages-only School ID, so the project rolls up to no registry school.",
        ("schools_sbp_projects_2026", "scope_storeys"): "Storeys parsed from a scope code like 2STY4CL; NULL when the scope is free text.",
        ("schools_sbp_projects_2026", "scope_classrooms"): "Classrooms parsed from a scope code like 2STY4CL or 2CL; NULL when the scope is free text. Compare with `classrooms`.",
        ("schools_sbp_candidates", "*"): "One row per review-only candidate school from Candidate_School_IDs_For_Review (the source lists end with '… (+N more)' when cut; those extra IDs are not in the workbook).",
    }
    for n, ((t, c), d) in enumerate(derived.items(), start=1):
        fields.append({"worksheet": "(derived in D1)", "column_no": n, "field_name": c, "field_group": "Derived by BetterGov build",
                       "source_workbook": None, "source_sheet": None, "source_fields": None, "definition": d,
                       "data_type": None, "notes": None, "d1_table": t, "d1_column": c})

    meta = {
        "source_workbook": os.path.basename(XLSX),
        "source_workbook_sha256": sha256(XLSX),
        "field_dictionary_sha256": sha256(DICT_CSV),
        "shortage_sheet_sha256": sha256(SHEET),
        "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "rows": {"schools": len(schools), "shortage_2023": len(shortage), "coordinates_2022": len(coords),
                 "facilities_2023": len(facilities), "enrollment_2023": len(enrollment),
                 "sbp_projects_2026": len(projects), "sbp_candidates": len(candidates), "join_review": len(review),
                 "fields": len(fields)},
        "checks": dict(sorted(counts.items())),
    }
    expect = {"schools": 60504, "shortage_2023": 47662, "coordinates_2022": 47828, "facilities_2023": 59101,
              "enrollment_2023": 47449, "sbp_projects_2026": 5652, "join_review": 52641}
    for k, v in expect.items():
        if meta["rows"][k] != v:
            fail(f"row count {k}: {meta['rows'][k]} (expected {v}: the workbook's Read Me, plus 300 schools from the shortage list)")

    tables = [
        ("schools", SCHOOLS, schools, "PRIMARY KEY (school_id)"),
        ("schools_shortage_2023", SHORTAGE, shortage, "PRIMARY KEY (school_id)"),
        ("schools_coordinates_2022", COORDS, coords, "PRIMARY KEY (school_id)"),
        ("schools_facilities_2023", FACILITIES, facilities, "PRIMARY KEY (school_id)"),
        ("schools_enrollment_2023", ENROLLMENT, enrollment, "PRIMARY KEY (school_id)"),
        ("schools_sbp_projects_2026", PROJECTS, projects, "PRIMARY KEY (project_id)"),
        ("schools_sbp_candidates", CANDIDATES, candidates, "PRIMARY KEY (project_id, rank)"),
        ("schools_join_review", JOIN_REVIEW, review, "PRIMARY KEY (review_id)"),
        ("schools_fields", FIELDS, fields, "PRIMARY KEY (worksheet, column_no)"),
        ("schools_meta", META, [{"key": k, "value": v if isinstance(v, str) else json.dumps(v)} for k, v in meta.items()], "PRIMARY KEY (key)"),
    ]
    not_null = {"school_id", "project_id", "rank", "review_id", "worksheet", "column_no", "field_name", "key", "registry_row"}

    def required(table, col):  # an unlinked project has no school
        return col in not_null and not (table == "schools_sbp_projects_2026" and col == "school_id")
    indexes = [
        "CREATE INDEX schools_region ON schools (region_key, division);",
        "CREATE INDEX schools_place ON schools (province, municipality);",
        "CREATE INDEX schools_legdist ON schools (province, legislative_district);",
        "CREATE INDEX schools_shortage_total ON schools_shortage_2023 (total_shortage);",
        "CREATE INDEX schools_sbp_school ON schools_sbp_projects_2026 (school_id);",
        "CREATE INDEX schools_sbp_modality ON schools_sbp_projects_2026 (modality);",
        "CREATE INDEX schools_sbp_candidates_school ON schools_sbp_candidates (school_id);",
        "CREATE INDEX schools_join_review_primary ON schools_join_review (primary_id);",
    ]
    view = """CREATE VIEW schools_sbp_rollup_2026 AS
SELECT school_id,
       COUNT(*)                                              AS project_record_count_id_linked,
       SUM(COALESCE(classrooms, 0))                          AS project_classrooms_numeric_sum,
       COUNT(classrooms)                                     AS project_classroom_value_rows,
       COUNT(*) - COUNT(classrooms)                          AS project_classroom_missing_rows,
       SUM(COALESCE(budget_php, 0))                          AS known_budget_sum_php,
       COUNT(budget_php)                                     AS known_budget_rows,
       SUM(budget_allocation_raw LIKE 'N/A (For Bidding)%')  AS for_bidding_project_count
FROM schools_sbp_projects_2026
WHERE link_status = 'ID-linked'
GROUP BY school_id;"""

    ddl = ["-- Generated by scripts/schools/build_d1.py; do not edit by hand.",
           "DROP VIEW IF EXISTS schools_sbp_rollup_2026;"]
    ddl += [f"DROP TABLE IF EXISTS {name};" for name, *_ in tables]
    for name, cols, _, pk in tables:
        body = [f"  {c} {SQL_TYPE[k]}{' NOT NULL' if required(name, c) else ''}" for c, _, k in cols]
        ddl.append(f"CREATE TABLE {name} (\n" + ",\n".join(body + [f"  {pk}"]) + "\n);")
    ddl += indexes + [view]
    schema = "\n".join(ddl) + "\n"
    with open(SCHEMA_PATH, "w") as f:
        f.write(schema)

    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, "d1-import.sql")
    n_statements = 0
    with open(out_path, "w") as f:
        f.write(schema)
        for name, cols, rows, _ in tables:
            names = [c for c, _, _ in cols]
            head = f"INSERT INTO {name} ({', '.join(names)}) VALUES\n"
            batch, size = [], len(head)
            for row in rows:
                vals = []
                for c, _, k in cols:
                    v = row.get(c)
                    if v is None:
                        if required(name, c):
                            fail(f"{name}.{c}: NULL in NOT NULL column")
                        vals.append("NULL")
                    elif SQL_TYPE[k] == "TEXT":
                        if not isinstance(v, str):
                            fail(f"{name}.{c}: {v!r} is not text")
                        vals.append("'" + v.replace("'", "''") + "'")
                    elif SQL_TYPE[k] == "INTEGER":
                        if not isinstance(v, int) or isinstance(v, bool):
                            fail(f"{name}.{c}: {v!r} is not an integer")
                        vals.append(str(v))
                    else:
                        if not isinstance(v, (int, float)) or isinstance(v, bool):
                            fail(f"{name}.{c}: {v!r} is not a number")
                        vals.append(repr(float(v)))
                tup = "(" + ", ".join(vals) + ")"
                if batch and size + len(tup) + 2 > MAX_STATEMENT:
                    f.write(head + ",\n".join(batch) + ";\n"); n_statements += 1
                    batch, size = [], len(head)
                batch.append(tup); size += len(tup) + 2
                if size > MAX_STATEMENT:
                    fail(f"{name}: one row is larger than a statement")
            if batch:
                f.write(head + ",\n".join(batch) + ";\n"); n_statements += 1

    print(json.dumps(meta["rows"], indent=1))
    print(json.dumps(meta["checks"], indent=1))
    print(f"wrote {out_path} ({os.path.getsize(out_path) / 1e6:.1f} MB, {n_statements} INSERT statements) and {SCHEMA_PATH}")


if __name__ == "__main__":
    main()
