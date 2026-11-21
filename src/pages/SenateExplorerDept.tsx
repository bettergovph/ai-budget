/**
 * `/senate/2027/explorer/:deptId`: one department in the Senate committee report.
 *
 *   1. What the report changes: its Annex A rows for the department, as the report prints them (the House
 *      bill amount, the change and the committee report amount), each with its House bill page and its page
 *      in the report.
 *   2. Every line: the House bill explorer's tree for the department with a Senate column; "Change" and
 *      "only lines that differ" compare the committee report with the House bill.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { SectionHead } from '../components/shared';
import { KpiStrip } from '../components/Nep2027Bits';
import { ExTree } from '../components/HgabExplorerBits';
import {
  SenateError, SenateHeader, SenateHero, SenateLoading, SenateNotice, SenateReviewBanner, SignedChange,
} from '../components/SenateBits';
import * as fmt from '../lib/format';
import { pdfUrl } from '../lib/hgab';
import { explorerPath, loadExplorerDept, titleCase, type ExAgency, type ExDept } from '../lib/hgab-explorer';
import {
  SENATE_EXPLORER_ROOT, changeKpi, loadSenateExplorer, loadSenateLines, senateLookup, senatePdfUrl,
  type SenateExplorerDept as SenateEx, type SenateLineRow, type SenateLines,
} from '../lib/senate';
import '../nep2027.css';
import '../hgab-explorer.css';

const ROW_NOTE: Record<string, string> = {
  new: 'Inserted by the Senate',
  new_class: 'New expense class on this line',
  unmatched: 'House line not found',
  ref_only: 'House amount differs from the bill',
  no_hb_table: '',
};

export default function SenateExplorerDept() {
  const { deptId = '' } = useParams();
  const [state, setState] = useState<{ id: string; lines: SenateLines | null; ex: SenateEx | null; dept: ExDept | null; err: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all([
      loadSenateLines(deptId),
      loadSenateExplorer(deptId).catch(() => null),
      loadExplorerDept(deptId).catch(() => null),
    ])
      .then(([lines, ex, dept]) => { if (live) setState({ id: deptId, lines, ex, dept, err: null }); })
      .catch((e) => { if (live) setState({ id: deptId, lines: null, ex: null, dept: null, err: String(e?.message || e) }); });
    return () => { live = false; };
  }, [deptId]);
  const cur = state?.id === deptId ? state : null;
  const exData = cur?.ex ?? null;
  const lookup = useMemo(() => (exData ? senateLookup(exData) : undefined), [exData]);
  const [showObjects, setShowObjects] = useState(false);
  const [changedOnly, setChangedOnly] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (cur?.lines) document.title = `${titleCase(cur.lines.name)}: Senate committee report, line by line · budget.bettergov.ph`;
  }, [cur?.lines]);

  if (cur?.err) return <SenateError message={cur.err} />;
  if (!cur?.lines) return <SenateLoading what="this department in the Senate committee report" />;
  const { lines, ex, dept } = cur;
  const name = titleCase(lines.name);
  const crumb = (
    <>
      <Link to={SENATE_EXPLORER_ROOT}>Line by line</Link>
      <span className="hgab-crumb-sep" aria-hidden="true">·</span>
      <span className="hgab-crumb-here">{name}</span>
    </>
  );
  const house = ex?.house ?? dept?.house ?? 0;
  const senate = ex?.senate ?? null;
  // Expense-class rows (TOTAL repeats them); the object-of-expenditure view of the same money on request.
  const shownRows = lines.rows.filter((r) => (r.kind === 'class' && r.label.toUpperCase() !== 'TOTAL') || (showObjects && r.kind === 'object'));
  const byAgency = groupBy(shownRows, (r) => r.agency ?? name);

  return (
    <>
      <SenateHeader crumb={crumb} />
      <SenateHero
        compact
        crumb={crumb}
        title={name}
        dek={senate != null
          ? <>{dept?.nep ? <>NEP {fmt.shortPhp(dept.nep)} → </> : null}House bill {fmt.shortPhp(house)} → Senate committee report {fmt.shortPhp(senate)} (<SignedChange v={senate - house} base={house} /> vs the House bill{dept?.nep ? <>, <SignedChange v={senate - dept.nep} base={dept.nep} /> vs the NEP</> : null}).</>
          : undefined}
      />
      <main className="nep-main hgab-ex-main">
        <SenateReviewBanner />
        <div className="senate-kpi5"><KpiStrip
          items={[
            { label: 'NEP', value: dept?.nep ? fmt.shortPhp(dept.nep) : '—', sub: dept?.nep ? `₱${dept.nep.toLocaleString()}` : undefined },
            { label: 'House bill', value: fmt.shortPhp(house), sub: `₱${house.toLocaleString()}` },
            { label: 'Senate', value: senate != null ? fmt.shortPhp(senate) : '—', sub: senate != null ? `₱${senate.toLocaleString()}` : undefined },
            changeKpi('vs House bill', senate, house, 'the House bill'),
            changeKpi('vs NEP', senate, dept?.nep || null, 'the NEP'),
          ]}
        /></div>

        <section className="nep-section">
          <SectionHead
            eyebrow="What the report changes"
            headline={lines.rows.length ? 'The Senate committee report’s amendments, line by line' : 'No amendments to this department'}
            dek="As Annex A prints them: the House bill amount, the change and the committee report amount, with the House bill page and line it cites. The NEP amount is the same line's in the NEP."
            right={
              <label className="nep-toggle">
                <input type="checkbox" checked={showObjects} onChange={(e) => setShowObjects(e.target.checked)} /> Also by object of expenditure
              </label>
            }
          />
          {[...byAgency.entries()].map(([agency, rows]) => (
            <div key={agency} className="hgab-ex-agency is-open">
              <header className="hgab-ex-agency-head"><span className="hgab-ex-agency-name">{titleCase(agency)}</span></header>
              <div className="nep-table-wrap">
                <table className="nep-table hgab-ex-tree">
                  <thead>
                    <tr>
                      <th className="nep-th-name">Line</th>
                      <th className="num">NEP</th>
                      <th className="num">House bill</th>
                      <th className="num senate-col-senate">Senate</th>
                      <th className="num" title="Senate committee report minus the House bill">vs House bill</th>
                      <th className="num" title="Senate committee report minus the NEP">vs NEP</th>
                      <th>Pages</th>
                    </tr>
                  </thead>
                  <tbody>{rows.map((r, i) => <AmendmentRow key={i} r={r} />)}</tbody>
                </table>
              </div>
            </div>
          ))}
        </section>

        {dept && lookup && (
          <section className="nep-section">
            <SectionHead
              eyebrow="Every line"
              headline="The House bill’s lines with their Senate amounts"
              dek="The House bill's own tables, by agency, program, region and office, with the committee report's amount for each. A line the report does not change keeps its House bill amount."
            />
            <div className="hgab-ex-controls">
              <input className="text-input nep-filter" type="search" placeholder="Find a program, activity, region or office…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search this department" />
              <label className="nep-toggle">
                <input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} /> Only lines the Senate changes
              </label>
            </div>
            {dept.agencies.map((a) => (
              <AgencyTree key={a.id} a={a} ex={ex} lookup={lookup} changedOnly={changedOnly} query={q} single={dept.agencies.length === 1} />
            ))}
            <p className="nep-provenance">
              <Link to={explorerPath(deptId)}>This department in the House bill, against the NEP</Link>
            </p>
          </section>
        )}
        <SenateNotice />
      </main>
      <SiteFooter />
    </>
  );
}

function AmendmentRow({ r }: { r: SenateLineRow }) {
  const [doc, pdf, printed, line] = r.hb;
  const note = ROW_NOTE[r.status];
  // The House bill's own path for a matched line (clean names); else the report's text above the row, whose
  // lines wrap mid-name.
  const where = (r.hb_path ? r.hb_path.split(' > ').slice(-3) : r.context ? [r.context.split(' > ').join(' ')] : [])
    .filter((x) => x.toLowerCase() !== r.label.toLowerCase());
  return (
    <tr className="hgab-ex-line">
      <td className="hgab-ex-name">
        <span className={r.deleted ? 'senate-deleted' : undefined}>
          {where.length ? <span className="hgab-ex-sub">{where.join(' · ')}</span> : null}
          <strong> {r.kind === 'object' ? r.label : expense(r.label)}</strong>
        </span>
        {note && <span className="hgab-ex-moved"> {note}</span>}
        {r.instruction && <span className="senate-instr">{r.instruction}</span>}
      </td>
      <td className="num nep-td-base">
        {r.nep != null ? fmt.shortPhp(r.nep)
          : <span className="hgab-ds-null" title={r.house ? 'The NEP has no figure for this line at this level' : 'Not in the NEP'}>—</span>}
      </td>
      <td className="num">{r.house != null ? fmt.shortPhp(r.house) : <span className="hgab-ds-null">—</span>}</td>
      <td className="num senate-col-senate"><strong>{r.senate != null ? fmt.shortPhp(r.senate) : '—'}</strong></td>
      <td className="num"><SignedChange v={r.net} base={r.house} /></td>
      <td className="num"><SignedChange v={r.nep != null && r.senate != null ? r.senate - r.nep : null} base={r.nep} /></td>
      <td className="hgab-ex-page">
        <span className="hgab-ex-refs">
          {doc && pdf ? (
            <a className="hgab-ex-ref" href={pdfUrl(doc, pdf)} target="_blank" rel="noreferrer" title={`House bill page ${printed ?? ''}${line ? `, line ${line}` : ''}`}>
              <span className="hgab-ex-ref-doc">HB</span> p.{printed ?? pdf}{line ? ` l.${line}` : ''}
            </a>
          ) : printed ? (
            <span className="hgab-ex-ref is-none" title="The House bill page the report cites"><span className="hgab-ex-ref-doc">HB</span> p.{printed}{line ? ` l.${line}` : ''}</span>
          ) : null}
          <a className="hgab-ex-ref" href={senatePdfUrl('senate-cr-annex-a', r.senate_page)} target="_blank" rel="noreferrer" title="The page of the Senate committee report (Annex A) that prints this amendment">
            <span className="hgab-ex-ref-doc">Senate</span> p.{r.senate_page}
          </a>
        </span>
      </td>
    </tr>
  );
}

function AgencyTree({ a, ex, lookup, changedOnly, query, single }: {
  a: ExAgency; ex: SenateEx | null; lookup: ReturnType<typeof senateLookup>; changedOnly: boolean; query: string; single: boolean;
}) {
  const s = ex?.agencies[a.id];
  const [open, setOpen] = useState<boolean | null>(null);
  const isOpen = open ?? (single || query.trim().length > 0 || !!s?.lines_delta);
  if (changedOnly && s && !s.lines_delta && !s.above && !s.new_lines && !query) return null;
  return (
    <section className={`hgab-ex-agency ${isOpen ? 'is-open' : ''}`.trim()}>
      <header className="hgab-ex-agency-head">
        <button type="button" className="hgab-ex-agency-toggle" aria-expanded={isOpen} onClick={() => setOpen(!isOpen)}>
          <span className="hgab-ex-caret" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
          <span className="hgab-ex-agency-name">{titleCase(a.name)}</span>
        </button>
        <span className="hgab-ex-agency-figs">
          <span><span className="hgab-ex-fig-label">NEP</span> {a.nep ? fmt.shortPhp(a.nep) : '—'}</span>
          <span><span className="hgab-ex-fig-label">House bill</span> {fmt.shortPhp(a.house)}</span>
          <span><span className="hgab-ex-fig-label">Senate</span> <strong>{s?.senate != null ? fmt.shortPhp(s.senate) : '—'}</strong></span>
          {s?.senate != null && <span title="vs the House bill"><SignedChange v={s.senate - a.house} base={a.house} /></span>}
          {s?.senate != null && a.nep > 0 && <span title="vs the NEP"><span className="hgab-ex-fig-label">vs NEP</span> <SignedChange v={s.senate - a.nep} base={a.nep} /></span>}
        </span>
      </header>
      {!!s?.new_lines && (
        <p className="hgab-ex-nepname">
          {s.new_lines > 0 ? '+' : '−'}{fmt.shortPhp(Math.abs(s.new_lines))} of the Senate total is in lines the House bill does not have
          (see the amendments above).
        </p>
      )}
      {isOpen && <ExTree nodes={a.tree} changedOnly={changedOnly} query={query} openDepth={single ? 2 : 1} senate={lookup} compare="house" />}
    </section>
  );
}

function expense(label: string): string {
  const u = label.toUpperCase();
  return u === 'PS' ? 'Personnel services' : u === 'MOOE' ? 'Maintenance and other operating expenses'
    : u === 'CO' ? 'Capital outlays' : u === 'FINEX' ? 'Financial expenses' : label;
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(x);
  }
  return m;
}
