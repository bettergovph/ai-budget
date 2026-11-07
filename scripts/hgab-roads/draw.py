#!/usr/bin/env python3
"""Road and bridge lines drawn along OpenStreetMap roads, for the roads map (docs/hgab-roads.md). Jason (2026-11-07):
"We have projects that use openstreetmap already", then "you can do as recommended dpwh's own contracts as km posts".

Which lines: every line whose title prints stations (K0029+690 - K0031+087), in any budget.

Kilometre posts. DPWH's contract list holds about 26,000 contracts whose descriptions print the road and its stations,
each with a point: "this road, this station, here". Each is an anchor, at the middle of its stations (contracts whose
stations span more than ANCHOR_MAX_SPAN_M are too loose to use). OpenStreetMap's own kilometre posts on a road join them.

Per line:
  1. anchored: the anchors on the same road (its name as the title prints it, spelled out; contract descriptions repeat
     the budget's titles) whose stations lie within ANCHOR_REACH_M of the line's, in one place (within CLUSTER_M of
     their middle) and, when the line is placed, within reach of its mark. The OSM road through them (by name, else the
     national road under them); the anchors projected onto it; a robust line fit of road position against station
     (pairs of anchors propose a fit, the one most anchors agree with within FIT_TOL_M wins; its scale must be
     SCALE_MIN–SCALE_MAX metres of road per metre of station). The line's own stations cut from it, each range on its
     own, never far outside the anchors (EXTRAPOLATE_M). A line with its own point keeps the cut only within
     OWN_POINT_M of that point;
  2. a line placed at its own point (its contract's, or GPS in its title) and not anchored, as before: the named OSM road
     near the point (else the national road under it), cut at its stations where OSM kilometre posts agree with the
     point within 300 m, else the stated length centred on the point; not drawn when its stations are scattered.
Geometry is ODbL (OpenStreetMap contributors): written apart from the budget data, credited, with the extract's date
and checksum.

Usage: draw.py --osm=<dir with roads.parquet, posts.parquet> --pbf=<the extract> --lines=<build out dir>
               [--contracts=data/dpwh-contracts] [--out=<dir>]
Outputs: geom-<budget>.json per budget; draw-summary.json (anchors, rules, per budget: lines with stations, drawn by
how and confidence, the fit's residuals).
"""
from __future__ import annotations

import argparse, hashlib, json, re, sys, time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import numpy as np
from pyproj import Transformer
from rapidfuzz import fuzz, process
from shapely import STRtree, wkb
from shapely.geometry import MultiLineString, Point, shape
from shapely.ops import linemerge, substring, transform

sys.path.insert(0, str(Path(__file__).resolve().parent))
from stations import stations  # noqa: E402

KEEP = ('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'motorway_link', 'trunk_link',
        'primary_link', 'secondary_link', 'tertiary_link', 'road', 'residential')
NATIONAL = {'motorway', 'trunk', 'primary', 'secondary'}
NEAR_DEG, MERGE_DEG = 0.015, 0.36        # about 1.6 km and 40 km
NAME_MIN, CLASS_MAX_M, STATIONS_MAX_M = 85, 30, 300
SCATTER_SLACK_M = 1000
SIMPLIFY_M = 4
# Anchors
ANCHOR_MAX_SPAN_M = 5000                 # a contract whose stations span more is too loose to anchor
ANCHOR_REACH_M = 20_000                  # anchors within this many metres of station of the line's stations
NAME_ALIKE = 90                          # a contract's road name counts when it reads this alike (token sort ratio)
CLUSTER_M = 45_000                       # anchors used together lie within this of their middle
ON_ROAD_M = 250                          # an anchor counts when it lies this close to the OSM road
FIT_TOL_M = 300                          # an anchor agrees with a fit within this
SCALE_MIN, SCALE_MAX = 0.8, 1.25         # metres of road per metre of station
MAX_CANDIDATES = 8                       # a contract with more stretches than this gives no candidates
EXTRAPOLATE_M = 5000                     # a cut no further than this outside the anchors' stations
# Stations from kilometre zero of a national road; a local road's own stations (Sta. 0+183) start at 0 for every road,
# so two roads in one town could share a name and stations: neither anchors nor is anchored below this.
ANCHOR_MIN_STATION_M = 1000
OWN_POINT_M = 1000                       # a line's own point within this of its anchored cut
MARK_REACH_M = {'barangay': 25_000, 'municipality': 35_000, 'city': 35_000, 'province': 90_000, 'deo': 90_000,
                'region': 250_000}

