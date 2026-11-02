#!/usr/bin/env python3
"""Fetch the source workbench's files this pipeline reuses, at one pinned commit.

The workbench (github.com/csiiiv/DPWH-NEP-HB-2027-ANALYSIS) is never vendored. Its code is imported from
the copy this script writes, so the GAA years are placed by the same scope rule, GPS reader and title
matcher that place its FY2027 multi-purpose buildings:

  analysis/web/buildMpbLegislativeLens.py     the MPB scope rule (PAP or title), mpb_title_scope()
  analysis/web/buildMpbPsgcApproxOverlay.py   PSGC centroids from the 2023 PSA shapefiles, resolve_centroid()
  master_list/scripts/locations.py            the title-to-PSGC matcher (location_evidence_v6.5)
  master_list/scripts/readable_titles.py      readable_title_v1 cleanup
  gps-analysis/scan_gps_inventory.py          title GPS reader, analyze_text()
  PSGC2LEG/data/*                             the PSGC catalog and PSGC -> legislative district assignments
  analysis/data/mpb_*_2027.json               its FY2027 MPB lens and approximate placements
  analysis/data/congress_district_map_2027.json   legislative district outlines

Usage: upstream.py <dest_dir>
  UPSTREAM_GIT=<clone>   copy with `git archive` from a local clone holding the commit (default: download
                         each file from raw.githubusercontent.com)
"""
import os, subprocess, sys, tarfile, io, urllib.parse, urllib.request
from pathlib import Path

REPO = 'csiiiv/DPWH-NEP-HB-2027-ANALYSIS'
COMMIT = '565076af7ace7c0a71915ed42ae2cc7704d26e1f'  # 2026-11-02 "map: count all MPB rows without title GPS in district badges"
FILES = [
    'analysis/web/buildMpbLegislativeLens.py',
    'analysis/web/buildLocationLens.py',
    'analysis/web/buildMpbPsgcApproxOverlay.py',
    'analysis/builders/normalize_labels.py',
    'master_list/scripts/locations.py',
    'master_list/scripts/readable_titles.py',
    'gps-analysis/scan_gps_inventory.py',
    'gps-analysis/coordinate_parse.py',
    'PSGC2LEG/data/psgc_locations.jsonl',
    'PSGC2LEG/data/psgc_leg_assignments.jsonl',
    'PSGC2LEG/data/legislative_districts.json',
    'analysis/data/mpb_legislative_index_2027.json',
    'analysis/data/mpb_psgc_approx_overlay_2027.json',
    'analysis/data/congress_district_map_2027.json',
    'analysis/data/comparison_projects_2027.json',
]


def fetch(dest: Path) -> Path:
    root = dest / COMMIT
    if all((root / f).exists() for f in FILES):
        return root
    root.mkdir(parents=True, exist_ok=True)
    clone = os.environ.get('UPSTREAM_GIT')
    if clone:
        tar = subprocess.run(['git', '-C', clone, 'archive', COMMIT, *FILES], check=True, capture_output=True).stdout
        tarfile.open(fileobj=io.BytesIO(tar)).extractall(root, filter='data')
    else:
        for f in FILES:
            out = root / f
            if out.exists():
                continue
            out.parent.mkdir(parents=True, exist_ok=True)
            url = f'https://raw.githubusercontent.com/{REPO}/{COMMIT}/{urllib.parse.quote(f)}'
            print(f'  fetch {f}', file=sys.stderr)
            with urllib.request.urlopen(url, timeout=300) as r:
                tmp = out.with_suffix(out.suffix + '.part')
                tmp.write_bytes(r.read())
                tmp.rename(out)
    missing = [f for f in FILES if not (root / f).exists()]
    if missing:
        raise SystemExit(f'upstream: missing after fetch: {missing}')
    return root


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    print(fetch(Path(sys.argv[1])))
