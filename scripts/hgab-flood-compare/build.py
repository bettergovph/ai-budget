#!/usr/bin/env python3
"""Every flood control line in the FY2015 to FY2026 GAA, the 2027 NEP and the House bill, placed for
/hgab/2027/flood-control. The maps draw FY2025, FY2026 and 2027 (Jason, 2026-11-05: "the proper comparison is 2025,
2026, and 2027"); every year feeds the region-by-year matrix (Jason, 2026-11-06: "I want a matrix of the MPBs per
region and per year. I want the same for flood control", "For flood control we need it for multiple years that we
have").

Which lines, each budget's own flood codes (scope_of):
  - FY2020 to FY2026 GAA: the flood control series on the multi-purpose page's chart (src/lib/hgab-history.ts, series
    `flood`), so they add up to it; the build stops if they do not. The Flood Management Program (3201…), BIP and SIPAG
    flood mitigation (FY2022–FY2025), the Local Program's flood control and drainage lines (300106–300109);
  - FY2018 and FY2019: the same codes (the budget's structure is the FY2020 one); FY2019's lines add up to the headings
    the technical GAA prints;
  - FY2015 to FY2017: the older code set's flood control families, 162… and 292… (by their lines: maintenance and
    repair, river basin and master-plan projects, local flood works and a disaster fund, foreign-assisted projects);
  - 2027 NEP and House bill: the Flood Management Program.

Where each line goes on the map, first that works (the multi-purpose map's order, scripts/hgab-mpb-years/build.py):
  1. GPS printed in the title (upstream analyze_text(), else WIDER_GPS; points outside the Philippines or at sea
     are dropped);
  2. the place the title names, drawn at upstream resolve_centroid(), provinces at their 2023 outline. GAA: upstream's
     Matcher, with the office's region and province as hints, as the multi-purpose map reads GAA titles; a head-office
     (Central Office) line the Matcher cannot read, having no office hint, goes to the one province its title names
     (upstream's name finder), never a town. 2027: the source's location lens (row_psgc);
  3. the DPWH office: the district it serves, or all of them if it serves several;
  4. the region: the office's; a head-office line, the region the budget lists it under (as the 2027 lens places
     head-office lines). A line with none (budgeted nationwide) is counted, not drawn.
2027, in both documents or one: the lens's own buckets (insertions: House bill only; deletions: NEP only; the rest:
both). The lens is the one the district pages use (data/hgab/2027/locations.json); every line's basis and target are
checked against it.

Usage: build.py --upstream=<dir> --lens=<checkout> --shapes=<dir> [--data=data] [--history=data/gaa-history]
                [--out=data/hgab/2027/flood-compare]
  --upstream  the multi-purpose map's pinned workbench files (scripts/hgab-mpb-years/upstream.py)
  --lens      a workbench checkout holding the built location lens (analysis/data/location_district_index_2027.json)
              and the comparison it was built on; the commit data/hgab/2027/locations.json records
  --shapes    the 2023 PSA shapefiles; their centroids come from the cache `npm run build:hgab-mpb-years` writes
  --history   the GAA history release (FY2015–FY2018 yearly files, FY2019's text), as the multi-purpose map reads it

Outputs (contract: src/lib/hgab-mpb-years.ts MpbLinesFile, FY2027 only; src/lib/mpb-compare.ts FloodCompareSummary):
  lines.json    the mapped budgets' lines (FY2025, FY2026, 2027), in the multi-purpose map's format
  summary.json  per mapped budget: lines, pesos, placement census, the chart's figure and its foreign-assisted part;
                the matrix (each region's lines and pesos in every budget); checks
"""
from __future__ import annotations

import argparse, json, re, subprocess, sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import duckdb
from shapely.geometry import Point, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'hgab-mpb-years'))
from build import (  # noqa: E402  the multi-purpose map's build: its line format, GPS screens and GAA text readers
    BASES, CLASSES, DISTRICT_QUALIFIER, FLAGS, HISTORY_YEARS, LAND_TOLERANCE, LEVELS, PAP_IN_TITLE, PAP_RULE_FROM, PH_LAT,
    PH_LNG, PSGC_REGION, RULES, TEXT_2019, TEXT_YEAR, UACS_REGION, region_key, repair_text, sha256, tidy_label, wider_gps,
    write_json,
)
import gaa2019  # noqa: E402
from upstream import COMMIT, FILES, REPO  # noqa: E402

