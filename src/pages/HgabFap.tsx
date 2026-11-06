/**
 * `/hgab/2027/foreign-assisted` — Foreign-assisted projects: every loan- or grant-financed project in the FY2027
 * House bill against the NEP, and how every budget since FY2021 treated these projects.
 *
 * The data is `fap.json` (`npm run build:hgab-fap`, contract in src/lib/hgab-fap.ts) plus the DBM series the
 * contract carries (BESF Table B.13, one edition a year) and the unprogrammed figures. Every figure in the copy is
 * computed from them. Stages are compared, never added.
 *
 * Copy: factual headings with the number in them; short sentences; the technical record inside "Details for
 * analysts". Follows the reading in section 2.3.1 of PBC's House bill assessment and checks its figures.
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { Caveats, DisclaimerNotice, HgabDetails, HgabError, HgabHeader, HgabHero, HgabLoading, WhatThisMeans } from '../components/HgabBits';
import { SectionHead } from '../components/shared';
import { loadHgabFap } from '../lib/hgab';
import { dataUrl } from '../lib/data-url';
import { billions, bn, fullPeso } from '../lib/hgab-history-view';
import {
  BESF_EDITIONS, FAP_CSV_NAME, FAP_CSV_PATH, FAP_DEPT_NAMES, FAP_DEPT_SERIES, FAP_NEP_VOL_III_PATH, FAP_SERIES, FAP_STAGE_LABELS,
  FAP_TITLE, FAP_VOL_IB_PATH, PBC_FAP_SECTION, UNPROGRAMMED, UNPROGRAMMED_RELEASES_2025_PHP, cutShare, fapExplorerHref,
  type FapData, type FapProject, type FapStageKey, type FapYear,
} from '../lib/hgab-fap';
import '../nep2027.css';
import '../hgab-fap.css';

const HGAB = '/hgab/2027';
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');
const signed = (v: number) => (v === 0 ? '0' : `${v > 0 ? '+' : '−'}${bn(Math.abs(v))}`);
const STATUS_LABEL: Record<FapProject['status'], string> = { cut: 'Cut', raised: 'Raised', same: 'Same', new: 'New line' };

function asOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `As of ${d.toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'long', day: 'numeric', year: 'numeric' })}`;
}

/** The project's name as a link: DPWH lines to their record, the rest to the line in the explorer. */
function ProjectLink({ p }: { p: FapProject }) {
  if (p.dpwh_id) return <Link to={`${HGAB}/dpwh/p/${encodeURIComponent(p.dpwh_id)}`}>{p.title}</Link>;
  const href = fapExplorerHref(p);
  return href ? <Link to={href}>{p.title}</Link> : <>{p.title}</>;
}

function Change({ v }: { v: number }) {
  if (v === 0) return <span className="hgab-fa-status is-same">same</span>;
  return <span className={v < 0 ? 'hgab-fa-down' : 'hgab-fa-up'}>{signed(v)}</span>;
}

/** The largest cuts: the NEP over the House bill, one scale, labelled with the exact billions. */
function TopCuts({ projects }: { projects: FapProject[] }) {
  const max = Math.max(...projects.map((p) => Math.max(p.nep_php ?? 0, p.house_php ?? 0)));
  const w = (v: number | null) => `${((v ?? 0) / max) * 72}%`;
  return (
    <ol className="hgab-fa-pairs" aria-label="The largest cuts, NEP against House bill">
      {projects.map((p) => (
        <li key={p.key} className="hgab-fa-pair">
          <div className="hgab-fa-pair-name">
            <ProjectLink p={p} />
            <small>{p.dept_short} · {p.lenders.join(', ')} · <span className="hgab-fa-pair-change">{signed(p.change_php)} ({pct(-p.change_php, p.nep_php ?? 0)})</span></small>
          </div>
          <div className="hgab-fa-tracks" role="img" aria-label={`${p.title}: NEP ${bn(p.nep_php)}, House bill ${bn(p.house_php)}`}>
            <div className="hgab-fa-track"><span className="hgab-fa-seg is-nep" style={{ width: w(p.nep_php) }} /><span className="hgab-fa-seg-val" style={{ left: w(p.nep_php) }}>{bn(p.nep_php)}</span></div>
            <div className="hgab-fa-track"><span className="hgab-fa-seg is-house" style={{ width: w(p.house_php) }} /><span className="hgab-fa-seg-val" style={{ left: w(p.house_php) }}>{bn(p.house_php)}</span></div>
          </div>
        </li>
      ))}
    </ol>
  );
}

