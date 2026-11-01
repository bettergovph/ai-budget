/**
 * `/hgab/2027/explorer/:deptId` — one department of the House bill against the NEP, line by line:
 * each agency, then the bill's own hierarchy down to expense classes, with the page each House
 * bill line is published on.
 *
 * One JSON per department (`explorer/d/<id>.json`; DepEd, with every secondary school, is the
 * largest at about 4 MB, 0.6 MB compressed). Agencies open on demand.
 */
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { DisclaimerNotice, HgabError, HgabHeader, HgabHero, HgabLoading } from '../components/HgabBits';
import { KpiStrip } from '../components/Nep2027Bits';
import { ExChange, ExStatusChip, ExTree, UnderReviewBanner } from '../components/HgabExplorerBits';
import * as fmt from '../lib/format';
import { downloadCsv } from '../lib/csv';
import {
  EXPLORER_ROOT, STATUS_LABEL, STATUS_ORDER, agencyCsvRows, fullPhp, explorerPath, loadExplorerDept, titleCase, toCsv,
  type ExAgency, type ExDept,
} from '../lib/hgab-explorer';
import '../nep2027.css';
import '../hgab-explorer.css';

export default function HgabExplorerDept() {
  const { deptId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const [loaded, setLoaded] = useState<{ id: string; dept: ExDept | null; err: string | null } | null>(null);

  useEffect(() => {
    let live = true;
    loadExplorerDept(deptId)
      .then((d) => { if (live) setLoaded({ id: deptId, dept: d, err: null }); })
      .catch((e) => { if (live) setLoaded({ id: deptId, dept: null, err: String(e?.message || e) }); });
    return () => { live = false; };
  }, [deptId]);

  const dept = loaded?.id === deptId ? loaded.dept : null;
  const err = loaded?.id === deptId ? loaded.err : null;

  useEffect(() => {
    if (dept) document.title = `${titleCase(dept.name)} — House bill line by line · budget.bettergov.ph`;
  }, [dept]);

  const q = params.get('q') ?? '';
  const changedLines = dept ? dept.agencies.reduce((a, g) => a + g.lines - (g.status.same ?? 0), 0) : 0;
  // "Only changes" is on by default when anything changed; the URL keeps the reader's choice.
  const changedOnly = params.get('all') === '1' ? false : changedLines > 0;
  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v == null || v === '') next.delete(k); else next.set(k, v);
    setParams(next, { replace: true });
  };

  if (err) return <HgabError message={err} />;
  if (!dept) return <HgabLoading what="this department, line by line" />;

  const name = titleCase(dept.name);
  const crumb = (
    <>
      <Link to={EXPLORER_ROOT}>Line by line</Link>
      <span className="hgab-crumb-sep" aria-hidden="true">·</span>
      <span className="hgab-crumb-here">{name}</span>
    </>
  );
  const needle = q.trim().toLowerCase();
  const shown = dept.agencies.filter((a) =>
    (!changedOnly || a.lines > (a.status.same ?? 0)) && (!needle || agencyMatches(a, needle)));
  const status = dept.agencies.reduce<Record<string, number>>((acc, a) => {
    for (const [k, v] of Object.entries(a.status)) acc[k] = (acc[k] ?? 0) + (v ?? 0);
    return acc;
  }, {});

  return (
    <>
      <HgabHeader crumb={crumb} />
      <HgabHero
        compact
        crumb={crumb}
        title={name}
        dek={
          changedLines
            ? `${changedLines.toLocaleString()} of ${dept.lines.toLocaleString()} lines differ between the NEP and the House bill.`
            : `All ${dept.lines.toLocaleString()} lines carry the same amount in the NEP and the House bill.`
        }
      />
      <main className="nep-main hgab-ex-main">
        <UnderReviewBanner />
        <KpiStrip
          items={[
            { label: 'NEP', value: dept.nep ? fmt.shortPhp(dept.nep) : '—', sub: dept.nep ? fullPhp(dept.nep) : 'not in the NEP data' },
            { label: 'House bill', value: fmt.shortPhp(dept.house), sub: fullPhp(dept.house) },
            {
              label: 'Change',
              value: `${dept.house >= dept.nep ? '+' : '−'}${fmt.shortPhp(Math.abs(dept.house - dept.nep))}`,
              tone: dept.house > dept.nep ? 'up' : dept.house < dept.nep ? 'down' : undefined,
              sub: dept.nep ? `${fmt.signedPct((dept.house - dept.nep) / dept.nep, 1)} · House bill minus the NEP` : 'House bill minus the NEP',
            },
            {
              label: 'Lines',
              value: dept.lines.toLocaleString(),
              sub: STATUS_ORDER.filter((s) => s !== 'same' && status[s]).map((s) => `${status[s].toLocaleString()} ${s === 'higher' || s === 'lower' ? STATUS_LABEL[s].label.toLowerCase() : STATUS_LABEL[s].label}`).join(' · ') || 'none differ',
            },
          ]}
        />

        <div className="hgab-ex-controls">
          <input
            className="text-input nep-filter"
            type="search"
            placeholder="Find a program, activity, region, office or school…"
            value={q}
            onChange={(e) => setParam('q', e.target.value)}
            aria-label="Search this department"
          />
          <label className="nep-toggle">
            <input
              type="checkbox"
              checked={changedOnly}
              disabled={!changedLines}
              onChange={(e) => setParam('all', e.target.checked ? null : '1')}
            />
            Only lines that differ
          </label>
          <span className="hgab-ex-legend-inline">
            {STATUS_ORDER.filter((s) => status[s]).map((s) => <ExStatusChip key={s} status={s} />)}
          </span>
        </div>

        {shown.map((a) => (
          <AgencyBlock key={a.id} dept={dept} agency={a} changedOnly={changedOnly} query={q} single={shown.length === 1} />
        ))}
        {!shown.length && <p className="nep-empty">No agency here has a line that matches.</p>}

        <p className="nep-provenance">
          <Link to={explorerPath()}>All departments</Link> · <Link to={`${explorerPath()}#downloads`}>download the whole dataset</Link>{' '}
          · amounts in pesos as published · the page link opens the House bill PDF at that page
        </p>
        <DisclaimerNotice />
      </main>
      <SiteFooter />
    </>
  );
}

