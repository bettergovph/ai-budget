/**
 * `/hgab/2027/contractors` and `/hgab/2027/contractors/:key` (DPWH menu → Contractors): every contractor in DPWH's
 * contract list, FY2016 to FY2026, and one contractor's contracts with the enacted-budget (GAA) line each carries.
 *
 *   Index (`?q=&year=&sort=`): the contractors as a table, searchable by name or license number, ranked by
 *   amount, contracts or budget lines matched, for all years or one; the whole table as CSV.
 *
 *   Contractor: its figures, its amount by year, its DPWH offices and joint-venture partners, then every contract
 *   (searchable, by year, CSV) with the budget line we matched to it, FY2020 to FY2026.
 *
 * Data: `contractors/` (npm run build:hgab-contractors; contract in src/lib/hgab-contractors.ts). Every figure is
 * DPWH's list, counted as listed; only the contract-to-line link is ours, and the page says so wherever it shows one.
 * A joint-venture contract counts in full for each partner, so amounts are never added across contractors.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { Caveats, DisclaimerNotice, HgabError, HgabHeader, HgabHero, HgabLoading } from '../components/HgabBits';
import { datasetPath, loadContractorIndex, loadContractorShard } from '../lib/hgab';
import { dataUrl } from '../lib/data-url';
import { billions, count, fullPeso } from '../lib/hgab-history-view';
import {
  AMOUNT_NOTE, CONTRACTORS_CSV_NAME, CONTRACTORS_ROOT, CONTRACTORS_TITLE, JV_NOTE, LINKED_YEARS, MATCH_NOTE, METHOD_LABELS,
  REVOKED_NOTE, SORT_LABELS, STATUS_LABELS, amountIn, contractorPath, contractorsCsvPath, contractsCsv, contractsIn,
  decodeContracts, filterContractors, officeTotals, partnerTotals, sortContractors,
  type Contractor, type ContractorIndex, type ContractorSort, type ContractorSummary, type ContractRow,
} from '../lib/hgab-contractors';
import { pageMeta } from '../lib/seo';
import '../nep2027.css';
import '../hgab-contractors.css';

const PAGE = 100;
const CONTRACT_PAGE = 50;
const SIDE_ROWS = 10;

/** "₱6.62 trillion", "₱83.7 billion", "₱4.9 million", "₱850,000" for sentences and figures. */
function amountText(v: number): string {
  if (v >= 1e12) return `₱${(v / 1e12).toFixed(2)} trillion`;
  if (v >= 1e9) return billions(v);
  if (v >= 1e6) return `₱${(v / 1e6).toFixed(1)} million`;
  return fullPeso(Math.round(v));
}
const peso = (v: number) => fullPeso(Math.round(v));
const asOf = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'long', day: 'numeric', year: 'numeric' });
};

function download(name: string, text: string) {
  const blob = new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** A search box that commits after a pause. */
function useTyped(value: string, commit: (v: string) => void): [string, (v: string) => void] {
  const [typed, setTyped] = useState({ base: value, text: value });
  const text = typed.base === value ? typed.text : value;
  useEffect(() => {
    const t = setTimeout(() => { if (text !== value) commit(text); }, 250);
    return () => clearTimeout(t);
  }, [text, value, commit]);
  return [text, (v: string) => setTyped({ base: value, text: v })];
}

function Crumb({ name }: { name?: string }) {
  return (
    <>
      <Link to={datasetPath('dpwh')}>DPWH</Link>
      <span className="hgab-crumb-sep" aria-hidden="true">·</span>
      {name ? <Link to={CONTRACTORS_ROOT}>Contractors</Link> : <span className="hgab-crumb-here">Contractors</span>}
      {name && <><span className="hgab-crumb-sep" aria-hidden="true">·</span><span className="hgab-crumb-here">{name}</span></>}
    </>
  );
}

export default function HgabContractors() {
  const { key } = useParams();
  const [state, setState] = useState<{ index: ContractorIndex; summary: ContractorSummary } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadContractorIndex()
      .then((d) => { if (live) setState(d); })
      .catch((e) => { if (live) setErr(String(e?.message || e)); });
    return () => { live = false; };
  }, []);
  if (err) return <HgabError message={err} />;
  if (!state) return <HgabLoading what="the DPWH contractors" />;
  return key
    ? <ContractorPage key={key} ckey={key} index={state.index} summary={state.summary} />
    : <IndexPage index={state.index} summary={state.summary} />;
}

