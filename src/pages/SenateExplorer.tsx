/**
 * `/senate/2027/explorer`: "Line by line" for the Senate committee report — every department and fund, its
 * House bill total and the committee report's (the report's General Summary), and how many of its lines
 * the report changes (Annex A). Each row opens the department's page.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { SectionHead } from '../components/shared';
import { KpiStrip } from '../components/Nep2027Bits';
import {
  SenateError, SenateHeader, SenateHero, SenateLoading, SenateNotice, SenateReviewBanner, SignedChange,
} from '../components/SenateBits';
import * as fmt from '../lib/format';
import { pageMeta } from '../lib/seo';
import { titleCase } from '../lib/hgab-explorer';
import { SENATE_EXPLORER_ROOT, loadSenateDepartments, senateExplorerPath, senatePdfUrl, type SenateDepartments, type SenateDept } from '../lib/senate';
import '../nep2027.css';
import '../hgab-explorer.css';

type Sort = 'order' | 'house' | 'senate' | 'net' | 'rows';

export default function SenateExplorer() {
  const [d, setD] = useState<SenateDepartments | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [changedOnly, setChangedOnly] = useState(true);
  const [sort, setSort] = useState<Sort>('net');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  useEffect(() => {
    document.title = pageMeta(SENATE_EXPLORER_ROOT).title;
    loadSenateDepartments().then(setD).catch((e) => setErr(String(e?.message || e)));
  }, []);

  const rows = useMemo(() => {
    if (!d) return [];
    const needle = q.trim().toLowerCase();
    let r = d.departments.filter((x) => x.roman);
    if (needle) r = r.filter((x) => x.name.toLowerCase().includes(needle));
    if (changedOnly) r = r.filter((x) => x.increase || x.decrease);
    if (sort === 'order') return r;
    const val = (x: SenateDept) => (sort === 'house' ? x.house : sort === 'senate' ? x.senate : sort === 'rows' ? x.changed_rows : x.net) ?? 0;
    const m = dir === 'asc' ? 1 : -1;
    return [...r].sort((a, b) => (val(a) - val(b)) * m);
  }, [d, q, changedOnly, sort, dir]);

  if (err) return <SenateError message={err} />;
  if (!d) return <SenateLoading what="the Senate committee report by department" />;
  const t = d.totals['DEPARTMENTS'];
  const all = d.departments.filter((x) => x.roman);
  const changed = all.filter((x) => x.increase || x.decrease).length;

  function head(key: Sort, text: string, cls = '') {
    const active = sort === key;
    return (
      <th className={`${cls} ${active ? 'nep-th-active' : ''}`.trim()}>
        <button type="button" onClick={() => {
          if (active && key !== 'order') setDir(dir === 'asc' ? 'desc' : 'asc');
          else { setSort(key); setDir(key === 'net' ? 'asc' : 'desc'); }
        }}>
          {text}<span className="nep-sort-caret">{active && key !== 'order' ? (dir === 'asc' ? '▲' : '▼') : ''}</span>
        </button>
      </th>
    );
  }

  return (
    <>
      <SenateHeader crumb="Line by line" />
      <SenateHero
        compact
        crumb="Line by line"
        title={`${changed} of ${all.length} departments and funds change in the Senate committee report`}
        dek="Each department's House bill total beside the committee report's. Open one to see the lines the report changes, and every line of the House bill with its Senate amount."
      />
      <main className="nep-main hgab-ex-main">
        <SenateReviewBanner />
        <KpiStrip
          items={[
            { label: 'Departments, House bill', value: fmt.shortPhp(t.house ?? 0, 'T') },
            { label: 'Departments, Senate', value: fmt.shortPhp(t.senate ?? 0, 'T'), sub: `${fmt.shortPhp(t.net ?? 0, 'B')} vs the House bill` },
            { label: 'Raised', value: fmt.shortPhp(t.increase ?? 0, 'B'), tone: 'up', sub: 'in departments' },
            { label: 'Cut', value: fmt.shortPhp(Math.abs(t.decrease ?? 0), 'B'), tone: 'down', sub: 'in departments' },
          ]}
        />
        <section className="nep-section">
          <SectionHead
            eyebrow="By department"
            headline="House bill and Senate committee report"
            right={
              <label className="nep-toggle">
                <input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} /> Only those that change
              </label>
            }
          />
          <div className="nep-table-toolbar">
            <input className="text-input nep-filter" type="search" placeholder="Filter departments…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter departments" />
            <span className="nep-table-count">{rows.length} of {all.length}</span>
          </div>
          <div className="nep-table-wrap">
            <table className="nep-table">
              <thead>
                <tr>
                  {head('order', 'Department or fund', 'nep-th-name')}
                  {head('house', 'House bill', 'num')}
                  {head('senate', 'Senate', 'num')}
                  {head('net', 'Change', 'num')}
                  {head('rows', 'Lines changed', 'num')}
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.name}>
                    <td className="nep-td-name">
                      {x.id ? <Link to={senateExplorerPath(x.id)}>{titleCase(x.name)}</Link> : titleCase(x.name)}
                      {x.agencies.length > 1 && <span className="hgab-ex-sub">{x.agencies.length} agencies</span>}
                    </td>
                    <td className="num nep-td-base">{fmt.shortPhp(x.house ?? 0)}</td>
                    <td className="num nep-td-amt">{fmt.shortPhp(x.senate ?? 0)}</td>
                    <td className="num"><SignedChange v={x.net} base={x.house} /></td>
                    <td className="num">{x.changed_rows ? x.changed_rows.toLocaleString() : <span className="hgab-ex-none">none</span>}</td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={5} className="nep-empty">No department matches that filter.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="nep-provenance">
            From the report's <a href={senatePdfUrl('senate-cr-general-summary')} target="_blank" rel="noreferrer">General Summary</a> (in
            thousand pesos, shown here in pesos) and <a href={senatePdfUrl('senate-cr-annex-a')} target="_blank" rel="noreferrer">Annex A</a>,
            the line-by-line amendments. "Lines changed" counts Annex A's rows for the department.
          </p>
        </section>
        <SenateNotice />
      </main>
      <SiteFooter />
    </>
  );
}