PROGRAM = 'Flood Management Program'
GAA_YEARS = list(range(2015, 2027))  # placed: the matrix
MAP_GAA_YEARS = [2025, 2026]          # drawn: lines.json
SITE_FROM = 2020                      # the site's GAA extract (data/18); before it, the GAA history release
FORMER_FROM, FORMER_TO = 2015, 2017   # the older code set
# The chart's flood control parts (src/lib/hgab-history.ts): the Flood Management Program, BIP_CODES.flood,
# SIPAG_CODES.flood, LOCAL_FLOOD. FY2018 and FY2019 use the same codes.
GAA_PREFIXES = ('3201', '300225', '300237', '300219', '300234', '300106', '300107', '300108', '300109')
# FY2015–FY2017: the older code set's flood control families (no headings in the files; named by their lines).
FORMER_PREFIXES = ('162', '292')
FY2027 = [{'key': 'nep-2027', 'fy': 2027, 'stage': 'nep'}, {'key': 'house-2027', 'fy': 2027, 'stage': 'house'}]
BUDGETS = [*({'key': f'gaa-{fy}', 'fy': fy, 'stage': 'gaa'} for fy in MAP_GAA_YEARS), *FY2027]
MATRIX_BUDGETS = [*({'key': f'gaa-{fy}', 'fy': fy, 'stage': 'gaa',
                     **({'note': 'former_codes'} if fy <= FORMER_TO else {})} for fy in GAA_YEARS), *FY2027]


def scope_of(fy: int, code: str) -> bool:
    """A GAA line is flood control when its code is in its year's flood families."""
    return code.startswith(FORMER_PREFIXES if fy <= FORMER_TO else GAA_PREFIXES)

REGION_IN_TITLE = re.compile(r'\b(?:Region\s+(?:IV-?[AB]|X{0,1}(?:IX|IV|V?I{0,3}))\b|NCR|CAR|BARMM|CARAGA|MIMAROPA|'
                             r'CALABARZON|SOCCSKSARGEN)', re.I)
BUCKET_CLASS = {'insertions': 'house_only', 'deletions': 'nep_only', 'unchanged': 'paired', 'increased': 'paired',
                'reduced': 'paired'}


def fail(msg: str):
    raise SystemExit(f'build-hgab-flood-compare: {msg}')