// ---------------------------------------------------------------------------
// Every contractor
// ---------------------------------------------------------------------------

function IndexPage({ index, summary }: { index: ContractorIndex; summary: ContractorSummary }) {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const yearParam = Number(params.get('year'));
  const year = index.years.includes(yearParam) ? yearParam : 0;
  const sortParam = params.get('sort') as ContractorSort | null;
  const sort: ContractorSort = sortParam && sortParam in SORT_LABELS ? sortParam : 'amount';
  const set = useMemo(() => (patch: Record<string, string>) => {
    const next = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(patch)) if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  }, [setParams]);
  const commitQ = useMemo(() => (v: string) => set({ q: v.trim() }), [set]);
  const [qInput, setQInput] = useTyped(q, commitQ);

  const list = useMemo(() => sortContractors(filterContractors(index, q, year), index.years, sort, year), [index, q, year, sort]);
  const [more, setMore] = useState<{ of: Contractor[]; n: number }>({ of: list, n: PAGE });
  const shown = more.of === list ? more.n : PAGE;
  useEffect(() => { document.title = pageMeta(CONTRACTORS_ROOT).title; }, []);

  const t = summary.totals;
  const linked = summary.gaa_links.years.filter((y) => y.fy < LINKED_YEARS[1]);
  const linkedLines = linked.reduce((a, y) => a + y.one_to_one.lines + y.bundle.lines, 0);
  const allLines = linked.reduce((a, y) => a + y.lines, 0);
  return (
    <>
      <HgabHeader crumb={CONTRACTORS_TITLE} />
      <HgabHero
        compact
        crumb={<Crumb />}
        title={<>{count(t.contractors)} contractors hold {count(t.contracts_with_contractor)} DPWH contracts from {t.years[0]} to {t.years[1]}</>}
        dek={<>Every contractor in DPWH’s contract list, with contracts worth {amountText(t.amount_php)} in all. Open one to see each contract and the budget line it carries.</>}
        note={<>{AMOUNT_NOTE} {JV_NOTE} DPWH’s list as of {asOf(summary.source.downloaded_to)}.</>}
      />
      <main className="nep-main hgab-ctr-main">
        <section className="hgab-ctr-section" aria-labelledby="hgab-ctr-list-h" style={{ marginTop: 8 }}>
          <div className="hgab-ctr-head">
            <div>
              <h2 id="hgab-ctr-list-h" className="hgab-ctr-h2">
                {count(list.length)} {list.length === 1 ? 'contractor' : 'contractors'}{year ? ` with contracts in ${year}` : ''}{q ? ` matching “${q}”` : ''}
              </h2>
              <p className="hgab-ctr-dek">
                {SORT_LABELS[sort]}{year ? `, ${year} only` : ', all years'}. Budget lines are matched for {LINKED_YEARS[0]} to {LINKED_YEARS[1]}.
              </p>
            </div>
            <div className="hgab-ctr-controls">
              <label className="hgab-ctr-search">
                <span>Search</span>
                <input type="search" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Contractor name or license number" />
              </label>
              <label>
                <span>Year</span>
                <select value={year || ''} onChange={(e) => set({ year: e.target.value })}>
                  <option value="">All years</option>
                  {[...index.years].reverse().map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
              <label>
                <span>Sort</span>
                <select value={sort} onChange={(e) => set({ sort: e.target.value === 'amount' ? '' : e.target.value })}>
                  {(Object.keys(SORT_LABELS) as ContractorSort[]).map((k) => <option key={k} value={k}>{SORT_LABELS[k]}</option>)}
                </select>
              </label>
              <a className="hgab-cta" href={dataUrl(contractorsCsvPath(summary))} download={CONTRACTORS_CSV_NAME}>Every contractor (CSV)</a>
            </div>
          </div>
          <div className="hgab-ctr-tablewrap">
            <table className="hgab-ctr-table">
              <thead>
                <tr>
                  <th scope="col" className="is-num">#</th>
                  <th scope="col">Contractor</th>
                  <th scope="col">License no.</th>
                  <th scope="col" className="is-num">{year ? `Contracts, ${year}` : 'Contracts'}</th>
                  <th scope="col" className="is-num">{year ? `Amount, ${year}` : 'Amount'}</th>
                  <th scope="col" className="is-num">Joint ventures</th>
                  <th scope="col">Years</th>
                  <th scope="col">Main DPWH office</th>
                  <th scope="col" className="is-num">Budget lines matched</th>
                </tr>
              </thead>
              <tbody>
                {list.slice(0, shown).map((c, i) => <IndexRow key={c.key} c={c} rank={i + 1} index={index} year={year} />)}
              </tbody>
            </table>
          </div>
          {list.length > shown && (
            <p className="hgab-ctr-more">
              Showing {count(shown)} of {count(list.length)}.{' '}
              <button type="button" className="hgab-ctr-linkbtn" onClick={() => setMore({ of: list, n: shown + PAGE * 5 })}>
                Show {count(Math.min(PAGE * 5, list.length - shown))} more
              </button>
            </p>
          )}
          {!list.length && <p className="hgab-ctr-more">No contractor matches. Try another name, or all years.</p>}
        </section>

        <section className="hgab-ctr-section" aria-labelledby="hgab-ctr-match-h">
          <h2 id="hgab-ctr-match-h" className="hgab-ctr-h2">
            {Math.round((linkedLines / allLines) * 100)}% of DPWH budget lines from {LINKED_YEARS[0]} to {LINKED_YEARS[1] - 1} have a contract
          </h2>
          <p className="hgab-ctr-dek">{MATCH_NOTE}</p>
          <MatchTable summary={summary} />
          <Caveats
            items={[
              'Most budget lines with no contract are lump sums: right-of-way payments, foreign-assisted projects and repair funds.',
              `Many ${LINKED_YEARS[1]} contracts are still for procurement, with no contractor yet.`,
              'A contract can carry several budget lines. DPWH lists these as clusters.',
              'Each contract’s year is DPWH’s. Contracts from before 2020 are listed but not matched to budget lines.',
              `${count(t.contracts_without_contractor)} contracts in DPWH’s list name no contractor yet; they are left out.`,
              JV_NOTE,
            ]}
          />
        </section>

        <DisclaimerNotice compact contractors="only" className="hgab-ctr-notice" />
      </main>
      <SiteFooter />
    </>
  );
}

