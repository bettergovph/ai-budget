/**
 * A PDF drawn page by page with PDF.js, for the reviewer's Documents tab on phones: phone browsers don't show a PDF
 * inside a page (Android shows nothing; iPhones only the first page). Pages are drawn as they scroll into view, at the
 * width of the screen times the zoom; zooming scrolls sideways. Loaded only when that tab opens (React.lazy), so the
 * reviewer on a computer never downloads PDF.js. If the file can't be read, it offers to open it in a new tab.
 */
import { useEffect, useRef, useState } from 'react';
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

const ZOOMS = [1, 1.5, 2, 3] as const;

export default function HgabPdfPages({ src, openHref, title }: { src: string; openHref: string; title: string }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    // Keyed by file in the parent, so state starts empty for each document.
    const task = getDocument({ url: src, disableAutoFetch: true, disableStream: false });
    let live = true;
    task.promise.then((d) => { if (live) setDoc(d); }, () => { if (live) setFailed(true); });
    return () => { live = false; void task.destroy(); };
  }, [src]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const open = <a className="rv-btn" href={openHref} target="_blank" rel="noopener noreferrer">Open in a new tab</a>;
  return (
    <div className="rv-pdf" ref={box}>
      {failed ? (
        <div className="rv-viewer-empty"><p>This document can’t be shown here.</p>{open}</div>
      ) : !doc ? (
        <div className="rv-viewer-empty"><p role="status">Loading the document…</p></div>
      ) : (
        <>
          <div className="rv-pdf-bar">
            <span>{doc.numPages} {doc.numPages === 1 ? 'page' : 'pages'}</span>
            <span className="rv-pdf-zoom" role="group" aria-label="Zoom">
              <button type="button" onClick={() => setZoom((z) => Math.max(0, z - 1))} disabled={zoom === 0} aria-label="Zoom out">−</button>
              <b>{Math.round(ZOOMS[zoom] * 100)}%</b>
              <button type="button" onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))} disabled={zoom === ZOOMS.length - 1} aria-label="Zoom in">+</button>
            </span>
          </div>
          <div className="rv-pdf-pages" aria-label={title}>
            {width > 0 && Array.from({ length: doc.numPages }, (_, i) => (
              <PdfPage key={i} doc={doc} n={i + 1} width={Math.round((width - 16) * ZOOMS[zoom])} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** One page: a placeholder of the right shape until it scrolls near the screen, then drawn once per width. */
function PdfPage({ doc, n, width }: { doc: PDFDocumentProxy; n: number; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState(1.414);
  const [near, setNear] = useState(n === 1);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setNear(true); }, { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  useEffect(() => {
    if (!near) return;
    let live = true;
    let cancel = () => {};
    void doc.getPage(n).then((page) => {
      if (!live || !ref.current) return;
      const base = page.getViewport({ scale: 1 });
      setRatio(base.height / base.width);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = page.getViewport({ scale: (width / base.width) * dpr });
      const canvas = ref.current;
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      const task = page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp });
      cancel = () => task.cancel();
      task.promise.catch(() => {});
    });
    return () => { live = false; cancel(); };
  }, [doc, n, width, near]);
  return <canvas ref={ref} className="rv-pdf-page" style={{ width, height: Math.round(width * ratio) }} aria-label={`Page ${n}`} />;
}
