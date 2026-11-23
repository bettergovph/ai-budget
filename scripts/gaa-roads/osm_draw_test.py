"""Can a DPWH road line be drawn along OpenStreetMap? Test on sample.json (national road lines, FY2023–2025, with
stations in the title and a matched contract's point).

Usage: osm_draw_test.py <osm out dir> <sample.json> <out geojson>

Per line:
  1. the OSM roads within 1.5 km of the contract's point; the one whose name (or ref/alt names) best matches the
     title's road name ("Iloilo East Coast-Capiz Rd" ~ "Iloilo East Coast–Capiz Road");
  2. the matched road's ways of that name within 40 km, merged into one line; the point projected onto it;
  3. kilometre posts (highway=milestone) on that line with a readable km: if two or more, a km → position fit, and
     the title's stations cut from it ("stations"); else the stated length centred on the point ("centred").
Prints coverage figures and writes a GeoJSON of every drawn line (with the contract point) for a visual check.
"""
import json
import re
import sys
from pathlib import Path

import duckdb
import numpy as np
from pyproj import Transformer
from rapidfuzz import fuzz
from shapely import STRtree, wkb
from shapely.geometry import LineString, MultiLineString, Point, mapping
from shapely.ops import linemerge, substring, transform

osm, sample_path, out_path = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
KEEP = ('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'motorway_link', 'trunk_link',
        'primary_link', 'secondary_link', 'tertiary_link', 'road', 'residential')
con = duckdb.connect()
rows = con.execute(f"select id, highway, name, ref, alt, geom from '{osm / 'roads.parquet'}' "
                   f"where highway in ({','.join('?' * len(KEEP))})", list(KEEP)).fetchall()
geoms = [wkb.loads(g) for *_, g in rows]
tree = STRtree(geoms)
posts = con.execute(f"select lng, lat, tags from '{osm / 'posts.parquet'}'").fetchall()
post_pts = [Point(a, b) for a, b, _ in posts]
post_tree = STRtree(post_pts)
print(f'{len(rows):,} road ways loaded; {len(posts):,} kilometre posts')

to_m = Transformer.from_crs(4326, 32651, always_xy=True).transform
to_deg = Transformer.from_crs(32651, 4326, always_xy=True).transform

ABBR = [(r'\brd\b', 'road'), (r'\bjct\b', 'junction'), (r'\bhwy\b', 'highway'), (r'\bbdry\b', 'boundary'),
        (r'\bave\b', 'avenue'), (r'\bblvd\b', 'boulevard'), (r'\bst\b', 'street'), (r'\bnat\'?l\b', 'national'),
        (r'\bsto\b', 'santo'), (r'\bsta\b', 'santa'), (r'\bbrgy\b', 'barangay'), (r'\bext\b', 'extension')]
GENERIC = {'road', 'highway', 'junction', 'boundary', 'national', 'avenue', 'street', 'the', 'of', 'and', 'section'}


def norm(s):
    s = (s or '').lower().replace('–', ' ').replace('—', ' ').replace('-', ' ')
    s = re.sub(r'\([^)]*\)', ' ', s)  # "(LZ)", "(Jct Bais-…)"
    for a, b in ABBR:
        s = re.sub(a, b, s)
    s = re.sub(r'[^a-z0-9ñ ]+', ' ', s)
    return ' '.join(w for w in s.split() if w not in GENERIC)


def km_of(tags):
    """A kilometre post's km: distance=12.5, or a name/ref like 'K0012', 'KM 12', '12'."""
    for k in ('distance', 'ref', 'name', 'pk', 'km'):
        v = tags.get(k)
        if not v:
            continue
        m = re.search(r'(?:^|K(?:M)?\s*0*)(\d{1,4}(?:\.\d+)?)\s*(?:km)?$', v.strip(), re.I)
        if m:
            return float(m.group(1))
    return None


