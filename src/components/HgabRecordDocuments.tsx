/**
 * A DPWH project's documents on its record page (`/hgab/2027/dpwh/p/:id`). Jason (2026-11-15): "the individual DPWH
 * project pages should now display the documents when possible".
 *
 * The files are the ones documents/files.parquet ties to the line (one DuckDB-Wasm lookup by `project_id`): the copies
 * DPWH gave the Senate and the files on DPWH Transparency, by kind, with the program of work open in a frame. A Senate
 * copy opens only when the Worker says it is redacted and its region isn't held back (fetchSenateStatus), as in the
 * project reviewer; otherwise it is listed without a link. Never link an unredacted Senate copy.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { SectionHead } from './shared';
import { runQuery } from '../lib/duckdb';
import { dataUrl } from '../lib/data-url';
import { HGAB_BASE } from '../lib/hgab';
import { sqlStr } from '../lib/hgab-query';
import { NAMED_TYPES, REVIEW_INDEX_PATH } from '../lib/hgab-documents';
import { NAMED_MEANING, NAMED_SHORT, REVIEW_ROOT, SOURCE_LABEL } from '../lib/hgab-review';
import { documentHref, fetchSenateStatus, senatePath, type SenateCopyStatus } from '../lib/hgab-review-api';
import { heldBackRegion } from '../lib/senate-copies-held-back';

interface DocFile { hgabId: string; source: 'senate' | 'proposal'; kind: string; name: string; url: string; archived: boolean }
type Kind = (typeof NAMED_TYPES)[number] | 'Other';

const FILES_PARQUET = `${HGAB_BASE}/${REVIEW_INDEX_PATH.replace(/review\.json$/, 'files.parquet')}`;
const isPdf = (f: DocFile) => /\.pdf$/i.test(f.name) || /\.pdf(\?|$)/i.test(f.url);
const kindOf = (t: string): Kind => ((NAMED_TYPES as readonly string[]).includes(t) ? (t as Kind) : 'Other');
const rank = (k: Kind) => { const i = (NAMED_TYPES as readonly string[]).indexOf(k); return i < 0 ? 99 : i; };

function useProjectFiles(projectId: string) {
  const [state, setState] = useState<{ id: string; files: DocFile[] | null; senate: Record<string, SenateCopyStatus> | null; err: string | null }>(
    { id: projectId, files: null, senate: null, err: null });
  useEffect(() => {
    let live = true;
    const u = dataUrl(FILES_PARQUET);
    const url = u.startsWith('http') ? u : `${window.location.origin}${u}`;
    const sql = `SELECT hgab_id, source, doc_type, name, url, archived FROM read_parquet(${sqlStr(url)}) WHERE project_id = ${sqlStr(projectId)}`;
    runQuery<{ hgab_id: string; source: 'senate' | 'proposal'; doc_type: string; name: string; url: string; archived: boolean }>(sql)
      .then(async (res) => {
        const files = res.rows.map((r) => ({ hgabId: r.hgab_id, source: r.source, kind: kindOf(r.doc_type), name: r.name, url: r.url, archived: !!r.archived }))
          .sort((a, b) => rank(a.kind as Kind) - rank(b.kind as Kind) || Number(a.archived) - Number(b.archived) || a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
        if (!live) return;
        setState({ id: projectId, files, senate: null, err: null });
        const paths = [...new Set(files.map((f) => senatePath(f.url)).filter((p): p is string => p != null))];
        // If the Worker can't say, no Senate copy opens.
        const senate = paths.length ? await fetchSenateStatus(paths).then((r) => r.data).catch(() => ({})) : {};
        if (live) setState({ id: projectId, files, senate, err: null });
      })
      .catch((e: unknown) => live && setState({ id: projectId, files: [], senate: {}, err: e instanceof Error ? e.message : String(e) }));
    return () => { live = false; };
  }, [projectId]);
  return state.id === projectId ? state : { files: null, senate: null, err: null };
}

export default function HgabRecordDocuments({ projectId }: { projectId: string }) {
  const { files, senate, err } = useProjectFiles(projectId);
  const [picked, setPicked] = useState<string | null>(null);
  // A Senate copy opens only once the Worker has said it is redacted; DPWH Transparency files always do.
  const linkOf = useMemo(() => (f: DocFile): string | null => {
    const p = senatePath(f.url);
    if (p == null) return documentHref(f.url);
    if (heldBackRegion(p) || !senate || senate[p] !== 'available') return null;
    return documentHref(f.url);
  }, [senate]);
  const checking = (f: DocFile) => senatePath(f.url) != null && senate == null;
  const first = useMemo(() => {
    if (!files) return null;
    const ok = files.filter((f) => linkOf(f) && isPdf(f));
    return ok.find((f) => f.kind === 'POW' && !f.archived) ?? ok.find((f) => !f.archived) ?? ok[0] ?? null;
  }, [files, linkOf]);
  const open = files?.find((f) => f.url === picked) ?? first;
  const href = open ? linkOf(open) : null;

  if (err) return null;
  const groups = files ? ([...NAMED_TYPES, 'Other'] as Kind[]).map((k) => ({ k, fs: files.filter((f) => f.kind === k) })).filter((g) => g.fs.length) : [];
  const hgabId = files?.[0]?.hgabId ?? null;
  const held = files?.filter((f) => senatePath(f.url) != null && senate != null && !linkOf(f)).length ?? 0;
  return (
    <div className="hgab-rec-section" id="documents">
      <SectionHead
        size="sm"
        eyebrow="Documents"
        headline={files == null ? 'The project’s documents' : files.length ? `The project’s documents (${files.length})` : 'No documents found for this project'}
        dek={files == null
          ? 'Looking for this project’s documents…'
          : files.length
            ? 'What DPWH filed for this project: the copies it gave the Senate, with signatures redacted, and its files on DPWH Transparency. Pick one to read it here.'
            : 'We found no copy given to the Senate and no file on DPWH Transparency for this line.'}
      />
      {files != null && files.length > 0 && (
        <div className="hgab-rec-docs">
          <ul className="hgab-rec-docs-list" aria-label="Documents">
            {groups.map((g) => (
              <li key={g.k}>
                <p className="hgab-rec-docs-kind" title={g.k === 'Other' ? 'Other files' : NAMED_MEANING[g.k]}>{g.k === 'Other' ? 'Other files' : NAMED_SHORT[g.k]}</p>
                <ul>
                  {g.fs.map((f) => {
                    const can = !!linkOf(f);
                    return (
                      <li key={f.url}>
                        <button type="button" className={open?.url === f.url ? 'is-on' : ''} disabled={!can} onClick={() => setPicked(f.url)} title={f.name}>
                          <span className={`hgab-rec-docs-src is-${f.source}`}>{SOURCE_LABEL[f.source]}</span>
                          <span className="hgab-rec-docs-name">{f.name}</span>
                          {f.archived && <span className="hgab-rec-docs-tag">earlier copy</span>}
                          {!can && <span className="hgab-rec-docs-tag is-locked">{checking(f) ? 'checking…' : 'not yet available'}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
          <div className="hgab-rec-docs-view">
            {open && (
              <div className="hgab-rec-docs-bar">
                <span className={`hgab-rec-docs-src is-${open.source}`}>{SOURCE_LABEL[open.source]}</span>
                <span className="hgab-rec-docs-name" title={open.name}>{open.name}</span>
                {href && <a href={href} target="_blank" rel="noopener noreferrer">Open in a new tab</a>}
              </div>
            )}
            {!open
              ? <p className="hgab-rec-docs-empty">{senate == null ? 'Checking which copies can open…' : 'None of these files can be shown here yet.'}</p>
              : href && isPdf(open)
                ? <iframe key={href} src={`${href}#view=FitH`} title={open.name} />
                : href
                  ? <p className="hgab-rec-docs-empty">This file can’t be shown here. <a href={href} target="_blank" rel="noopener noreferrer">Open it</a>.</p>
                  : <p className="hgab-rec-docs-empty">This Senate copy isn’t available yet: we’re redacting its signatures first, for privacy.</p>}
          </div>
        </div>
      )}
      {files != null && files.length > 0 && (
        <p className="hgab-rec-docs-more">
          {held > 0 && `${held} Senate ${held === 1 ? 'copy isn’t' : 'copies aren’t'} available yet: we’re redacting signatures first, for privacy. `}
          {hgabId && <><Link to={`${REVIEW_ROOT}?p=${encodeURIComponent(hgabId)}`}>Open this project in the project reviewer</Link>, with its red flags beside the documents.</>}
        </p>
      )}
    </div>
  );
}
