/**
 * `/senate/2027/explorer/:deptId`: one department in the Senate committee report.
 *
 *   1. What the report changes: its Annex A rows for the department, by agency and activity (Jason,
 *      2026-11-21: "the text is overwhelming especially the Annex A"): what changes and where on one line, the
 *      expense class as a tag, rows that share an activity under its name, long agencies folded after 12 rows.
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
  new: 'Inserted',
  new_class: 'New expense class',
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
  const classRows = lines.rows.filter((r) => r.kind === 'class' && r.label.toUpperCase() !== 'TOTAL');
  const shownRows = lines.rows.filter((r) => (r.kind === 'class' && r.label.toUpperCase() !== 'TOTAL') || (showObjects && r.kind === 'object'));
  const byAgency = groupBy(shownRows, (r) => r.agency ?? name);

  return (
    <>
      <SenateHeader crumb={crumb} />
      <SenateHero
        compact
        crumb={crumb}
        title={name}
        dek="What the Senate committee report changes in this department, then every House bill line with its Senate amount."
      />
      <main className="nep-main hgab-ex-main">
        <SenateReviewBanner compact />
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
            headline={classRows.length ? `${classRows.length.toLocaleString()} ${classRows.length === 1 ? 'amendment' : 'amendments'} in Annex A` : 'No amendments to this department'}
            dek="Each line the report changes, by agency and activity, beside the NEP. Tags: PS personnel, MOOE operating expenses, CO capital outlays. Page links open the House bill and the report."
            right={
              <label className="nep-toggle">
                <input type="checkbox" checked={showObjects} onChange={(e) => setShowObjects(e.target.checked)} /> Also by object of expenditure
              </label>
            }
          />
          {[...byAgency.entries()].map(([agency, rows]) => (
            <AmendmentAgency key={agency} agency={titleCase(agency)} rows={rows} single={byAgency.size === 1} />
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

/** A region heading in a House bill path ("Region IX - Zamboanga Peninsula", "National Capital Region (NCR)"). */
const REGION_PART = /^(Region\b|National Capital Region|Cordillera|Negros Island|Bangsamoro|BARMM\b|Nationwide)/i;

/** What a row changes and where: the activity or project, and the region and office below it. */
function whatWhere(r: SenateLineRow): { what: string; where: string | null } {
  // The House bill's own path when matched (clean names); else the report's text above the row, whose lines wrap
  // mid-name, so its pieces are words of one name unless one is a region.
  const parts = r.hb_path ? r.hb_path.split(' > ') : (r.context ?? '').replace(/^\[|\]$/g, '').split(' > ');
  const at = parts.findIndex((x) => REGION_PART.test(x.trim()));
  const head = at > 0 ? parts.slice(0, at) : parts;
  const what = (r.hb_path ? head[head.length - 1] : head.join(' ')).replace(/^(Project\(s\)\s*)?(Locally-Funded Project\(s\)\s*)/i, '');
  const where = at > 0 ? parts.slice(at).filter((x, i, xs) => i === 0 || x !== xs[i - 1]).join(' · ') : null;
  return { what: nameCase((what || r.hb_label || r.label).trim()), where: where ? nameCase(where) : null };
}

/** Acronyms the report prints in its all-caps names, kept when the name is set in title case. */
const ACRONYMS = new Set(['UP', 'PGH', 'NCPAG', 'GRIT', 'DRRM', 'TVUP', 'XDP', 'PH', 'ICT', 'DOH', 'DEPED', 'CHED', 'TESDA', 'AFP', 'PNP',
  'BFP', 'DILG', 'LGU', 'LGUS', 'SUC', 'SUCS', 'NCR', 'CAR', 'BARMM', 'MIMAROPA', 'CALABARZON', 'SOCCSKSARGEN', 'PCC', 'PCIC', 'NIA', 'DPWH', 'ADB', 'JICA']);
/** The report's all-caps names in title case, keeping acronyms and short words in parentheses ("(CAL)"). */
function nameCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  const src = s.split(/(\s+)/), out = titleCase(s).split(/(\s+)/);
  if (src.length !== out.length) return out.join('');
  return out.map((w, i) => {
    const pieces = src[i].split('-').map((x) => x.replace(/[^\p{L}]/gu, '')).filter(Boolean);
    return (pieces.length && pieces.every((x) => ACRONYMS.has(x))) || /^\(\p{L}{2,6}\)[,.;:]?$/u.test(src[i]) ? src[i] : w;
  }).join('');
}

const CLASS_TAG: Record<string, string> = { PS: 'PS', MOOE: 'MOOE', CO: 'CO', FINEX: 'FinEx' };

