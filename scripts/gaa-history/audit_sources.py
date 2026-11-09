"""Verify saved bytes and account for unavailable archive links explicitly."""
from collections import Counter
import concurrent.futures
import csv
import json
from pathlib import Path
import zipfile

from download import digest, save_json


def main():
    root=Path('data/gaa-history').resolve()
    manifest=json.loads((root/'manifest.json').read_text())
    # Import successful segmented transfers only after their CRC-checked journal exists.
    journals={j['url']:j for p in root.glob('large-download-*.json') for j in [json.loads(p.read_text())]}
    for item in manifest['files']:
        if item['url'] in journals:
            item.update(journals[item['url']])
    def check(item):
        if item.get('status')!='downloaded':
            return dict(year=item['year'],url=item['url'],status=item.get('status','pending'),error=item.get('error',''))
        path=root/item['path']
        if not path.exists() or path.stat().st_size!=item['bytes'] or digest(path)!=item['sha256']:
            raise ValueError(f'Saved file failed integrity check: {path}')
        if path.suffix.lower()=='.zip':
            with zipfile.ZipFile(path) as z:
                bad=z.testzip()
                if bad:raise ValueError(f'ZIP CRC failure: {path}: {bad}')
        return None
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        missing=[x for x in pool.map(check,manifest['files']) if x]
    save_json(root/'manifest.json',manifest)
    save_json(root/'quality/unavailable-sources.json',missing)
    with (root/'unavailable-sources.csv').open('w') as f:
        w=csv.DictWriter(f,fieldnames=['year','url','status','error']);w.writeheader();w.writerows(missing)
    report=dict(source_entries=len(manifest['files']),unique_urls=len({x['url'] for x in manifest['files']}),
        statuses=dict(Counter(x.get('status','pending') for x in manifest['files'])),
        bytes=sum(x.get('bytes',0) for x in manifest['files'] if x.get('status')=='downloaded'),
        downloaded_files_sha256_verified=True,downloaded_zips_crc_verified=True,
        discovery_errors=manifest['discovery_errors'],unavailable_by_year=dict(Counter(x['year'] for x in missing)))
    save_json(root/'quality/source-audit.json',report)
    print(json.dumps(report,indent=2))

if __name__=='__main__':main()
