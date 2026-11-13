#!/usr/bin/env python3
"""Probe a Z.ai model's concurrency: N calls at once, no retries; count 200s / 429s, throughput and latency.

  probe_limits.py PDF MODEL 1,5,10,20 [--rounds 3]
"""
import base64, json, os, sys, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor
import pymupdf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import redact_signatures as rs

pdf, model, levels = sys.argv[1], sys.argv[2], [int(x) for x in sys.argv[3].split(",")]
rounds = int(sys.argv[sys.argv.index("--rounds") + 1]) if "--rounds" in sys.argv else 3
jpeg, _ = rs.render(pymupdf.open(pdf)[0])
body = json.dumps({"model": model, "max_tokens": 300, "temperature": 0, "thinking": {"type": "disabled"},
                   "messages": [{"role": "user", "content": [
                       {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()}},
                       {"type": "text", "text": rs.PROMPT}]}]}).encode()


def call(_):
    t0 = time.time()
    req = urllib.request.Request(rs.GLM_URL, data=body, method="POST", headers={
        "Authorization": f"Bearer {os.environ['GLM_API_KEY']}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            r.read()
            return 200, time.time() - t0, ""
    except urllib.error.HTTPError as e:
        return e.code, time.time() - t0, e.read().decode()[:160]
    except Exception as e:  # noqa: BLE001
        return 0, time.time() - t0, str(e)[:160]


for n in levels:
    t0 = time.time()
    with ThreadPoolExecutor(n) as ex:
        res = list(ex.map(call, range(n * rounds)))
    wall = time.time() - t0
    ok = [s for c, s, _ in res if c == 200]
    codes = {}
    for c, _, m in res:
        codes[c] = codes.get(c, 0) + 1
    msg = next((m for c, _, m in res if c != 200), "")
    print(f"{model} concurrency {n:3d}: {len(res)} calls {codes} | {len(ok) / wall:.2f} ok/s | "
          f"latency median {sorted(ok)[len(ok) // 2] if ok else 0:.1f}s | {msg}", flush=True)
