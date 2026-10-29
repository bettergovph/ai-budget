/**
 * `/hgab/2027/multi-purpose` (DPWH menu) — multi-purpose buildings, flood
 * control, BIP, SIPAG and four other lines, from the FY2020 enacted budget to
 * the FY2027 House bill, one bar per budget and stage, on one shared scale.
 *
 * The data is `history.json` (`npm run build:hgab-history`, contract in
 * src/lib/hgab-history.ts). Every figure in the copy is computed from it.
 * Stages are compared, never added; series overlap and are never added either.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { Caveats, DisclaimerNotice, HgabDetails, HgabError, HgabHeader, HgabHero, HgabLoading, WhatThisMeans } from '../components/HgabBits';
import { HistoryBars, HistoryKey } from '../components/HgabHistoryChart';
import { billions, bn, count, fullPeso, type HistoryMode } from '../lib/hgab-history-view';
import { SectionHead } from '../components/shared';
import { loadHgabHistory } from '../lib/hgab';
import { dataUrl } from '../lib/data-url';
import { asOfText } from '../lib/hgab-leaderboard';
import {
  HISTORY_COLUMNS, HISTORY_CSV_NAME, HISTORY_CSV_PATH, HISTORY_DEFINITIONS, HISTORY_SERIES, HISTORY_TITLE, HISTORY_VOL_IA_PATH,
  columnIndex, gaaHistoryHref, listHref, seriesOf,
  type HistoryData, type HistorySeries, type HistorySeriesKey,
} from '../lib/hgab-history';
import '../nep2027.css';
import '../hgab-history.css';

const I = {
  nep2026: columnIndex('nep-2026'),
  gaa2025: columnIndex('gaa-2025'),
  gaa2026: columnIndex('gaa-2026'),
  nep2027: columnIndex('nep-2027'),
  house2027: columnIndex('house-2027'),
};
/** Volume I-B of the House bill (third reading), where BIP's special provision is published. */
const VOL_IB_PATH = 'hgab/2027/pdf/hb10858-3r-vol-ib.pdf';

const cellsOf = (s: HistorySeries, mode: HistoryMode) => (mode === 'php' ? s.php : s.projects);

/** "twice", "1.5 times", "half". */
function ratioText(a: number, b: number): string {
  if (!b) return 'against no amount in';
  const r = a / b;
  if (Math.abs(r - 2) < 0.05) return 'twice';
  if (Math.abs(r - 0.5) < 0.025) return 'half';
  return `${r.toFixed(1)} times`;
}
/** "+104%" / "−7%". */
function deltaText(a: number | null, b: number | null): string | null {
  if (a == null || b == null || b === 0) return null;
  const d = Math.round(((a - b) / b) * 100);
  return d === 0 ? '0%' : `${d > 0 ? '+' : '−'}${Math.abs(d)}%`;
}

/** Columns that get a value on the cap: the largest, the FY2026 NEP and enacted budget, and both FY2027 stages. */
function labelledCols(cells: ReadonlyArray<number | null>): number[] {
  let top = -1;
  cells.forEach((v, i) => { if (v != null && (top < 0 || v > (cells[top] ?? 0))) top = i; });
  return [...new Set([top, I.nep2026, I.gaa2026, I.nep2027, I.house2027])].filter((i) => i >= 0 && (cells[i] ?? 0) > 0);
}

/** The figure line under a card's name: the 2027 House bill against the NEP, else the last budget the line is in. */
function figureLine(s: HistorySeries, mode: HistoryMode): ReactNode {
  if (mode === 'projects' && s.department !== 'DPWH') return 'One program line each year; projects are not counted.';
  const cells = cellsOf(s, mode);
  const fmt = mode === 'php' ? bn : (v: number | null) => `${count(v)} lines`;
  const h = cells[I.house2027];
  const n = cells[I.nep2027];
  if (h != null) {
    const d = deltaText(h, n);
    return (
      <>
        <strong>{fmt(h)}</strong> in the 2027 House bill · {fmt(n)} in the NEP
        {d && <span className={`hgab-hy-delta ${h > (n ?? 0) ? 'is-up' : 'is-down'}`}>{d}</span>}
      </>
    );
  }
  let last = -1;
  cells.forEach((v, i) => { if (v != null) last = i; });
  if (last < 0) return '—';
  return <><strong>{fmt(cells[last])}</strong> in the {HISTORY_COLUMNS[last].label}; no lines in 2027</>;
}