function IndexRow({ c, rank, index, year }: { c: Contractor; rank: number; index: ContractorIndex; year: number }) {
  const n = contractsIn(c, index.years, year);
  const php = amountIn(c, index.years, year);
  return (
    <tr>
      <td className="hgab-ctr-rank is-num">{rank}</td>
      <td>
        <span className="hgab-ctr-name"><Link to={contractorPath(c.key)}>{c.name}</Link></span>
        {c.revoked && <span className="hgab-ctr-tag" title={REVOKED_NOTE}>license revoked in DPWH’s list</span>}
        {c.aliases.length > 0 && <span className="hgab-ctr-sub">Also listed as {c.aliases.slice(0, 2).join('; ')}{c.aliases.length > 2 ? '…' : ''}</span>}
      </td>
      <td><span className="hgab-ctr-id">{c.id ?? '—'}</span></td>
      <td className="is-num">{count(n)}</td>
      <td className="is-num">{peso(php)}</td>
      <td className={`is-num${c.jvContracts ? '' : ' is-zero'}`}>{count(c.jvContracts)}</td>
      <td className="hgab-ctr-yr">{c.firstYear === c.lastYear ? c.firstYear : `${c.firstYear}–${c.lastYear}`}</td>
      <td>
        {c.topOffice}
        {c.offices > 1 && <span className="hgab-ctr-sub">{Math.round((c.topOfficePhp / c.php) * 100)}% of its amount · {count(c.offices)} offices</span>}
      </td>
      <td className={`is-num${c.linkedLines ? '' : ' is-zero'}`}>
        {count(c.linkedLines)}
        {c.linkedLines > 0 && <span className="hgab-ctr-sub">{amountText(c.linkedGaaPhp)} in the budget</span>}
      </td>
    </tr>
  );
}