const YEAR_STAGES: readonly FapStageKey[] = ['proposed', 'program', 'actual'];
const STAGE_CLASS: Record<FapStageKey | 'house', string> = { proposed: 'is-nep', program: 'is-gaa', actual: 'is-actual', house: 'is-house' };

/**
 * One budget year per group, FY2021 to FY2027: what the NEP proposed, what the enacted budget carried, what was
 * actually obligated; FY2027 shows the NEP and the House bill. Inline SVG; every value is in the aria-label and in
 * the table below the chart.
 */
function YearChart({ house2027 }: { house2027: number }) {
  const hatch = `hgab-fa-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const years = FAP_SERIES.filter((y) => y.fy >= 2021);
  const cells = years.map((y) => {
    const list: { key: string; cls: string; v: number | null; label: string }[] = YEAR_STAGES.map((st) => ({ key: st, cls: STAGE_CLASS[st], v: y[st]?.total ?? null, label: FAP_STAGE_LABELS[st].label }));
    if (y.fy === 2027) list.splice(1, 2, { key: 'house', cls: STAGE_CLASS.house, v: house2027, label: 'House bill' });
    return { fy: y.fy, list };
  });
  const max = Math.max(...cells.flatMap((c) => c.list.map((b) => b.v ?? 0)));
  const W = 720, H = 250, left = 40, top = 18, bottom = 30, gap = 18;
  const plotBottom = H - bottom;
  const plotH = plotBottom - top;
  const groupW = (W - left - gap) / cells.length;
  const barW = Math.min(22, (groupW - gap) / 3);
  const y = (v: number) => plotBottom - (v / max) * plotH;
  const step = 100e9;
  const ticks: number[] = [];
  for (let t = step; t <= max * 1.001; t += step) ticks.push(t);
  const summary = cells.map((c) => `FY${c.fy}: ${c.list.map((b) => `${b.label} ${b.v == null ? 'no figure' : bn(b.v)}`).join(', ')}`).join('; ');
  return (
    <svg className="hgab-fa-years" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Foreign-assisted projects by budget year. ${summary}.`} focusable="false">
      <defs>
        <pattern id={hatch} className="hatch" patternUnits="userSpaceOnUse" width="4" height="4">
          <path d="M-1,1 l2,-2 M0,4 l4,-4 M3,5 l2,-2" />
        </pattern>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line className="gridline" x1={left} x2={W} y1={y(t)} y2={y(t)} />
          <text className="tick" x={left - 6} y={y(t) + 3}>{Math.round(t / 1e9)}B</text>
        </g>
      ))}
      <line className="axis" x1={left} x2={W} y1={plotBottom} y2={plotBottom} />
      {cells.map((c, gi) => {
        const x0 = left + gap / 2 + gi * groupW + (groupW - gap - barW * c.list.length) / 2;
        return (
          <g key={c.fy}>
            {c.list.map((b, bi) => {
              const x = x0 + bi * barW;
              if (b.v == null) return <line key={b.key} className="empty" x1={x + 2} x2={x + barW - 2} y1={plotBottom - 6} y2={plotBottom - 6} />;
              const h = Math.max(1, plotBottom - y(b.v));
              return (
                <g key={b.key}>
                  <rect className={`bar ${b.cls}`} x={x + 1} y={y(b.v)} width={barW - 2} height={h} fill={b.cls === 'is-nep' ? `url(#${hatch})` : undefined}>
                    <title>{`FY${c.fy} ${b.label}: ${fullPeso(b.v)}`}</title>
                  </rect>
                  <text className="val" x={x + barW / 2} y={y(b.v) - 3}>{Math.round(b.v / 1e9)}</text>
                </g>
              );
            })}
            <text className="x" x={x0 + (barW * c.list.length) / 2} y={H - 10}>FY{c.fy}</text>
          </g>
        );
      })}
    </svg>
  );
}