const OVERLAP_NOTE: Partial<Record<HistorySeriesKey, string>> = {
  bip: 'Includes BIP’s multi-purpose and flood lines, which the first two charts also show.',
  sipag: 'Includes SIPAG’s multi-purpose and flood lines, which the first two charts also show.',
  fap: 'These projects sit inside flood control, roads and bridges; they are not extra money.',
};
const EXTRA_NOTE: Partial<Record<HistorySeriesKey, string>> = {
  fap: 'FY2024: the GAA data lists no foreign-assisted DPWH lines. FY2026 NEP, House and Senate figures were not compiled.',
  // verify:hgab checks the two document claims against Volume I-A; docs/hgab-data.md records the first.
  hfep: 'DOH has no other line that pays only for health facilities. Its Quick Response Fund also pays for emergency supplies and staff. The bill does not say what its World Bank health project pays for.',
};

/** "₱3.0B" for the compact lists. */
const bShort = (v: number | null | undefined) => (v == null ? '—' : `₱${(v / 1e9).toFixed(1)}B`);

/**
 * DepEd: what the one line is, and its other school-facility lines in the 2027 House bill (from Volume I-A;
 * the NEP figure only where the House changed it), with the total of all four.
 */
function DepedLines({ s, printed, extras }: { s: HistorySeries; printed?: HistoryData['printed'][number]; extras: HistoryData['extras'] }) {
  const mine = extras.filter((x) => x.series === s.key);
  if (!printed && !mine.length) return null;
  const house = (printed?.total_php ?? 0) + mine.reduce((a, x) => a + (x.house_php ?? 0), 0);
  const nep = (s.php[I.nep2027] ?? 0) + mine.reduce((a, x) => a + (x.nep_php ?? 0), 0);
  return (
    <div className="hgab-hy-extra">
      {printed && (
        <p>
          One line, held by DepEd’s Central Office: {billions(printed.co_php)} in capital spending, {billions(printed.mooe_php)} in
          operating costs. The bill lists it under NCR because the Central Office is there. It does not say which schools get it.
        </p>
      )}
      {mine.length > 0 && (
        <>
          <p>
            DepEd’s other lines for school facilities:{' '}
            {mine.map((x, i) => (
              <span key={x.key}>
                {i > 0 && ' · '}
                {x.plain} <strong>{bShort(x.house_php)}</strong>
                {x.nep_php != null && x.house_php != null && x.nep_php !== x.house_php && <> ({bShort(x.nep_php)} in the NEP)</>}
              </span>
            ))}
            .
          </p>
          <p>All four lines: <strong>{billions(house)}</strong>, {house < nep ? 'down' : 'up'} from {billions(nep)} in the NEP.</p>
        </>
      )}
    </div>
  );
}

/** The card's way into its projects, its other budgets, and what the bill says the line pays for. */
function ListLink({ s, printed }: { s: HistorySeries; printed?: HistoryData['printed'][number] }) {
  const l = s.list2027;
  const def = HISTORY_SERIES.find((d) => d.key === s.key);
  const history = def?.gaaHistory ? (
    <Link to={gaaHistoryHref(def.gaaHistory)}>See this line in every enacted budget, 2020–2026 →</Link>
  ) : null;
  if (!l && !history) return null;
  return (
    <p className="hgab-hy-list">
      {l ? (
        <>
          <Link to={listHref(l)}>
            See the 2027 projects: {l.nep_rows.toLocaleString('en-US')} in the NEP, {l.house_rows.toLocaleString('en-US')} in the House bill →
          </Link>
          {l.unlisted_php > 0 && (
            <span> The list leaves out {billions(l.unlisted_php)} in operating costs, which the budget gives as one amount.</span>
          )}
        </>
      ) : (
        <span className="is-none">No project list: the budget gives this line as one amount. </span>
      )}
      {printed?.provision_page != null && (
        <span className="hgab-hy-list-more">
          <a href={`${dataUrl(HISTORY_VOL_IA_PATH)}#page=${printed.provision_page}`} target="_blank" rel="noopener noreferrer">
            See what the House bill says it pays for →
          </a>
        </span>
      )}
      {history && <span className="hgab-hy-list-more">{history}</span>}
    </p>
  );
}

