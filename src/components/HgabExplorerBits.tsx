/**
 * Pieces of the House bill explorer: the status chip, the change cell, and the line-by-line
 * tree (agency > program > activity > region > office > school > fund > expense class).
 *
 * The tree renders only what is open, so DepEd's 47,000 school lines cost nothing until a
 * reader drills into a division. "Only changes" hides every branch whose lines all carry the
 * same amount in both documents.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import * as fmt from '../lib/format';
import { HGAB_ROOT } from '../lib/hgab';
import {
  EXPENSE_LABEL, KIND_LABEL, LINES_UNDER_REVIEW, NEP_HOW_NOTE, SCOPE_NOTE, STATUS_LABEL, explorerPath, fullPhp, linePdf, reportLineUrl,
  shortMoney, titleCase, volumeName,
  type ExLine, type ExNode, type LineStatus, type NepBrowserGap,
} from '../lib/hgab-explorer';
import type { SenateLookup } from '../lib/senate';
import '../hgab-links.css';
import '../senate.css';

const joinAnd = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * Why the NEP browser's total for a department differs from the line-by-line NEP figure: it counts
 * automatic appropriations, which no bill votes on, and agencies the bill files under another
 * department. `on` is the page it sits on; `billNep` is the line-by-line NEP total for the bill's
 * department, which may also hold agencies DBM files elsewhere.
 */
export function NepBrowserGapNote({ gap, code, billNep, on }: { gap: NepBrowserGap; code: string; billNep: number; on: 'explorer' | 'nep' }) {
  const auto = gap.automatic.slice(0, 3).map((a) => `${a.label} ${shortMoney(a.php)}`);
  const more = gap.automatic.length - auto.length;
  const away = gap.elsewhere.filter((e) => e.bill_department);
  const awayDepts = [...new Set(away.map((e) => titleCase(e.bill_department ?? '')))];
  const imported = billNep - gap.new_here_php;  // the bill's department also holds agencies DBM files elsewhere
  return (
    <p className="hgab-ex-gap">
      {on === 'explorer'
        ? <>The <Link to={`/2027/d/${code}`}>NEP browser</Link> shows {shortMoney(gap.all_funds_php)} for this department. </>
        : <>The House bill is compared with new appropriations only. This page’s {shortMoney(gap.all_funds_php)} counts every fund. </>}
      {gap.automatic_php > 0 && (
        <>
          {on === 'explorer' ? 'That' : 'Its total'} includes {shortMoney(gap.automatic_php)} in automatic appropriations, which no bill votes on
          {' '}({joinAnd(more > 0 ? [...auto, `${more} more`] : auto)}).{' '}
        </>
      )}
      {away.length > 0 && (
        <>
          It also counts {joinAnd(away.map((e) => `${titleCase(e.agency)} (${shortMoney(e.php)})`))}, which the bill lists
          {' '}under {joinAnd(awayDepts)}.{' '}
        </>
      )}
      {imported > 0 && (
        <>
          {on === 'explorer'
            ? <>This page also counts {shortMoney(imported)} for agencies the NEP files under another department.</>
            : <>The figures above also include {shortMoney(imported)} for agencies the NEP files under another department.</>}
        </>
      )}
    </p>
  );
}

/**
 * DPWH's project pages (/hgab/2027/dpwh) compare its projects only; the explorer has all of DPWH. The
 * difference is administration and support (the bill's General Administration and Support and Support
 * to Operations). `on` is the page it sits on.
 */
export function ProjectsVsWholeNote({ projects, whole, on }: {
  projects: { nep: number; house: number };
  whole: { id?: string; nep: number; house: number };
  on: 'projects' | 'explorer';
}) {
  const restNep = whole.nep - projects.nep;
  const restHouse = whole.house - projects.house;
  return (
    <p className="hgab-ex-gap">
      {on === 'projects' ? (
        <>
          The figures above are all of DPWH: {shortMoney(whole.nep)} in the NEP and {shortMoney(whole.house)} in the House bill.
          Its projects, compared row by row on these pages, are {shortMoney(projects.nep)} and {shortMoney(projects.house)}.
          The rest is administration and support: {shortMoney(restNep)} in the NEP and {shortMoney(restHouse)} in the House
          bill. <Link to={explorerPath(whole.id)}>See every DPWH line →</Link>
        </>
      ) : (
        <>
          DPWH’s <Link to={`${HGAB_ROOT}/dpwh`}>project pages</Link> compare its projects row by row: {shortMoney(projects.nep)} in the NEP
          and {shortMoney(projects.house)} in the House bill. The rest of this page is administration and support:{' '}
          {shortMoney(restNep)} in the NEP and {shortMoney(restHouse)} in the House bill.
        </>
      )}
    </p>
  );
}

