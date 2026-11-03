"""Measure how often match.py's links are right, on a sample. For each sampled link, fetch that one contract's detail
from the API and look for a component whose title is the GAA line's title (DPWH writes components as
"<type of work> - <title as in the GAA>"). Writes OUT/qa.json. A few hundred requests; the full detail is not fetched.

    python qa.py OUT [--per 40]
"""
import argparse, json, random, re, time, unicodedata, urllib.request
import concurrent.futures as cf
from pathlib import Path
import pandas as pd
from rapidfuzz import fuzz

ap = argparse.ArgumentParser(); ap.add_argument('out'); ap.add_argument('--per', type=int, default=40)
a = ap.parse_args(); out = Path(a.out)
K = pd.read_csv(out / 'links.csv', dtype={'contract_id': str})


def stratum(r):
    if r.method != 'one_to_one':
        return r.method
    return f"one_to_one, {r.searched}, {'sole candidate' if r.candidates == 1 else 'several candidates'}"


K['stratum'] = K.apply(stratum, axis=1)
# sample whole lines for split, whole contracts for bundle, links otherwise
S = []
for st, g in K.groupby('stratum'):
    key = {'split': 'line_id', 'bundle': 'contract_id'}.get(st, None)
    if key:
        ids = g[key].drop_duplicates().sample(min(a.per // 2, g[key].nunique()), random_state=11)
        S.append(g[g[key].isin(ids)])
    else:
        S.append(g.sample(min(a.per, len(g)), random_state=11))
S = pd.concat(S)


def get(cid):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(f'https://api.dpwh.bettergov.ph/projects/{cid}', timeout=60) as r:
                return cid, json.load(r)['data']
        except Exception:
            time.sleep(3)
    return cid, None


with cf.ThreadPoolExecutor(4) as ex:
    D = dict(ex.map(get, S.contract_id.unique()))


def n(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def best(row):
    d = D.get(row.contract_id)
    if not d:
        return None
    titles = [c.get('description') or '' for c in d.get('components') or []]
    return max([max(fuzz.ratio(n(row.gaa_title), n(t)), fuzz.ratio(n(row.gaa_title), n(t.split(' - ', 1)[-1])))
                for t in titles] + [0])


S['component_score'] = S.apply(best, axis=1)
S['confirmed'] = S.component_score >= 90
res = {}
for st, g in S.groupby('stratum'):
    f = g[g.component_score.notna()]
    res[st] = dict(sampled=len(g), fetched=len(f), confirmed=int(f.confirmed.sum()),
                   share=round(float(f.confirmed.mean()), 3) if len(f) else None,
                   links_in_stratum=int((K.stratum == st).sum()))
    print(f"{st:50s} {res[st]['confirmed']:3d}/{res[st]['fetched']:3d} confirmed  ({res[st]['share']:.0%}) "
          f"of {res[st]['links_in_stratum']:,} links")
misses = S[(S.component_score.notna()) & ~S.confirmed].sort_values('component_score')
(out / 'qa.json').write_text(json.dumps(dict(
    method='component title of the fetched contract vs the GAA title, rapidfuzz ratio >= 90', strata=res,
    misses=misses[['stratum', 'line_id', 'gaa_title', 'contract_id', 'contract_description', 'component_score']]
    .to_dict('records')), indent=1, default=str) + '\n')