ABBR = [(r'\bsn\b', 'san'), (r'\bsta\b\.?', 'santa'), (r'\bsto\b\.?', 'santo'), (r'\brd\b', 'road'),
        (r'\bjct\b', 'junction'), (r'\bhwy\b|\bhi ?way\b|\bh ?way\b', 'highway'), (r'\bbdry\b', 'boundary'),
        (r'\bave\b', 'avenue'), (r'\bblvd\b', 'boulevard'), (r'\bst\b', 'street'), (r'\bnatl\b|\bnat l\b', 'national'),
        (r'\bbr\b', 'bridge'), (r'\bpres\b', 'president'), (r'\bgen\b', 'general'), (r'\bext\b', 'extension')]
# "daang" is Filipino for road: "Daang Maharlika" and "Maharlika Highway" read alike.
GENERIC = {'road', 'highway', 'junction', 'boundary', 'national', 'avenue', 'street', 'the', 'of', 'and', 'section',
           'along', 'via', 'to', 'daang'}
WORK = re.compile(r'^(?:preventive maintenance|rehabilitation|reconstruction|upgrading|widening|road widening|construction|'
                  r'improvement|concreting|asphalt overlay|paving|completion|installation|repair|retrofitting|replacement|'
                  r'maintenance|road slip|slope protection)\b', re.I)
STATION_START = re.compile(r'\s*(?:[-–,]\s*)?(?:\bK\s*\d{1,4}\s*\+|\bSta\.?\s*\d)', re.I)


def norm(s: str) -> str:
    s = (s or '').lower().replace('–', ' ').replace('—', ' ').replace('-', ' ').replace("'", ' ').replace('.', ' ')
    for a, b in ABBR:
        s = re.sub(a, b, s)
    s = re.sub(r'[^a-z0-9ñ ]+', ' ', s)
    return ' '.join(w for w in s.split() if w not in GENERIC)


def road_names(title: str) -> list[str]:
    """The road a title or description names: the text before its stations, less a leading work ("Preventive
    Maintenance along", "Construction of Drainage Structure along Road - "), and the name in brackets, if any."""
    m = STATION_START.search(title or '')
    head = (title or '')[:m.start()] if m else (title or '')
    if WORK.match(head):
        # the road after the last "along" ("… Drainage Structure along Road - X Rd"), else after the first "of"
        parts = re.split(r'\balong\s+', head, flags=re.I)
        head = parts[-1] if len(parts) > 1 else re.split(r'\bof\s+', head, maxsplit=1, flags=re.I)[-1]
    head = re.sub(r'^\s*road\s*[-–]\s*', '', head, flags=re.I).strip(' ,-–')
    out = [re.sub(r'\([^)]*\)', ' ', head)]
    out += [x for x in re.findall(r'\(([^)]*)\)', head) if not re.fullmatch(r'\s*[SB]\d{5}[A-Z]{2}\s*|\s*[A-Z]{2}\s*', x)]
    names = []
    for n in (norm(x) for x in out):
        if n and n not in names:
            names.append(n)
    return names