function YearTable({ house2027 }: { house2027: number }) {
  const row = (y: FapYear) => {
    const share = cutShare(y);
    return (
      <tr key={y.fy}>
        <th scope="row">FY{y.fy}</th>
        <td className="num">{y.proposed ? bn(y.proposed.total) : '—'}</td>
        <td className="num">{y.fy === 2027 ? <>{bn(house2027)}<span className="hgab-fa-share">House bill</span></> : y.program ? bn(y.program.total) : '—'}</td>
        <td className="num">{y.fy === 2027 ? <Change v={house2027 - y.proposed!.total} /> : y.proposed && y.program ? <Change v={y.program.total - y.proposed.total} /> : '—'}</td>
        <td className="num">{y.fy === 2027 ? pct(y.proposed!.total - house2027, y.proposed!.total) : share == null ? '—' : `${Math.round(share * 100)}%`}</td>
        <td className="num">{y.actual ? bn(y.actual.total) : '—'}</td>
        <td className="num">{y.actual ? bn(y.actual.loan) : '—'}</td>
      </tr>
    );
  };
  return (
    <div className="nep-table-wrap">
      <table className="nep-table hgab-fa-table">
        <thead>
          <tr>
            <th scope="col">Budget year</th>
            <th scope="col" className="num">NEP</th>
            <th scope="col" className="num">Enacted budget</th>
            <th scope="col" className="num">Change</th>
            <th scope="col" className="num">Cut</th>
            <th scope="col" className="num">Actual obligations</th>
            <th scope="col" className="num">of which loan proceeds</th>
          </tr>
        </thead>
        <tbody>{FAP_SERIES.filter((y) => y.fy >= 2020).map(row)}</tbody>
      </table>
    </div>
  );
}

