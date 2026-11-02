#!/usr/bin/env python3
"""Every multi-purpose building line in every budget we hold, FY2015 GAA to the FY2027 House bill, on the map.

Which lines: the source workbench's MPB scope rule, a union of
  - PAP: the budget's own multi-purpose building lines. BIP (300226) and SIPAG (300220) from FY2022, the Local
    Program's MULTIPURPOSE / FACILITIES lines (300103, 300104) before that: the same codes as the multi-purpose
    page's chart, so these lines add up to it. FY2027: "BIP - Multi-Purpose Buildings/ Facilities to support
    Social Services";
  - title: a title that names a multi-purpose building or hall (upstream mpb_title_scope()), under any PAP.

Where each line goes on the map, first that works:
  1. GPS printed in the title (upstream analyze_text(), points outside the Philippines dropped);
  2. the place the title names: barangay, else municipality or city, else province (upstream Matcher);
  3. the DPWH office (DEO): the legislative district it serves, or all of them if it serves several;
  4. the region;
  5. nowhere: listed, not mapped.
The legislative district of a line is a separate lookup, the source's order: the title's place (PSGC2LEG), else
the GPS point, else the office when it serves one district. FY2027 is the source's own MPB lens, carried as is:
its rows, scope, district resolution, title places and GPS points; centroids are computed the same way for all.

Usage: build.py --upstream=<dir> --shapes=<dir> [--data=data] [--out=data/hgab/2027/mpb-years] [--cache=<dir>]

Outputs (contract: src/lib/hgab-mpb-years.ts):
  lines.json      every line, compact (dictionaries for places, offices, PAPs, districts)
  summary.json    per budget: lines, pesos, scope rule, placement census, reconciliation; checks; sources
  districts.json  legislative district outlines, simplified (GeoJSON), for the map
  lines.csv       every line, every budget (UTF-8 with BOM)
"""
from __future__ import annotations

import argparse, csv, hashlib, io, json, re, sys, unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import duckdb
from shapely.geometry import Point, shape, mapping
from shapely.ops import unary_union
from shapely.strtree import STRtree

GAA_YEARS = list(range(2020, 2027))      # the site's GAA extracts (data/18)
HISTORY_YEARS = [2015, 2016, 2017, 2018]  # the GAA history release's yearly files (data/gaa-history/parquet)
TEXT_YEAR = 2019                          # DBM's technical GAA for DPWH, as text (data/gaa-history/text/2019)
ALL_GAA_YEARS = sorted(HISTORY_YEARS + [TEXT_YEAR] + GAA_YEARS)
BUDGETS = [*({'key': f'gaa-{fy}', 'fy': fy, 'stage': 'gaa'} for fy in ALL_GAA_YEARS),
           {'key': 'nep-2027', 'fy': 2027, 'stage': 'nep'}, {'key': 'house-2027', 'fy': 2027, 'stage': 'house'}]
# The multi-purpose page's chart (src/lib/hgab-history.ts, series `mpb`): BIP_CODES.mpb, SIPAG_CODES.mpb, LOCAL_MPB.
# The same codes hold the Local Program in FY2018 and FY2019. FY2015–FY2017 use an older code set with no
# multi-purpose building line, so those years are in by title only.
MPB_PAP_PREFIXES = ('300226', '300220', '300103', '300104')
PAP_RULE_FROM = 2018
# FY2015–FY2017 titles often end a place with the legislative district of the time ("Pampanga 4th LD", "Mandaluyong
# City Lone District"), which stops the title matcher reading the place. Dropped for matching only; the title keeps it.
DISTRICT_QUALIFIER = re.compile(r'\s+(?:Lone|\d(?:st|nd|rd|th))\s+(?:Legislative\s+)?District\b'
                                r'|\s+\d(?:st|nd|rd|th)?\s*L\.?D\b\.?', re.IGNORECASE)
# FY2015 titles carry their program in front: "Local Infrastructure Program - Construction of …".
PAP_IN_TITLE = re.compile(r'^(Local Infrastructure Program|Construction/Repair/Rehabilitation/Improvement of Various '
                          r'Infrastructure including Local Projects)\s+-\s+')
TEXT_2019 = 'text/2019/32c79a9eba5fd2a5144e522c.txt'  # TechGAA2019/DPWH/A.pdf (documents-2019.json)
SOURCES = {
    'history': 'DBM technical GAA files (CSV, spreadsheets), from the GAA history release (data/gaa-history)',
    'text': 'DBM technical GAA for DPWH (PDF), read from its text in the GAA history release',
    'site': 'DBM GAA extracts on the site (data/18)',
}
# The source's review screen (buildMpbLegislativeLens.PH_LNG/PH_LAT is 116–127°E), widened west to take in the
# Kalayaan Island Group (Pag-asa is at 114.28°E); the land test below does the real screening.
PH_LNG, PH_LAT = (112.0, 127.0), (4.0, 22.0)
LAND_TOLERANCE = 0.02  # degrees, about 2 km: a coastal building stays, a point out at sea goes

LEVELS = ['gps', 'barangay', 'municipality', 'city', 'province', 'deo', 'region', 'none']
BASES = [None, 'title', 'gps', 'deo']
RULES = ['pap', 'title', 'pap+title']
CLASSES = [None, 'house_only', 'nep_only', 'paired']
FLAGS = {  # bit -> meaning (lines.json `flag_bits`)
    'gps_not_drawn': 1,            # a published GPS pair lies outside the Philippines or at sea, more than 2 km from
                                   # any legislative district: not drawn, and not used to place the line
    'gps_district_differs': 2,     # the GPS point lies in another legislative district than the title's place
    'office_elsewhere': 4,         # the title's place lies outside the DPWH office's area: GAA, another province than
                                   # the office is named for; FY2027, the source's office_location_mismatch
    'maguindanao_successor': 8,    # "Maguindanao" read as the successor province that holds the named town (RA 11550)
    'text_repaired': 16,           # garbled characters in the published text repaired (see GAA_TEXT_REPAIRS)
    'gps_wider_reader': 32,        # GPS read by WIDER_GPS: the source's reader found none (a pair written with a
                                   # space, a slash, N/E letters or a ˚ ring for the degree sign)
}

# The source's GPS reader skips pairs written "13.937600 120.731843", "13.927226/120.627343", "13.621615N, 123.186086E"
# or "16.272957˚, 120.419588˚" (about 250 lines, almost all FY2026). Read only when it finds no pair at all: two
# numbers with at least four decimals, one a Philippine latitude and the other a longitude, in either order; the
# box and land screens below still apply.
_NUM = r'(\d{1,3}\.\d{4,})'
_DEG = r'\s*[°˚º\u030a]?\s*([NSEW])?'
WIDER_GPS = re.compile(r'(?<![\d.])' + _NUM + _DEG + r'(?:\s*[,;/]\s*|\s+)' + _NUM + _DEG + r'(?![\d.])', re.IGNORECASE)


