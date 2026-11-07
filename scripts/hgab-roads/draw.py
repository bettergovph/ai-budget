#!/usr/bin/env python3
"""Road and bridge lines drawn along OpenStreetMap roads, for the roads map (docs/hgab-roads.md). Jason (2026-11-07),
asked whether a line could be drawn: "We have projects that use openstreetmap already".

Which lines: those the build placed at a point (the matched DPWH contract's, or GPS printed in the title) whose title
prints stations (so a length). Per line:
  1. the road the title names (the text before its stations; the name in brackets tried too), matched to the OSM roads
     within 1.5 km of the point by name, ref or other names (abbreviations spelled out); when none matches, the
     national-class road (trunk, primary, secondary) within 30 m of the point, marked lower confidence ('class');
  2. that road's ways of the same name within about 40 km, merged; the piece the point lies on;
  3. drawn:
     - 'stations': OSM kilometre posts on the road place the title's stations, and the stretch they give lies within
       300 m of the point (half the posts tested elsewhere sit 0.9–7.5 km off, so the point is the check);
     - 'centred': otherwise the stated length along the road, centred on the point;
     - not drawn when the stations are scattered (several stretches kilometres apart: one stretch would be wrong), or no
       road is found.
Geometry is ODbL (OpenStreetMap contributors): it is written apart from the budget data, credited, with the extract's
date and checksum.

Usage: draw.py --osm=<dir with roads.parquet, posts.parquet> --pbf=<the extract> --lines=<build out dir> [--out=<dir>]
Outputs: geom-<budget>.json per budget; draw-summary.json (per budget: lines eligible, drawn by how and confidence).
"""
from __future__ import annotations

import argparse, hashlib, json, re, time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import numpy as np
from pyproj import Transformer
from rapidfuzz import fuzz
from shapely import STRtree, wkb
from shapely.geometry import MultiLineString, Point
from shapely.ops import linemerge, substring, transform

KEEP = ('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'motorway_link', 'trunk_link',
        'primary_link', 'secondary_link', 'tertiary_link', 'road', 'residential')
NATIONAL = {'motorway', 'trunk', 'primary', 'secondary'}
NEAR_DEG, MERGE_DEG = 0.015, 0.36        # about 1.6 km and 40 km
NAME_MIN, CLASS_MAX_M, STATIONS_MAX_M = 85, 30, 300
SCATTER_SLACK_M = 1000                   # stations spanning more than the length plus this: scattered
SIMPLIFY_M = 4

ABBR = [(r'\bsn\b', 'san'), (r'\bsta\b\.?', 'santa'), (r'\bsto\b\.?', 'santo'), (r'\brd\b', 'road'),
        (r'\bjct\b', 'junction'), (r'\bhwy\b|\bhi ?way\b|\bh ?way\b', 'highway'), (r'\bbdry\b', 'boundary'),
        (r'\bave\b', 'avenue'), (r'\bblvd\b', 'boulevard'), (r'\bst\b', 'street'), (r'\bnatl\b|\bnat l\b', 'national'),
        (r'\bbr\b', 'bridge'), (r'\bpres\b', 'president'), (r'\bgen\b', 'general'), (r'\bext\b', 'extension')]
GENERIC = {'road', 'highway', 'junction', 'boundary', 'national', 'avenue', 'street', 'the', 'of', 'and', 'section',
           'along', 'via', 'to'}
LEAD = re.compile(r'^(?:preventive maintenance|rehabilitation|reconstruction|upgrading|widening|road widening|construction|'
                  r'improvement|concreting|asphalt overlay|paving|completion)\b[^,]*?\b(?:along|of)\s+', re.I)
STATION_START = re.compile(r'\s*(?:[-–,]\s*)?(?:\bK\s*\d{1,4}\s*\+|\bSta\.?\s*\d)', re.I)


def norm(s: str) -> str:
    s = (s or '').lower().replace('–', ' ').replace('—', ' ').replace('-', ' ').replace("'", ' ').replace('.', ' ')
    for a, b in ABBR:
        s = re.sub(a, b, s)
    s = re.sub(r'[^a-z0-9ñ ]+', ' ', s)
    return ' '.join(w for w in s.split() if w not in GENERIC)