function DeptYearTable() {
  const keys = ['dpwh', 'dotr', 'da', 'deped', 'doh', 'dswd'] as const;
  const fys = [2021, 2022, 2023, 2024, 2025, 2026, 2027];
  const cell = (k: typeof keys[number], fy: number, st: FapStageKey) => {
    const r = FAP_DEPT_SERIES[k].find((d) => d.fy === fy);
    const v = r?.[st];
    return v == null ? '—' : v === 0 ? '0' : bn(v);
  };
  return (
    <div className="nep-table-wrap">
      <table className="nep-table hgab-fa-table">
        <thead>
          <tr>
            <th scope="col">Department</th>
            <th scope="col">Stage</th>
            {fys.map((fy) => <th key={fy} scope="col" className="num">FY{fy}</th>)}
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            YEAR_STAGES.map((st, i) => (
              <tr key={`${k}-${st}`}>
                {i === 0 && <th scope="rowgroup" rowSpan={3}><abbr title={FAP_DEPT_NAMES[k].name}>{FAP_DEPT_NAMES[k].short}</abbr></th>}
                <td>{FAP_STAGE_LABELS[st].label}</td>
                {fys.map((fy) => <td key={fy} className="num">{cell(k, fy, st)}</td>)}
              </tr>
            ))
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProjectsTable({ projects }: { projects: FapProject[] }) {
  return (
    <div className="nep-table-wrap">
      <table className="nep-table hgab-fa-table">
        <thead>
          <tr>
            <th scope="col">Dept.</th>
            <th scope="col">Project</th>
            <th scope="col">Lender</th>
            <th scope="col" className="num">NEP</th>
            <th scope="col" className="num">House bill</th>
            <th scope="col" className="num">Change</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.key}>
              <td><abbr title={p.department}>{p.dept_short}</abbr></td>
              <td className="name"><ProjectLink p={p} /><small>{p.agency !== p.department ? p.agency : ''}</small></td>
              <td>{p.lenders.join(', ')}</td>
              <td className="num">{p.nep_php ? bn(p.nep_php) : '—'}</td>
              <td className="num">{p.house_php ? bn(p.house_php) : '—'}</td>
              <td className="num"><Change v={p.change_php} /></td>
              <td><span className={`hgab-fa-status is-${p.status}`}>{STATUS_LABEL[p.status]}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function HgabFap() {
  const [data, setData] = useState<FapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadHgabFap().then((d) => { if (live) setData(d); }).catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, []);
  const sorted = useMemo(() => (data ? [...data.projects].sort((a, b) => a.change_php - b.change_php || (b.nep_php ?? 0) - (a.nep_php ?? 0)) : []), [data]);

  if (error) return <HgabError message={error} />;
  if (!data) return <HgabLoading what={FAP_TITLE} />;

  const T = data.totals;
  const cut = T.all.nep_php - T.all.house_php;
  const loanCut = T.loan.nep_php - T.loan.house_php;
  const gopCut = T.gop.nep_php - T.gop.house_php;
  const top = sorted.filter((p) => p.change_php < 0).slice(0, 12);
  const dpwh = data.departments.find((d) => d.dept_code === '18');
  const dotr = data.departments.find((d) => d.dept_code === '38');
  const y2026 = FAP_SERIES.find((y) => y.fy === 2026)!;
  const y2025 = FAP_SERIES.find((y) => y.fy === 2025)!;
  const y2024 = FAP_SERIES.find((y) => y.fy === 2024)!;
  const past = FAP_SERIES.filter((y) => y.fy >= 2021 && y.fy <= 2026);
  const shares = past.map((y) => cutShare(y)!);
  const minShare = Math.min(...shares);
  const maxShare = Math.max(...shares);
  const actuals = FAP_SERIES.filter((y) => y.fy >= 2021 && y.actual).map((y) => y.actual!.total);
  const support2026 = UNPROGRAMMED.support.find((s) => s.fy === 2026)!;
  const support2027 = UNPROGRAMMED.support.find((s) => s.fy === 2027)!;
  const newLines = sorted.filter((p) => p.status === 'new');
  const newTotal = newLines.reduce((a, p) => a + (p.house_php ?? 0), 0);
  const lenderList = data.lenders.filter((l) => l.name !== 'Government counterpart');
  const gopLender = data.lenders.find((l) => l.name === 'Government counterpart');

  return (
    <>
      <HgabHeader crumb={FAP_TITLE} />
      <HgabHero
        compact
        crumb={FAP_TITLE}
        title={<>Foreign-assisted projects: {billions(T.all.house_php)} in the House bill, {billions(cut)} less than the NEP’s {billions(T.all.nep_php)}</>}
        dek={
          <>
            The bill lists {T.projects} projects paid for with foreign loans or grants. The House cut {T.cut} of them, kept {T.same} as
            the NEP had them, and added {T.new} small DPWH lines worth {billions(newTotal)} together. The cut is {pct(cut, T.bill_cuts_php)} of
            everything the House took out of the bill’s lines.
          </>
        }
        note={
          <>
            Every budget since FY2021 has done something like this. The NEP proposes, the enacted budget carries between half and almost none of
            it, and the projects run on unprogrammed appropriations instead. The FY2027 NEP broke with that; the House bill goes part of the way back.
          </>
        }
      />
      <main className="nep-main hgab-fa-main">
        <p className="hgab-fa-asof">{asOf(data.built_at)} · House Bill 10858, third reading, against the FY2027 NEP.</p>

        <ul className="hgab-fa-tiles" aria-label="Key figures">
          <li className="hgab-fa-tile"><b>{bn(T.all.nep_php)}</b><span>NEP, {T.projects} projects</span><small>DBM’s own total for the year</small></li>
          <li className="hgab-fa-tile"><b>{bn(T.all.house_php)}</b><span>House bill</span><small>{signed(-cut)} · {pct(cut, T.all.nep_php)} less</small></li>
          <li className="hgab-fa-tile"><b className="is-down">{signed(-loanCut)}</b><span>Loan and grant proceeds</span><small>{bn(T.loan.nep_php)} → {bn(T.loan.house_php)}</small></li>
          <li className="hgab-fa-tile"><b className="is-down">{signed(-gopCut)}</b><span>Government counterpart</span><small>{bn(T.gop.nep_php)} → {bn(T.gop.house_php)}</small></li>
        </ul>

        <section className="nep-section hgab-fa-section" aria-labelledby="hgab-fa-top">
          <SectionHead
            headline={<span id="hgab-fa-top">The largest cuts: {top.slice(0, 4).map((p) => p.title.replace(/\s*\(.*$/, '').replace(/,.*$/, '')).join(', ')}</span>}
            dek={`The ${top.length} projects that lost the most, NEP over House bill, on one scale. ${top.length ? `${top[0].title.replace(/,.*$/, '')} alone loses ${billions(-top[0].change_php)}.` : ''}`}
          />
          <ul className="hgab-fa-key" aria-hidden="true">
            <li><i className="is-nep" />NEP</li>
            <li><i className="is-house" />House bill</li>
          </ul>
          <TopCuts projects={top} />
          <WhatThisMeans>
            These are signed loans, not proposals. A smaller appropriation does not cancel a loan. It delays the drawdown, and the government
            keeps paying commitment fees on the undrawn balance.
          </WhatThisMeans>
        </section>

        <section className="nep-section hgab-fa-section" aria-labelledby="hgab-fa-dept">
          <SectionHead
            headline={
              <span id="hgab-fa-dept">
                DPWH loses {dpwh ? pct(-dpwh.change_php, dpwh.nep_php) : '—'} of its foreign-assisted budget, DOTr {dotr ? pct(-dotr.change_php, dotr.nep_php) : '—'}
              </span>
            }
            dek={`${data.departments.length} departments and funds carry a foreign-assisted line. ${data.departments.filter((d) => d.change_php < 0).length} of them lost budget; none gained.`}
          />
          <div className="nep-table-wrap">
            <table className="nep-table hgab-fa-table">
              <thead>
                <tr>
                  <th scope="col">Department</th>
                  <th scope="col" className="num">Projects</th>
                  <th scope="col" className="num">Cut</th>
                  <th scope="col" className="num">NEP</th>
                  <th scope="col" className="num">House bill</th>
                  <th scope="col" className="num">Change</th>
                  <th scope="col" className="num">Share</th>
                </tr>
              </thead>
              <tbody>
                {data.departments.map((d) => (
                  <tr key={`${d.dept_code}-${d.department}`}>
                    <td className="name">{d.dept_slug ? <Link to={`${HGAB}/explorer/${d.dept_slug}`}>{d.department}</Link> : d.department}</td>
                    <td className="num">{d.projects}</td>
                    <td className="num">{d.cut || '—'}</td>
                    <td className="num">{bn(d.nep_php)}</td>
                    <td className="num">{bn(d.house_php)}</td>
                    <td className="num"><Change v={d.change_php} /></td>
                    <td className="num">{d.change_php ? pct(-d.change_php, d.nep_php) : '—'}</td>
                  </tr>
                ))}
                <tr className="is-total">
                  <td>All</td>
                  <td className="num">{T.projects}</td>
                  <td className="num">{T.cut}</td>
                  <td className="num">{bn(T.all.nep_php)}</td>
                  <td className="num">{bn(T.all.house_php)}</td>
                  <td className="num"><Change v={-cut} /></td>
                  <td className="num">{pct(cut, T.all.nep_php)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="nep-section hgab-fa-section" aria-labelledby="hgab-fa-loan">
          <SectionHead
            headline={<span id="hgab-fa-loan">{pct(loanCut, cut)} of the cut is loan proceeds, which cannot pay for anything else</span>}
            dek="Each foreign-assisted line has two parts: what the lender pays, and the government’s counterpart share."
          />
          <div className="hgab-fa-cols">
            <div className="hgab-fa-card">
              <h3>Loan and grant proceeds: {bn(T.loan.nep_php)} in the NEP, {bn(T.loan.house_php)} in the House bill</h3>
              <p>
                A lender’s proceeds can only be spent on the project they finance. Cutting them frees no cash for other lines. What the House
                did was give up borrowing room the NEP had set aside for these projects.
              </p>
              <p>
                By lender in the NEP: {lenderList.map((l, i) => <span key={l.name}>{i > 0 ? '; ' : ''}{l.name} <b>{bn(l.nep_php)}</b></span>)}.
                The bill splits proceeds from counterpart, not lender from lender, so there is no House figure by lender.
              </p>
            </div>
            <div className="hgab-fa-card">
              <h3>Government counterpart: {bn(T.gop.nep_php)} in the NEP, {bn(T.gop.house_php)} in the House bill</h3>
              <p>
                The counterpart is the Treasury’s own share: land, taxes, duties and the parts of a project the loan does not cover. This is
                the only part of the cut that frees budget for other lines, {billions(gopCut)} of the {billions(cut)}.
              </p>
              {gopLender && <p>The NEP charges {bn(gopLender.nep_php)} of counterpart across {gopLender.projects} lines.</p>}
            </div>
          </div>
        </section>

        <section className="nep-section hgab-fa-section" aria-labelledby="hgab-fa-years">
          <SectionHead
            headline={
              <span id="hgab-fa-years">
                Every enacted budget since FY2021 carried {Math.round(minShare * 100)}% to {Math.round(maxShare * 100)}% less for these projects than the NEP proposed
              </span>
            }
            dek={`DBM’s own series, one BESF table a year: what the NEP proposed, what the enacted budget carried, and what agencies actually obligated. FY2027 shows the NEP and the House bill.`}
          />
          <ul className="hgab-fa-key" aria-hidden="true">
            <li><i className="is-nep" />NEP</li>
            <li><i className="is-gaa" />Enacted budget (programmed)</li>
            <li><i className="is-actual" />Actual obligations</li>
            <li><i className="is-house" />House bill (FY2027)</li>
          </ul>
          <YearChart house2027={T.all.house_php} />
          <YearTable house2027={T.all.house_php} />
          <WhatThisMeans>
            Actual obligations stayed between {bn(Math.min(...actuals))} and {bn(Math.max(...actuals))} a year whatever the enacted budget said. In FY{y2024.fy} the
            enacted budget carried {bn(y2024.program!.total)} and agencies obligated {bn(y2024.actual!.total)}. The difference came from unprogrammed
            appropriations, released against the loans. The FY2027 NEP put {bn(T.all.nep_php)} in the programmed budget instead, more than
            any year before it; the House bill’s {pct(cut, T.all.nep_php)} cut is smaller than any enacted cut since FY2021, but it leaves
            less standby cover than FY2026 had.
          </WhatThisMeans>
        </section>

        <section className="nep-section hgab-fa-section" aria-labelledby="hgab-fa-ua">
          <SectionHead
            headline={
              <span id="hgab-fa-ua">
                Standby cover: {bn(support2027.php)} for FY2027, against {bn(support2026.php)} in FY2026 and {bn(UNPROGRAMMED_RELEASES_2025_PHP)} actually released in FY2025
              </span>
            }
            dek="“Support to Foreign-Assisted Projects” is a purpose of the unprogrammed appropriations, released only against approved loans. The House kept the NEP’s figure and added nothing."
          />
          <div className="hgab-fa-cols">
            <div className="hgab-fa-card">
              <h3>FY2025: {bn(UNPROGRAMMED_RELEASES_2025_PHP)} released to {UNPROGRAMMED.releases_2025.length} agencies</h3>
              <p>
                The FY2027 NEP lists what was drawn from the purpose in 2025:{' '}
                {UNPROGRAMMED.releases_2025.slice(0, 5).map((r, i) => <span key={r.agency}>{i > 0 ? ', ' : ''}{r.dept_short} <b>{bn(r.php)}</b></span>)}
                {UNPROGRAMMED.releases_2025.length > 5 ? ` and ${UNPROGRAMMED.releases_2025.length - 5} others` : ''}. Another {bn(UNPROGRAMMED.counterpart_releases_2025_php)} came
                from the purpose for the government counterpart.
              </p>
              <p>
                The enacted FY2025 budget carried {bn(y2025.program!.total)} for these projects in its programmed part. With the releases, agencies obligated {bn(y2025.actual!.total)}.
              </p>
            </div>
            <div className="hgab-fa-card">
              <h3>FY2026: {bn(support2026.php)} standby; FY2027: {bn(support2027.php)}</h3>
              <p>
                In FY2026 the enacted budget cut the programmed amount from {bn(y2026.proposed!.total)} to {bn(y2026.program!.total)} and kept {bn(support2026.php)} on standby, with a
                further {bn(UNPROGRAMMED.counterpart_2026_house_php)} the House created for the counterpart.
              </p>
              <p>
                For FY2027 the NEP programmed {bn(T.all.nep_php)} and brought the standby down to {bn(support2027.php)}. The House cut {bn(cut)} from the programmed lines
                and left the standby where it was. The unprogrammed total is {bn(UNPROGRAMMED.totals.find((t) => t.fy === 2027)!.php)} in both documents.
              </p>
            </div>
          </div>
          <WhatThisMeans>
            In FY2024 and FY2025 the projects that lost programmed budget came back through unprogrammed appropriations at the bicameral
            conference. For FY2027 the bill gives them {bn(support2027.php)} of standby against a {bn(cut)} cut, and ranks the purpose first
            among the four it names. Whether the Senate or the bicameral conference restores the lines, or raises the standby, is the thing
            to check in December.
          </WhatThisMeans>
        </section>

        <section className="nep-section hgab-fa-section" aria-labelledby="hgab-fa-depts-years">
          <SectionHead
            headline={<span id="hgab-fa-depts-years">DPWH and DOTr carry most of it, year by year</span>}
            dek="Department rows of the same DBM table: NEP, enacted budget as adjusted, and actual obligations. A dash means the table has no row for that year; 0 means the row shows a dash."
          />
          <DeptYearTable />
        </section>

        <section className="nep-section hgab-fa-section" aria-labelledby="hgab-fa-all">
          <SectionHead
            headline={<span id="hgab-fa-all">Every project: {T.projects} lines, {T.cut} cut</span>}
            dek="Largest cut first. A project is one activity line of the bill, with every loan it names; DPWH lines open their record, the rest open the line in the explorer."
            right={<a className="hgab-cta" href={dataUrl(FAP_CSV_PATH)} download={FAP_CSV_NAME}>Download CSV</a>}
          />
          <ProjectsTable projects={sorted} />
          <Caveats
            items={[
              'Amounts are new appropriations for the year, not spending. Stages are compared, never added.',
              'The enacted-budget column is the programmed budget. Releases from unprogrammed appropriations sit outside it and show up in actual obligations.',
              'DBM’s table reports the enacted budget as adjusted during the year; our extract carries it as enacted. They differ for FY2022 only.',
              'The FY2023, FY2024 and FY2027 editions of the DBM table are scanned images, read by OCR and checked by their row sums.',
              'A new line is one the NEP listed without an amount or did not list; the bill does not say which.',
            ]}
          />
          <HgabDetails>
            <p>
              A foreign-assisted project is every activity the House bill lists under “Foreign-Assisted Project(s)”, with its loan-proceeds and GOP-counterpart rows,
              matched to the NEP line by line (the line-by-line dataset). One DPWH line the matcher left without an NEP side, the Accelerated Bridge Construction
              Project, is taken from the DBM NEP extract by its exact name. In the NEP, the same projects are every line whose seventh P/A/P code digit is 3, under
              Operations or Support to Operations; the two readings agree to the peso.
            </p>
            <p>
              Lenders are the funds the NEP charges each line to (Asian Development Bank, Japan, IBRD, Korea, IFAD, AIIB, China, France, United States). Enacted budgets
              FY2020–FY2026 use the same code mark on the DBM GAA extracts. The DBM series is Table B.13 of each BESF:
            </p>
            <ul className="hgab-fa-codes">
              {BESF_EDITIONS.map((e) => (
                <li key={e.fy}><a href={e.url} target="_blank" rel="noopener noreferrer">BESF {e.fy}</a>, {e.years}{e.ocr ? ' (image-only, read by OCR)' : ''}</li>
              ))}
            </ul>
            <p>
              Unprogrammed appropriations: the FY2027 NEP, Volume III, from page {UNPROGRAMMED.nep_vol_iii_page}{' '}
              (<a href={`${dataUrl(FAP_NEP_VOL_III_PATH)}#page=${UNPROGRAMMED.nep_vol_iii_page}`} target="_blank" rel="noopener noreferrer">open</a>); House Bill 10858,
              Volume I-B, page {UNPROGRAMMED.vol_ib_page}{' '}
              (<a href={`${dataUrl(FAP_VOL_IB_PATH)}#page=${UNPROGRAMMED.vol_ib_page}`} target="_blank" rel="noopener noreferrer">open</a>); the FY2026 figures from the
              People’s Budget Coalition’s tracker of the unprogrammed annex. The bill’s own ranking of the purposes:
            </p>
            <blockquote className="hgab-fa-quote">{UNPROGRAMMED.priority_quote}</blockquote>
            <p>
              This page follows the reading in <a href={PBC_FAP_SECTION.url} target="_blank" rel="noopener noreferrer">{PBC_FAP_SECTION.section}</a> of the{' '}
              {PBC_FAP_SECTION.by}’s “{PBC_FAP_SECTION.title}”, which puts the cut at ₱130.0 billion on a smaller set of lines (it leaves out the
              corporations and the smallest departments); ours is {billions(cut)} on all {T.projects}.
            </p>
            <p>Checks run when the file was built:</p>
            <ul className="hgab-fa-codes">
              {data.checks.map((c) => <li key={c.key}>{c.label}: {c.detail}</li>)}
            </ul>
            <p>Sources:</p>
            <ul className="hgab-fa-codes">
              {data.sources.map((s) => <li key={`${s.key}-${s.path}`}>{s.label}{s.sha256 ? ` (SHA-256 ${s.sha256.slice(0, 12)}…)` : ''}</li>)}
            </ul>
          </HgabDetails>
        </section>

        <section className="nep-section hgab-fa-section" aria-labelledby="hgab-fa-ask">
          <SectionHead headline={<span id="hgab-fa-ask">Three questions for the Senate</span>} />
          <ol className="hgab-fa-questions">
            <li>
              Which of the {T.cut} cut projects will the Senate restore in the programmed budget, and which will it move to unprogrammed appropriations?
            </li>
            <li>
              If the standby stays at {bn(support2027.php)} against a {bn(cut)} cut, which loans will draw late, and what will the commitment fees cost?
            </li>
            <li>
              The counterpart cut of {bn(gopCut)} is the only part that frees budget. Which lines did it pay for?
            </li>
          </ol>
        </section>

        <DisclaimerNotice compact />
      </main>
      <SiteFooter />
    </>
  );
}