/** One agency's amendments: rows sharing an activity under its name, folded after FOLD rows. */
function AmendmentAgency({ agency, rows, single }: { agency: string; rows: SenateLineRow[]; single: boolean }) {
  const FOLD = 12;
  const [all, setAll] = useState(false);
  // The report's instruction ("Between lines 36 and 37, insert ...") once, at the first row it covers.
  const items = rows.map((r, k) => ({ r, ...whatWhere(r), instruction: r.instruction && r.instruction !== rows[k - 1]?.instruction ? r.instruction : null }));
  const groups: Array<{ what: string; items: typeof items }> = [];
  for (const it of items) {
    const g = groups[groups.length - 1];
    if (g && g.what === it.what) g.items.push(it);
    else groups.push({ what: it.what, items: [it] });
  }
  const classes = rows.filter((r) => r.kind === 'class');
  const net = classes.reduce((t, r) => t + (r.net ?? 0), 0);
  const house = classes.reduce((t, r) => t + (r.house ?? 0), 0);
  // Fold by rows shown, whole groups at a time.
  let shown = 0;
  const visible = all ? groups : groups.filter((g) => { const keep = shown < FOLD; shown += g.items.length; return keep; });
  const hidden = rows.length - visible.reduce((t, g) => t + g.items.length, 0);
  const sum = (xs: Array<number | null>) => (xs.some((x) => x != null) ? xs.reduce<number>((t, x) => t + (x ?? 0), 0) : null);
  return (
    <div className="hgab-ex-agency is-open senate-am">
      <header className="hgab-ex-agency-head">
        <span className="hgab-ex-agency-name">{single ? 'Amendments' : agency}</span>
        <span className="hgab-ex-agency-figs">
          <span>{classes.length.toLocaleString()} {classes.length === 1 ? 'line' : 'lines'}</span>
          <span title="Net change in these lines, vs the House bill"><SignedChange v={net} base={house || null} /></span>
        </span>
      </header>
      <div className="nep-table-wrap">
        <table className="nep-table hgab-ex-tree senate-am-table">
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
          <tbody>
            {visible.map((g, gi) => {
              const grouped = g.items.length > 1;
              const cls = g.items.filter((x) => x.r.kind === 'class').map((x) => x.r);
              const gNep = sum(cls.map((r) => r.nep)), gHouse = sum(cls.map((r) => r.house)), gSenate = sum(cls.map((r) => r.senate));
              return [
                grouped && (
                  <tr key={`g${gi}`} className="senate-am-group">
                    <td className="hgab-ex-name">{g.what} <span className="senate-am-count">{g.items.length} lines</span></td>
                    <td className="num nep-td-base">{gNep != null ? fmt.shortPhp(gNep) : '—'}</td>
                    <td className="num">{gHouse != null ? fmt.shortPhp(gHouse) : '—'}</td>
                    <td className="num senate-col-senate">{gSenate != null ? fmt.shortPhp(gSenate) : '—'}</td>
                    <td className="num"><SignedChange v={gSenate != null && gHouse != null ? gSenate - gHouse : null} base={gHouse} /></td>
                    <td className="num"><SignedChange v={gSenate != null && gNep != null ? gSenate - gNep : null} base={gNep} /></td>
                    <td />
                  </tr>
                ),
                ...g.items.map((it, i) => (
                  <AmendmentRow key={`${gi}-${i}`} r={it.r} what={grouped ? null : g.what} where={it.where}
                    instruction={it.instruction} indent={grouped} />
                )),
              ];
            })}
          </tbody>
        </table>
      </div>
      {hidden > 0 && (
        <button type="button" className="senate-am-more" onClick={() => setAll(true)}>Show {hidden.toLocaleString()} more {hidden === 1 ? 'line' : 'lines'}</button>
      )}
    </div>
  );
}

function AmendmentRow({ r, what, where, instruction, indent }: {
  r: SenateLineRow; what: string | null; where: string | null; instruction: string | null; indent: boolean;
}) {
  const [doc, pdf, printed, line] = r.hb;
  const note = ROW_NOTE[r.status];
  const removed = r.deleted || (r.senate === 0 && (r.house ?? 0) > 0);
  // The class as a tag, unless the row's name is the class itself (a grouped row with no place).
  const tag = r.kind === 'object' || (!what && !where) ? null : (CLASS_TAG[r.label.toUpperCase()] ?? r.label);
  return (
    <tr className={`hgab-ex-line ${indent ? 'senate-am-in' : ''}`.trim()}>
      <td className="hgab-ex-name">
        <span className={removed ? 'senate-deleted' : undefined}>
          {r.kind === 'object' ? <span className="senate-am-obj">{r.label}</span> : (what ?? where ?? expense(r.label))}
        </span>
        {tag && <span className="senate-tag" title={expense(r.label)}>{tag}</span>}
        {removed && <span className="senate-tag is-removed">Removed</span>}
        {note && <span className={`senate-tag ${r.status === 'new' ? 'is-new' : ''}`.trim()}>{note}</span>}
        {what && where && <span className="senate-am-sub">{where}</span>}
        {instruction && <span className="senate-am-instr">{instruction}</span>}
      </td>
      <td className="num nep-td-base">
        {r.nep != null ? fmt.shortPhp(r.nep)
          : <span className="hgab-ds-null" title={r.house ? 'The NEP has no figure for this line at this level' : 'Not in the NEP'}>—</span>}
      </td>
      <td className="num">{r.house != null ? fmt.shortPhp(r.house) : <span className="hgab-ds-null">—</span>}</td>
      <td className="num senate-col-senate"><strong>{r.senate != null ? fmt.shortPhp(r.senate) : '—'}</strong></td>
      <td className="num"><SignedChange v={r.net} base={r.house} /></td>
      <td className="num"><SignedChange v={r.nep != null && r.senate != null ? r.senate - r.nep : null} base={r.nep} /></td>
      <td className="senate-am-refs">
        {doc && pdf ? (
          <a href={pdfUrl(doc, pdf)} target="_blank" rel="noreferrer" title={`House bill page ${printed ?? ''}${line ? `, line ${line}` : ''}`}>HB {printed ?? pdf}</a>
        ) : printed ? (
          <span title="The House bill page the report cites">HB {printed}</span>
        ) : null}
        <a href={senatePdfUrl('senate-cr-annex-a', r.senate_page)} target="_blank" rel="noreferrer" title="The page of Annex A, the Senate committee report, that prints this amendment">Senate {r.senate_page}</a>
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