/**
 * "Under citizen review": the whole-bill lines went live before a full review. Full at the top of
 * each line-by-line page and whole-bill board; compact where a link lands mid-page (#downloads).
 * Renders nothing once LINES_UNDER_REVIEW is false.
 */
export function UnderReviewBanner({ compact = false, subject = 'lines' }: {
  compact?: boolean;
  /** What the reader is looking at: the lines themselves, one whole-bill board, or a group of them. */
  subject?: 'lines' | 'board' | 'boards';
}) {
  const { pathname, search } = useLocation();
  if (!LINES_UNDER_REVIEW) return null;
  const report = (
    <a className="hgab-review-report" href={reportLineUrl(`${window.location.origin}${pathname}${search}`)} target="_blank" rel="noopener noreferrer">
      Report a wrong line ↗
    </a>
  );
  const board = subject !== 'lines';
  const head = {
    lines: 'We have not finished checking these lines.',
    board: 'We have not finished checking the lines behind this board.',
    boards: 'We have not finished checking the lines behind these boards.',
  }[subject];
  if (compact) {
    return (
      <aside className="hgab-review is-compact" aria-label="Under citizen review">
        <p>
          <strong className="hgab-review-tag">Under citizen review</strong> {head} Confirm a figure on its House bill
          page before you cite it. {report}
        </p>
      </aside>
    );
  }
  return (
    <aside className="hgab-review" aria-label="Under citizen review">
      <p className="hgab-review-tag">Under citizen review</p>
      <p className="hgab-review-head">{head}</p>
      <p>
        Every line was read from the House bill by computer and matched to the NEP by name. A line may be
        misread, or paired with the wrong NEP line. {board
          ? <>Before you share a figure, find it in the <Link to={explorerPath()}>line-by-line pages</Link> and open its House bill page.</>
          : <>Before you cite a figure, open its House bill page and confirm it.</>}
      </p>
      <p className="hgab-review-actions">
        {report}
        <span>Tell us the page and the line. Fixes go into the next build.</span>
      </p>
    </aside>
  );
}

const STATUS_TONE: Record<LineStatus, string> = {
  same: 'var(--ink-mute)',
  higher: 'var(--positive)',
  lower: 'var(--negative)',
  house_only: '#7a4fb3',
  nep_only: '#b06a12',
  unprogrammed: 'var(--ink-3)',
};

export function ExStatusChip({ status, children }: { status: LineStatus; children?: ReactNode }) {
  return (
    <span
      className={`hgab-chip hgab-ex-chip is-${status}`}
      style={{ ['--hgab-group' as string]: STATUS_TONE[status] }}
      title={STATUS_LABEL[status].help}
    >
      {children ?? STATUS_LABEL[status].label}
    </span>
  );
}

/** House bill minus NEP, signed, with the percent when both sides have money. */
export function ExChange({ nep, house }: { nep: number; house: number }) {
  const d = house - nep;
  if (d === 0) return <span className="hgab-ex-zero">0</span>;
  const color = d > 0 ? 'var(--positive)' : 'var(--negative)';
  const pct = nep > 0 ? d / nep : null;
  return (
    <span className="nep-delta" style={{ color }} title={`${d > 0 ? '+' : ''}${fullPhp(d)}`}>
      <span className="nep-delta-abs">{d > 0 ? '+' : '−'}{fmt.shortPhp(Math.abs(d))}</span>
      {pct != null && <span className="nep-delta-pct">{d > 0 ? '+' : '−'}{fmt.pct(Math.abs(pct), 1)}</span>}
    </span>
  );
}

function Amount({ v, strong = false }: { v: number; strong?: boolean }) {
  return <span className={strong ? 'hgab-ex-amt is-strong' : 'hgab-ex-amt'} title={fullPhp(v)}>{v ? fmt.shortPhp(v) : '—'}</span>;
}

/** A Senate amount; "split not given" when the report changes a heading above the line but not the line. */
function SenateAmount({ v, strong = false }: { v: number | null; strong?: boolean }) {
  if (v == null) {
    return <span className="hgab-ds-null" title="The Senate committee report changes a heading above this line, without the split below it.">n/a</span>;
  }
  return <Amount v={v} strong={strong} />;
}

/** Senate committee report minus a base (the House bill, or the NEP), with its percent. */
function SenateChange({ house, senate }: { house: number; senate: number | null }) {
  if (senate == null) return <span className="hgab-ds-null">—</span>;
  return <ExChange nep={house} house={senate} />;
}