def road_names(title: str) -> list[str]:
    """The road a title names: the text before its stations, less a leading work ("Preventive Maintenance along"),
    and the name in brackets, if any."""
    m = STATION_START.search(title)
    head = title[:m.start()] if m else title
    head = LEAD.sub('', head).strip(' ,-–')
    out = [re.sub(r'\([^)]*\)', ' ', head)]
    out += [x for x in re.findall(r'\(([^)]*)\)', head) if not re.fullmatch(r'\s*[SB]\d{5}[A-Z]{2}\s*|\s*[A-Z]{2}\s*', x)]
    return [n for n in (norm(x) for x in out) if n]


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--osm', required=True)
    ap.add_argument('--pbf', required=True)
    ap.add_argument('--lines', required=True)
    ap.add_argument('--out')
    a = ap.parse_args()
    osm, lines_dir = Path(a.osm), Path(a.lines)
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
    merged_cache: dict[tuple, list] = {}

    def road_line(i: int, p: Point, by_name: bool):
        """The merged road through way i: its same-named ways within ~40 km (or, unnamed, its same-class neighbours)."""
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
        return min(pieces, key=lambda g: g.distance(p))

    summary = json.loads((lines_dir / 'summary.json').read_text())
    draw_summary = []
    for b in summary['budgets']:
        f = json.loads((lines_dir / f"lines-{b['key']}.json").read_text())
        I = {c: i for i, c in enumerate(f['cols'])}
        at = lambda r, k: r[I[k]] if len(r) > I[k] else None
        out_rows, census = [], Counter()
        for r in f['rows']:
            level = f['levels'][at(r, 'level')]
            ranges, length = at(r, 'stations'), at(r, 'length_m')
            if level not in ('contract', 'gps') or not ranges or not length:
                continue
            census['eligible'] += 1
            lid = f"gaa:{b['fy']}:{at(r, 'id')}" if b['stage'] == 'gaa' else at(r, 'id')
            lng, lat = at(r, 'pts')[0]
            p = Point(lng, lat)
            pm = transform(to_m, p)
            span = max(x for _, x in ranges) - min(x for x, _ in ranges)
            if span > length + SCATTER_SLACK_M:
                census['scattered'] += 1
                continue
            targets = road_names(at(r, 'title'))
            best, conf = None, None
            near = tree.query(p.buffer(NEAR_DEG))
            scored = []
            for j in near:
                if not names[j]:
                    continue
                sc = max((fuzz.token_set_ratio(t, n) for t in targets for n in names[j]), default=0)
                if sc >= NAME_MIN:
                    scored.append((-sc, geoms[j].distance(p), j))
            if scored:
                best, conf = min(scored)[2], 'named'
            else:
                cands = sorted((transform(to_m, geoms[j]).distance(pm), j) for j in near if rows[j][1] in NATIONAL)
                if cands and cands[0][0] <= CLASS_MAX_M:
                    best, conf = cands[0][1], 'class'
            if best is None:
                census['no_road'] += 1
                continue
            line = road_line(best, p, conf == 'named')
            lm = transform(to_m, line)
            at_m = lm.project(pm)
            drawn, how = None, None
            pk = [(k, lm.project(transform(to_m, posts[j][0]))) for j in post_tree.query(line.buffer(0.0006))
                  for k in [posts[j][1]]]
            if len(pk) >= 2 and len({k for k, _ in pk}) >= 2:
                kms, pos = np.array([k for k, _ in pk]), np.array([x for _, x in pk])
                slope, icpt = np.polyfit(kms, pos, 1)
                if 700 < abs(slope) < 1300:
                    segs = []
                    for x0, x1 in ranges:
                        s0, s1 = sorted((icpt + slope * x0 / 1000, icpt + slope * x1 / 1000))
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
                census['no_road'] += 1
                continue
            coords = [[[round(x, 5), round(y, 5)] for x, y in transform(to_deg, sg.simplify(SIMPLIFY_M)).coords] for sg in drawn]
            census[f'{how}:{conf}'] += 1
            census['drawn'] += 1
            census['drawn_m'] += round(sum(sg.length for sg in drawn))
            out_rows.append([lid, how, conf, coords])
        name = f"geom-{b['key']}.json"
        (out / name).write_text(json.dumps({
            'schema': 1, 'budget': b['key'], 'how': ['stations', 'centred'], 'confidence': ['named', 'class'],
            'license': 'ODbL-1.0', 'attribution': '© OpenStreetMap contributors', 'rows': out_rows,
        }, ensure_ascii=False, separators=(',', ':')) + '\n')
        draw_summary.append({'key': b['key'], **{k: census[k] for k in sorted(census)}, 'bytes': (out / name).stat().st_size})
        log(f"{b['key']:<11} eligible {census['eligible']:>5,}  drawn {census['drawn']:>5,}  " +
            ' '.join(f'{k}={census[k]}' for k in ('stations:named', 'stations:class', 'centred:named', 'centred:class',
                                                    'scattered', 'no_road')))
    pbf = Path(a.pbf)
    (out / 'draw-summary.json').write_text(json.dumps({
        'schema': 1, 'built_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'lines_built_at': summary['built_at'],
        'osm': {'extract': pbf.name, 'bytes': pbf.stat().st_size, 'sha256': sha256(pbf),
                'downloaded': datetime.fromtimestamp(pbf.stat().st_mtime, timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                'source': 'https://download.geofabrik.de/asia/philippines-latest.osm.pbf', 'license': 'ODbL-1.0',
                'attribution': '© OpenStreetMap contributors', 'ways': len(rows), 'kilometre_posts': len(posts)},
        'rules': {'name_min': NAME_MIN, 'class_max_m': CLASS_MAX_M, 'stations_max_m': STATIONS_MAX_M,
                  'scatter_slack_m': SCATTER_SLACK_M, 'simplify_m': SIMPLIFY_M},
        'budgets': draw_summary,
    }, indent=1) + '\n')
    log('done')


if __name__ == '__main__':
    main()
