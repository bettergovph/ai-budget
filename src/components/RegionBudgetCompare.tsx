/**
 * One indicator beside the budget assigned to each region (Indicators section). Used full-size on
 * `/indicators/budget-by-region` and compact on every indicator's page.
 *
 * With a `need` (poor people, children under 15, births, hectares of palay) it pairs each region's share of
 * that need with its share of the budget, and gives the budget per unit of need. Without one, it sets the
 * indicator's value beside the budget per person. The caller owns the state (URL or local).
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  BUDGET_BY_REGION_ROOT, BUDGET_YEARS, CENTRAL_LABEL, CENTRAL_PLAIN, NATIONWIDE_LABEL, NATIONWIDE_PLAIN, REGION_BUDGET_CSV_NAME, shareOf,
  type BudgetDepartment, type BudgetRegion, type BudgetYear, type RegionBudgetFile,
} from '../lib/budget-regions';
import { THEMES, formatIndicator, formatSigned, indicatorPath, type IndicatorDef } from '../lib/indicators';
import { COMPARABLE, type CompareState, type SortKey } from '../lib/region-compare';
import { dataUrl } from '../lib/data-url';

const peso = (v: number) => `₱${Math.round(v).toLocaleString('en-PH')}`;
const big = (v: number) => (v >= 1e12 ? `₱${(v / 1e12).toFixed(2)} trillion` : `₱${(v / 1e9).toFixed(1)} billion`);
const bigShort = (v: number) => (v >= 1e12 ? `₱${(v / 1e12).toFixed(2)}T` : `₱${(v / 1e9).toFixed(1)}B`);
const pct = (v: number, d = 1) => `${v.toFixed(d)}%`;
const pts = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)} pts`;
const yearLabel = (y: BudgetYear) => BUDGET_YEARS.find((b) => b.key === y)!.label;

interface Row {
  r: BudgetRegion; v: number | null; need: number | null; php: number; base: number;
  perPerson: number; perNeed: number | null; shNeed: number | null; shPop: number; shBudget: number;
}

function useRows(rb: RegionBudgetFile, def: IndicatorDef, s: CompareState): Row[] {
  return useMemo(() => {
    const other: BudgetYear = BUDGET_YEARS.find((y) => y.key === s.year)!.compare;
    const by = rb.budget[s.year][s.dept] ?? {};
    const tot = Object.values(by).reduce((a, v) => a + v, 0);
    const needOf = (r: BudgetRegion) => (def.need ? r.needs[def.need.measure] ?? null : null);
    const needT = rb.regions.reduce((a, r) => a + (needOf(r) ?? 0), 0);
    const popT = rb.regions.reduce((a, r) => a + r.population_2024, 0);
    const rows = rb.regions.map((r): Row => {
      const php = by[r.key] ?? 0, need = needOf(r);
      return {
        r, v: r.values[def.id] ?? null, need, php, base: rb.budget[other][s.dept]?.[r.key] ?? 0,
        perPerson: php / r.population_2024, perNeed: need ? php / need : null,
        shNeed: need != null && needT ? shareOf(need, needT) : null, shPop: shareOf(r.population_2024, popT), shBudget: shareOf(php, tot),
      };
    });
    const per = (x: Row) => (s.per === 'need' && x.perNeed != null ? x.perNeed : x.perPerson);
    return rows.sort((a, b) => {
      if (s.sort === 'per') return per(b) - per(a);
      if (s.sort === 'gap') return (b.shBudget - (b.shNeed ?? b.shPop)) - (a.shBudget - (a.shNeed ?? a.shPop));
      if (s.sort === 'budget') return b.php - a.php;
      if (a.v == null) return 1;
      if (b.v == null) return -1;
      return b.v - a.v;
    });
  }, [rb, def, s]);
}

function fmtV(def: IndicatorDef, v: number | null) {
  return def.scale === 'diverging' ? formatSigned(v, def) : formatIndicator(v, def, { compact: true });
}

export function CompareControls({ rb, def, s, onChange, onIndicator }: {
  rb: RegionBudgetFile; def: IndicatorDef; s: CompareState;
  onChange: (patch: Partial<CompareState>) => void;
  /** Present on the full page: the indicator itself can be switched. */
  onIndicator?: (id: string) => void;
}) {
  const choices = rb.departments.filter((d) => d.id === 'all' || d.regional[s.year] >= 1e9);
  return (
    <div className="bpr-controls">
      {onIndicator && (
        <label className="ind-select">
          <span>Indicator</span>
          <select value={def.id} onChange={(e) => onIndicator(e.target.value)}>
            {THEMES.filter((t) => t.key !== 'budget').map((t) => (
              <optgroup key={t.key} label={t.title}>
                {COMPARABLE.filter((d) => d.theme === t.key).map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
      )}
      <label className="ind-select">
        <span>Budget of</span>
        <select value={s.dept} onChange={(e) => onChange({ dept: e.target.value })}>
          {choices.map((d) => <option key={d.id} value={d.id}>{d.short}{d.id === 'all' ? '' : ` (${Math.round(shareOf(d.regional[s.year], d.total[s.year]))}% in regions)`}</option>)}
        </select>
      </label>
      <div className="ind-themes" role="group" aria-label="Budget">
        {BUDGET_YEARS.map((y) => <button key={y.key} type="button" aria-pressed={y.key === s.year} className={y.key === s.year ? 'is-on' : undefined} onClick={() => onChange({ year: y.key })}>{y.label}</button>)}
      </div>
      {def.need && (
        <div className="ind-themes" role="group" aria-label="Show">
          <button type="button" aria-pressed={s.per === 'need'} className={s.per === 'need' ? 'is-on' : undefined} onClick={() => onChange({ per: 'need' })}>Per {def.need.one}</button>
          <button type="button" aria-pressed={s.per === 'person'} className={s.per === 'person' ? 'is-on' : undefined} onClick={() => onChange({ per: 'person' })}>Per person</button>
        </div>
      )}
      <label className="ind-select">
        <span>Order by</span>
        <select value={s.sort} onChange={(e) => onChange({ sort: e.target.value as SortKey })}>
          <option value="indicator">{def.short}, highest first</option>
          <option value="per">Budget {s.per === 'need' && def.need ? `per ${def.need.one}` : 'per person'}, highest first</option>
          <option value="gap">Budget share minus share of {def.need ? def.need.many : 'people'}</option>
          <option value="budget">Budget, largest first</option>
        </select>
      </label>
    </div>
  );
}

function DeptNote({ dept, year, rb }: { dept: BudgetDepartment; year: BudgetYear; rb: RegionBudgetFile }) {
  const share = shareOf(dept.regional[year], dept.total[year]);
  const barmmZero = dept.id !== 'all' && !(rb.budget[year][dept.id]?.BARMM) && (rb.budget[year].all.BARMM ?? 0) > 0;
  if ((dept.id === 'all' || share >= 50) && !barmmZero) return null;
  return (
    <p className="bpr-warn">
      {dept.id !== 'all' && share < 50 && (
        <>Only {pct(share, 0)} of {dept.short}’s budget is assigned to a region; the rest is managed by its central office,
        so these regional figures leave most of it out. </>
      )}
      {dept.id === '18' && <>For DPWH, the <Link to={indicatorPath('dpwh-house-per-person')}>projects placed by location</Link> and <Link to={indicatorPath('dpwh-contracts-per-person')}>contracts placed by GPS</Link> show far more of it, by province. </>}
      {barmmZero && <>BARMM shows ₱0 because it runs these services itself, paid from its own block grant; choose “All departments” to see BARMM’s whole budget.</>}
    </p>
  );
}

/** The whole budget in three parts: the 18 regions, the central offices and the nationwide items. */
function WholeBar({ dept, year }: { dept: BudgetDepartment; year: BudgetYear }) {
  const parts = [
    { key: 'regions', label: 'The 18 regions', php: dept.regional[year], cls: 'is-regions' },
    { key: 'central', label: CENTRAL_LABEL, php: dept.central[year], cls: 'is-central' },
    { key: 'nationwide', label: NATIONWIDE_LABEL, php: dept.nationwide[year], cls: 'is-nationwide' },
  ].filter((p) => p.php > 0);
  const whole = dept.total[year];
  return (
    <figure className="bpr-whole">
      <figcaption>Where {dept.id === 'all' ? 'the whole budget' : `${dept.short}’s budget`} goes, {big(whole)}</figcaption>
      <div className="bpr-whole-bar" role="img" aria-label={parts.map((p) => `${p.label} ${pct(shareOf(p.php, whole))}`).join(', ')}>
        {parts.map((p) => <span key={p.key} className={`bpr-whole-seg ${p.cls}`} style={{ width: `${shareOf(p.php, whole)}%` }} />)}
      </div>
      <ul className="bpr-whole-key">
        {parts.map((p) => <li key={p.key}><i className={`bpr-whole-sw ${p.cls}`} />{p.label} <strong>{bigShort(p.php)}</strong> <span>{pct(shareOf(p.php, whole))}</span></li>)}
      </ul>
    </figure>
  );
}

/** The two rows outside the regions, so every peso of the budget is on the list. */
function OutsideRows({ rb, dept, year, popT }: { rb: RegionBudgetFile; dept: BudgetDepartment; year: BudgetYear; popT: number }) {
  const top = dept.id === 'all'
    ? rb.departments.filter((d) => d.id !== 'all' && d.central[year] > 0).sort((a, b) => b.central[year] - a.central[year]).slice(0, 6)
    : [];
  const rowsOut = [
    { key: 'central', label: CENTRAL_LABEL, plain: CENTRAL_PLAIN, php: dept.central[year] },
    { key: 'nationwide', label: NATIONWIDE_LABEL, plain: NATIONWIDE_PLAIN, php: dept.nationwide[year] },
  ].filter((r) => r.php !== 0);
  if (!rowsOut.length) return null;
  return (
    <div className="bpr-outside">
      <p className="bpr-outside-h">Outside the 18 regions</p>
      <ol className="bpr-rows">
        {rowsOut.map((r) => (
          <li key={r.key} className="bpr-row is-outside">
            <span className="bpr-name"><strong>{r.label}</strong> <span>{r.plain}</span>
              {r.key === 'central' && top.length > 0 && (
                <span className="bpr-outside-top">Largest: {top.map((d) => `${d.short} ${bigShort(d.central[year])}`).join(' · ')}</span>
              )}
            </span>
            <span className="bpr-pov">{pct(shareOf(r.php, dept.total[year]))} of the whole</span>
            <span className="bpr-bars"><span className="bpr-line"><span className={`bpr-bar is-${r.key}`} style={{ width: `${shareOf(r.php, dept.total[year])}%` }} /><span className="bpr-val">{bigShort(r.php)}</span></span></span>
            <span className="bpr-per">{peso(r.php / popT)}<small>per person if spread evenly</small></span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Bars({ rows, def, s }: { rows: Row[]; def: IndicatorDef; s: CompareState }) {
  const perVal = (x: Row) => (s.per === 'need' && x.perNeed != null ? x.perNeed : x.perPerson);
  const perWord = s.per === 'need' && def.need ? `per ${def.need.one}` : 'per person';
  if (def.need) {
    const max = Math.max(...rows.flatMap((x) => [x.shNeed ?? 0, x.shBudget]), 1);
    return (
      <figure className="bpr-fig">
        <div className="bpr-legend" aria-hidden="true">
          <span><i className="bpr-key is-poor" />Share of the country’s {def.need.many}</span>
          <span><i className="bpr-key is-budget" />Share of the budget assigned to regions</span>
        </div>
        <ol className="bpr-rows">
          {rows.map((x) => (
            <li key={x.r.key} className="bpr-row">
              <span className="bpr-name"><strong>{x.r.label}</strong> <span>{x.r.plain}</span></span>
              <span className="bpr-pov" title={def.title}>{fmtV(def, x.v)}</span>
              <span className="bpr-bars">
                <span className="bpr-line"><span className="bpr-bar is-poor" style={{ width: `${((x.shNeed ?? 0) / max) * 100}%` }} /><span className="bpr-val">{x.shNeed == null ? 'no figure' : pct(x.shNeed)}</span></span>
                <span className="bpr-line"><span className="bpr-bar is-budget" style={{ width: `${(x.shBudget / max) * 100}%` }} /><span className="bpr-val">{pct(x.shBudget)}</span></span>
              </span>
              <span className="bpr-per">{x.need == null && s.per === 'need' ? '—' : peso(perVal(x))}<small>{perWord}</small></span>
            </li>
          ))}
        </ol>
        <figcaption className="ind-map-note">
          Each pair compares a region’s share of the country’s {def.need.many} with its share of the budget assigned to
          regions. A longer budget bar means the region gets a larger share of the budget than of the {def.need.many}.
        </figcaption>
      </figure>
    );
  }
  const vmax = Math.max(...rows.map((x) => Math.abs(x.v ?? 0)), 1e-9), pmax = Math.max(...rows.map((x) => x.perPerson), 1);
  return (
    <figure className="bpr-fig">
      <div className="bpr-legend" aria-hidden="true">
        <span><i className="bpr-key is-poor" />{def.title}</span>
        <span><i className="bpr-key is-budget" />Budget per person</span>
      </div>
      <ol className="bpr-rows">
        {rows.map((x) => (
          <li key={x.r.key} className="bpr-row is-two">
            <span className="bpr-name"><strong>{x.r.label}</strong> <span>{x.r.plain}</span></span>
            <span className="bpr-line"><span className={`bpr-bar is-poor${(x.v ?? 0) < 0 ? ' is-neg' : ''}`} style={{ width: `${(Math.abs(x.v ?? 0) / vmax) * 100}%` }} /><span className="bpr-val">{fmtV(def, x.v)}</span></span>
            <span className="bpr-line"><span className="bpr-bar is-budget" style={{ width: `${(x.perPerson / pmax) * 100}%` }} /><span className="bpr-val">{peso(x.perPerson)}</span></span>
          </li>
        ))}
      </ol>
      <figcaption className="ind-map-note">
        Left: the indicator for each region, from its provinces. Right: the budget assigned to the region, per person.
      </figcaption>
    </figure>
  );
}

function Scatter({ rows, def, s }: { rows: Row[]; def: IndicatorDef; s: CompareState }) {
  const W = 720, H = 400, M = { l: 78, r: 24, t: 14, b: 46 };
  const pts2 = rows.filter((x) => x.v != null && (s.per === 'person' || x.perNeed != null))
    .map((x) => ({ x: x.v!, y: s.per === 'need' && x.perNeed != null ? x.perNeed : x.perPerson, r: x.r }));
  if (pts2.length < 3) return null;
  const xs = pts2.map((p) => p.x), ys = pts2.map((p) => p.y);
  let x0 = Math.min(...xs), x1 = Math.max(...xs);
  const pad = (x1 - x0) * 0.08 || 1;
  x0 = x0 >= 0 && x0 - pad < 0 ? 0 : x0 - pad; x1 += pad;
  const y1 = Math.max(...ys) * 1.1 || 1;
  const sx = (v: number) => M.l + ((v - x0) / (x1 - x0)) * (W - M.l - M.r), sy = (v: number) => H - M.b - (v / y1) * (H - M.t - M.b);
  const tick = (lo: number, hi: number) => {
    const span = hi - lo || 1, p = 10 ** Math.floor(Math.log10(span / 5));
    const st = [1, 2, 2.5, 5, 10].map((m) => m * p).find((q) => span / q <= 6)!;
    const out: number[] = []; for (let t = Math.ceil(lo / st) * st; t <= hi + 1e-9; t += st) out.push(Number(t.toFixed(10)));
    return out;
  };
  const perWord = s.per === 'need' && def.need ? `per ${def.need.one}` : 'per person';
  return (
    <figure className="ind-scatter">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Budget ${perWord} against ${def.short}, ${pts2.length} regions.`}>
        {tick(0, y1).map((t) => <g key={`y${t}`} className="ind-scatter-grid"><line x1={M.l} x2={W - M.r} y1={sy(t)} y2={sy(t)} /><text x={M.l - 8} y={sy(t)} dy="0.32em" textAnchor="end">{peso(t)}</text></g>)}
        {tick(x0, x1).map((t) => <g key={`x${t}`} className="ind-scatter-grid"><line y1={M.t} y2={H - M.b} x1={sx(t)} x2={sx(t)} /><text y={H - M.b + 18} x={sx(t)} textAnchor="middle">{fmtV(def, t)}</text></g>)}
        {x0 < 0 && x1 > 0 && <line className="ind-scatter-zero" y1={M.t} y2={H - M.b} x1={sx(0)} x2={sx(0)} />}
        <text className="ind-scatter-axis" x={(M.l + W - M.r) / 2} y={H - 8} textAnchor="middle">{def.title}</text>
        <text className="ind-scatter-axis" transform={`translate(16 ${(M.t + H - M.b) / 2}) rotate(-90)`} textAnchor="middle">Budget {perWord}</text>
        {pts2.map((p, i) => {
          const cx = sx(p.x), cy = sy(p.y);
          const crowded = pts2.some((o, j) => j !== i && Math.abs(sx(o.x) - cx - 14) < 18 && Math.abs(sy(o.y) - cy) < 10);
          const left = cx > W - M.r - 80 || crowded;
          return (
            <g key={p.r.key}>
              <circle className="ind-scatter-dot" cx={cx} cy={cy} r={5}><title>{`${p.r.label} (${p.r.plain}): ${fmtV(def, p.x)}, ${peso(p.y)} ${perWord}`}</title></circle>
              <text className="bpr-dotlabel" x={left ? cx - 7 : cx + 7} y={cy} dy="0.32em" textAnchor={left ? 'end' : 'start'}>{p.r.label.replace('Region ', '')}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="ind-scatter-cap">One dot per region; hover a dot for its figures. Two figures moving together does not mean one causes the other.</figcaption>
    </figure>
  );
}

function Table({ rows, def, s, rb, dept }: { rows: Row[]; def: IndicatorDef; s: CompareState; rb: RegionBudgetFile; dept: BudgetDepartment }) {
  const cfg = BUDGET_YEARS.find((y) => y.key === s.year)!;
  const whole = dept.total[s.year];
  const changeOf = (now: number, then: number) => {
    const ch = cfg.direction === 'from' ? now - then : then - now;
    return `${ch >= 0 ? '+' : '−'}${bigShort(Math.abs(ch))}`;
  };
  const other = BUDGET_YEARS.find((y) => y.key === cfg.compare)!;
  const csv = `${dataUrl(rb.csv.path)}?v=${rb.csv.sha256.slice(0, 12)}`;
  const tot = rows.reduce((a, x) => a + x.php, 0), popT = rows.reduce((a, x) => a + x.r.population_2024, 0);
  const needT = rows.reduce((a, x) => a + (x.need ?? 0), 0);
  return (
    <section className="ind-section" aria-labelledby="bpr-table-h">
      <div className="ind-section-head">
        <h2 id="bpr-table-h">Every region: {def.short} and {dept.short}, {yearLabel(s.year)}</h2>
        <a className="ind-download" href={csv} download={REGION_BUDGET_CSV_NAME}>Download the budget by region and department (CSV)</a>
      </div>
      <div className="ind-table-scroll">
        <table className="ind-table">
          <thead>
            <tr>
              <th scope="col">Region</th>
              <th scope="col" className="is-num">{def.short}</th>
              {def.need && <th scope="col" className="is-num">{def.need.many[0].toUpperCase() + def.need.many.slice(1)}</th>}
              <th scope="col" className="is-num">Budget</th>
              <th scope="col" className="is-num">Per person</th>
              {def.need && <th scope="col" className="is-num">Per {def.need.one}</th>}
              <th scope="col" className="is-num">Share of people</th>
              {def.need && <th scope="col" className="is-num">Share of {def.need.many}</th>}
              <th scope="col" className="is-num">Share of the regions’ budget</th>
              <th scope="col" className="is-num">Share of the whole budget</th>
              <th scope="col" className="is-num">{cfg.direction === 'from' ? `Change from the ${other.label}` : `Change to the ${other.label}`}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => {
              const ch = cfg.direction === 'from' ? x.php - x.base : x.base - x.php;
              return (
                <tr key={x.r.key}>
                  <th scope="row">{x.r.label} <span className="ind-region">{x.r.plain}</span></th>
                  <td className="is-num ind-strong">{fmtV(def, x.v)}</td>
                  {def.need && <td className="is-num">{x.need?.toLocaleString('en-PH') ?? '—'}</td>}
                  <td className="is-num">{bigShort(x.php)}</td>
                  <td className="is-num">{peso(x.perPerson)}</td>
                  {def.need && <td className="is-num">{x.perNeed == null ? '—' : peso(x.perNeed)}</td>}
                  <td className="is-num ind-muted">{pct(x.shPop)}</td>
                  {def.need && <td className="is-num">{x.shNeed == null ? '—' : pct(x.shNeed)}</td>}
                  <td className="is-num">{pct(x.shBudget)} <span className="ind-muted">({pts(x.shBudget - (x.shNeed ?? x.shPop))})</span></td>
                  <td className="is-num ind-muted">{pct(shareOf(x.php, whole))}</td>
                  <td className="is-num ind-muted">{x.base ? `${ch >= 0 ? '+' : '−'}${bigShort(Math.abs(ch))}` : '—'}</td>
                </tr>
              );
            })}
            <tr className="is-subtotal">
              <th scope="row">All 18 regions</th>
              <td />
              {def.need && <td className="is-num">{needT.toLocaleString('en-PH')}</td>}
              <td className="is-num">{bigShort(tot)}</td>
              <td className="is-num">{peso(tot / popT)}</td>
              {def.need && <td className="is-num">{needT ? peso(tot / needT) : '—'}</td>}
              <td className="is-num">100%</td>
              {def.need && <td className="is-num">100%</td>}
              <td className="is-num">100%</td>
              <td className="is-num">{pct(shareOf(tot, whole))}</td>
              <td className="is-num ind-muted">{changeOf(tot, rows.reduce((a, x) => a + x.base, 0))}</td>
            </tr>
            {([['central', CENTRAL_LABEL, CENTRAL_PLAIN], ['nationwide', NATIONWIDE_LABEL, NATIONWIDE_PLAIN]] as const).map(([k, label, plain]) => {
              const now = dept[k][s.year], then = dept[k][cfg.compare];
              if (!now && !then) return null;
              return (
                <tr key={k} className="is-outside">
                  <th scope="row">{label} <span className="ind-region">{plain}</span></th>
                  <td className="is-num ind-muted">—</td>
                  {def.need && <td />}
                  <td className="is-num">{bigShort(now)}</td>
                  <td className="is-num ind-muted" title="Spread evenly over everyone in the Philippines">{peso(now / popT)}*</td>
                  {def.need && <td />}
                  <td />
                  {def.need && <td />}
                  <td className="is-num ind-muted">—</td>
                  <td className="is-num">{pct(shareOf(now, whole))}</td>
                  <td className="is-num ind-muted">{changeOf(now, then)}</td>
                </tr>
              );
            })}
            <tr className="is-overall">
              <th scope="row">Whole budget{dept.id === 'all' ? '' : ` of ${dept.short}`}</th>
              <td />
              {def.need && <td />}
              <td className="is-num">{bigShort(whole)}</td>
              <td className="is-num">{peso(whole / popT)}*</td>
              {def.need && <td />}
              <td />
              {def.need && <td />}
              <td />
              <td className="is-num">100%</td>
              <td className="is-num ind-muted">{changeOf(whole, dept.total[cfg.compare])}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="ind-footnote">
        * Spread evenly over everyone in the Philippines; these budgets are in no one region. “(+x pts)” is the region’s share of the regions’ budget minus its share of {def.need ? `the ${def.need.many}` : 'the people'}. A region’s
        {' '}{def.short.toLowerCase()} is added up from its provinces: counts summed, published rates weighted (by population for
        poverty, by families for income){def.need ? '' : ''}. Regions are today’s: Sulu in Region IX, the Negros Island Region on its own.
      </p>
    </section>
  );
}

export default function RegionBudgetCompare({ rb, def, s, compact = false }: { rb: RegionBudgetFile; def: IndicatorDef; s: CompareState; compact?: boolean }) {
  const rows = useRows(rb, def, s);
  const dept = rb.departments.find((d) => d.id === s.dept) ?? rb.departments[0];
  return (
    <>
      <DeptNote dept={dept} year={s.year} rb={rb} />
      <WholeBar dept={dept} year={s.year} />
      <Bars rows={rows} def={def} s={s} />
      <OutsideRows rb={rb} dept={dept} year={s.year} popT={rows.reduce((a, x) => a + x.r.population_2024, 0)} />
      {compact ? (
        <p className="ind-note">
          {big(dept.regional[s.year])} of {dept.id === 'all' ? 'the whole budget' : `${dept.short}’s budget`} ({pct(shareOf(dept.regional[s.year], dept.total[s.year]))}) is assigned to a region in the {yearLabel(s.year)}.
          {' '}<Link to={`${BUDGET_BY_REGION_ROOT}?indicator=${def.id}&dept=${s.dept}&budget=${s.year}&per=${s.per}`}>The full comparison, with a chart, a table and how a region’s budget is counted →</Link>
        </p>
      ) : (
        <>
          <section className="ind-section" aria-labelledby="bpr-sc-h">
            <div className="ind-section-head"><h2 id="bpr-sc-h">{def.short} and budget {s.per === 'need' && def.need ? `per ${def.need.one}` : 'per person'}</h2></div>
            <Scatter rows={rows} def={def} s={s} />
          </section>
          <Table rows={rows} def={def} s={s} rb={rb} dept={dept} />
        </>
      )}
    </>
  );
}
