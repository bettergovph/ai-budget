"""Roads and kilometre posts from the Philippines OSM extract, for the drawing test.

Usage: osm_extract.py <philippines-latest.osm.pbf> <out dir>
Writes roads.parquet (way id, highway, name, ref, other names, WKB line) and posts.parquet (every highway=milestone node
with its tags and point).
"""
import json
import sys
from pathlib import Path

import duckdb
import osmium
from shapely import wkb
from shapely.geometry import LineString

ROAD = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'road', 'living_street',
        'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'service', 'track'}

pbf, out = sys.argv[1], Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
roads, posts = [], []
fp = osmium.FileProcessor(pbf).with_locations('sparse_mem_array').with_filter(osmium.filter.KeyFilter('highway'))
for o in fp:
    if o.is_node():
        if o.tags.get('highway') == 'milestone' and o.location.valid():
            posts.append((o.id, o.location.lon, o.location.lat, json.dumps(dict(o.tags))))
    elif o.is_way():
        hw = o.tags.get('highway')
        if hw not in ROAD:
            continue
        try:
            pts = [(n.lon, n.lat) for n in o.nodes if n.location.valid()]
        except osmium.InvalidLocationError:
            continue
        if len(pts) < 2:
            continue
        t = o.tags
        alt = ';'.join(v for k in ('alt_name', 'old_name', 'official_name', 'loc_name', 'short_name') if (v := t.get(k)))
        roads.append((o.id, hw, t.get('name'), t.get('ref'), alt or None, wkb.dumps(LineString(pts))))
con = duckdb.connect()
con.execute('create table roads (id bigint, highway varchar, name varchar, ref varchar, alt varchar, geom blob)')
con.executemany('insert into roads values (?, ?, ?, ?, ?, ?)', roads)
con.execute(f"copy roads to '{out / 'roads.parquet'}' (format parquet)")
con.execute('create table posts (id bigint, lng double, lat double, tags varchar)')
con.executemany('insert into posts values (?, ?, ?, ?)', posts)
con.execute(f"copy posts to '{out / 'posts.parquet'}' (format parquet)")
print(f'{len(roads):,} road ways, {len(posts):,} kilometre posts')