function ProgramCard({ s, mode, max, printed, extras }: {
  s: HistorySeries; mode: HistoryMode; max: number; printed?: HistoryData['printed'][number]; extras: HistoryData['extras'];
}) {
  const id = `hgab-hy-${s.key}`;
  const uncounted = mode === 'projects' && s.department !== 'DPWH';
  const gaaHistory = HISTORY_SERIES.find((d) => d.key === s.key)?.gaaHistory;
  const title = s.list2027
    ? <Link to={listHref(s.list2027)} title="See the 2027 projects">{s.label}</Link>
    : gaaHistory
      ? <Link to={gaaHistoryHref(gaaHistory)} title="See this line in every enacted budget, 2020–2026">{s.label}</Link>
      : s.label;
  return (
    <article className="hgab-hy-card" aria-labelledby={id}>
      <header className="hgab-hy-card-head">
        <h3 id={id}>{title}{s.department !== 'DPWH' && <span className="hgab-hy-dept">{s.department}</span>}</h3>
        <p className="hgab-hy-fig">{figureLine(s, mode)}</p>
      </header>
      <p className="hgab-hy-plain">{s.plain}</p>
      {uncounted ? (
        <p className="hgab-hy-uncounted">Switch to amounts to see this line.</p>
      ) : (
        <HistoryBars series={s} mode={mode} max={max} labelled={labelledCols(cellsOf(s, mode))} />
      )}
      {(OVERLAP_NOTE[s.key] || EXTRA_NOTE[s.key]) && (
        <p className="hgab-hy-note">{[OVERLAP_NOTE[s.key], EXTRA_NOTE[s.key]].filter(Boolean).join(' ')}</p>
      )}
      {s.key === 'deped' && <DepedLines s={s} printed={printed} extras={extras} />}
      <ListLink s={s} printed={printed} />
    </article>
  );
}

