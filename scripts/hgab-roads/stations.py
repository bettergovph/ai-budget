"""Stations printed in a DPWH title or contract description, shared by build.py and draw.py.

"K0029+690 - K0031+087", "K0379 + (-400) - K0379 + (-200)", "Sta. 1600+564.9 - Sta. 1601+020", "Sta 0 + 000 to 0 + 510".
A range reads as metres from the road's kilometre zero: [from, to]. DPWH road and bridge section IDs (S01859LZ, B03085LZ)
are read beside them.
"""
from __future__ import annotations

import re

_KM = r'(\d{1,4})\s*\+\s*\(?\s*(-?\d{1,4}(?:\.\d+)?)\s*\)?'
STATIONS = re.compile(r'\b(?:K|Sta\.?\s*)\s*' + _KM + r'\s*(?:-|–|—|to)\s*(?:K|Sta\.?)?\s*' + _KM, re.IGNORECASE)
SECTION_ID = re.compile(r'\b([SB]\d{5}[A-Z]{2})\b')
MAX_RANGE_M = 30_000   # one station range longer than this is read but marked for review


def stations(text: str) -> tuple[list[list[int]], bool]:
    """Every station range in a text, in metres [[from, to], …], and whether one reads oddly (metres past 999,
    reversed, or longer than MAX_RANGE_M)."""
    out, review = [], False
    for m in STATIONS.finditer(text or ''):
        a_km, a_m, b_km, b_m = m.groups()
        a, b = int(a_km) * 1000 + float(a_m), int(b_km) * 1000 + float(b_m)
        if abs(float(a_m)) > 999 or abs(float(b_m)) > 999 or b < a or b - a > MAX_RANGE_M:
            review = True
        pair = [round(a), round(b)]
        if pair not in out:
            out.append(pair)
    return out, review


def length_of(ranges: list[list[int]]) -> int | None:
    return sum(abs(b - a) for a, b in ranges) if ranges else None