function SenateLineLabel({ house, senate }: { house: number; senate: number | null }) {
  if (senate == null) return <span className="hgab-ex-moved" title="The report changes a heading above this line, without the split below it.">Split not given</span>;
  if (senate === house) return <span className="hgab-ex-none">Same</span>;
  const tone = senate === 0 ? 'var(--negative)' : senate < house ? '#b06a12' : 'var(--positive)';
  const label = senate === 0 ? 'Cut to zero' : senate < house ? 'Lower' : 'Higher';
  return <span className="hgab-chip hgab-ex-chip" style={{ ['--hgab-group' as string]: tone }}>{label}</span>;
}

// ---------------------------------------------------------------------------

interface TreeProps {
  nodes: ExNode[];
  changedOnly: boolean;
  query: string;
  /** Open every branch to this depth when nothing is searched. */
  openDepth?: number;
  /** The Senate committee report's amounts: adds a Senate column. */
  senate?: SenateLookup;
  /**
   * What "Change" and "only lines that differ" compare: the House bill with the NEP (the House section), or
   * the Senate committee report with the House bill (the Senate section). Needs `senate` for 'house'.
   */
  compare?: 'nep' | 'house';
}

/** A node's Senate total from its lines; null when a line under it has no Senate amount of its own. */
function senateTotal(n: ExNode, s: SenateLookup, memo: WeakMap<ExNode, number | null>): number | null {
  if (memo.has(n)) return memo.get(n)!;
  let t: number | null = 0;
  for (const x of n.x ?? []) {
    const v = s.value(x.p, x.e, x.h);
    t = v == null || t == null ? null : t + v;
  }
  for (const c of n.c ?? []) {
    const v = senateTotal(c, s, memo);
    t = v == null || t == null ? null : t + v;
  }
  memo.set(n, t);
  return t;
}

/**
 * Memoised per tree: whether a node has any line that differs, and whether its label (or any
 * label under it) matches the search.
 */
function useMarks(nodes: ExNode[], query: string, lineChanged: (x: ExLine) => boolean) {
  return useMemo(() => {
    const changed = new WeakMap<ExNode, boolean>();
    const hit = new WeakMap<ExNode, boolean>();
    const q = query.trim().toLowerCase();
    const walk = (n: ExNode): [boolean, boolean] => {
      let ch = n.x?.some(lineChanged) ?? false;
      let h = q ? n.l.toLowerCase().includes(q) : true;
      for (const c of n.c ?? []) {
        const [cc, hh] = walk(c);
        ch ||= cc;
        h ||= hh;
      }
      changed.set(n, ch);
      hit.set(n, h);
      return [ch, h];
    };
    nodes.forEach(walk);
    return { changed, hit, q };
  }, [nodes, query, lineChanged]);
}