function HistoryTable({ data, mode }: { data: HistoryData; mode: HistoryMode }) {
  const cell = (v: number | null) => (mode === 'php' ? bn(v) : count(v));
  const title = (v: number | null) => (mode === 'php' ? fullPeso(v) : v == null ? 'none' : `${count(v)} project lines`);
  return (
    <div className="nep-table-wrap">
      <table className="nep-table hgab-hy-table">
        <caption className="visually-hidden">{mode === 'php' ? 'Amount' : 'Project lines'} per budget and stage, every line and its parts</caption>
        <thead>
          <tr>
            <th scope="col" className="nep-th-name">Line</th>
            {HISTORY_COLUMNS.map((c) => (
              <th key={c.key} scope="col" className={c.fy >= 2026 ? 'is-stage' : undefined}>
                {c.fy < 2026 ? c.fy : <>{c.fy}<br />{c.stage === 'gaa' ? 'GAA' : c.axis}</>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.series.map((s) => {
            const counted = mode === 'php' || s.department === 'DPWH';
            return [
              <tr key={s.key} className="is-series">
                <th scope="row">{s.label}</th>
                {HISTORY_COLUMNS.map((c, i) => {
                  const v = counted ? cellsOf(s, mode)[i] : null;
                  return <td key={c.key} title={title(v)}>{cell(v)}</td>;
                })}
              </tr>,
              ...(s.parts.length > 1 ? s.parts : []).map((p) => (
                <tr key={`${s.key}-${p.key}`} className="is-part">
                  <th scope="row">{p.label}</th>
                  {HISTORY_COLUMNS.map((c, i) => {
                    const v = mode === 'php' ? p.php[i] : p.projects[i];
                    return <td key={c.key} title={title(v)}>{cell(v)}</td>;
                  })}
                </tr>
              )),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function HgabHistory() {
  const [data, setData] = useState<HistoryData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<HistoryMode>('php');

  useEffect(() => {
    let live = true;
    loadHgabHistory()
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setErr(String(e?.message || e)); });
    return () => { live = false; };
  }, []);

  /** One scale for every card in the current mode. */
  const max = useMemo(() => {
    if (!data) return 1;
    let m = 0;
    for (const s of data.series) {
      if (mode === 'projects' && s.department !== 'DPWH') continue;
      for (const v of cellsOf(s, mode)) if (v != null && v > m) m = v;
    }
    return m || 1;
  }, [data, mode]);

  if (err) return <HgabError message={err} />;
  if (!data) return <HgabLoading what="the budget history" />;

  const S = (k: HistorySeriesKey) => seriesOf(data, k);
  const mpb = S('mpb');
  const flood = S('flood');
  const bip = S('bip');
  const fap = S('fap');
  const deped = S('deped');
  const hfep = S('hfep');
  const v = (s: HistorySeries, i: number) => s.php[i] ?? 0;
  const floodAllForeign26 = flood.php[I.gaa2026] != null && flood.foreign_php[I.gaa2026] === flood.php[I.gaa2026];
  const bipMpbShare = (i: number) => (bip.php[i] ? Math.round((v(mpb, i) / bip.php[i]!) * 100) : null);
  const card = (k: HistorySeriesKey) => (
    <ProgramCard key={k} s={S(k)} mode={mode} max={max} printed={data.printed.find((p) => p.series === k)} extras={data.extras ?? []} />
  );
  const change = (s: HistorySeries) => v(s, I.house2027) - v(s, I.nep2027);
  const moreLess = (d: number) => (d === 0 ? 'the same amount' : `${billions(Math.abs(d))} ${d > 0 ? 'more' : 'less'}`);
  const sipagGone27 = S('sipag').php[I.nep2027] == null && S('sipag').php[I.house2027] == null;
  const changeText = (s: HistorySeries, what: string) => {
    const d = change(s);
    if (d === 0) return `leaves ${what} unchanged`;
    return `${d > 0 ? 'adds' : 'cuts'} ${billions(Math.abs(d))} ${d > 0 ? 'to' : 'from'} ${what}`;
  };
  /** Two changes in one clause; one verb when both go the same way ("cuts ₱3.1 billion from A and ₱4.5 billion from B"). */
  const pairText = (a: HistorySeries, aWhat: string, b: HistorySeries, bWhat: string) => {
    const da = change(a);
    const db = change(b);
    if (da !== 0 && db !== 0 && Math.sign(da) === Math.sign(db)) {
      const prep = da > 0 ? 'to' : 'from';
      return `${da > 0 ? 'adds' : 'cuts'} ${billions(Math.abs(da))} ${prep} ${aWhat} and ${billions(Math.abs(db))} ${prep} ${bWhat}`;
    }
    return `${changeText(a, aWhat)} and ${changeText(b, bWhat)}`;
  };

  return (
    <>
      <HgabHeader crumb={HISTORY_TITLE} />
      <HgabHero
        compact
        crumb={HISTORY_TITLE}
        title={
          <>
            Multi-purpose buildings: {billions(v(mpb, I.house2027))} in the 2027 House bill,{' '}
            {ratioText(v(mpb, I.house2027), v(mpb, I.nep2027))} the NEP’s {billions(v(mpb, I.nep2027))}
          </>
        }
        dek={
          <>
            School facilities get {billions(v(deped, I.house2027))} and health facilities {billions(v(hfep, I.house2027))}
            {change(deped) < 0 && change(hfep) < 0 ? ', both less than in the NEP' : ''}. Flood control gets{' '}
            {billions(v(flood, I.house2027))}, {v(flood, I.house2027) < v(flood, I.nep2027) ? 'down' : 'up'} from{' '}
            {billions(v(flood, I.nep2027))}. In the FY2026 enacted budget, flood control had {billions(v(flood, I.gaa2026))}
            {floodAllForeign26 ? ', all foreign-assisted,' : ''} against {billions(v(mpb, I.gaa2026))} for multi-purpose buildings.
          </>
        }
        note={
          <>
            Each bar is one budget at one stage: the NEP, the House and Senate bills, or the enacted budget (GAA). The NEP is
            the budget the President submits to Congress each August. Amounts are published allocations, not spending.{' '}
            {asOfText(data)}.
          </>
        }
      />
      <main className="nep-main hgab-hy-main">
        <div className="hgab-hy-controls">
          <div className="hgab-ds-dims hgab-hy-mode" role="group" aria-label="Show">
            <button type="button" aria-pressed={mode === 'php'} onClick={() => setMode('php')}>Amounts</button>
            <button type="button" aria-pressed={mode === 'projects'} onClick={() => setMode('projects')}>Number of projects</button>
          </div>
          <HistoryKey />
        </div>

        <section className="nep-section hgab-hy-section" aria-labelledby="hgab-hy-mpb-flood">
          <SectionHead
            headline={
              <span id="hgab-hy-mpb-flood">
                FY2025 to FY2026: flood control {bn(flood.php[I.gaa2025])} to {bn(flood.php[I.gaa2026])}, multi-purpose
                buildings {bn(mpb.php[I.gaa2025])} to {bn(mpb.php[I.gaa2026])}
              </span>
            }
            dek="Both on the same scale. Flood control includes the flood lines of BIP, SIPAG and the Local Program."
          />
          <div className="hgab-hy-grid">{card('mpb')}{card('flood')}</div>
          {floodAllForeign26 && (
            <WhatThisMeans>
              The FY2026 enacted budget has no locally funded flood control; all {billions(v(flood, I.gaa2026))} is for
              foreign-assisted projects.
            </WhatThisMeans>
          )}
        </section>

        <section className="nep-section hgab-hy-section" aria-labelledby="hgab-hy-bip">
          <SectionHead
            headline={<span id="hgab-hy-bip">BIP: {bn(bip.php[I.house2027])} in the House bill, up from {bn(bip.php[I.nep2027])} in the NEP</span>}
            dek={
              <>
                Multi-purpose buildings are {bipMpbShare(I.house2027)}% of BIP in the House bill and {bipMpbShare(I.nep2027)}% in the NEP.
                {sipagGone27 ? ' SIPAG, BIP’s sister set of lines, has none in 2027.' : ''}
              </>
            }
          />
          <div className="hgab-hy-defs">
            {HISTORY_DEFINITIONS.map((d) => (
              <div key={d.key} className="hgab-hy-def" id={`what-is-${d.key}`}>
                <h3><abbr title={d.name}>{d.term}</abbr> <span>{d.name}</span></h3>
                {d.plain.map((p) => <p key={p}>{p}</p>)}
                {d.quote && (
                  <HgabDetails title="As published">
                    <blockquote className="hgab-hy-quote">{d.quote.text}</blockquote>
                    <p className="hgab-hy-where">
                      {d.quote.where}{' '}
                      <a href={`${dataUrl(VOL_IB_PATH)}#page=${d.quote.page}`} target="_blank" rel="noopener noreferrer">Open page {d.quote.page}</a>.
                    </p>
                  </HgabDetails>
                )}
              </div>
            ))}
          </div>
          <div className="hgab-hy-grid">{card('bip')}{card('sipag')}</div>
        </section>

        <section className="nep-section hgab-hy-section" aria-labelledby="hgab-hy-scale">
          <SectionHead
            headline={
              <span id="hgab-hy-scale">
                In the House bill: multi-purpose buildings {bn(mpb.php[I.house2027])}, school facilities {bn(deped.php[I.house2027])},
                health facilities {bn(hfep.php[I.house2027])}
              </span>
            }
            dek="DepEd’s and DOH’s lines, on the same scale as the DPWH lines. Each is one program line, so projects are not counted."
          />
          <div className="hgab-hy-grid">{card('deped')}{card('hfep')}</div>
          <WhatThisMeans>
            Against the NEP, the House bill {changeText(mpb, 'multi-purpose buildings')}. It {pairText(deped, 'school facilities', hfep, 'health facilities')}.
          </WhatThisMeans>
        </section>

        <section className="nep-section hgab-hy-section" aria-labelledby="hgab-hy-other">
          <SectionHead
            headline={<span id="hgab-hy-other">Foreign-assisted projects: {bn(fap.php[I.house2027])} in the House bill, down from {bn(fap.php[I.nep2027])} in the NEP</span>}
            dek="Foreign loans and grants, with the government’s share; and the Local Program, which carried district projects before BIP and SIPAG."
          />
          <div className="hgab-hy-grid">{card('fap')}{card('local_roads')}</div>
          <WhatThisMeans>
            Against the NEP, the House bill has {moreLess(change(fap))} for foreign-assisted projects and {moreLess(change(bip))} for BIP.
          </WhatThisMeans>
        </section>

        <section className="nep-section hgab-hy-section" aria-labelledby="hgab-hy-table">
          <SectionHead
            headline={<span id="hgab-hy-table">Every figure: {HISTORY_SERIES.length} lines, {HISTORY_COLUMNS.length} budgets and stages</span>}
            dek="A dash means no line with an amount in that budget, never zero."
            right={
              <a className="hgab-cta" href={dataUrl(HISTORY_CSV_PATH)} download={HISTORY_CSV_NAME}>Download CSV</a>
            }
          />
          <HistoryTable data={data} mode={mode} />
          <Caveats
            items={[
              'Bars compare stages of the same budget; they are never added together.',
              'Some lines overlap. BIP and SIPAG include their own multi-purpose and flood lines; foreign-assisted projects sit inside flood control and roads.',
              'Amounts are what each budget allocates for that year, not what was spent.',
              'The FY2026 NEP, House bill and Senate bill figures were compiled by the People’s Budget Coalition.',
              'The DepEd and DOH figures are whole program lines. The Health Facilities page counts only facility projects, so its totals are a little smaller.',
            ]}
          />
          <HgabDetails>
            <p>
              Each line is a set of DPWH (department 18), DepEd (07) or DOH (13) program codes, summed per budget. Project lines are the
              codes with an amount (enacted budgets) or the lines the House-bill comparison lists (2027); the FY2026 stages carry no project list.
            </p>
            <ul className="hgab-hy-codes">
              {HISTORY_SERIES.map((s) => (
                <li key={s.key}>
                  <strong>{s.label}:</strong>{' '}
                  {s.parts.map((p) => `${p.label} ${p.foreign ? '(seventh code digit 3, DPWH Operations)' : p.codes ? `(${p.codes.prefixes.join(', ')})` : ''}`).join('; ')}
                </li>
              ))}
            </ul>
            <p>Published in Volume I-A of the House bill (third reading):</p>
            <ul className="hgab-hy-codes">
              {data.printed.map((p) => (
                <li key={p.series}>
                  {p.label}: MOOE {fullPeso(p.mooe_php)} + capital outlays {fullPeso(p.co_php)} = {fullPeso(p.total_php)}{' '}
                  (<a href={`${dataUrl(HISTORY_VOL_IA_PATH)}#page=${p.page}`} target="_blank" rel="noopener noreferrer">page {p.page}</a>)
                </li>
              ))}
            </ul>
            {data.series.filter((s) => s.list2027?.nep_list_gap_php).map((s) => (
              <p key={`gap-${s.key}`}>
                {s.label}: the NEP list’s lines add up to {fullPeso(s.list2027!.nep_list_gap_php)} less than the total published on it,
                an error in the published list the source documents; the project list shows the lines as published.
              </p>
            ))}
            <p>Checks run when the file was built:</p>
            <ul className="hgab-hy-codes">
              {data.checks.map((c) => <li key={c.key}>{c.label}: {c.detail}</li>)}
            </ul>
            <p>Sources:</p>
            <ul className="hgab-hy-codes">
              {data.sources.map((s) => <li key={`${s.key}-${s.path}`}>{s.label}{s.sha256 ? ` (SHA-256 ${s.sha256.slice(0, 12)}…)` : ''}</li>)}
            </ul>
          </HgabDetails>
        </section>

        <DisclaimerNotice compact />
      </main>
      <SiteFooter />
    </>
  );
}