sample = json.load(open(sample_path))
stats = {'lines': len(sample), 'road_within_50m': 0, 'road_within_200m': 0, 'name_match': 0, 'drawn': 0,
         'by_stations': 0, 'centred': 0, 'posts_near': 0}
feats = []
post_tag_examples = []
for s in sample:
    p = Point(s['lng'], s['lat'])
    pm = transform(to_m, p)
    near = tree.query(p.buffer(0.015))  # ~1.6 km
    if not len(near):
        continue
    dists = sorted((transform(to_m, geoms[i]).distance(pm), i) for i in near)
    if dists[0][0] <= 50:
        stats['road_within_50m'] += 1
    if dists[0][0] <= 200:
        stats['road_within_200m'] += 1
    target = norm(s['road'])
    best = (0, None)
    for d, i in dists:
        if d > 1500:
            break
        _, hw, name, ref, alt, _ = rows[i]
        names = [n for n in [name, ref, *(alt or '').split(';')] if n]
        sc = max((fuzz.token_set_ratio(target, norm(n)) for n in names), default=0)
        if sc > best[0] or (sc == best[0] and best[1] is not None and d < best[2]):
            best = (sc, i, d)
    if best[0] < 85 or best[1] is None:
        continue
    stats['name_match'] += 1
    i = best[1]
    name = rows[i][2]
    # The road: its ways of the same name within ~40 km, merged; the piece the point lies on.
    if name:
        cand = tree.query(p.buffer(0.36))
        parts = [geoms[j] for j in cand if rows[j][2] == name]
    else:
        parts = [geoms[i]]
    merged = linemerge(MultiLineString(parts)) if len(parts) > 1 else parts[0]
    pieces = list(merged.geoms) if merged.geom_type == 'MultiLineString' else [merged]
    line = min(pieces, key=lambda g: g.distance(p))
    lm = transform(to_m, line)
    at = lm.project(pm)
    # Kilometre posts on this line.
    pk = []
    for j in post_tree.query(line.buffer(0.0006)):
        km = km_of(json.loads(posts[j][2]))
        if len(post_tag_examples) < 12:
            post_tag_examples.append(posts[j][2])
        if km is not None:
            pk.append((km, lm.project(transform(to_m, post_pts[j]))))
    if pk:
        stats['posts_near'] += 1
    drawn, how = None, None
    if len(pk) >= 2:
        kms, pos = np.array([k for k, _ in pk]), np.array([x for _, x in pk])
        slope, icpt = np.polyfit(kms, pos, 1)
        if 700 < abs(slope) < 1300:  # metres per km: posts consistent with the line
            segs = []
            for a, b in s['chainages']:
                x0, x1 = sorted((icpt + slope * a / 1000, icpt + slope * b / 1000))
                if 0 <= x0 and x1 <= lm.length:
                    segs.append(substring(lm, x0, x1))
            if segs:
                drawn, how = segs, 'stations'
    if drawn is None and s['length_m'] > 0:
        half = s['length_m'] / 2
        drawn, how = [substring(lm, max(0, at - half), min(lm.length, at + half))], 'centred'
    if drawn:
        stats['drawn'] += 1
        stats['by_stations' if how == 'stations' else 'centred'] += 1
        g = MultiLineString([transform(to_deg, d) for d in drawn if d.length > 0])
        feats.append({'type': 'Feature', 'geometry': mapping(g),
                      'properties': {'title': s['title'], 'how': how, 'osm_name': name, 'score': best[0],
                                     'length_m': s['length_m'], 'drawn_m': round(sum(d.length for d in drawn)),
                                     'contract': s['contract'], 'lng': s['lng'], 'lat': s['lat']}})
json.dump({'type': 'FeatureCollection', 'features': feats}, open(out_path, 'w'))
n = stats['lines']
print({k: f'{v} ({v / n:.0%})' for k, v in stats.items()})
print('post tag examples:', post_tag_examples[:8])