function agencyMatches(a: ExAgency, q: string): boolean {
  const walk = (ns: ExAgency['tree']): boolean => ns.some((n) => n.l.toLowerCase().includes(q) || walk(n.c ?? []));
  return a.name.toLowerCase().includes(q) || walk(a.tree);
}

function AgencyBlock({ dept, agency, changedOnly, query, single }: {
  dept: ExDept;
  agency: ExAgency;
  changedOnly: boolean;
  query: string;
  single: boolean;
}) {
  const changed = agency.lines - (agency.status.same ?? 0);
  const hasQuery = query.trim().length > 0;
  const [openByUser, setOpenByUser] = useState<boolean | null>(null);
  const open = openByUser ?? (single || hasQuery);
  // No agency heading in the bill (single-agency departments, DepEd): use the NEP's agency name.
  const sameName = agency.name === dept.name;

  return (
    <section className={`hgab-ex-agency ${open ? 'is-open' : ''}`.trim()}>
      <header className="hgab-ex-agency-head">
        <button type="button" className="hgab-ex-agency-toggle" aria-expanded={open} onClick={() => setOpenByUser(!open)}>
          <span className="hgab-ex-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
          <span className="hgab-ex-agency-name">{sameName ? (agency.nep_name ?? 'All lines') : titleCase(agency.name)}</span>
        </button>
        <span className="hgab-ex-agency-figs">
          <span><span className="hgab-ex-fig-label">NEP</span> <span title={fullPhp(agency.nep)}>{agency.nep ? fmt.shortPhp(agency.nep) : '—'}</span></span>
          <span><span className="hgab-ex-fig-label">House bill</span> <strong title={fullPhp(agency.house)}>{fmt.shortPhp(agency.house)}</strong></span>
          <ExChange nep={agency.nep} house={agency.house} />
          <span className="hgab-ex-sub">{changed ? `${changed.toLocaleString()} of ${agency.lines.toLocaleString()} lines differ` : `${agency.lines.toLocaleString()} lines, all the same`}</span>
          <button
            type="button"
            className="hgab-ex-csv"
            onClick={() => downloadCsv(`house-bill-2027-${dept.id}-${agency.id}.csv`, toCsv(agencyCsvRows(dept, agency)), { excelBom: true })}
          >
            CSV
          </button>
        </span>
      </header>
      {agency.nep_name && agency.nep_name.toLowerCase() !== agency.name.toLowerCase() && !sameName && (
        <p className="hgab-ex-nepname">In the NEP: {agency.nep_name}</p>
      )}
      {open && <ExTree nodes={agency.tree} changedOnly={changedOnly} query={query} openDepth={single ? 2 : 1} />}
    </section>
  );
}