export function ExTree({ nodes, changedOnly, query, openDepth = 1, senate, compare = 'nep' }: TreeProps) {
  const vsHouse = compare === 'house' && !!senate;
  const lineChanged = useMemo(
    () => (vsHouse ? (x: ExLine) => senate!.value(x.p, x.e, x.h) !== x.h : (x: ExLine) => x.s !== 'same'),
    [vsHouse, senate],
  );
  const marks = useMarks(nodes, query, lineChanged);
  const [senateMemo] = useState(() => new WeakMap<ExNode, number | null>());
  const [firsts] = useState(() => new WeakMap<ExNode, Refs>());  // keyed by node, so new data just misses
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [closed, setClosed] = useState<Set<string>>(() => new Set());

  const isOpen = (key: string, depth: number, n: ExNode) => {
    if (closed.has(key)) return false;
    if (open.has(key)) return true;
    if (marks.q) return marks.hit.get(n) === true && !n.l.toLowerCase().includes(marks.q);
    return depth < openDepth;
  };
  const toggle = (key: string, now: boolean) => {
    const o = new Set(open);
    const c = new Set(closed);
    if (now) { o.delete(key); c.add(key); } else { c.delete(key); o.add(key); }
    setOpen(o);
    setClosed(c);
  };

  const rows: ReactNode[] = [];
  const visible = (n: ExNode) =>
    (!changedOnly || marks.changed.get(n)) && (!marks.q || marks.hit.get(n));

  const walk = (list: ExNode[], depth: number, parentKey: string, parentMatched: boolean) => {
    list.forEach((n, i) => {
      const selfMatch = marks.q ? n.l.toLowerCase().includes(marks.q) : false;
      if (!parentMatched && !visible(n)) return;
      if (parentMatched && changedOnly && !marks.changed.get(n)) return;
      const key = `${parentKey}/${i}`;
      const lines = (n.x ?? []).filter((x) => !changedOnly || lineChanged(x));
      const expandable = (n.c?.length ?? 0) > 0 || lines.length > 0;
      const on = expandable && isOpen(key, depth, n);
      const moved = n.n === n.h && n.n > 0 && marks.changed.get(n);
      rows.push(
        <tr key={key} className={`hgab-ex-row is-${n.k} ${on ? 'is-open' : ''}`.trim()}>
          <td className="hgab-ex-name" style={{ paddingLeft: 12 + depth * 18 }}>
            {expandable ? (
              <button type="button" className="hgab-ex-toggle" aria-expanded={on} onClick={() => toggle(key, on)}>
                <span className="hgab-ex-caret" aria-hidden="true">{on ? '▾' : '▸'}</span>
                <span className="hgab-ex-label">{n.l}</span>
              </button>
            ) : (
              <span className="hgab-ex-label">{n.l}</span>
            )}
            {KIND_LABEL[n.k] && <span className="hgab-ex-kind">{KIND_LABEL[n.k]}</span>}
          </td>
          <td className="num"><Amount v={n.n} /></td>
          <td className="num"><Amount v={n.h} strong={!senate} /></td>
          {senate && <td className="num senate-col-senate"><SenateAmount v={senateTotal(n, senate, senateMemo)} strong /></td>}
          <td className="num">{vsHouse ? <SenateChange house={n.h} senate={senateTotal(n, senate!, senateMemo)} /> : <ExChange nep={n.n} house={n.h} />}</td>
          {vsHouse && <td className="num"><SenateChange house={n.n} senate={senateTotal(n, senate!, senateMemo)} /></td>}
          <td className="hgab-ex-status">
            {vsHouse
              ? (marks.changed.get(n) ? null : <span className="hgab-ex-none">All same</span>)
              : moved ? <span className="hgab-ex-moved" title="The total is the same in both, but some lines under it moved between places or names.">Same total, moved within</span>
              : marks.changed.get(n) ? null : <span className="hgab-ex-none">All same</span>}
          </td>
          <td className="hgab-ex-page"><PageRefs {...firstRefs(n, firsts)} group={KIND_LABEL[n.k]?.toLowerCase() || 'group'} /></td>
        </tr>,
      );
      if (!on) return;
      lines.forEach((x, j) => rows.push(<LineRow key={`${key}#${j}`} x={x} depth={depth + 1} senate={senate} vsHouse={vsHouse} />));
      if (n.c) walk(n.c, depth + 1, key, parentMatched || selfMatch);
    });
  };
  walk(nodes, 0, '', false);

  return (
    <div className="nep-table-wrap hgab-ex-tree-wrap">
      <table className="nep-table hgab-ex-tree">
        <thead>
          <tr>
            <th className="nep-th-name">Line</th>
            <th className="num">NEP</th>
            <th className="num">House bill</th>
            {senate && <th className="num senate-col-senate" title="The Senate committee report on the House bill">Senate</th>}
            <th className="num" title={vsHouse ? 'Senate committee report minus the House bill' : 'House bill minus the NEP'}>{vsHouse ? 'vs House bill' : 'Change'}</th>
            {vsHouse && <th className="num" title="Senate committee report minus the NEP">vs NEP</th>}
            <th>Label</th>
            <th title="The page that prints each line in the NEP and in the House bill. A group links to the first page where it appears.">Pages</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows : (
            <tr><td colSpan={vsHouse ? 8 : senate ? 7 : 6} className="nep-empty">
              {changedOnly
                ? (vsHouse ? 'No line here differs between the House bill and the Senate committee report.' : 'No line here differs between the NEP and the House bill.')
                : 'Nothing matches that search.'}
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

type Refs = { p?: ExLine['p']; q?: ExLine['q'] };

/** The earlier of two page references, in document order (volume, then PDF page). */
function earlier<T extends [string, number, ...unknown[]]>(a: T | undefined, b: T | undefined): T | undefined {
  if (!a) return b;
  if (!b) return a;
  return b[0] < a[0] || (b[0] === a[0] && b[1] < a[1]) ? b : a;
}

/** A group's first page in each document, from the lines under it (memoised per tree). */
function firstRefs(n: ExNode, memo: WeakMap<ExNode, Refs>): Refs {
  const hit = memo.get(n);
  if (hit) return hit;
  let p: Refs['p'];
  let q: Refs['q'];
  let absent: Refs['q'];  // NEP tables that lack a House-bill-only line: only if nothing better
  for (const x of n.x ?? []) {
    p = earlier(p, x.p);
    if (x.q?.[3] === 'x') absent = earlier(absent, x.q);
    else q = earlier(q, x.q);
  }
  for (const c of n.c ?? []) {
    const r = firstRefs(c, memo);
    p = earlier(p, r.p);
    q = earlier(q, r.q);
  }
  const out = { p, q: q ?? absent };
  memo.set(n, out);
  return out;
}

const pageText = (r: [string, number, number, ...unknown[]]) =>
  `${volumeName(r[0]).replace('Vol. ', '')} p.${r[2] || `${r[1]} (PDF)`}`;

/**
 * Proof of reference: the NEP page and the House bill page that print a line (or, for a group, the
 * first page where it appears). Each opens the published PDF at that page.
 */
function PageRefs({ p, q, a, status, group }: Refs & { a?: 1; status?: ExLine['s']; group?: string }) {
  const where = group ? `Where this ${group} begins in` : 'The page that prints this line in';
  return (
    <span className="hgab-ex-refs">
      {q ? (
        <a
          className="hgab-ex-ref"
          href={linePdf(q)}
          target="_blank"
          rel="noreferrer"
          title={`NEP ${volumeName(q[0])}, page ${q[2] || '(none printed)'}, PDF page ${q[1]}. ${!group && q[3] ? NEP_HOW_NOTE[q[3]].help : `${where} the NEP.`}`}
        >
          <span className="hgab-ex-ref-doc">NEP</span> {pageText(q)}
          {!group && q[3] && <span className="hgab-ex-ref-how"> · {NEP_HOW_NOTE[q[3]].short}</span>}
        </a>
      ) : (
        <span className="hgab-ex-ref is-none" title={status === 'house_only' ? 'Not in the NEP, and no NEP table for its activity was found.' : 'No NEP page found for this line yet.'}>
          <span className="hgab-ex-ref-doc">NEP</span> —
        </span>
      )}
      {p ? (
        <a
          className="hgab-ex-ref"
          href={linePdf(p)}
          target="_blank"
          rel="noreferrer"
          title={`House bill ${volumeName(p[0])}, page ${p[2]}${!group && p[3] ? `, line ${p[3]}` : ''}${a ? ' (list of non-implementing schools)' : ''}, PDF page ${p[1]}. ${where} the House bill.`}
        >
          <span className="hgab-ex-ref-doc">HB</span> {pageText(p)}{a && <span className="hgab-ex-ref-how"> · list</span>}
        </a>
      ) : (
        <span className="hgab-ex-ref is-none" title={status === 'nep_only' ? 'Not in the House bill.' : 'No House bill page for this line.'}>
          <span className="hgab-ex-ref-doc">HB</span> —
        </span>
      )}
    </span>
  );
}

function LineRow({ x, depth, senate, vsHouse }: { x: ExLine; depth: number; senate?: SenateLookup; vsHouse?: boolean }) {
  const sv = senate ? senate.value(x.p, x.e, x.h) : undefined;
  return (
    <tr className={`hgab-ex-line is-${x.s}`}>
      <td className="hgab-ex-name" style={{ paddingLeft: 12 + depth * 18 + 14 }}>
        <span className="hgab-ex-exp">{EXPENSE_LABEL[x.e]}</span>
        {x.z && (
          <Link className="hgab-ex-scope" to={SCOPE_NOTE[x.z].to} title="Covered project by project on its own pages">
            {SCOPE_NOTE[x.z].label}
          </Link>
        )}
        {x.m && <span className="hgab-ex-fuzzy" title={`Matched on a similar name: ${x.m}`}>≈ similar name</span>}
      </td>
      <td className="num"><Amount v={x.n} /></td>
      <td className="num"><Amount v={x.h} strong={!senate} /></td>
      {senate && <td className="num senate-col-senate"><SenateAmount v={sv ?? null} strong /></td>}
      <td className="num">{vsHouse ? <SenateChange house={x.h} senate={sv ?? null} /> : <ExChange nep={x.n} house={x.h} />}</td>
      {vsHouse && <td className="num"><SenateChange house={x.n} senate={sv ?? null} /></td>}
      <td className="hgab-ex-status">
        {vsHouse ? <SenateLineLabel house={x.h} senate={sv ?? null} /> : <ExStatusChip status={x.s} />}
      </td>
      <td className="hgab-ex-page"><PageRefs p={x.p} q={x.q} a={x.a} status={x.s} /></td>
    </tr>
  );
}
