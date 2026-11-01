import glob, re, sys, pymupdf
import os
PDF_GLOB = os.environ.get('HB_PDF_GLOB', os.path.expanduser('~/.paseo/uploads/*/hb-10858-vol-{v}.pdf'))
# HB_PDF_1A / HB_PDF_1B / ... point one volume at a specific file (e.g. the 2nd-reading copies)
VOL = {v: os.environ.get(f'HB_PDF_{v.upper()}') or (glob.glob(PDF_GLOB.format(v=v)) or [None])[0]
       for v in ('1a', '1b', '1c', '2')}
DOTS = re.compile(r'^[.… ]+$')
def rows(page, ymerge=2.5):
    ws = sorted(page.get_text('words'), key=lambda w: (w[1], w[0]))
    out = []
    for w in ws:
        if DOTS.match(w[4]): continue
        w = (w[0], w[1], w[2], w[3], w[4].rstrip('.') if re.search(r'\w\.{2,}$', w[4]) else w[4])
        if out and w[1] - out[-1][0] <= ymerge:
            out[-1][1].append(w); out[-1][0] = min(out[-1][0], w[1])
        else:
            out.append([w[1], [w]])
    return [(y, sorted(ws, key=lambda w: w[0])) for y, ws in out]
if __name__ == '__main__':
    v, a, b = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    doc = pymupdf.open(VOL[v])
    for p in range(a, b + 1):
        print(f'===== {v} pdf page index {p}')
        for y, ws in rows(doc[p]):
            print(f'{y:6.1f} ' + '  '.join(f'{w[4]}@{w[2]:.0f}' if re.search(r'\d', w[4]) else w[4] for w in ws))
