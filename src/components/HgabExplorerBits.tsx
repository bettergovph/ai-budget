/**
 * Pieces of the House bill explorer: the status chip, the change cell, and the line-by-line
 * tree (agency > program > activity > region > office > school > fund > expense class).
 *
 * The tree renders only what is open, so DepEd's 47,000 school lines cost nothing until a
 * reader drills into a division. "Only changes" hides every branch whose lines all carry the
 * same amount in both documents.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import * as fmt from '../lib/format';
import {
  EXPENSE_LABEL, KIND_LABEL, SCOPE_NOTE, STATUS_LABEL, fullPhp, linePdf, volumeName,
  type ExLine, type ExNode, type LineStatus,
} from '../lib/hgab-explorer';

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

// ---------------------------------------------------------------------------

interface TreeProps {
  nodes: ExNode[];
  changedOnly: boolean;
  query: string;
  /** Open every branch to this depth when nothing is searched. */
  openDepth?: number;
}

/**
 * Memoised per tree: whether a node has any line that differs, and whether its label (or any
 * label under it) matches the search.
 */
function useMarks(nodes: ExNode[], query: string) {
  return useMemo(() => {
    const changed = new WeakMap<ExNode, boolean>();
    const hit = new WeakMap<ExNode, boolean>();
    const q = query.trim().toLowerCase();
    const walk = (n: ExNode): [boolean, boolean] => {
      let ch = n.x?.some((x) => x.s !== 'same') ?? false;
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
  }, [nodes, query]);
}

export function ExTree({ nodes, changedOnly, query, openDepth = 1 }: TreeProps) {
  const marks = useMarks(nodes, query);
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
      const lines = (n.x ?? []).filter((x) => !changedOnly || x.s !== 'same');
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
          <td className="num"><Amount v={n.h} strong /></td>
          <td className="num"><ExChange nep={n.n} house={n.h} /></td>
          <td className="hgab-ex-status">
            {moved ? <span className="hgab-ex-moved" title="The total is the same in both, but some lines under it moved between places or names.">Same total, moved within</span>
              : marks.changed.get(n) ? null : <span className="hgab-ex-none">All same</span>}
          </td>
          <td />
        </tr>,
      );
      if (!on) return;
      lines.forEach((x, j) => rows.push(<LineRow key={`${key}#${j}`} x={x} depth={depth + 1} />));
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
            <th className="num">Change</th>
            <th>Label</th>
            <th>Page</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? rows : (
            <tr><td colSpan={6} className="nep-empty">
              {changedOnly ? 'No line here differs between the NEP and the House bill.' : 'Nothing matches that search.'}
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function LineRow({ x, depth }: { x: ExLine; depth: number }) {
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
      <td className="num"><Amount v={x.h} strong /></td>
      <td className="num"><ExChange nep={x.n} house={x.h} /></td>
      <td className="hgab-ex-status"><ExStatusChip status={x.s} /></td>
      <td className="hgab-ex-page">
        {x.p ? (
          <a
            href={linePdf(x.p)}
            target="_blank"
            rel="noreferrer"
            title={`House bill ${volumeName(x.p[0])}, page ${x.p[2]}${x.p[3] ? `, line ${x.p[3]}` : ''}${x.a ? ' (list of non-implementing schools)' : ''} — PDF page ${x.p[1]}`}
          >
            {volumeName(x.p[0]).replace('Vol. ', '')} p.{x.p[2]}{x.a ? ' ·list' : ''}
          </a>
        ) : null}
      </td>
    </tr>
  );
}