def wider_gps(text: str) -> list[tuple[float, float]]:
    out = []
    for m in WIDER_GPS.finditer(text or ''):
        a, b = float(m.group(1)), float(m.group(3))
        if 4 < a < 22 and 112 < b < 127:
            pt = (b, a)
        elif 4 < b < 22 and 112 < a < 127:
            pt = (a, b)
        else:
            continue
        if pt not in out:
            out.append(pt)
    return out
# UACS region code of a GAA operating unit -> our region key (src/lib/hgab.ts RegionKey)
UACS_REGION = {'01': 'I', '02': 'II', '03': 'III', '04': 'IV-A', '05': 'V', '06': 'VI', '07': 'VII', '08': 'VIII',
               '09': 'IX', '10': 'X', '11': 'XI', '12': 'XII', '13': 'NCR', '14': 'CAR', '15': 'BARMM', '16': 'XIII',
               '17': 'MIMAROPA', '18': 'NIR'}
# PSGC region code (first two digits) -> region key
PSGC_REGION = {'01': 'I', '02': 'II', '03': 'III', '04': 'IV-A', '05': 'V', '06': 'VI', '07': 'VII', '08': 'VIII',
               '09': 'IX', '10': 'X', '11': 'XI', '12': 'XII', '13': 'NCR', '14': 'CAR', '16': 'XIII',
               '17': 'MIMAROPA', '18': 'NIR', '19': 'BARMM'}