def km_of(tags: dict) -> float | None:
    for k in ('distance', 'ref', 'name', 'inscription'):
        v = tags.get(k)
        if v:
            m = re.search(r'(?:^|K(?:M)?\s*0*)(\d{1,4}(?:\.\d+)?)\s*(?:km)?(?:\s*\|\||$)', v.strip(), re.I)
            if m:
                return float(m.group(1))
    return None


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def robust_fit(pairs: list[tuple]):
    """(station m, road position m[, source, candidate]) pairs → (slope, intercept, inliers, median residual) or None.
    Every pair of anchors from two sources at least 300 m of station apart proposes a fit; the one most sources agree
    with (within FIT_TOL_M) wins. A source (a contract) counts once: a contract with stretches far apart gives one
    candidate per stretch (`candidate` true), and only the one on the fit can agree. A fit that leans on candidates needs
    three sources."""
    pairs = [(p[0], p[1], p[2] if len(p) > 2 else i, p[3] if len(p) > 3 else False) for i, p in enumerate(pairs)]
    best = None
    n = len(pairs)
    for i in range(n):
        for j in range(i + 1, n):
            (k1, s1, c1, _), (k2, s2, c2, _) = pairs[i], pairs[j]
            if c1 == c2 or abs(k2 - k1) < 300:
                continue
            slope = (s2 - s1) / (k2 - k1)
            if not SCALE_MIN <= abs(slope) <= SCALE_MAX:
                continue
            icpt = s1 - slope * k1
            agree = {}
            for k, s, c, cand in pairs:
                r = abs(s - (icpt + slope * k))
                if r <= FIT_TOL_M and (c not in agree or r < agree[c][0]):
                    agree[c] = (r, (k, s, c, cand))
            key = (len(agree), -sum(r for r, _ in agree.values()))
            if best is None or key > best[0]:
                best = (key, [x for _, x in agree.values()])
    if not best or len(best[1]) < 2:
        return None
    inl = best[1]
    if any(x[3] for x in inl) and len(inl) < 3:
        return None
    ks, ss = np.array([x[0] for x in inl]), np.array([x[1] for x in inl])
    slope, icpt = np.polyfit(ks, ss, 1) if len(inl) > 2 else ((ss[1] - ss[0]) / (ks[1] - ks[0]), None)
    if icpt is None:
        icpt = ss[0] - slope * ks[0]
    if not SCALE_MIN <= abs(slope) <= SCALE_MAX:
        return None
    med = float(np.median(np.abs(ss - (icpt + slope * ks))))
    return float(slope), float(icpt), inl, med


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--osm', required=True)
    ap.add_argument('--pbf', required=True)
    ap.add_argument('--lines', required=True)
    ap.add_argument('--contracts', default='data/dpwh-contracts')
    ap.add_argument('--districts', default='data/hgab/2027/mpb-years/districts.geojson',
                    help='legislative district outlines with their region (the multi-purpose map\'s)')
    ap.add_argument('--out')
    ap.add_argument('--only', help='budget keys, comma-separated (a trial run: draw-summary.json is not written)')
    a = ap.parse_args()
    osm, lines_dir, contracts_dir = Path(a.osm), Path(a.lines), Path(a.contracts)
    out = Path(a.out or a.lines)
    t0 = time.time()
    log = lambda s: print(f'[{time.time() - t0:6.0f}s] {s}', flush=True)

    con = duckdb.connect()
    rows = con.execute(f"SELECT id, highway, name, ref, alt, geom FROM '{osm / 'roads.parquet'}' "
                       f"WHERE highway IN ({','.join('?' * len(KEEP))})", list(KEEP)).fetchall()
    geoms = [wkb.loads(g) for *_, g in rows]
    names = [[norm(n) for n in [r[2], r[3], *(r[4] or '').split(';')] if n] for r in rows]
    tree = STRtree(geoms)
    posts = [(Point(x, y), km_of(json.loads(t))) for x, y, t in con.execute(f"SELECT lng, lat, tags FROM '{osm / 'posts.parquet'}'").fetchall()]
    posts = [(p, k) for p, k in posts if k is not None]
    post_tree = STRtree([p for p, _ in posts])
    log(f'{len(rows):,} OSM road ways; {len(posts):,} kilometre posts with a readable km')
    to_m = Transformer.from_crs(4326, 32651, always_xy=True).transform
    to_deg = Transformer.from_crs(32651, 4326, always_xy=True).transform
    # Where a drawn stretch lies: its middle's legislative district and region (the page places a line there when its
    # own placement was only its office's area, its region, or nowhere).
    dfeat = json.loads(Path(a.districts).read_text())['features']
    dgeom = [shape(x['geometry']) for x in dfeat]
    dtree = STRtree(dgeom)

    def district_at(pt: Point):
        for j in dtree.query(pt, predicate='within'):
            return dfeat[j]['properties']['id'], dfeat[j]['properties']['region']
        near = dtree.query_nearest(pt, max_distance=0.02)
        return (dfeat[near[0]]['properties']['id'], dfeat[near[0]]['properties']['region']) if len(near) else (None, None)

    # ------------------------------------------------------------------ anchors: DPWH contracts with stations and a point
    anchors: dict[str, list] = defaultdict(list)
    n_contracts = n_used = n_multi = 0
    contracts_file = contracts_dir / 'contracts.parquet'
    for cid, desc, lat, lng, year in con.execute(f"""SELECT contractId, description, latitude, longitude, infraYear
            FROM read_parquet('{contracts_file}') WHERE latitude IS NOT NULL AND latitude <> 0
            AND latitude BETWEEN 4 AND 22 AND longitude BETWEEN 112 AND 127""").fetchall():
        ranges, review = stations(desc or '', reversed_ok=True)
        if not ranges:
            continue
        n_contracts += 1
        lo, hi = min(min(r) for r in ranges), max(max(r) for r in ranges)
        if review or lo < ANCHOR_MIN_STATION_M or len(ranges) > MAX_CANDIDATES:
            continue
        rn = road_names(desc)
        if not rn:
            continue
        # One anchor at the middle of its stations; a contract whose stretches lie further apart, one candidate per
        # stretch (its one point marks one of them; the fit finds which).
        if hi - lo <= ANCHOR_MAX_SPAN_M:
            these = [((lo + hi) / 2, float(lng), float(lat), cid, year, False)]
            n_used += 1
        else:
            these = [((min(r) + max(r)) / 2, float(lng), float(lat), cid, year, True) for r in ranges]
            n_multi += 1
        for n in rn:
            anchors[n].extend(these)
    log(f'anchors: {n_contracts:,} contracts print stations and carry a point; {n_used:,} anchor at their stations, '
        f'{n_multi:,} give a candidate per stretch ({len(anchors):,} road names)')

    merged_cache: dict[tuple, list] = {}
    anchor_names = list(anchors)
    alike_cache: dict[str, list[str]] = {}

    def alike(name: str) -> list[str]:
        """The anchors' road names that read like `name` (word order and small spelling differences aside)."""
        if name not in alike_cache:
            hits = process.extract(name, anchor_names, scorer=fuzz.token_sort_ratio, score_cutoff=NAME_ALIKE, limit=8)
            alike_cache[name] = [h[0] for h in hits]
        return alike_cache[name]

    def road_piece(i: int, p: Point, by_name: bool, near_pts: list[Point]):
        """The merged road through way i: its same-named ways within ~40 km (or, unnamed, its same-class neighbours);
        the piece closest to `near_pts`."""
        key = (rows[i][2], round(p.x, 1), round(p.y, 1)) if by_name and rows[i][2] else None
        if key and key in merged_cache:
            pieces = merged_cache[key]
        else:
            if by_name and rows[i][2]:
                parts = [geoms[j] for j in tree.query(p.buffer(MERGE_DEG)) if rows[j][2] == rows[i][2]]
            else:
                parts = [geoms[j] for j in tree.query(p.buffer(0.05)) if rows[j][1] == rows[i][1] and not rows[j][2]] or [geoms[i]]
            merged = linemerge(MultiLineString(parts)) if len(parts) > 1 else parts[0]
            pieces = list(merged.geoms) if merged.geom_type == 'MultiLineString' else [merged]
            if key:
                merged_cache[key] = pieces
        return min(pieces, key=lambda g: sum(g.distance(q) for q in near_pts))

    def find_road(targets: list[str], p: Point):
        """The OSM way the road names, within ~1.6 km of p (score ≥ NAME_MIN), else the national road within 30 m."""
        near = tree.query(p.buffer(NEAR_DEG))
        scored = []
        for j in near:
            if names[j]:
                sc = max((fuzz.token_set_ratio(t, n) for t in targets for n in names[j]), default=0)
                if sc >= NAME_MIN:
                    scored.append((-sc, geoms[j].distance(p), j))
        if scored:
            return min(scored)[2], 'named'
        pm = transform(to_m, p)
        cands = sorted((transform(to_m, geoms[j]).distance(pm), j) for j in near if rows[j][1] in NATIONAL)
        if cands and cands[0][0] <= CLASS_MAX_M:
            return cands[0][1], 'class'
        return None, None

    def anchored(targets, ranges, mark, reach):
        """The line's stations cut along the OSM road its anchors sit on, or None."""
        lo, hi = min(min(r) for r in ranges), max(max(r) for r in ranges)
        if lo < ANCHOR_MIN_STATION_M:
            return None, 'local_stations'
        cands = {}
        for t in targets:
            for an in (x for n in alike(t) for x in anchors[n]):
                if lo - ANCHOR_REACH_M <= an[0] <= hi + ANCHOR_REACH_M:
                    cands[(an[3], an[0])] = an
        cands = list(cands.values())
        if len({c[3] for c in cands}) < 2:
            return None, 'few_candidates'
        mx, my = np.median([c[1] for c in cands]), np.median([c[2] for c in cands])
        mid_m = transform(to_m, Point(mx, my))
        near = [c for c in cands if transform(to_m, Point(c[1], c[2])).distance(mid_m) <= CLUSTER_M]
        if mark is not None and reach:
            mark_m = transform(to_m, mark)
            near = [c for c in near if transform(to_m, Point(c[1], c[2])).distance(mark_m) <= reach]
        if len({c[3] for c in near}) < 2:
            return None, 'few_in_one_place'
        # The OSM road: tried at the anchors nearest the line's stations; the road piece most anchors lie on wins.
        near.sort(key=lambda c: min(abs(c[0] - lo), abs(c[0] - hi)))
        pts = [Point(c[1], c[2]) for c in near]
        pts_m = [transform(to_m, q) for q in pts]
        best_piece = None
        for c, q in list(zip(near, pts))[:4]:
            way, conf_w = find_road(targets, q)
            if way is None:
                continue
            line = road_piece(way, q, conf_w == 'named', pts[:8])
            lm = transform(to_m, line)
            on = [(c2[0], lm.project(qm), c2[3], c2[5]) for c2, qm in zip(near, pts_m) if lm.distance(qm) <= ON_ROAD_M]
            if best_piece is None or len(on) > len(best_piece[3]):
                best_piece = (line, lm, conf_w, on)
        if best_piece is None:
            return None, 'no_road'
        line, lm, conf, pairs = best_piece
        for j in post_tree.query(line.buffer(0.0006)):
            pairs.append((posts[j][1] * 1000, lm.project(transform(to_m, posts[j][0])), f'osm:{j}', False))
        if len({x[2] for x in pairs}) < 2:
            return None, 'few_on_the_road'
        fit = robust_fit(pairs)
        if not fit:
            return None, 'no_fit'
        slope, icpt, inl, med = fit
        ks = [x[0] for x in inl]
        if lo < min(ks) - EXTRAPOLATE_M or hi > max(ks) + EXTRAPOLATE_M:
            return None, 'outside_anchors'
        segs = []
        for x0, x1 in ranges:
            s0, s1 = sorted((icpt + slope * x0, icpt + slope * x1))
            s0, s1 = max(0.0, s0), min(lm.length, s1)
            if s1 - s0 > 1:
                segs.append(substring(lm, s0, s1))
        if not segs or sum(sg.length for sg in segs) < 0.5 * sum(abs(b - a) for a, b in ranges):
            return None, 'off_road'
        return (segs, conf, len(inl), med), None

    summary = json.loads((lines_dir / 'summary.json').read_text())
    draw_summary = []
    only = set(a.only.split(',')) if a.only else None
    for b in summary['budgets']:
        if only and b['key'] not in only:
            continue
        f = json.loads((lines_dir / f"lines-{b['key']}.json").read_text())
        I = {c: i for i, c in enumerate(f['cols'])}
        at = lambda r, k: r[I[k]] if len(r) > I[k] else None
        places = f['places']
        out_rows, census, residuals = [], Counter(), []
        for r in f['rows']:
            level = f['levels'][at(r, 'level')]
            ranges, length = at(r, 'stations'), at(r, 'length_m')
            if not ranges or not length:
                continue
            census['with_stations'] += 1
            lid = f"gaa:{b['fy']}:{at(r, 'id')}" if b['stage'] == 'gaa' else at(r, 'id')
            own = Point(*at(r, 'pts')[0]) if level in ('contract', 'gps') else None
            pl = at(r, 'place')
            mark = own or (Point(places[pl][3], places[pl][4]) if pl is not None and pl >= 0 else None)
            reach = None if own else MARK_REACH_M.get(level)
            targets = road_names(at(r, 'title'))
            drawn = how = conf = None
            if targets:
                res, why = anchored(targets, ranges, mark, OWN_POINT_M * 30 if own else reach)
                if res:
                    segs, conf_a, n_inl, med = res
                    if own is None or min(sg.distance(transform(to_m, own)) for sg in segs) <= OWN_POINT_M:
                        drawn, how, conf = segs, 'anchored', conf_a
                        residuals.append(med)
                        census['anchors_used'] += n_inl
                    else:
                        census['anchored_far_from_own_point'] += 1
                else:
                    census[f'not_anchored:{why}'] += 1
            if drawn is None and own is not None:
                pm = transform(to_m, own)
                span = max(x for _, x in ranges) - min(x for x, _ in ranges)
                if span > length + SCATTER_SLACK_M:
                    census['scattered'] += 1
                else:
                    best, conf = find_road(targets or [''], own)
                    if best is not None:
                        line = road_piece(best, own, conf == 'named', [own])
                        lm = transform(to_m, line)
                        at_m = lm.project(pm)
                        pk = [(k * 1000, lm.project(transform(to_m, posts[j][0]))) for j in post_tree.query(line.buffer(0.0006))
                              for k in [posts[j][1]]]
                        fit = robust_fit(pk) if len(pk) >= 2 else None
                        if fit:
                            slope, icpt, _, _ = fit
                            segs = []
                            for x0, x1 in ranges:
                                s0, s1 = sorted((icpt + slope * x0, icpt + slope * x1))
                                if 0 <= s0 and s1 <= lm.length and s1 > s0:
                                    segs.append(substring(lm, s0, s1))
                            if segs and min(sg.distance(pm) for sg in segs) <= STATIONS_MAX_M:
                                drawn, how = segs, 'stations'
                        if drawn is None:
                            half = length / 2
                            seg = substring(lm, max(0, at_m - half), min(lm.length, at_m + half))
                            if seg.length > 0:
                                drawn, how = [seg], 'centred'
            if not drawn:
                continue
            coords = [[[round(x, 5), round(y, 5)] for x, y in transform(to_deg, sg.simplify(SIMPLIFY_M)).coords] for sg in drawn]
            longest = max(drawn, key=lambda sg: sg.length)
            mid = transform(to_deg, longest.interpolate(0.5, normalized=True))
            did, reg = district_at(mid)
            census[f'{how}:{conf}'] += 1
            census['drawn'] += 1
            out_rows.append([lid, how, conf, coords, [round(mid.x, 5), round(mid.y, 5)], did, reg])
        name = f"geom-{b['key']}.json"
        (out / name).write_text(json.dumps({
            'schema': 2, 'budget': b['key'],
            'cols': ['id', 'how', 'confidence', 'stretches', 'middle', 'district', 'region'], 'how': ['anchored', 'stations', 'centred'], 'confidence': ['named', 'class'],
            'license': 'ODbL-1.0', 'attribution': '© OpenStreetMap contributors', 'rows': out_rows,
        }, ensure_ascii=False, separators=(',', ':')) + '\n')
        res_q = (np.percentile(residuals, [50, 90]).round().tolist() if residuals else [None, None])
        draw_summary.append({'key': b['key'], **{k: census[k] for k in sorted(census)},
                             'anchored_residual_m': {'median': res_q[0], 'p90': res_q[1]}, 'bytes': (out / name).stat().st_size})
        log(f"{b['key']:<11} with stations {census['with_stations']:>6,}  drawn {census['drawn']:>6,}  " +
            ' '.join(f'{k}={census[k]}' for k in ('anchored:named', 'anchored:class', 'stations:named', 'centred:named',
                                                    'centred:class')) + f'  residual median {res_q[0]} m, p90 {res_q[1]} m')
    if only:
        print(json.dumps(draw_summary, indent=1))
        return
    pbf = Path(a.pbf)
    (out / 'draw-summary.json').write_text(json.dumps({
        'schema': 2, 'built_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'lines_built_at': summary['built_at'],
        'osm': {'extract': pbf.name, 'bytes': pbf.stat().st_size, 'sha256': sha256(pbf),
                'downloaded': datetime.fromtimestamp(pbf.stat().st_mtime, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                'source': 'https://download.geofabrik.de/asia/philippines-latest.osm.pbf', 'license': 'ODbL-1.0',
                'attribution': '© OpenStreetMap contributors', 'ways': len(rows), 'kilometre_posts': len(posts)},
        'anchors': {'contracts_with_stations_and_point': n_contracts, 'anchors': n_used, 'candidate_contracts': n_multi,
                    'road_names': len(anchors),
                    'source': str(contracts_file), 'sha256': sha256(contracts_file)},
        'rules': {'name_min': NAME_MIN, 'class_max_m': CLASS_MAX_M, 'stations_max_m': STATIONS_MAX_M,
                  'scatter_slack_m': SCATTER_SLACK_M, 'simplify_m': SIMPLIFY_M, 'anchor_max_span_m': ANCHOR_MAX_SPAN_M,
                  'anchor_reach_m': ANCHOR_REACH_M, 'cluster_m': CLUSTER_M, 'on_road_m': ON_ROAD_M, 'fit_tol_m': FIT_TOL_M,
                  'scale': [SCALE_MIN, SCALE_MAX], 'extrapolate_m': EXTRAPOLATE_M, 'own_point_m': OWN_POINT_M,
                  'anchor_min_station_m': ANCHOR_MIN_STATION_M, 'name_alike': NAME_ALIKE, 'max_candidates': MAX_CANDIDATES,
                  'mark_reach_m': MARK_REACH_M},
        'budgets': draw_summary,
    }, indent=1) + '\n')
    log('done')


if __name__ == '__main__':
    main()
