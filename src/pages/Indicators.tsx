/**
 * `/indicators`: every indicator, grouped by theme, then one table of all 87 areas.
 * Data: indicators/indicators.json (scripts/build-indicators.ts; contract src/lib/indicators.ts).
 */
import { Fragment, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SiteHeader from '../components/SiteHeader';
import SiteFooter from '../components/SiteFooter';
import {
  IndicatorsFooterNote, IndicatorsReviewNotice, IndicatorsStatus,
} from '../components/IndicatorsBits';
import { csvHref } from '../lib/indicators-view';
import { BUDGET_BY_REGION_ROOT } from '../lib/budget-regions';
import { useIndicatorsData } from '../lib/use-indicators';
import {
  INDICATORS, THEMES, areaPath, formatIndicator, formatSigned, indicatorPath,
  type IndicatorDef, type IndicatorsFile, type ThemeKey,
} from '../lib/indicators';
import '../nep2027.css';
import '../indicators.css';

const fmt = (v: number | null | undefined, def: IndicatorDef) => (def.scale === 'diverging' ? formatSigned(v, def) : formatIndicator(v, def, { compact: true }));

function extremes(data: IndicatorsFile, def: IndicatorDef) {
  const vals = data.indicators.find((i) => i.id === def.id)!.values;
  const list = data.areas.filter((a) => vals[a.id] != null).sort((a, b) => vals[b.id]! - vals[a.id]!);
  return { hi: list[0], lo: list[list.length - 1], vals };
}

function Card({ data, def }: { data: IndicatorsFile; def: IndicatorDef }) {
  const iv = data.indicators.find((i) => i.id === def.id)!;
  const { hi, lo, vals } = extremes(data, def);
  return (
    <li>
      <Link className="ind-card" to={indicatorPath(def.id)}>
        <span className="ind-card-title">{def.title}</span>
        <span className="ind-card-figure">{fmt(iv.overall.value, def)}</span>
        <span className="ind-card-label">{iv.overall.label}</span>
        {hi && lo && (
          <span className="ind-card-range">
            Highest {hi.name} {fmt(vals[hi.id], def)} · lowest {lo.name} {fmt(vals[lo.id], def)}
          </span>
        )}
        <span className="ind-card-go">Map and every area →</span>
      </Link>
    </li>
  );
}

type Sort = { id: string; dir: 1 | -1 };

function AreasTable({ data }: { data: IndicatorsFile }) {
  const [params, setParams] = useSearchParams();
  const theme = (THEMES.find((t) => t.key === params.get('theme'))?.key ?? 'poverty') as ThemeKey;
  const [sort, setSort] = useState<Sort>({ id: 'area', dir: 1 });
  const cols = INDICATORS.filter((d) => d.theme === theme);
  const byId = useMemo(() => new Map(data.indicators.map((i) => [i.id, i])), [data]);
  const rows = useMemo(() => {
    const list = [...data.areas];
    const v = (id: string, a: (typeof list)[number]) => byId.get(id)?.values[a.id];
    list.sort((a, b) => {
      if (sort.id === 'area') return sort.dir * a.name.localeCompare(b.name);
      if (sort.id === 'region') return sort.dir * a.region.localeCompare(b.region) || a.name.localeCompare(b.name);
      const x = v(sort.id, a), y = v(sort.id, b);
      if (x == null && y == null) return a.name.localeCompare(b.name);
      if (x == null) return 1;
      if (y == null) return -1;
      return sort.dir * (x - y);
    });
    return list;
  }, [data, sort, byId]);
  const head = (id: string, label: string, numeric = false) => {
    const on = sort.id === id;
    return (
      <th scope="col" className={numeric ? 'is-num' : undefined} aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
        <button type="button" onClick={() => setSort({ id, dir: on ? (sort.dir === 1 ? -1 : 1) : numeric ? -1 : 1 })}>
          {label}{on ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
        </button>
      </th>
    );
  };
  return (
    <section className="ind-section" id="all-areas" aria-labelledby="all-areas-h">
      <div className="ind-section-head">
        <h2 id="all-areas-h">All {data.areas.length} areas</h2>
        <a className="ind-download" href={csvHref(data)} download>Download every figure (CSV, {Math.round(data.csv.bytes / 1024)} KB)</a>
      </div>
      <div className="ind-themes" role="group" aria-label="Show the columns for">
        {THEMES.map((t) => (
          <button
            key={t.key} type="button" aria-pressed={t.key === theme} className={t.key === theme ? 'is-on' : undefined}
            onClick={() => { const p = new URLSearchParams(params); p.set('theme', t.key); setParams(p, { replace: true }); }}
          >{t.title}</button>
        ))}
      </div>
      <div className="ind-table-scroll">
        <table className="ind-table">
          <thead>
            <tr>
              {head('area', 'Area')}
              {head('region', 'Region')}
              {cols.map((d) => <Fragment key={d.id}>{head(d.id, `${d.short}, ${d.year}`, true)}</Fragment>)}
            </tr>
          </thead>
          <tbody>
            <tr className="is-overall">
              <th scope="row">Philippines</th>
              <td />
              {cols.map((d) => {
                const iv = byId.get(d.id)!;
                return <td key={d.id} className="is-num" title={iv.overall.label}>{fmt(iv.overall.value, d)}{iv.overall.label !== 'Philippines' ? '*' : ''}</td>;
              })}
            </tr>
            {rows.map((a) => (
              <tr key={a.id}>
                <th scope="row"><Link to={areaPath(a.id)}>{a.name}</Link></th>
                <td>{a.region}</td>
                {cols.map((d) => <td key={d.id} className="is-num">{fmt(byId.get(d.id)!.values[a.id], d)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cols.some((d) => byId.get(d.id)!.overall.label !== 'Philippines') && (
        <p className="ind-footnote">* Not a national figure: the total over the areas that have one (see the indicator’s page).</p>
      )}
    </section>
  );
}

export default function Indicators() {
  const { data, error } = useIndicatorsData();
  return (
    <div className="ind-page">
      <SiteHeader crumb="Indicators" />
      <main className="nep-main ind-main">
        <div className="page-headline">
          <p className="page-eyebrow">Statistics by province · {INDICATORS.length} indicators</p>
          <h1 className="page-title">Indicators</h1>
          <p className="page-dek">
            Statistics for every province and Metro Manila district, beside the national budget: people and
            age, poverty and income, the economy, farms, births and deaths, and DPWH budget per person. The
            statistics are the Philippine Statistics Authority’s; the budget figures are built from the
            budget documents and DPWH’s contract list.
          </p>
        </div>
        <IndicatorsReviewNotice />
        <Link className="ind-feature" to={BUDGET_BY_REGION_ROOT}>
          <strong>Budget by region, beside any indicator</strong>
          <span>Each region’s share of the poor, children, births or rice land beside its share of the 2027 NEP or the 2026 GAA, for the whole budget or one department.</span>
          <em>Open →</em>
        </Link>
        {!data ? <IndicatorsStatus error={error} /> : (
          <>
            <nav className="ind-jump" aria-label="Themes">
              {THEMES.map((t) => <a key={t.key} href={`#theme-${t.key}`}>{t.title}</a>)}
              <a href="#all-areas">All areas</a>
            </nav>
            {THEMES.map((t) => (
              <section key={t.key} className="ind-section" id={`theme-${t.key}`} aria-labelledby={`theme-${t.key}-h`}>
                <div className="ind-section-head">
                  <h2 id={`theme-${t.key}-h`}>{t.title}</h2>
                  <p>{t.dek}</p>
                </div>
                <ul className="ind-cards">
                  {INDICATORS.filter((d) => d.theme === t.key).map((d) => <Card key={d.id} data={data} def={d} />)}
                </ul>
              </section>
            ))}
            <AreasTable data={data} />
            <IndicatorsFooterNote data={data} />
          </>
        )}
      </main>
      <SiteFooter source="SOURCES: PHILIPPINE STATISTICS AUTHORITY (PSA OPENSTAT); DPWH; FY2027 NEP AND HOUSE BILL 10858" />
    </div>
  );
}