# The source's region labels (congress index, region cards) -> region key
def region_key(label: str | None) -> str | None:
    if not label:
        return None
    s = label.upper().replace('‐', '-')
    if re.search(r'\bNCR\b|NATIONAL CAPITAL|METRO MANILA', s): return 'NCR'
    if re.search(r'\bCAR\b|CORDILLERA', s): return 'CAR'
    if re.search(r'\bBARMM\b|BANGSAMORO|\bARMM\b', s): return 'BARMM'
    if re.search(r'\bNIR\b|NEGROS ISLAND', s): return 'NIR'
    if re.search(r'MIMAROPA|\bIV-?B\b', s): return 'MIMAROPA'
    if re.search(r'CALABARZON|\bIV-?A\b', s): return 'IV-A'
    if re.search(r'CARAGA|\bXIII\b', s): return 'XIII'
    m = re.search(r'\bREGION\s+([IVX]+)\b', s)
    return m.group(1) if m and m.group(1) in {'I', 'II', 'III', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'} else None


# Garbled characters in the GAA text (FY2020–FY2026 extract). Each rule is exact and changes characters only,
# never a place name; the published text is kept beside the repaired one.
GAA_TEXT_REPAIRS = [
    ('byte_order_mark', re.compile('﻿'), ''),
    ('enye_as_plus_minus', re.compile(r'(?<=[A-Za-z])±(?=[A-Za-z])'), 'ñ'),
    ('enye_as_caron_or_acute', re.compile(r'(?<=[A-Za-z])[ňń](?=[A-Za-z])'), 'ñ'),
    ('dash_as_c1_control', re.compile('\x96'), '–'),
    ('dash_as_u_circumflex', re.compile(r'(?<= )û(?= )'), '–'),
    ('apostrophe_as_ae', re.compile(r'(?<=[a-z])Æ(?=s\b|\s)'), '’'),
    ('stray_trailing_a_acute', re.compile(r'(?<=[A-Za-z])á\s*$'), ''),
    ('cyrillic_lookalikes', re.compile('deОго'), 'de Oro'),
]


def repair_text(text: str) -> tuple[str, list[str]]:
    rules = []
    for name, rx, sub in GAA_TEXT_REPAIRS:
        out = rx.sub(sub, text)
        if out != text:
            rules.append(name)
            text = out
    return text, rules


def tidy_label(s: str | None) -> str | None:
    """PAP descriptions as the GAA extract spaces them ("Program ( BIP )   -   Multi  -  Purpose") made readable."""
    if not s:
        return s
    s = re.sub(r'\s+', ' ', s).strip()
    s = re.sub(r'\(\s+', '(', s)
    s = re.sub(r'\s+\)', ')', s)
    s = re.sub(r'\s*/\s*', '/', s)
    s = re.sub(r'(?i)multi\s*-\s*purpose', 'Multi-Purpose', s)
    return s


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def fail(msg: str):
    raise SystemExit(f'build-hgab-mpb-years: {msg}')


def ensure(cond, msg: str):
    if not cond:
        fail(msg)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--upstream', required=True)
    ap.add_argument('--shapes', required=True)
    ap.add_argument('--data', default='data')
    ap.add_argument('--out', default='data/hgab/2027/mpb-years')
    ap.add_argument('--cache', default='/tmp/hgab-mpb-years-cache')
    ap.add_argument('--history', default='data/gaa-history')
    args = ap.parse_args()
    up, shapes, data, out, cache = (Path(args.upstream), Path(args.shapes), Path(args.data), Path(args.out), Path(args.cache))
    hist_dir = Path(args.history)
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import gaa2019  # noqa: E402
    out.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    log = lambda s: print(s, flush=True)

    # ------------------------------------------------------------------ upstream code, imported as published
    sys.path[:0] = [str(up / 'analysis/web'), str(up / 'master_list/scripts'), str(up / 'gps-analysis'),
                    str(up / 'analysis/builders')]
    from buildMpbLegislativeLens import MPB_PAP, mpb_title_scope  # noqa: E402
    import buildMpbPsgcApproxOverlay as approx  # noqa: E402
    from locations import SCORE_METHOD, Matcher, normalize  # noqa: E402
    from readable_titles import TITLE_CLEAN_METHOD, readable_title  # noqa: E402
    from scan_gps_inventory import analyze_text  # noqa: E402
    from normalize_labels import apply_place_spellings  # noqa: E402

    catalog = [json.loads(s) for s in (up / 'PSGC2LEG/data/psgc_locations.jsonl').read_text().splitlines()]
    psgc = {r['code']: r for r in catalog}
    matcher = Matcher(catalog)
    leg_assign = {}
    for s in (up / 'PSGC2LEG/data/psgc_leg_assignments.jsonl').read_text().splitlines():
        r = json.loads(s)
        leg_assign[r['psgc_code']] = r

    # ------------------------------------------------------------------ legislative districts (ours) and their outlines (source)
    dist_index = json.loads((data / 'hgab/2027/districts.json').read_text())
    our_districts = {d['id']: d for d in dist_index['districts']}
    offices = dist_index['offices']
    dmap = json.loads((up / 'analysis/data/congress_district_map_2027.json').read_text())
    ensure(len(dmap['features']) == 254, f"district map has {len(dmap['features'])} outlines, expected 254")
    psgc_leg_to_district = {}
    district_geom = {}
    for f in dmap['features']:
        p = f['properties']
        ensure(p['district_id'] in our_districts, f"district map id {p['district_id']} is not one of our 254 districts")
        psgc_leg_to_district[p['psgc_leg_id']] = p['district_id']
        district_geom[p['district_id']] = shape(f['geometry'])
    ensure(set(district_geom) == set(our_districts), 'district outlines do not cover our 254 districts')
    dist_ids = sorted(district_geom)
    tree = STRtree([district_geom[d] for d in dist_ids])

    def on_land(lng, lat):
        return len(tree.query(Point(lng, lat), predicate='dwithin', distance=LAND_TOLERANCE)) > 0

    def gps_district(points):
        hits = set()
        for lng, lat in points:
            pt = Point(lng, lat)
            for i in tree.query(pt, predicate='within'):
                hits.add(dist_ids[i])
        return next(iter(hits)) if len(hits) == 1 else None

    # ------------------------------------------------------------------ centroids: barangay/municipality (source), province, district, region
    # The workbench reads Municities/Municities.shp.shp (psgc_code); the shapefiles' dist zips name the same
    # outlines PH_Adm3_MuniCities (adm3_psgc). Either works; provinces likewise.
    pick = lambda d, *names: next((shapes / d / n for n in names if (shapes / d / n).exists()), shapes / d / names[0])
    muni_shp = pick('Municities', 'Municities.shp.shp', 'PH_Adm3_MuniCities.shp.shp')
    bgy_shp = pick('BgySubMuns', 'PH_Adm4_BgySubMuns.shp.shp')
    prov_shp = pick('Provdists', 'Provdists.shp.shp', 'PH_Adm2_ProvDists.shp.shp')
    for f in (muni_shp, bgy_shp, prov_shp):
        ensure(f.exists(), f'{f} not found (SHAPES_DIR)')
    centroid_cache = cache / f"centroids-{sha256(bgy_shp)[:12]}-{sha256(muni_shp)[:12]}.json"
    if centroid_cache.exists():
        centroids = json.loads(centroid_cache.read_text())
    else:
        log('centroids: reading the 2023 PSA shapefiles (once; cached)')
        import geopandas as gpd
        read_file = gpd.read_file

        def read_renamed(path, *a, **k):
            df = read_file(path, *a, **k)
            name = Path(path).name
            if name.startswith('PH_Adm3'):
                return df.rename(columns={'adm3_psgc': 'psgc_code'})
            if name.startswith('PH_Adm2'):
                return df.rename(columns={'adm2_psgc': 'psgc_code', 'adm2_en': 'name'})
            return df
        approx.gpd.read_file = read_renamed
        approx.MUNICITY_SHP, approx.BARANGAY_SHP = muni_shp, bgy_shp
        centroids = approx.load_centroids()
        prov = read_renamed(prov_shp)
        prov = prov[prov['geo_level'].isin(['Prov', 'Dist'])][['psgc_code', 'name', 'geometry']].to_crs(4326)
        for row in prov.itertuples(index=False):
            code = approx.modernize(str(int(row.psgc_code)).zfill(10))
            pt = row.geometry.representative_point()
            centroids[code] = {'lng': float(pt.x), 'lat': float(pt.y), 'level': 'province', 'name': row.name,
                               'source': 'province_2023'}
        centroid_cache.write_text(json.dumps(centroids))
    district_anchor = {d: g.representative_point() for d, g in district_geom.items()}

    def union_anchor(ids):
        g = unary_union([district_geom[d] for d in ids])
        p = g.representative_point()
        return float(p.x), float(p.y)

    # ------------------------------------------------------------------ the place dictionary
    places: dict[str, dict] = {}

    def psgc_label(code):
        anc = matcher.ancestry(code)
        parts = []
        for lvl in ('barangay', 'sub_municipality', 'municipality', 'city', 'province'):
            if lvl in anc:
                parts.append(psgc[anc[lvl]]['name'])
        return ', '.join(parts) or psgc[code]['name']

    def psgc_region(code):
        return PSGC_REGION.get(code[:2])

    def leg_district_of(code):
        """PSGC2LEG: barangay rows of split cities first, else the municipality/city; one district or none."""
        anc = matcher.ancestry(code)
        cands = []
        if 'barangay' in anc:
            cands.append(anc['barangay'])
        for lvl in ('sub_municipality', 'municipality', 'city'):
            if lvl in anc:
                cands.append(anc[lvl])
        for c in cands:
            a = leg_assign.get(c)
            if a and a.get('leg_id'):
                return psgc_leg_to_district.get(a['leg_id'])
        return None

    province_districts = defaultdict(set)
    for code, a in leg_assign.items():
        if a.get('leg_id') and a.get('parent_province_code'):
            province_districts[a['parent_province_code']].add(psgc_leg_to_district.get(a['leg_id']))

    def district_of_place(code, level):
        if level == 'province':
            ds = {d for d in province_districts.get(code, set()) if d}
            return next(iter(ds)) if len(ds) == 1 else None
        return leg_district_of(code)

    def psgc_place(code, level, drawn=None):
        """A place named by a title. `drawn` = the unit whose centroid anchors it (upstream resolve_centroid)."""
        key = f'psgc:{code}'
        if key not in places:
            anchor = drawn
            if anchor is None:
                c = centroids.get(code) or centroids.get(approx.modernize(code))
                anchor = c
            places[key] = {
                'key': key, 'level': level, 'name': psgc[code]['name'], 'label': psgc_label(code),
                'lng': round(anchor['lng'], 6) if anchor else None, 'lat': round(anchor['lat'], 6) if anchor else None,
                'anchor': (anchor or {}).get('placement_reason') or (anchor or {}).get('source'),
                'region': psgc_region(code),
                'province': psgc[matcher.ancestry(code)['province']]['name'] if 'province' in matcher.ancestry(code) else None,
                'district_ids': [d for d in [district_of_place(code, level)] if d],
            }
        return key

    def district_place(district_id):
        key = f'district:{district_id}'
        if key not in places:
            d = our_districts[district_id]
            pt = district_anchor[district_id]
            places[key] = {'key': key, 'level': 'deo', 'name': d['label'], 'label': d['label'],
                           'lng': round(pt.x, 6), 'lat': round(pt.y, 6), 'anchor': 'district_outline',
                           'region': region_key(d['region']), 'province': None, 'district_ids': [district_id]}
        return key

    def office_group_place(name, ids):
        ids = sorted(ids)
        key = 'offices:' + '+'.join(ids)
        if key not in places:
            lng, lat = union_anchor(ids)
            regions = {region_key(our_districts[d]['region']) for d in ids}
            places[key] = {'key': key, 'level': 'deo', 'name': name, 'label': name,
                           'lng': round(lng, 6), 'lat': round(lat, 6), 'anchor': 'district_outlines',
                           'region': next(iter(regions)) if len(regions) == 1 else None, 'province': None,
                           'district_ids': ids}
        return key

    region_anchor = {}
    by_region = defaultdict(list)
    for d in dist_ids:
        by_region[region_key(our_districts[d]['region'])].append(d)

    def region_place(rk):
        key = f'region:{rk}'
        if key not in places:
            lng, lat = union_anchor(by_region[rk])
            places[key] = {'key': key, 'level': 'region', 'name': rk, 'label': rk, 'lng': round(lng, 6),
                           'lat': round(lat, 6), 'anchor': 'district_outlines', 'region': rk, 'province': None,
                           'district_ids': []}
        return key

    def centroid_for(code, level, municipality_code=None):
        """Upstream resolve_centroid() for barangays, municipalities and cities; provinces from the 2023 outlines."""
        if level == 'province':
            c = centroids.get(code) or centroids.get(approx.modernize(code))
            return ({**c, 'psgc_code': code, 'placement_reason': 'province_2023'}, 'province') if c else (None, None)
        if level == 'sub_municipality':
            anc = matcher.ancestry(code)
            code, level = anc.get('city', code), 'city'
        hit, reason = approx.resolve_centroid({'level': level, 'psgc_code': code, 'municipality_code': municipality_code},
                                              centroids)
        return hit, reason

    # ------------------------------------------------------------------ GAA FY2020–FY2026
    con = duckdb.connect()
    fp = str(data / '18/fpaps/*/*.parquet')
    ou = str(data / '18/operating_units/*/*.parquet')
    con.sql(f"""CREATE TABLE f AS SELECT id, code, description, CAST(year AS INTEGER) fy,
               CAST(ROUND(amount * 1000) AS BIGINT) php FROM read_parquet('{fp}', hive_partitioning = true)""")
    con.sql(f"""CREATE TABLE o AS SELECT fpap_id, code ou_code, description ou_name, CAST(year AS INTEGER) fy,
               CAST(ROUND(amount * 1000) AS BIGINT) php FROM read_parquet('{ou}', hive_partitioning = true) WHERE amount > 0""")
    paps = {(fy, code[:6]): tidy_label(d) for fy, code, d in con.sql(
        "SELECT fy, code, description FROM f WHERE code LIKE '______000000000'").fetchall()}
    full = str(data / '18/full_extract.csv')
    con.sql(f"""CREATE TABLE reg AS SELECT DISTINCT CAST(year AS INTEGER) fy, prexc_fpap_id code, operunit ou_code, uacs_reg_id reg
               FROM read_csv('{full}', all_varchar = true, header = true)
               WHERE CAST(amt AS DOUBLE) > 0 AND prexc_fpap_id LIKE '3%'""")
    rows = con.sql("""SELECT f.fy, f.code, f.description, f.php, o.ou_name, o.ou_code, o.php, r.reg
                      FROM f LEFT JOIN o ON o.fpap_id = f.id AND o.fy = f.fy
                      LEFT JOIN reg r ON r.fy = f.fy AND r.code = f.code AND r.ou_code = o.ou_code
                      WHERE f.php > 0 AND f.code NOT LIKE '%\\_%' ESCAPE '\\' AND length(f.code) = 15
                      ORDER BY f.fy, f.code""").fetchall()
    log(f'GAA: {len(rows):,} DPWH lines with an amount, FY{GAA_YEARS[0]}–FY{GAA_YEARS[-1]}')
    gaa_rows = [{'fy': fy, 'code': code, 'desc': desc, 'php': php, 'ou': ou_name, 'reg': reg, 'source': 'site',
                 'ou_php': ou_php, 'offices': 1} for fy, code, desc, php, ou_name, ou_code, ou_php, reg in rows]

    hist_files = [hist_dir / f'parquet/gaa-{fy}.parquet' for fy in HISTORY_YEARS]
    for f in hist_files:
        ensure(f.exists(), f'{f} not found (--history)')
    files_sql = ', '.join(f"'{f}'" for f in hist_files)
    hist_rows = con.sql(f"""SELECT fy, fpap_code, any_value(fpap_dsc), SUM(amount) php, arg_max(operunit_dsc, amount),
               arg_max(region_code, amount), count(DISTINCT operunit_dsc)
               FROM read_parquet([{files_sql}], union_by_name = true)
               WHERE department_id = '18' GROUP BY 1, 2 ORDER BY 1, 2""").fetchall()
    zero_listed = Counter()
    for fy, code, desc, php, ou_name, reg, n_ou in hist_rows:
        if php == 0:
            if mpb_title_scope(PAP_IN_TITLE.sub('', desc or ''))[1]:
                zero_listed[fy] += 1
            continue
        if php > 0:
            gaa_rows.append({'fy': fy, 'code': code, 'desc': desc, 'php': php, 'ou': ou_name, 'reg': reg,
                             'source': 'history', 'ou_php': php, 'offices': n_ou})
    log(f'GAA history: {sum(1 for r in gaa_rows if r["source"] == "history"):,} DPWH lines with an amount, '
        f'FY{HISTORY_YEARS[0]}–FY{HISTORY_YEARS[-1]}')

    t19 = gaa2019.parse(str(hist_dir / TEXT_2019))
    total19 = sum(x['php'] for x in t19['lines'])
    ensure(t19['department_total'] == total19,
           f"FY2019: the parsed lines add up to ₱{total19:,}, the document's DPWH total is ₱{t19['department_total']}")
    bad19 = {k: v for k, v in t19['recon'].items() if not v['ok']}
    ensure(not bad19, f'FY2019: headings that the parsed lines do not add up to: {bad19}')
    for x in t19['lines']:
        gaa_rows.append({'fy': TEXT_YEAR, 'code': x['code'], 'desc': x['title'], 'php': x['php'], 'ou': x['office'],
                         'reg': None, 'source': 'text', 'ou_php': x['php'], 'offices': 1})
    paps.update({(TEXT_YEAR, k): tidy_label(v) for k, v in t19.get('pap_titles', {}).items()})
    log(f"FY2019 text: {len(t19['lines']):,} DPWH lines, ₱{total19:,} = the document's total; "
        f"{len(t19['recon'])} headings reconcile")

    label_office = {}
    label_any = {}  # FY2015–FY2019: office names join the crosswalk as they do in later years
    for oid, o in offices.items():
        for y in o['years']:
            if y['stage'] == 'gaa' and y['matched_label']:
                for lab in y['matched_label'].split(' + '):
                    label_office[(y['fy'], lab)] = oid
                    label_any.setdefault(lab, oid)
    magui = {'1908700000': [], '1908800000': []}  # Maguindanao del Norte, del Sur (RA 11550)
    for r in catalog:
        if r['level'] in ('municipality', 'city') and r['parent_code'] in magui:
            magui[r['parent_code']].append(normalize(r['name']))

    def maguindanao_successor(title):
        """'…, <town>, Maguindanao' in a pre-2023 title: the successor province holding the named town, if exactly one."""
        if not re.search(r'\bMaguindanao\b(?!\s+del\b)', title):
            return None
        words = f' {normalize(title)} '
        hits = [code for code, towns in magui.items() if any(f' {t} ' in words for t in towns)]
        return hits[0] if len(hits) == 1 else None

    def town_of(code):
        anc = matcher.ancestry(code)
        return next((anc[k] for k in ('municipality', 'city', 'sub_municipality') if k in anc), None)

    def place_for(code, level):
        """The place dictionary key for a title's place: upstream resolve_centroid() for barangays, towns and
        cities (a barangay with no 2023 outline falls back to its town), the 2023 outline for provinces; a town with
        no outline falls back to its province."""
        anc = matcher.ancestry(code)
        hit, reason = centroid_for(code, level, town_of(code) if level == 'barangay' else None)
        if hit:
            if reason in ('direct', 'province'):
                lvl = 'city' if level == 'sub_municipality' else level
                return psgc_place(code, lvl, hit)
            drawn = hit['psgc_code']
            lvl = psgc[drawn]['level']
            return psgc_place(drawn, 'city' if lvl == 'sub_municipality' else lvl, hit)
        if level != 'province' and 'province' in anc:
            return place_for(anc['province'], 'province')
        return None

    REGION_IN_TITLE = re.compile(r'\b(?:Region\s+(?:IV-?[AB]|X{0,1}(?:IX|IV|V?I{0,3}))\b|NCR|CAR|BARMM|CARAGA|MIMAROPA|CALABARZON|SOCCSKSARGEN)', re.I)

    def title_region_named(title):
        hits = {region_key(m.group(0)) for m in REGION_IN_TITLE.finditer(title)} - {None}
        return hits.pop() if len(hits) == 1 else None

    lines = []
    seen = set()
    census = Counter()
    multi_office = Counter()
    for row in gaa_rows:
        fy, code, desc, php, ou_name, reg, ou_php = (row['fy'], row['code'], row['desc'], row['php'], row['ou'],
                                                      row['reg'], row['ou_php'])
        title_pub = desc
        title, repairs = repair_text(desc)
        title = readable_title(title)['title_clean']
        prog = PAP_IN_TITLE.match(title)
        if prog:
            title = title[prog.end():]
        pap_hit = fy >= PAP_RULE_FROM and code.startswith(MPB_PAP_PREFIXES)
        fragment, title_hit = mpb_title_scope(title)
        if not (pap_hit or title_hit):
            continue
        ensure(ou_name is not None, f'FY{fy} {code}: no operating unit')
        ensure(ou_php == php, f'FY{fy} {code}: operating unit amount {ou_php} != line amount {php}')
        if row['offices'] > 1:
            multi_office[fy] += 1
        lid = f'gaa:{fy}:{code}'
        ensure(lid not in seen, f'{lid} twice')
        seen.add(lid)
        flags = FLAGS['text_repaired'] if repairs else 0
        office_id = label_office.get((fy, ou_name)) or (label_any.get(ou_name) if fy < GAA_YEARS[0] else None)
        office = offices.get(office_id) if office_id else None
        is_deo = 'District Engineering Office' in ou_name
        is_co = ou_name == 'Central Office'
        office_region = region_key(office['region']) if office else (UACS_REGION.get(reg) if not is_co else None)
        region_hint = None
        if office_region:
            region_hint = matcher.region_code({'NCR': 'NCR', 'CAR': 'CAR', 'BARMM': 'BARMM', 'NIR': 'NIR',
                                               'MIMAROPA': 'MIMAROPA', 'XIII': 'Region XIII'}.get(office_region,
                                                                                                    f'Region {office_region}'))
        office_hint = matcher.province_code(apply_place_spellings(ou_name)) if is_deo else None

        # 1. GPS in the title: the source's reader, else the wider one
        g = analyze_text(title_pub)
        pts = []
        found = [(p.get('longitude'), p.get('latitude')) for p in (g or {}).get('points', [])
                 if p.get('longitude') is not None and p.get('latitude') is not None]
        if not found:
            found = wider_gps(title)
            if found:
                flags |= FLAGS['gps_wider_reader']
        for lng, lat in found:
            if lng is None or lat is None:
                continue
            if PH_LNG[0] < lng < PH_LNG[1] and PH_LAT[0] < lat < PH_LAT[1] and on_land(lng, lat):
                if [round(lng, 6), round(lat, 6)] not in pts:
                    pts.append([round(lng, 6), round(lat, 6)])
            else:
                flags |= FLAGS['gps_not_drawn']

        # 2. the place the title names
        match_title = DISTRICT_QUALIFIER.sub('', title) if fy < GAA_YEARS[0] else title
        succ = maguindanao_successor(title)
        if succ:
            match_title = re.sub(r'\bMaguindanao\b(?!\s+del\b)', psgc[succ]['name'], match_title)
            flags |= FLAGS['maguindanao_successor']
        m = matcher.match(match_title, (), region_hint, office_hint)
        place_code, place_level = None, None
        locs = m['locations'] if m['status'] in ('name_matched', 'multiple_locations', 'province_only') else []
        if len(locs) == 1:
            place_code, place_level = locs[0]['psgc_code'], locs[0]['level']
        elif len(locs) > 1:
            # Several places: the specific one when the rest is province context (an independent city written
            # with its old province: "Bacolod City, Negros Occidental"; the shared method's normative rule), else
            # the town they share, else the province they share.
            specific = [l for l in locs if l['level'] != 'province']
            towns = {town_of(l['psgc_code']) for l in specific}
            provs = {l['ancestry'].get('province', {}).get('code') for l in specific}
            if len(specific) == 1:
                place_code, place_level = specific[0]['psgc_code'], specific[0]['level']
            elif specific and len(towns) == 1 and None not in towns:
                place_code = towns.pop()
                place_level = psgc[place_code]['level']
            elif specific and len(provs) == 1 and None not in provs:
                place_code, place_level = provs.pop(), 'province'
            elif not specific and len(locs) == 1:
                place_code, place_level = locs[0]['psgc_code'], 'province'
        if place_level == 'special_geographic_area':
            place_code = place_level = None
        title_region = psgc_region(place_code) if place_code else None

        # placement
        place_key, level = None, None
        if place_code:
            place_key = place_for(place_code, place_level)
            if place_key:
                level = places[place_key]['level']
        if pts:
            level = 'gps'
        elif place_key is None:
            dids = office['district_ids'] if office else []
            if len(dids) == 1:
                place_key, level = district_place(dids[0]), 'deo'
            elif len(dids) > 1:
                place_key, level = office_group_place(f"DPWH {office['name']}", dids), 'deo'
            elif office_region or title_region_named(title):
                place_key, level = region_place(office_region or title_region_named(title)), 'region'
            else:
                level = 'none'

        # legislative district: the title's place, else the GPS point, else the office's one district
        district, basis = None, None
        if place_code:
            district = district_of_place(place_code, 'province' if place_level == 'province' else place_level)
            basis = 'title' if district else None
        gd = gps_district(pts) if pts else None
        if district is None and gd:
            district, basis = gd, 'gps'
        elif district and gd and gd != district:
            flags |= FLAGS['gps_district_differs']
        if district is None and office and len(office['district_ids']) == 1:
            district, basis = office['district_ids'][0], 'deo'
        # The office is named for a province and the title's place lies in another one. (Comparing districts would
        # be wrong for past years: offices then served other districts than the 2025 crosswalk says.)
        title_prov = matcher.ancestry(place_code).get('province') if place_code else None
        if office_hint and title_prov and title_prov != office_hint:
            flags |= FLAGS['office_elsewhere']

        census[(fy, level)] += 1
        lines.append({
            'id': lid, 'fy': fy, 'title': title, 'title_published': title_pub if title != title_pub else None,
            'code': code, 'gaa_php': php, 'nep_php': None, 'house_php': None, 'class': None,
            'office': ou_name,
            # The PAP: the extract's heading; FY2018 shares FY2020's codes; FY2015 prints it in the title; FY2016–FY2017
            # files carry none.
            'pap': (paps.get((fy, code[:6])) or (paps.get((GAA_YEARS[0], code[:6])) if fy >= PAP_RULE_FROM else None)
                    or (prog.group(1) if prog else '')),
            'rule': 'pap+title' if pap_hit and title_hit else ('pap' if pap_hit else 'title'),
            'level': level, 'place': place_key, 'pts': pts or None,
            'district': district, 'basis': basis,
            'region': title_region or office_region,
            'flags': flags, 'repairs': repairs, 'psgc_status': m['status'],
        })
    log(f'GAA: {len(lines):,} multi-purpose building lines')

    # ------------------------------------------------------------------ FY2027: the source's MPB lens, as is
    lens = json.loads((up / 'analysis/data/mpb_legislative_index_2027.json').read_text())
    comp_path = up / 'analysis/data/comparison_projects_2027.json'
    ensure(sha256(comp_path) == lens['input_provenance']['comparison']['sha256'],
           'the MPB lens was built from another comparison_projects_2027.json than the pinned one')
    comp = {r['id']: r for r in json.loads(comp_path.read_text())['projects']}
    ours = {r[0]: r for r in con.sql(f"""SELECT id, title, nep_php, hgab3_php, pap, office, region, nep_page, hgab3_page
        FROM read_parquet('{data / 'hgab/2027/dpwh/projects.parquet'}')""").fetchall()}
    classes = {}
    for card in lens['cards'] + lens['region_cards']:
        for b, ids in card['row_ids'].items():
            for rid in ids:
                ensure(rid not in classes, f'lens row {rid} on two cards')
                classes[rid] = 'house_only' if b == 'insertions' else ('nep_only' if b == 'deletions' else 'paired')
    ensure(set(classes) == set(lens['row_scope']), 'lens cards and row_scope disagree')
    ensure(len(classes) == lens['counts']['rows'], 'lens row count')
    flag_map_2027 = {'office_location_mismatch': FLAGS['office_elsewhere']}
    at_sea_2027 = 0
    wider_2027 = 0
    group_districts = {card['id'].removeprefix('mpb:deo:'): [x['id'] for x in card['districts']]
                       for card in lens['cards'] if card.get('location_tier') == 'deo'}
    for rid in sorted(classes, key=lambda r: (r.split(':')[0], int(r.split(':')[-1]) if r.split(':')[-1].isdigit() else r)):
        c = comp[rid]
        o = ours.get(rid)
        ensure(o is not None, f'FY2027 {rid} not in our projects.parquet')
        nep = (c.get('nep') or {}).get('amount_php')
        house = (c.get('third') or {}).get('amount_php')
        ensure(o[1] == c['title'] and o[2] == nep and o[3] == house and o[4] == c['pap'],
               f'FY2027 {rid}: our projects.parquet differs from the pinned comparison rows')
        scope = lens['row_scope'][rid]
        rule = 'pap+title' if set(scope['rules']) == {'pap', 'title'} else scope['rules'][0]
        ensure((c['pap'] == MPB_PAP) == ('pap' in scope['rules']), f'{rid}: lens PAP rule disagrees with its PAP')
        res = lens['row_resolution'][rid]
        flags = 0
        for fl in lens['row_flags'].get(rid, []):
            flags |= flag_map_2027.get(fl, 0)
        pts = []
        for p in lens['row_points'].get(rid, []):
            if on_land(p['lng'], p['lat']):
                pts.append([round(p['lng'], 6), round(p['lat'], 6)])
            else:
                flags |= FLAGS['gps_not_drawn']
                at_sea_2027 += 1
        if not lens['row_points'].get(rid):
            extra = [(lng, lat) for lng, lat in wider_gps(c['title'])
                     if PH_LNG[0] < lng < PH_LNG[1] and PH_LAT[0] < lat < PH_LAT[1]]
            if extra:
                flags |= FLAGS['gps_wider_reader']
                for lng, lat in extra:
                    if on_land(lng, lat):
                        pts.append([round(lng, 6), round(lat, 6)])
                        wider_2027 += 1
                    else:
                        flags |= FLAGS['gps_not_drawn']
        rp = lens['row_psgc'].get(rid)
        place_key = place_for(str(rp['psgc_code']).zfill(10), rp['level']) if rp and rp.get('psgc_code') else None
        level = None
        if pts:
            level = 'gps'
        elif place_key:
            level = places[place_key]['level']
        basis_map = {'title_psgc': 'title', 'deo_to_leg': 'deo'}
        district = res['target_id'] if res['basis'] in basis_map else None
        gd = gps_district(pts) if pts else None
        if district and gd and gd != district:
            flags |= FLAGS['gps_district_differs']
        basis = basis_map.get(res['basis'])
        if district:
            ensure(district in our_districts, f'{rid}: lens district {district} unknown')
        if level is None:
            if res['basis'] in ('title_psgc', 'deo_to_leg'):
                place_key, level = district_place(district), 'deo'
            elif res['basis'] == 'deo':
                ids = group_districts.get(res['target_id'])
                ensure(ids, f'{rid}: office group {res["target_id"]} has no districts')
                office_label = ((c.get('third') or {}).get('office') or (c.get('nep') or {}).get('office') or '')
                place_key, level = office_group_place(f'DPWH {office_label}'.strip(), ids), 'deo'
            elif res['basis'] == 'region':
                rk = region_key(res['target_id'])
                ensure(rk, f'{rid}: region {res["target_id"]} unknown')
                place_key, level = region_place(rk), 'region'
            else:
                level = 'none'
        place_region = places[place_key]['region'] if place_key else None
        office_name = ((c.get('third') or {}).get('office') or (c.get('nep') or {}).get('office'))
        census[(2027, level)] += 1
        lines.append({
            'id': rid, 'fy': 2027, 'title': readable_title(c['title'])['title_clean'], 'title_published': None,
            'code': None, 'gaa_php': None, 'nep_php': nep, 'house_php': house, 'class': classes[rid],
            'office': office_name, 'pap': c['pap'], 'rule': rule, 'level': level, 'place': place_key,
            'pts': pts or None, 'district': district, 'basis': basis,
            'region': place_region or region_key(c.get('region')), 'flags': flags, 'repairs': [],
            'psgc_status': None, 'nep_page': o[7], 'house_page': o[8],
        })
    log(f'FY2027: {sum(1 for l in lines if l["fy"] == 2027):,} lines from the source MPB lens')

    # ------------------------------------------------------------------ budgets, reconciliation, checks
    history = json.loads((data / 'hgab/2027/history.json').read_text())
    mpb_series = next(s for s in history['series'] if s['key'] == 'mpb')
    col_index = {c['key']: i for i, c in enumerate(history['columns'])}
    checks = []

    def check(key, ok, detail):
        checks.append({'key': key, 'ok': bool(ok), 'detail': detail})
        ensure(ok, f'check {key} failed: {detail}')

    def amount(l, b):
        return l['gaa_php'] if b['stage'] == 'gaa' else (l['nep_php'] if b['stage'] == 'nep' else l['house_php'])

    budgets = []
    for b in BUDGETS:
        sel = [l for l in lines if l['fy'] == b['fy'] and amount(l, b) is not None]
        php = sum(amount(l, b) for l in sel)
        pap_php = sum(amount(l, b) for l in sel if 'pap' in l['rule'])
        title_only = [l for l in sel if l['rule'] == 'title']
        hist = mpb_series['php'][col_index[b['key']]] if b['key'] in col_index else None
        if hist is not None:
            check(f'history:{b["key"]}', pap_php == hist,
                  f'{b["key"]}: the MPB budget lines here add up to ₱{pap_php:,}; the chart on the multi-purpose page says ₱{hist:,}')
        lv = Counter(l['level'] for l in sel)
        budgets.append({
            **b, 'lines': len(sel), 'php': php, 'pap_lines': sum(1 for l in sel if 'pap' in l['rule']),
            'pap_php': pap_php, 'title_only_lines': len(title_only), 'title_only_php': sum(amount(l, b) for l in title_only),
            'history_php': hist, 'levels': {k: lv.get(k, 0) for k in LEVELS},
            'source': (SOURCES['history'] if b['fy'] in HISTORY_YEARS else SOURCES['text'] if b['fy'] == TEXT_YEAR
                       else SOURCES['site'] if b['stage'] == 'gaa' else 'The source workbench (FY2027 NEP and House bill)'),
            'pap_rule': b['fy'] >= PAP_RULE_FROM,
            'listed_at_zero': zero_listed.get(b['fy'], 0) if b['stage'] == 'gaa' else 0,
            'multi_office_lines': multi_office.get(b['fy'], 0) if b['stage'] == 'gaa' else 0,
            'with_district': sum(1 for l in sel if l['district']),
            'districts': len({l['district'] for l in sel if l['district']}),
            'flags': {k: sum(1 for l in sel if l['flags'] & bit) for k, bit in FLAGS.items()},
        })
        log(f"  {b['key']:<11} {len(sel):>6,} lines  ₱{php:>17,}  (budget lines ₱{pap_php:,}{' = chart' if hist is not None else ''})  "
            + ' '.join(f'{k}={lv.get(k, 0)}' for k in LEVELS))
    for l in lines:
        ensure(l['level'] in LEVELS, f"{l['id']}: no placement")
        ensure((l['level'] == 'gps') == bool(l['pts']), f"{l['id']}: gps placement without points or the reverse")
        ensure(l['level'] in ('gps', 'none') or l['place'] in places, f"{l['id']}: placed nowhere")
        ensure(l['district'] is None or l['district'] in our_districts, f"{l['id']}: district {l['district']}")
    check('2019:department-total', t19['department_total'] == total19,
          f"FY2019: the {len(t19['lines']):,} DPWH lines read from the technical GAA add up to ₱{total19:,}, its printed total")
    check('2019:headings', not bad19,
          f"FY2019: every one of its {len(t19['recon'])} Operations headings equals the lines under it "
          f"(300200 against the document's own program table; its heading counts a ₱1.9 billion group twice)")
    check('placement:every-line-once', sum(census.values()) == len(lines), f'{len(lines):,} lines, each placed once')
    check('lens:rows', sum(1 for l in lines if l['fy'] == 2027) == lens['counts']['rows'],
          f"FY2027 rows equal the source lens ({lens['counts']['rows']:,})")
    lens_points = sum(len(v) for v in lens['row_points'].values())
    our_points = sum(len(l['pts'] or []) for l in lines if l['fy'] == 2027)
    check('lens:points', our_points - wider_2027 + at_sea_2027 == lens_points,
          f'FY2027 GPS points: {our_points - wider_2027:,} drawn + {at_sea_2027} at sea = the source lens ({lens_points:,}); '
          f'{wider_2027} more read from titles the lens has no point for')
    for p in places.values():
        ensure(p['lng'] is not None, f"place {p['key']} has no anchor")

    # ------------------------------------------------------------------ write
    built_at = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    place_list = sorted(places.values(), key=lambda p: p['key'])
    place_ix = {p['key']: i for i, p in enumerate(place_list)}
    office_list = sorted({l['office'] for l in lines if l['office']})
    office_ix = {o: i for i, o in enumerate(office_list)}
    pap_list = sorted({l['pap'] for l in lines})
    pap_ix = {p: i for i, p in enumerate(pap_list)}
    district_list = dist_ids
    district_ix = {d: i for i, d in enumerate(district_list)}
    region_list = sorted({l['region'] for l in lines if l['region']} | {p['region'] for p in place_list if p['region']})
    region_ix = {r: i for i, r in enumerate(region_list)}
    # One array per line; FY2027-only fields last and trailing nulls dropped, so a GAA line ends after `flags`
    # (or `pts`). `id` is the UACS code for GAA lines (line id `gaa:<fy>:<code>`), the comparison row id for FY2027.
    cols = ['id', 'fy', 'title', 'office', 'pap', 'rule', 'level', 'place', 'district', 'basis', 'region', 'flags',
            'gaa_php', 'pts', 'nep_php', 'house_php', 'class', 'nep_page', 'house_page']
    nx = lambda d, k: -1 if k is None else d[k]

    def row_of(l):
        r = [l['code'] if l['fy'] < 2027 else l['id'], l['fy'], l['title'], nx(office_ix, l['office']), pap_ix[l['pap']],
             RULES.index(l['rule']), LEVELS.index(l['level']), nx(place_ix, l['place']), nx(district_ix, l['district']),
             BASES.index(l['basis']), nx(region_ix, l['region']), l['flags'], l['gaa_php'], l['pts'], l['nep_php'],
             l['house_php'], CLASSES.index(l['class']) if l['class'] else None, l.get('nep_page'), l.get('house_page')]
        while r and r[-1] is None:
            r.pop()
        return r
    rows_out = [row_of(l) for l in lines]
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from upstream import COMMIT, REPO  # noqa: E402
    lines_json = {
        'schema': 1, 'built_at': built_at, 'source_commit': COMMIT,
        'budgets': [{k: b[k] for k in ('key', 'fy', 'stage')} for b in budgets],
        'levels': LEVELS, 'bases': BASES, 'rules': RULES, 'classes': CLASSES, 'flag_bits': FLAGS,
        'regions': region_list,
        'districts': [[d, our_districts[d]['label'], nx(region_ix, region_key(our_districts[d]['region']))] for d in district_list],
        'offices': office_list, 'paps': pap_list,
        'place_cols': ['key', 'level', 'label', 'lng', 'lat', 'region', 'districts'],
        'places': [[p['key'].removeprefix('psgc:'), LEVELS.index(p['level']), p['label'], p['lng'], p['lat'],
                    nx(region_ix, p['region']), [district_ix[d] for d in p['district_ids']]] for p in place_list],
        'cols': cols, 'rows': rows_out,
    }
    write_json(out / 'lines.json', lines_json)

    # district outlines for the map: the source's PSGC2LEG polygons, simplified (about 100 m)
    feats = []
    for d in district_list:
        g = district_geom[d].simplify(0.001, preserve_topology=True)
        feats.append({'type': 'Feature', 'properties': {'id': d, 'label': our_districts[d]['label'],
                                                         'region': region_key(our_districts[d]['region'])},
                      'geometry': round_geometry(mapping(g), 4)})
    write_json(out / 'districts.geojson', {'type': 'FeatureCollection', 'features': feats})

    # every line as CSV
    level_words = {'gps': 'GPS in the title', 'barangay': 'barangay named in the title',
                   'municipality': 'municipality named in the title', 'city': 'city named in the title',
                   'province': 'province named in the title', 'deo': 'DPWH office (DEO)', 'region': 'region',
                   'none': 'not placed'}
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator='\n')
    w.writerow(CSV_COLUMNS)
    for l in lines:
        pl = places.get(l['place']) if l['place'] else None
        w.writerow([
            l['fy'], l['id'], l['title'], l['title_published'] or '', l['gaa_php'], l['nep_php'], l['house_php'],
            {'house_only': 'house_bill_only', 'nep_only': 'nep_only', 'paired': 'in_both'}.get(l['class'], ''),
            l['code'] or '', l['pap'], l['rule'], l['office'] or '', l['region'] or '', level_words[l['level']],
            pl['label'] if pl else '', pl['key'].removeprefix('psgc:') if pl and pl['key'].startswith('psgc:') else '',
            l['pts'][0][0] if l['pts'] else (pl['lng'] if pl else ''), l['pts'][0][1] if l['pts'] else (pl['lat'] if pl else ''),
            ';'.join(f'{a},{b}' for a, b in l['pts']) if l['pts'] else '',
            our_districts[l['district']]['label'] if l['district'] else '', l['district'] or '', l['basis'] or '',
            ';'.join(k for k, bit in FLAGS.items() if l['flags'] & bit), l.get('nep_page') or '', l.get('house_page') or '',
        ])
    (out / 'lines.csv').write_bytes(('\ufeff' + buf.getvalue()).encode('utf-8'))

    inputs = {
        'gaa_fpaps': str(data / '18/fpaps'), 'gaa_operating_units': str(data / '18/operating_units'),
        'gaa_full_extract': {'path': str(data / '18/full_extract.csv'), 'sha256': sha256(data / '18/full_extract.csv')},
        'house_bill_dpwh': {'path': str(data / 'hgab/2027/dpwh/projects.parquet'),
                            'sha256': sha256(data / 'hgab/2027/dpwh/projects.parquet')},
        'districts': {'path': str(data / 'hgab/2027/districts.json'), 'sha256': sha256(data / 'hgab/2027/districts.json')},
        'history': {'path': str(data / 'hgab/2027/history.json'), 'sha256': sha256(data / 'hgab/2027/history.json')},
        'gaa_history': {'dir': str(hist_dir), 'years': {str(fy): {'file': f'parquet/gaa-{fy}.parquet',
                                                                   'sha256': sha256(hist_dir / f'parquet/gaa-{fy}.parquet')}
                                                         for fy in HISTORY_YEARS},
                        '2019_text': {'file': TEXT_2019, 'sha256': sha256(hist_dir / TEXT_2019),
                                      'document': 'https://www.dbm.gov.ph/wp-content/uploads/GAA/GAA2019/TechGAA2019/DPWH/A.pdf'}},
        'shapefiles_2023': {'barangays': {'file': bgy_shp.name, 'sha256': sha256(bgy_shp)},
                            'municipalities': {'file': muni_shp.name, 'sha256': sha256(muni_shp)},
                            'provinces': {'file': prov_shp.name, 'sha256': sha256(prov_shp)}},
    }
    from upstream import FILES  # noqa: E402
    summary = {
        'schema': 1, 'built_at': built_at,
        'source': {'repo': f'https://github.com/{REPO}', 'commit': COMMIT,
                   'files': {f: sha256(up / f) for f in FILES},
                   'methods': {'title_place': SCORE_METHOD, 'title_cleanup': TITLE_CLEAN_METHOD,
                               'scope': 'buildMpbLegislativeLens.in_scope (PAP or title)',
                               'centroids': 'buildMpbPsgcApproxOverlay.resolve_centroid'}},
        'inputs': inputs,
        'budgets': budgets,
        'totals': {'lines': len(lines), 'places': len(places),
                   'gps_points': sum(len(l['pts'] or []) for l in lines)},
        'text_repairs': {name: sum(1 for l in lines if name in l['repairs']) for name, _, _ in GAA_TEXT_REPAIRS},
        'gaa_place_status': dict(sorted(Counter(l['psgc_status'] for l in lines if l['fy'] < 2027).items())),
        'checks': checks,
    }
    write_json(out / 'summary.json', summary, indent=1)
    for f in ('lines.json', 'summary.json', 'districts.geojson', 'lines.csv'):
        log(f'  wrote {out / f}  {(out / f).stat().st_size / 1e6:.2f} MB')


CSV_COLUMNS = ['fiscal_year', 'line_id', 'title', 'title_as_published', 'gaa_php', 'nep_php', 'house_bill_php',
               'fy2027_comparison', 'uacs_code', 'pap', 'scope_rule', 'dpwh_office', 'region', 'placed_by', 'place',
               'place_psgc', 'longitude', 'latitude', 'gps_points', 'legislative_district', 'legislative_district_id',
               'district_from', 'flags', 'nep_pdf_page', 'house_bill_pdf_page']


def round_geometry(g, nd):
    def r(c):
        return [round(c[0], nd), round(c[1], nd)] if isinstance(c[0], (int, float)) else [r(x) for x in c]
    return {'type': g['type'], 'coordinates': r(g['coordinates'])}


def write_json(path: Path, obj, indent=None):
    text = json.dumps(obj, ensure_ascii=False, separators=(',', ':') if indent is None else (',', ': '), indent=indent)
    path.write_text(text + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
