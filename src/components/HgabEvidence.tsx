/**
 * The source page a figure was read from, embedded beside the record.
 *
 * Closed by default and mounted only on demand: the DPWH volumes are tens of
 * megabytes and a reader who only wants the numbers should not pay for them.
 * The `#page=N` fragment is honoured by every built-in browser PDF viewer, so
 * the pane opens on the cited page rather than at the cover.
 *
 * Embedding note. In development everything is same-origin behind the dev
 * server's COOP/COEP headers, so the frame loads. In production the PDFs are
 * served from the R2 asset host (`VITE_DATA_BASE_URL`); because the page is
 * cross-origin-isolated (`Cross-Origin-Embedder-Policy: require-corp`), that
 * host MUST send `Cross-Origin-Resource-Policy: cross-origin` on the PDFs or
 * the browser refuses to render the frame. The "Open page" link next to every
 * figure works regardless, which is why the pane is an optional extra and
 * never the only route to the evidence.
 */
import { pdfUrl } from '../lib/hgab';

export default function HgabEvidence({
  docKey,
  page,
  docTitle,
  onClose,
}: {
  docKey: string;
  page: number | null;
  /** Human title of the document, when the catalogue has loaded. */
  docTitle?: string | null;
  onClose: () => void;
}) {
  const src = pdfUrl(docKey, page);
  const name = docTitle ?? docKey;
  const where = page ? `${name}, page ${page}` : name;
  return (
    <div className="hgab-rec-evidence" role="region" aria-label={`Source page: ${where}`}>
      <div className="hgab-rec-evidence-bar">
        <span>
          <strong>{name}</strong>
          {page ? ` · PDF page ${page}` : ''}
        </span>
        <a href={src} target="_blank" rel="noopener">Open in new tab ↗</a>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      <iframe src={src} title={`Source document: ${where}`} loading="lazy" />
      <p className="hgab-rec-evidence-note">
        Page numbers count the pages of the PDF file, not the page number shown on the page. If the
        viewer stays blank, your browser would not show the file here; use “Open in new tab”.
      </p>
    </div>
  );
}