def ensure(cond, msg: str):
    if not cond:
        fail(msg)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--upstream', required=True)
    ap.add_argument('--lens', required=True)
    ap.add_argument('--shapes', required=True)
    ap.add_argument('--data', default='data')
    ap.add_argument('--out', default='data/hgab/2027/flood-compare')
    ap.add_argument('--cache', default='/tmp/hgab-mpb-years-cache')
    ap.add_argument('--history', default='data/gaa-history')
    args = ap.parse_args()
    hist_dir = Path(args.history)
    up, lens_dir, shapes, data, out, cache = (Path(args.upstream), Path(args.lens), Path(args.shapes), Path(args.data),
                                              Path(args.out), Path(args.cache))
    out.mkdir(parents=True, exist_ok=True)
    log = lambda s: print(s, flush=True)

    # ------------------------------------------------------------------ upstream code, imported as published
    sys.path[:0] = [str(up / 'analysis/web'), str(up / 'master_list/scripts'), str(up / 'gps-analysis'),
                    str(up / 'analysis/builders')]
    import buildMpbPsgcApproxOverlay as approx  # noqa: E402
    from locations import SCORE_METHOD, Matcher, normalize  # noqa: E402
    from normalize_labels import apply_place_spellings  # noqa: E402
    from readable_titles import TITLE_CLEAN_METHOD, readable_title  # noqa: E402
    from scan_gps_inventory import analyze_text  # noqa: E402

    catalog = [json.loads(s) for s in (up / 'PSGC2LEG/data/psgc_locations.jsonl').read_text().splitlines()]
    psgc = {r['code']: r for r in catalog}
    matcher = Matcher(catalog)
    leg_assign = {}
    for s in (up / 'PSGC2LEG/data/psgc_leg_assignments.jsonl').read_text().splitlines():
        r = json.loads(s)
        leg_assign[r['psgc_code']] = r

    # ------------------------------------------------------------------ legislative districts and their outlines
    dist_index = json.loads((data / 'hgab/2027/districts.json').read_text())
    our_districts = {d['id']: d for d in dist_index['districts']}
    offices = dist_index['offices']
    dmap = json.loads((up / 'analysis/data/congress_district_map_2027.json').read_text())
    psgc_leg_to_district = {}
    district_geom = {}
    for f in dmap['features']:
        p = f['properties']
        ensure(p['district_id'] in our_districts, f"district map id {p['district_id']} is not one of our districts")
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
            for i in tree.query(Point(lng, lat), predicate='within'):
                hits.add(dist_ids[i])
        return next(iter(hits)) if len(hits) == 1 else None

    # ------------------------------------------------------------------ centroids: the multi-purpose map's cache
    pick = lambda d, *names: next((shapes / d / n for n in names if (shapes / d / n).exists()), shapes / d / names[0])
    muni_shp = pick('Municities', 'Municities.shp.shp', 'PH_Adm3_MuniCities.shp.shp')
    bgy_shp = pick('BgySubMuns', 'PH_Adm4_BgySubMuns.shp.shp')
    centroid_cache = cache / f"centroids-{sha256(bgy_shp)[:12]}-{sha256(muni_shp)[:12]}.json"
    ensure(centroid_cache.exists(), f'{centroid_cache} not found: run `npm run build:hgab-mpb-years` once (it writes it)')
    centroids = json.loads(centroid_cache.read_text())
    district_anchor = {d: g.representative_point() for d, g in district_geom.items()}

    def union_anchor(ids):
        p = unary_union([district_geom[d] for d in ids]).representative_point()
        return float(p.x), float(p.y)

    # ------------------------------------------------------------------ the place dictionary (as the multi-purpose map's)
    places: dict[str, dict] = {}

    def psgc_label(code):
        anc = matcher.ancestry(code)
        parts = [psgc[anc[lvl]]['name'] for lvl in ('barangay', 'sub_municipality', 'municipality', 'city', 'province')
                 if lvl in anc]
        return ', '.join(parts) or psgc[code]['name']

    def leg_district_of(code):
        anc = matcher.ancestry(code)
        cands = ([anc['barangay']] if 'barangay' in anc else []) + [anc[l] for l in ('sub_municipality', 'municipality', 'city')
                                                                    if l in anc]
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

    def psgc_place(code, level, anchor):
        key = f'psgc:{code}'
        if key not in places:
            anc = matcher.ancestry(code)
            places[key] = {
                'key': key, 'level': level, 'label': psgc_label(code),
                'lng': round(anchor['lng'], 6), 'lat': round(anchor['lat'], 6),
                'region': PSGC_REGION.get(code[:2]),
                'province': psgc[anc['province']]['name'] if 'province' in anc else None,
                'district_ids': [d for d in [district_of_place(code, level)] if d],
            }
        return key

    def district_place(district_id):
        key = f'district:{district_id}'
        if key not in places:
            d, pt = our_districts[district_id], district_anchor[district_id]
            places[key] = {'key': key, 'level': 'deo', 'label': d['label'], 'lng': round(pt.x, 6), 'lat': round(pt.y, 6),
                           'region': region_key(d['region']), 'province': None, 'district_ids': [district_id]}
        return key

    def office_group_place(name, ids):
        ids = sorted(ids)
        key = 'offices:' + '+'.join(ids)
        if key not in places:
            lng, lat = union_anchor(ids)
            regions = {region_key(our_districts[d]['region']) for d in ids}
            places[key] = {'key': key, 'level': 'deo', 'label': name, 'lng': round(lng, 6), 'lat': round(lat, 6),
                           'region': next(iter(regions)) if len(regions) == 1 else None, 'province': None,
                           'district_ids': ids}
        return key

    by_region = defaultdict(list)
    for d in dist_ids:
        by_region[region_key(our_districts[d]['region'])].append(d)

    def region_place(rk):
        key = f'region:{rk}'
        if key not in places:
            lng, lat = union_anchor(by_region[rk])
            places[key] = {'key': key, 'level': 'region', 'label': rk, 'lng': round(lng, 6), 'lat': round(lat, 6),
                           'region': rk, 'province': None, 'district_ids': []}
        return key

    def town_of(code):
        anc = matcher.ancestry(code)
        return next((anc[k] for k in ('municipality', 'city', 'sub_municipality') if k in anc), None)

    def place_for(code, level):
        """Upstream resolve_centroid() for barangays, towns and cities (a barangay with no 2023 outline falls back to
        its town), the 2023 outline for provinces; a town with no outline falls back to its province."""
        anc = matcher.ancestry(code)
        if level == 'province':
            c = centroids.get(code) or centroids.get(approx.modernize(code))
            return psgc_place(code, 'province', c) if c else None
        q_code, q_level = (anc.get('city', code), 'city') if level == 'sub_municipality' else (code, level)
        hit, reason = approx.resolve_centroid({'level': q_level, 'psgc_code': q_code,
                                               'municipality_code': town_of(code) if level == 'barangay' else None},
                                              centroids)
        if hit:
            if reason == 'direct':
                return psgc_place(q_code, q_level, hit)
            drawn = hit['psgc_code']
            lvl = psgc[drawn]['level']
            return psgc_place(drawn, 'city' if lvl == 'sub_municipality' else lvl, hit)
        if 'province' in anc:
            return place_for(anc['province'], 'province')
        return None

    # ------------------------------------------------------------------ the lens and our lines
    lens_path = lens_dir / 'analysis/data/location_district_index_2027.json'
    comp_path = lens_dir / 'analysis/data/comparison_projects_2027.json'
    lens = json.loads(lens_path.read_text())
    ensure(sha256(comp_path) == lens['input_provenance']['comparison']['sha256'],
           'the location lens was built from another comparison_projects_2027.json than the one beside it')
    lens_commit = subprocess.run(['git', '-C', str(lens_dir), 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
    site = json.loads((data / 'hgab/2027/locations.json').read_text())
    ensure(site['lens_commit'] == lens_commit,
           f"locations.json was built from the lens at {site['lens_commit'][:7]}, --lens holds {lens_commit[:7] or '?'}")
    site_lines = {l['id']: l for l in site['lines']}
    comp = {r['id']: r for r in json.loads(comp_path.read_text())['projects']}
    bucket = {}
    for card in lens['cards'] + lens['region_cards']:
        for b, ids in card['row_ids'].items():
            for rid in ids:
                ensure(rid not in bucket, f'lens row {rid} on two cards')
                bucket[rid] = b
    group_districts = {card['id'].removeprefix('location:deo:'): [x['id'] for x in card['districts']]
                       for card in lens['cards'] if card.get('location_tier') == 'deo'}

    con = duckdb.connect()
    ours = con.execute(f"""SELECT id, title, nep_php, hgab3_php, pap, office, region, nep_page, hgab3_page
        FROM read_parquet('{data / 'hgab/2027/dpwh/projects.parquet'}') WHERE program = ? ORDER BY id""", [PROGRAM]).fetchall()
    log(f'{PROGRAM}: {len(ours):,} lines in our projects.parquet')

    lines = []
    census = Counter()
    for rid, title_pub, nep, house, pap, office, region, nep_page, house_page in ours:
        c = comp.get(rid)
        ensure(c is not None, f'{rid} is not in the lens comparison')
        ensure(c['title'] == title_pub and (c.get('nep') or {}).get('amount_php') == nep
               and (c.get('third') or {}).get('amount_php') == house and c['pap'] == pap,
               f'{rid}: our projects.parquet differs from the comparison the lens was built on')
        cls = BUCKET_CLASS.get(bucket.get(rid))
        ensure(cls, f'{rid}: lens bucket {bucket.get(rid)}')
        ensure((cls == 'house_only') == (nep is None) and (cls == 'nep_only') == (house is None),
               f'{rid}: lens bucket {bucket[rid]} disagrees with its amounts')
        res = lens['row_resolution'][rid]
        sl = site_lines.get(rid)
        ensure(sl is not None and sl['basis'] == res['basis'] and sl['target'] == res['target_id'],
               f'{rid}: the district pages place it elsewhere ({sl and sl["basis"]} {sl and sl["target"]})')
        flags = FLAGS['office_elsewhere'] if 'office_location_mismatch' in lens['row_flags'].get(rid, []) else 0

        # 1. GPS in the title
        g = analyze_text(title_pub)
        found = [(p.get('longitude'), p.get('latitude')) for p in (g or {}).get('points', [])
                 if p.get('longitude') is not None and p.get('latitude') is not None]
        if not found:
            found = wider_gps(title_pub)
            if found:
                flags |= FLAGS['gps_wider_reader']
        pts = []
        for lng, lat in found:
            if PH_LNG[0] < lng < PH_LNG[1] and PH_LAT[0] < lat < PH_LAT[1] and on_land(lng, lat):
                if [round(lng, 6), round(lat, 6)] not in pts:
                    pts.append([round(lng, 6), round(lat, 6)])
            else:
                flags |= FLAGS['gps_not_drawn']

        # 2. the place the title names (the lens's), 3. the office, 4. the region
        rp = lens['row_psgc'].get(rid)
        place_key = place_for(str(rp['psgc_code']).zfill(10), rp['level']) if rp and rp.get('psgc_code') else None
        level = 'gps' if pts else (places[place_key]['level'] if place_key else None)
        basis_map = {'title_psgc': 'title', 'deo_to_leg': 'deo'}
        district = res['target_id'] if res['basis'] in basis_map else None
        if district:
            ensure(district in our_districts, f'{rid}: lens district {district} unknown')
        gd = gps_district(pts) if pts else None
        if district and gd and gd != district:
            flags |= FLAGS['gps_district_differs']
        if level is None:
            if res['basis'] in basis_map:
                place_key, level = district_place(district), 'deo'
            elif res['basis'] == 'deo':
                ids = group_districts.get(res['target_id'])
                ensure(ids, f'{rid}: office group {res["target_id"]} has no districts')
                office_label = (c.get('third') or {}).get('office') or (c.get('nep') or {}).get('office') or ''
                place_key, level = office_group_place(f'DPWH {office_label}'.strip(), ids), 'deo'
            elif res['basis'] == 'region' and res['target_id'] == 'Nationwide':
                level = 'none'  # budgeted nationwide: counted, not on the map
            elif res['basis'] == 'region':
                rk = region_key(res['target_id'])
                ensure(rk, f'{rid}: region {res["target_id"]} unknown')
                place_key, level = region_place(rk), 'region'
            else:
                level = 'none'
        census[level] += 1
        lines.append({
            'id': rid, 'fy': 2027, 'code': None, 'gaa_php': None, 'title': readable_title(title_pub)['title_clean'],
            'office': office, 'pap': pap,
            'level': level, 'place': place_key, 'pts': pts or None, 'district': district,
            'basis': basis_map.get(res['basis']), 'flags': flags, 'nep_php': nep, 'house_php': house, 'class': cls,
            'region': (places[place_key]['region'] if place_key else None) or region_key(region),
            'nep_page': nep_page, 'house_page': house_page,
        })
    log('FY2027 placed: ' + ' '.join(f'{k}={census.get(k, 0)}' for k in LEVELS))

    # ------------------------------------------------------------------ GAA FY2015–FY2026 (as the multi-purpose map reads GAA lines)
    # FY2020–FY2026: the site's extract. FY2015–FY2018: the GAA history release's yearly files, operating units summed
    # per line. FY2019: the technical GAA's text. Every year's own flood codes (scope_of).
    site_years = [y for y in GAA_YEARS if y >= SITE_FROM]
    fp = str(data / '18/fpaps/*/*.parquet')
    ou = str(data / '18/operating_units/*/*.parquet')
    years = ', '.join(str(y) for y in site_years)
    con.sql(f"""CREATE TABLE f AS SELECT id, code, description, CAST(year AS INTEGER) fy,
               CAST(ROUND(amount * 1000) AS BIGINT) php FROM read_parquet('{fp}', hive_partitioning = true)
               WHERE CAST(year AS INTEGER) IN ({years})""")
    con.sql(f"""CREATE TABLE o AS SELECT fpap_id, code ou_code, description ou_name, CAST(year AS INTEGER) fy,
               CAST(ROUND(amount * 1000) AS BIGINT) php FROM read_parquet('{ou}', hive_partitioning = true)
               WHERE amount > 0 AND CAST(year AS INTEGER) IN ({years})""")
    paps = {(fy, code[:6]): tidy_label(d) for fy, code, d in con.sql(
        "SELECT fy, code, description FROM f WHERE code LIKE '______000000000'").fetchall()}
    full = str(data / '18/full_extract.csv')
    con.sql(f"""CREATE TABLE reg AS SELECT DISTINCT CAST(year AS INTEGER) fy, prexc_fpap_id code, operunit ou_code, uacs_reg_id reg
               FROM read_csv('{full}', all_varchar = true, header = true)
               WHERE CAST(amt AS DOUBLE) > 0 AND prexc_fpap_id LIKE '3%' AND CAST(year AS INTEGER) IN ({years})""")
    leaf = "f.php > 0 AND f.code NOT LIKE '%\\_%' ESCAPE '\\' AND length(f.code) = 15"
    gaa_rows = [{'fy': fy, 'code': code, 'desc': desc, 'php': php, 'ou': ou_name, 'ou_php': ou_php, 'reg': reg,
                 'source': 'site', 'offices': 1}
                for fy, code, desc, php, ou_name, ou_php, reg in con.sql(f"""SELECT f.fy, f.code, f.description, f.php, o.ou_name, o.php, r.reg
                      FROM f LEFT JOIN o ON o.fpap_id = f.id AND o.fy = f.fy
                      LEFT JOIN reg r ON r.fy = f.fy AND r.code = f.code AND r.ou_code = o.ou_code
                      WHERE {leaf} ORDER BY f.fy, f.code""").fetchall()]
    hist_years = [y for y in GAA_YEARS if y in HISTORY_YEARS]
    hist_files = ', '.join(f"'{hist_dir / f'parquet/gaa-{fy}.parquet'}'" for fy in hist_years)
    for fy, code, desc, php, ou_name, reg, n_ou in con.sql(f"""SELECT fy, fpap_code, any_value(fpap_dsc), SUM(amount),
               arg_max(operunit_dsc, amount), arg_max(region_code, amount), count(DISTINCT operunit_dsc)
               FROM read_parquet([{hist_files}], union_by_name = true)
               WHERE department_id = '18' GROUP BY 1, 2 HAVING SUM(amount) > 0 ORDER BY 1, 2""").fetchall():
        gaa_rows.append({'fy': fy, 'code': code, 'desc': desc, 'php': php, 'ou': ou_name, 'ou_php': php, 'reg': reg,
                         'source': 'history', 'offices': n_ou})
    t19 = gaa2019.parse(str(hist_dir / TEXT_2019))
    ensure(t19['department_total'] == sum(x['php'] for x in t19['lines']),
           'FY2019: the parsed DPWH lines do not add up to the document\'s total')
    for x in t19['lines']:
        gaa_rows.append({'fy': TEXT_YEAR, 'code': x['code'], 'desc': x['title'], 'php': x['php'], 'ou': x['office'],
                         'ou_php': x['php'], 'reg': None, 'source': 'text', 'offices': 1})
    paps.update({(TEXT_YEAR, k): tidy_label(v) for k, v in t19.get('pap_titles', {}).items()})
    gaa_rows = [r for r in gaa_rows if scope_of(r['fy'], r['code'])]
    for pap in sorted({r['code'][:6] for r in gaa_rows if r['fy'] == TEXT_YEAR}):
        rc = t19['recon'].get(pap)
        ensure(rc and rc['ok'], f'FY2019 {pap}: the lines do not add up to the heading the document prints ({rc})')
    label_office = {}
    label_any = {}  # FY2015–FY2019: office names join the crosswalk as they do in later years (as the multi-purpose map)
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

    def head_office_province(title):
        """The one province a title names (upstream's longest-name finder; a name that is also a town counts), or None."""
        provs = {c for h in matcher.find(apply_place_spellings(title)) for c in h['codes'] if psgc[c]['level'] == 'province'}
        return next(iter(provs)) if len(provs) == 1 else None

    def title_region_named(title):
        hits = {region_key(m.group(0)) for m in REGION_IN_TITLE.finditer(title)} - {None}
        return hits.pop() if len(hits) == 1 else None

    gaa_census = Counter()
    head_office = Counter()
    seen = set()
    for row in gaa_rows:
        fy, code, desc, php, ou_name, ou_php, reg = (row['fy'], row['code'], row['desc'], row['php'], row['ou'],
                                                      row['ou_php'], row['reg'])
        lid = f'gaa:{fy}:{code}'
        ensure(lid not in seen, f'{lid} twice')
        seen.add(lid)
        ensure(ou_name is not None and ou_php == php, f'{lid}: operating unit amount {ou_php} != line amount {php}')
        title, repairs = repair_text(desc)
        title = readable_title(title)['title_clean']
        prog = PAP_IN_TITLE.match(title)
        if prog:
            title = title[prog.end():]
        flags = FLAGS['text_repaired'] if repairs else 0
        office_id = label_office.get((fy, ou_name)) or (label_any.get(ou_name) if fy < SITE_FROM else None)
        office = offices.get(office_id) if office_id else None
        is_deo = 'District Engineering Office' in ou_name
        is_co = ou_name == 'Central Office'
        office_region = region_key(office['region']) if office else (UACS_REGION.get(reg) if not is_co else None)
        region_hint = matcher.region_code({'NCR': 'NCR', 'CAR': 'CAR', 'BARMM': 'BARMM', 'NIR': 'NIR', 'MIMAROPA': 'MIMAROPA',
                                           'XIII': 'Region XIII'}.get(office_region, f'Region {office_region}')) if office_region else None
        office_hint = matcher.province_code(apply_place_spellings(ou_name)) if is_deo else None

        # 1. GPS in the title: the source's reader, else the wider one
        g = analyze_text(desc)
        found = [(p.get('longitude'), p.get('latitude')) for p in (g or {}).get('points', [])
                 if p.get('longitude') is not None and p.get('latitude') is not None]
        if not found:
            found = wider_gps(title)
            if found:
                flags |= FLAGS['gps_wider_reader']
        pts = []
        for lng, lat in found:
            if PH_LNG[0] < lng < PH_LNG[1] and PH_LAT[0] < lat < PH_LAT[1] and on_land(lng, lat):
                if [round(lng, 6), round(lat, 6)] not in pts:
                    pts.append([round(lng, 6), round(lat, 6)])
            else:
                flags |= FLAGS['gps_not_drawn']

        # 2. the place the title names (several: the specific one, else the town or province they share)
        match_title = DISTRICT_QUALIFIER.sub('', title) if fy < SITE_FROM else title
        succ = maguindanao_successor(title)
        if succ:
            match_title = re.sub(r'\bMaguindanao\b(?!\s+del\b)', psgc[succ]['name'], match_title)
            flags |= FLAGS['maguindanao_successor']
        m = matcher.match(match_title, (), region_hint, office_hint)
        locs = m['locations'] if m['status'] in ('name_matched', 'multiple_locations', 'province_only') else []
        place_code, place_level = None, None
        if len(locs) == 1:
            place_code, place_level = locs[0]['psgc_code'], locs[0]['level']
        elif len(locs) > 1:
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
        if place_level == 'special_geographic_area':
            place_code = place_level = None
        if is_co and place_code is None and not pts:
            place_code = head_office_province(match_title)
            if place_code:
                place_level = 'province'
                head_office[(fy, 'province')] += 1
        title_region = PSGC_REGION.get(place_code[:2]) if place_code else None

        # 3. the office, 4. the region
        place_key = place_for(place_code, place_level) if place_code else None
        level = 'gps' if pts else (places[place_key]['level'] if place_key else None)
        if level is None:
            dids = office['district_ids'] if office else []
            listed = UACS_REGION.get(reg) if is_co else None
            if len(dids) == 1:
                place_key, level = district_place(dids[0]), 'deo'
            elif len(dids) > 1:
                place_key, level = office_group_place(f"DPWH {office['name']}", dids), 'deo'
            elif office_region or title_region_named(title) or listed:
                place_key, level = region_place(office_region or title_region_named(title) or listed), 'region'
                if is_co and not office_region and not title_region_named(title):
                    head_office[(fy, 'listed_region')] += 1
            else:
                level = 'none'

        # legislative district: the title's place, else the GPS point, else the office's one district
        district, basis = None, None
        if place_code:
            district = district_of_place(place_code, place_level)
            basis = 'title' if district else None
        gd = gps_district(pts) if pts else None
        if district is None and gd:
            district, basis = gd, 'gps'
        elif district and gd and gd != district:
            flags |= FLAGS['gps_district_differs']
        if district is None and office and len(office['district_ids']) == 1:
            district, basis = office['district_ids'][0], 'deo'
        title_prov = matcher.ancestry(place_code).get('province') if place_code else None
        if office_hint and title_prov and title_prov != office_hint:
            flags |= FLAGS['office_elsewhere']

        gaa_census[(fy, level)] += 1
        pap = (paps.get((fy, code[:6])) or (paps.get((SITE_FROM, code[:6])) if fy >= PAP_RULE_FROM else None)
               or f'Former flood control code {code[:6]}')
        lines.append({
            'id': lid, 'fy': fy, 'code': code, 'gaa_php': php, 'title': title,
            'title_published': desc if title != desc else None, 'office': ou_name,
            'pap': pap, 'level': level, 'place': place_key, 'pts': pts or None,
            'district': district, 'basis': basis, 'flags': flags, 'nep_php': None, 'house_php': None, 'class': None,
            'region': title_region or office_region or (places[place_key]['region'] if place_key else None),
            'nep_page': None, 'house_page': None,
        })
    for fy in GAA_YEARS:
        log(f'FY{fy} GAA placed: ' + ' '.join(f'{k}={gaa_census.get((fy, k), 0)}' for k in LEVELS)
            + f"  (head office: {head_office[(fy, 'province')]} by the province named, {head_office[(fy, 'listed_region')]} at the listed region)")

    # ------------------------------------------------------------------ budgets, the chart, checks
    history = json.loads((data / 'hgab/2027/history.json').read_text())
    col = {c['key']: i for i, c in enumerate(history['columns'])}
    flood = next(s for s in history['series'] if s['key'] == 'flood')
    checks = []

    def check(key, ok, detail):
        checks.append({'key': key, 'ok': bool(ok), 'detail': detail})
        ensure(ok, f'check {key} failed: {detail}')

    budgets = []
    for b in BUDGETS:
        amt = {'gaa': 'gaa_php', 'nep': 'nep_php', 'house': 'house_php'}[b['stage']]
        sel = [l for l in lines if l['fy'] == b['fy'] and l[amt] is not None]
        php = sum(l[amt] for l in sel)
        hist = flood['php'][col[b['key']]]
        check(f'history:{b["key"]}', php == hist,
              f"{b['key']}: the flood control lines here add up to ₱{php:,}; the flood control chart says ₱{hist:,}")
        lv = Counter(l['level'] for l in sel)
        unplaced = [l for l in sel if l['level'] == 'none']
        budgets.append({**b, 'lines': len(sel), 'php': php, 'history_php': hist,
                        'foreign_php': flood['foreign_php'][col[b['key']]],
                        'levels': {k: lv.get(k, 0) for k in LEVELS},
                        'not_drawn': {'lines': len(unplaced), 'php': sum(l[amt] for l in unplaced)},
                        'classes': dict(Counter(l['class'] for l in sel if l['class']))})
        log(f"  {b['key']:<11} {len(sel):>6,} lines  ₱{php:>17,} = chart  " + ' '.join(f'{k}={lv.get(k, 0)}' for k in LEVELS))
    for l in lines:
        ensure(l['level'] in LEVELS, f"{l['id']}: no placement")
        ensure((l['level'] == 'gps') == bool(l['pts']), f"{l['id']}: gps placement without points or the reverse")
        ensure(l['level'] in ('gps', 'none') or l['place'] in places, f"{l['id']}: placed nowhere")
    check('placement:every-line-once', sum(census.values()) + sum(gaa_census.values()) == len(lines) == len(ours) + len(gaa_rows),
          f'{len(lines):,} lines, each placed once')
    check('lens:same-as-district-pages', all(site_lines[l['id']] for l in lines if l['fy'] == 2027),
          f'every line has the basis and target the district pages give it (lens {lens_commit[:7]})')
    for p in places.values():
        ensure(p['lng'] is not None, f"place {p['key']} has no anchor")
    nationwide = [l for l in lines if l['fy'] == 2027 and l['level'] == 'none']
    check('placement:2027-unmapped-are-nationwide', all(l['region'] is None for l in nationwide),
          f'{len(nationwide)} FY2027 lines are not on the map, all budgeted nationwide')

    # ------------------------------------------------------------------ the matrix: each region, every budget
    amount = lambda l, b: l['gaa_php'] if b['stage'] == 'gaa' else (l['nep_php'] if b['stage'] == 'nep' else l['house_php'])
    matrix_rows = defaultdict(lambda: [[0, 0] for _ in MATRIX_BUDGETS])
    matrix_totals = [[0, 0] for _ in MATRIX_BUDGETS]
    for l in lines:
        for i, b in enumerate(MATRIX_BUDGETS):
            v = amount(l, b) if l['fy'] == b['fy'] else None
            if v is None:
                continue
            for cell in (matrix_rows[l['region']][i], matrix_totals[i]):
                cell[0] += 1
                cell[1] += v
    for i, b in enumerate(MATRIX_BUDGETS):
        hist = flood['php'][col[b['key']]] if b['key'] in col else None
        if hist is not None:
            check(f'matrix:{b["key"]}', matrix_totals[i][1] == hist,
                  f"matrix {b['key']}: {matrix_totals[i][0]:,} lines, ₱{matrix_totals[i][1]:,} = the flood control chart")
    log('matrix: ' + ' '.join(f"{b['key']}={t[0]}/₱{t[1] / 1e9:.1f}B" for b, t in zip(MATRIX_BUDGETS, matrix_totals)))

    # ------------------------------------------------------------------ write (the multi-purpose map's format): the maps' budgets only
    built_at = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    lines = [l for l in lines if l['fy'] == 2027 or l['fy'] in MAP_GAA_YEARS]
    used = {l['place'] for l in lines if l['place']}
    place_list = sorted((p for p in places.values() if p['key'] in used), key=lambda p: p['key'])
    place_ix = {p['key']: i for i, p in enumerate(place_list)}
    office_list = sorted({l['office'] for l in lines if l['office']})
    office_ix = {o: i for i, o in enumerate(office_list)}
    pap_list = sorted({l['pap'] for l in lines})
    pap_ix = {p: i for i, p in enumerate(pap_list)}
    district_ix = {d: i for i, d in enumerate(dist_ids)}
    region_list = sorted({l['region'] for l in lines if l['region']} | {p['region'] for p in place_list if p['region']})
    region_ix = {r: i for i, r in enumerate(region_list)}
    cols = ['id', 'fy', 'title', 'office', 'pap', 'rule', 'level', 'place', 'district', 'basis', 'region', 'flags',
            'gaa_php', 'pts', 'nep_php', 'house_php', 'class', 'nep_page', 'house_page']
    nx = lambda d, k: -1 if k is None else d[k]

    def row_of(l):
        r = [l['code'] if l['fy'] < 2027 else l['id'], l['fy'], l['title'], nx(office_ix, l['office']), pap_ix[l['pap']],
             RULES.index('pap'), LEVELS.index(l['level']), nx(place_ix, l['place']), nx(district_ix, l['district']),
             BASES.index(l['basis']), nx(region_ix, l['region']), l['flags'], l['gaa_php'], l['pts'], l['nep_php'],
             l['house_php'], CLASSES.index(l['class']) if l['class'] else None, l['nep_page'], l['house_page']]
        while r and r[-1] is None:
            r.pop()
        return r
    write_json(out / 'lines.json', {
        'schema': 1, 'built_at': built_at, 'source_commit': COMMIT, 'budgets': BUDGETS,
        'levels': LEVELS, 'bases': BASES, 'rules': RULES, 'classes': CLASSES, 'flag_bits': FLAGS,
        'regions': region_list,
        'districts': [[d, our_districts[d]['label'], nx(region_ix, region_key(our_districts[d]['region']))] for d in dist_ids],
        'offices': office_list, 'paps': pap_list,
        'place_cols': ['key', 'level', 'label', 'lng', 'lat', 'region', 'districts'],
        'places': [[p['key'].removeprefix('psgc:'), LEVELS.index(p['level']), p['label'], p['lng'], p['lat'],
                    nx(region_ix, p['region']), [district_ix[d] for d in p['district_ids']]] for p in place_list],
        'cols': cols, 'rows': [row_of(l) for l in lines],
    })
    summary = {
        'schema': 1, 'built_at': built_at, 'program': PROGRAM,
        'source': {'repo': f'https://github.com/{REPO}', 'commit': COMMIT, 'files': {f: sha256(up / f) for f in FILES},
                   'lens': {'commit': lens_commit, 'built_at': lens['built_at'], 'sha256': sha256(lens_path),
                            'comparison_sha256': sha256(comp_path)},
                   'methods': {'title_place': SCORE_METHOD, 'title_cleanup': TITLE_CLEAN_METHOD,
                               'centroids': 'buildMpbPsgcApproxOverlay.resolve_centroid'}},
        'inputs': {f: {'path': str(data / f), 'sha256': sha256(data / f)}
                   for f in ('hgab/2027/dpwh/projects.parquet', 'hgab/2027/districts.json', 'hgab/2027/locations.json',
                             'hgab/2027/history.json', '18/full_extract.csv')},
        'budgets': budgets,
        'matrix': {'budgets': MATRIX_BUDGETS,
                   'rows': [{'region': r, 'cells': cells}
                            for r, cells in sorted(matrix_rows.items(), key=lambda x: (x[0] is None, x[0] or ''))],
                   'totals': matrix_totals},
        'head_office': {str(fy): {'province_named': head_office[(fy, 'province')], 'listed_region': head_office[(fy, 'listed_region')]}
                        for fy in GAA_YEARS},
        'nationwide': {'lines': len(nationwide), 'nep_php': sum(l['nep_php'] or 0 for l in nationwide),
                       'house_php': sum(l['house_php'] or 0 for l in nationwide)},
        'totals': {'lines': len(lines), 'places': len(places), 'gps_points': sum(len(l['pts'] or []) for l in lines),
                   'flags': {k: sum(1 for l in lines if l['flags'] & bit) for k, bit in FLAGS.items()}},
        'checks': checks,
        'outputs': {'lines.json': {'sha256': sha256(out / 'lines.json'), 'bytes': (out / 'lines.json').stat().st_size}},
    }
    write_json(out / 'summary.json', summary, indent=1)
    for f in ('lines.json', 'summary.json'):
        log(f'  wrote {out / f}  {(out / f).stat().st_size / 1e6:.2f} MB')


if __name__ == '__main__':
    main()