function MatchTable({ summary }: { summary: ContractorSummary }) {
  return (
    <div className="hgab-ctr-tablewrap">
      <table className="hgab-ctr-table">
        <thead>
          <tr>
            <th scope="col">Budget</th>
            <th scope="col" className="is-num">Lines</th>
            <th scope="col" className="is-num">With a contract</th>
            <th scope="col" className="is-num">In a cluster</th>
            <th scope="col" className="is-num">Share of the amount</th>
            <th scope="col" className="is-num">Contracts funded</th>
          </tr>
        </thead>
        <tbody>
          {summary.gaa_links.years.map((y) => {
            const n = y.one_to_one.lines + y.bundle.lines;
            return (
              <tr key={y.fy}>
                <td>{y.fy}</td>
                <td className="is-num">{count(y.lines)}</td>
                <td className="is-num">{count(n)} ({Math.round((n / y.lines) * 100)}%)</td>
                <td className="is-num">{count(y.bundle.lines)}</td>
                <td className="is-num">{Math.round((1 - y.none.gaa_php / y.gaa_php) * 100)}%</td>
                <td className="is-num">{count(y.contracts_funded)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One contractor
// ---------------------------------------------------------------------------

function ContractorPage({ ckey, index, summary }: { ckey: string; index: ContractorIndex; summary: ContractorSummary }) {
  const c = index.byKey.get(ckey);
  const { pathname } = useLocation();
  const [rows, setRows] = useState<ContractRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!c) return;
    let live = true;
    loadContractorShard(c.key)
      .then((f) => { if (live) setRows(decodeContracts(f, c.key, index) ?? []); })
      .catch((e) => { if (live) setErr(String(e?.message || e)); });
    return () => { live = false; };
  }, [c, index]);
  useEffect(() => {
    const base = pageMeta(pathname).title;
    document.title = c ? `${c.name} · ${base}` : `Contractor not found · ${base}`;
  }, [c, pathname]);
  useEffect(() => { window.scrollTo(0, 0); }, [ckey]);

  if (!c) {
    return (
      <>
        <HgabHeader crumb={CONTRACTORS_TITLE} />
        <HgabHero compact crumb={<Crumb />} title="Contractor not found" dek={<>No contractor in DPWH’s list has this key. <Link to={CONTRACTORS_ROOT}>See every contractor</Link>.</>} />
        <SiteFooter />
      </>
    );
  }
  const years = c.firstYear === c.lastYear ? `in ${c.firstYear}` : `from ${c.firstYear} to ${c.lastYear}`;
  const note: ReactNode[] = [];
  if (c.id) note.push(<>License no. {c.id} in DPWH’s list. </>);
  if (c.revoked) note.push(<>{REVOKED_NOTE} </>);
  if (c.aliases.length) note.push(<>Also listed as {c.aliases.join('; ')}. </>);
  note.push(<>{AMOUNT_NOTE} </>);
  if (c.jvContracts) note.push(<>{JV_NOTE} </>);
  note.push(<>DPWH’s list as of {asOf(summary.source.downloaded_to)}.</>);
  return (
    <>
      <HgabHeader crumb={CONTRACTORS_TITLE} />
      <HgabHero
        compact
        crumb={<Crumb name={c.name} />}
        title={c.name}
        dek={<>{count(c.contracts)} DPWH {c.contracts === 1 ? 'contract' : 'contracts'} {years}, worth {amountText(c.php)}.</>}
        note={<>{note.map((x, i) => <span key={i}>{x}</span>)}</>}
      />
      <main className="nep-main hgab-ctr-main">
        <Figures c={c} />
        <ByYear c={c} index={index} />
        {err && <p className="hgab-ctr-more" role="status">The contracts did not load ({err}).</p>}
        {!rows && !err && <p className="hgab-ctr-more" role="status">Loading the contracts…</p>}
        {rows && (
          <>
            <div className="hgab-ctr-cols">
              <Offices rows={rows} />
              <Partners rows={rows} index={index} />
            </div>
            <Contracts c={c} rows={rows} index={index} />
          </>
        )}
        <DisclaimerNotice compact contractors="only" className="hgab-ctr-notice" />
      </main>
      <SiteFooter />
    </>
  );
}

function Figures({ c }: { c: Contractor }) {
  const figs: Array<[string, ReactNode, ReactNode?]> = [
    ['Contracts', count(c.contracts)],
    ['Contract amount', amountText(c.php)],
    [STATUS_LABELS.Completed, count(c.completed)],
    [STATUS_LABELS['On-Going'], count(c.ongoing)],
    [STATUS_LABELS['Not Yet Started'], count(c.notStarted)],
    [STATUS_LABELS.Terminated, count(c.terminated)],
    ['Joint ventures', count(c.jvContracts), c.jvContracts ? amountText(c.jvPhp) : undefined],
    ['DPWH offices', count(c.offices), `${count(c.regions)} ${c.regions === 1 ? 'region' : 'regions'}`],
    [`Budget lines matched, ${LINKED_YEARS[0]}–${LINKED_YEARS[1]}`, count(c.linkedLines), c.linkedLines ? `${amountText(c.linkedGaaPhp)} in the budget` : undefined],
  ];
  return (
    <dl className="hgab-ctr-figs" aria-label="Figures">
      {figs.map(([k, v, sub]) => (
        <div key={k}><dt>{k}</dt><dd>{v}{sub && <span>{sub}</span>}</dd></div>
      ))}
    </dl>
  );
}

function ByYear({ c, index }: { c: Contractor; index: ContractorIndex }) {
  const max = Math.max(...c.yearsPhp, 1);
  const ys = index.years.map((y, k) => ({ y, n: c.yearsN[k], php: c.yearsPhp[k] })).filter((x) => x.n > 0);
  return (
    <section className="hgab-ctr-section" aria-labelledby="hgab-ctr-years-h">
      <h2 id="hgab-ctr-years-h" className="hgab-ctr-h2">By year</h2>
      <p className="hgab-ctr-dek">Contracts by DPWH’s year for each contract.</p>
      <div className="hgab-ctr-tablewrap">
        <table className="hgab-ctr-table">
          <thead>
            <tr><th scope="col">Year</th><th scope="col" className="is-num">Contracts</th><th scope="col" className="is-num">Amount</th><th scope="col"><span className="visually-hidden">Bar</span></th></tr>
          </thead>
          <tbody>
            {ys.map((x) => (
              <tr key={x.y}>
                <td>{x.y}</td>
                <td className="is-num">{count(x.n)}</td>
                <td className="is-num">{peso(x.php)}</td>
                <td className="hgab-ctr-bar"><i style={{ width: `${Math.max(1, (x.php / max) * 100)}%` }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Offices({ rows }: { rows: ContractRow[] }) {
  const all = useMemo(() => officeTotals(rows), [rows]);
  const [open, setOpen] = useState(false);
  const list = open ? all : all.slice(0, SIDE_ROWS);
  return (
    <section className="hgab-ctr-section" aria-labelledby="hgab-ctr-offices-h">
      <h2 id="hgab-ctr-offices-h" className="hgab-ctr-h2">DPWH offices</h2>
      <p className="hgab-ctr-dek">The offices that awarded its contracts.</p>
      <div className="hgab-ctr-tablewrap">
        <table className="hgab-ctr-table">
          <thead><tr><th scope="col">Office</th><th scope="col" className="is-num">Contracts</th><th scope="col" className="is-num">Amount</th></tr></thead>
          <tbody>
            {list.map((o) => (
              <tr key={o.office}><td>{o.office || '—'}</td><td className="is-num">{count(o.contracts)}</td><td className="is-num">{peso(o.php)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      {all.length > SIDE_ROWS && (
        <p className="hgab-ctr-more">
          <button type="button" className="hgab-ctr-linkbtn" onClick={() => setOpen(!open)}>{open ? 'Show fewer' : `Show all ${count(all.length)} offices`}</button>
        </p>
      )}
    </section>
  );
}

function Partners({ rows, index }: { rows: ContractRow[]; index: ContractorIndex }) {
  const all = useMemo(() => partnerTotals(rows), [rows]);
  const [open, setOpen] = useState(false);
  const list = open ? all : all.slice(0, SIDE_ROWS);
  return (
    <section className="hgab-ctr-section" aria-labelledby="hgab-ctr-partners-h">
      <h2 id="hgab-ctr-partners-h" className="hgab-ctr-h2">Joint-venture partners</h2>
      <p className="hgab-ctr-dek">{all.length ? 'Contractors named on the same contracts.' : 'No contract names another contractor.'}</p>
      {all.length > 0 && (
        <div className="hgab-ctr-tablewrap">
          <table className="hgab-ctr-table">
            <thead><tr><th scope="col">Partner</th><th scope="col" className="is-num">Contracts together</th><th scope="col" className="is-num">Amount</th></tr></thead>
            <tbody>
              {list.map((p) => {
                const who = index.byKey.get(p.key);
                return (
                  <tr key={p.key}>
                    <td><span className="hgab-ctr-name">{who ? <Link to={contractorPath(p.key)}>{who.name}</Link> : p.key}</span></td>
                    <td className="is-num">{count(p.contracts)}</td>
                    <td className="is-num">{peso(p.php)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {all.length > SIDE_ROWS && (
        <p className="hgab-ctr-more">
          <button type="button" className="hgab-ctr-linkbtn" onClick={() => setOpen(!open)}>{open ? 'Show fewer' : `Show all ${count(all.length)} partners`}</button>
        </p>
      )}
    </section>
  );
}

function Contracts({ c, rows, index }: { c: Contractor; rows: ContractRow[]; index: ContractorIndex }) {
  const [q, setQ] = useState('');
  const [year, setYear] = useState(0);
  const [onlyLinked, setOnlyLinked] = useState(false);
  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter((r) => (!year || r.year === year) && (!onlyLinked || r.lines.length > 0) && words.every((w) => r.search.includes(w)));
  }, [rows, q, year, onlyLinked]);
  const [more, setMore] = useState<{ of: ContractRow[]; n: number }>({ of: list, n: CONTRACT_PAGE });
  const shown = more.of === list ? more.n : CONTRACT_PAGE;
  const years = useMemo(() => [...new Set(rows.map((r) => r.year).filter((y): y is number => y != null))].sort((a, b) => b - a), [rows]);
  const total = list.reduce((a, r) => a + r.php, 0);
  return (
    <section className="hgab-ctr-section" aria-labelledby="hgab-ctr-contracts-h">
      <div className="hgab-ctr-head">
        <div>
          <h2 id="hgab-ctr-contracts-h" className="hgab-ctr-h2">{count(list.length)} contracts, {amountText(total)}</h2>
          <p className="hgab-ctr-dek">Newest first. {MATCH_NOTE}</p>
        </div>
        <div className="hgab-ctr-controls">
          <label className="hgab-ctr-search">
            <span>Search</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Contract, place, office or budget line" />
          </label>
          <label>
            <span>Year</span>
            <select value={year || ''} onChange={(e) => setYear(Number(e.target.value) || 0)}>
              <option value="">All years</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label>
            <span>Budget line</span>
            <select value={onlyLinked ? 'yes' : ''} onChange={(e) => setOnlyLinked(e.target.value === 'yes')}>
              <option value="">Every contract</option>
              <option value="yes">With a matched line</option>
            </select>
          </label>
          <button type="button" className="hgab-cta" disabled={!list.length}
            onClick={() => download(`bettergov-dpwh-contracts-${c.key}.csv`, contractsCsv(list, index))}>
            Download these (CSV)
          </button>
        </div>
      </div>
      <div className="hgab-ctr-tablewrap">
        <table className="hgab-ctr-table hgab-ctr-contracts">
          <thead>
            <tr>
              <th scope="col">Year</th>
              <th scope="col">Contract</th>
              <th scope="col">DPWH office</th>
              <th scope="col" className="is-num">Amount</th>
              <th scope="col">Status</th>
              <th scope="col">Budget line (enacted budget)</th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, shown).map((r) => <ContractTr key={r.id} r={r} index={index} />)}
          </tbody>
        </table>
      </div>
      {list.length > shown && (
        <p className="hgab-ctr-more">
          Showing {count(shown)} of {count(list.length)}.{' '}
          <button type="button" className="hgab-ctr-linkbtn" onClick={() => setMore({ of: list, n: shown + CONTRACT_PAGE * 4 })}>
            Show {count(Math.min(CONTRACT_PAGE * 4, list.length - shown))} more
          </button>
        </p>
      )}
      {!list.length && <p className="hgab-ctr-more">No contract matches.</p>}
    </section>
  );
}

function ContractTr({ r, index }: { r: ContractRow; index: ContractorIndex }) {
  const partners = r.partners.map((k) => index.byKey.get(k)).filter((x): x is Contractor => Boolean(x));
  return (
    <tr>
      <td>{r.year ?? '—'}</td>
      <td>
        <span className="hgab-ctr-id">{r.id}</span>
        <span className="hgab-ctr-sub" style={{ color: 'var(--ink-2)' }}>{r.description}</span>
        {partners.length > 0 && (
          <span className="hgab-ctr-sub">
            With {partners.map((p, i) => <span key={p.key}>{i ? '; ' : ''}<Link to={contractorPath(p.key)}>{p.name}</Link></span>)}
          </span>
        )}
      </td>
      <td>{r.office || '—'}</td>
      <td className="is-num">{peso(r.php)}</td>
      <td>
        <span className="hgab-ctr-status">{r.status ? STATUS_LABELS[r.status] : '—'}{r.status === 'On-Going' && r.progress != null ? ` · ${r.progress}%` : ''}</span>
        {(r.start || r.completion) && <span className="hgab-ctr-sub">{r.start ?? '…'} to {r.completion ?? '…'}</span>}
      </td>
      <td>
        {r.lines.length > 0 ? (
          <>
            {r.lines.map((l) => (
              <p key={l.id} className="hgab-ctr-line"><strong>{l.fy}</strong> {l.title} · <strong>{amountText(l.gaaPhp)}</strong></p>
            ))}
            <span className="hgab-ctr-sub">{METHOD_LABELS[r.lines[0].method]}</span>
          </>
        ) : (
          <span className="hgab-ctr-none">
            {r.year != null && r.year < LINKED_YEARS[0] ? `Not matched before ${LINKED_YEARS[0]}` : 'No budget line found'}
          </span>
        )}
      </td>
    </tr>
  );
}
