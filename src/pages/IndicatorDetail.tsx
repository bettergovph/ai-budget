/**
 * `/indicators/:id`: one indicator. The map, every area ranked, a comparison with any other indicator,
 * and how the figure was made, with its sources.
 */
import { useMemo, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import SiteHeader from '../components/SiteHeader';
import SiteFooter from '../components/SiteFooter';
import IndicatorMap from '../components/IndicatorMap';
import IndicatorScatter from '../components/IndicatorScatter';
import {
  IndicatorsFooterNote, IndicatorsReviewNotice, IndicatorsStatus, SourceList,
} from '../components/IndicatorsBits';
import { useIndicatorsData } from '../lib/use-indicators';
import {
  INDICATORS, INDICATOR_BY_ID, INDICATORS_ROOT, THEMES, areaPath, formatIndicator, formatSigned, indicatorPath, ranks,
  type IndicatorDef, type IndicatorValues, type IndicatorsFile,
} from '../lib/indicators';
import { mapClasses, type MapClass } from '../lib/indicators-view';
import RegionBudgetCompare, { CompareControls } from '../components/RegionBudgetCompare';
import { useRegionBudget } from '../lib/use-indicators';
import { defaultState, type CompareState } from '../lib/region-compare';
import type { HgabGeo } from '../lib/hgab';
import '../nep2027.css';
import '../indicators.css';

/** The comparison shown first: budget indicators against poverty, everything else against DPWH contracts. */
function defaultCompare(def: IndicatorDef): string {
  if (def.theme === 'budget') return 'poverty';
  return def.id === 'dpwh-contracts-per-person' ? 'poverty' : 'dpwh-contracts-per-person';
}

export default function IndicatorDetail() {
  const { id = '' } = useParams();
  const def = INDICATOR_BY_ID.get(id);
  const { data, geo, error } = useIndicatorsData();
  const [params, setParams] = useSearchParams();
  const iv = data?.indicators.find((i) => i.id === id);
  const classes = useMemo(() => (def && iv ? mapClasses(def, iv.values) : []), [def, iv]);
  if (!def) return <Navigate to={INDICATORS_ROOT} replace />;

  const theme = THEMES.find((t) => t.key === def.theme)!;
  const cmpId = INDICATOR_BY_ID.has(params.get('compare') ?? '') && params.get('compare') !== id ? params.get('compare')! : defaultCompare(def);
  const cmp = INDICATOR_BY_ID.get(cmpId)!;

  return (
    <div className="ind-page">
      <SiteHeader crumb={<><Link to={INDICATORS_ROOT}>Indicators</Link> · {theme.title}</>} />
      <main className="nep-main ind-main">
        <div className="page-headline">
          <p className="page-eyebrow"><Link to={`${INDICATORS_ROOT}#theme-${theme.key}`}>{theme.title}</Link></p>
          <h1 className="page-title">{def.title}</h1>
          <p className="page-dek">{def.plain}</p>
        </div>
        <IndicatorsReviewNotice />
        {!data || !geo || !iv ? <IndicatorsStatus error={error} /> : (
          <DetailBody data={data} geo={geo} iv={iv} def={def} classes={classes} cmp={cmp} onCompare={(v) => { const p = new URLSearchParams(params); p.set('compare', v); setParams(p, { replace: true }); }} />
        )}
      </main>
      <SiteFooter source="SOURCES: PHILIPPINE STATISTICS AUTHORITY (PSA OPENSTAT); DPWH; FY2027 NEP AND HOUSE BILL 10858" />
    </div>
  );

}

function DetailBody({ data, geo, iv, def, classes, cmp, onCompare }: {
data: IndicatorsFile; geo: HgabGeo; iv: IndicatorValues; def: IndicatorDef; classes: MapClass[]; cmp: IndicatorDef;
onCompare: (id: string) => void;
}) {
  const fmt = (v: number | null | undefined) => (def.scale === 'diverging' ? formatSigned(v, def) : formatIndicator(v, def));
  const idx = INDICATORS.findIndex((d) => d.id === def.id);
  const prev = INDICATORS[idx - 1], next = INDICATORS[idx + 1];
  const rank = ranks(iv.values);
  const ranked = data.areas.filter((a) => iv.values[a.id] != null).sort((a, b) => iv.values[b.id]! - iv.values[a.id]!);
  const missing = data.areas.filter((a) => iv.values[a.id] == null);
  const max = Math.max(...ranked.map((a) => Math.abs(iv.values[a.id]!)), 1e-9);
  const hi = ranked[0], lo = ranked[ranked.length - 1];
  const cv = iv.cv;
  return (
    <>
      <dl className="ind-kpis">
        <div><dt>{iv.overall.label}</dt><dd>{fmt(iv.overall.value)}</dd></div>
        <div><dt>Highest</dt><dd>{fmt(iv.values[hi.id])}</dd><dd className="ind-kpi-sub"><Link to={areaPath(hi.id)}>{hi.name}</Link></dd></div>
        <div><dt>Lowest</dt><dd>{fmt(iv.values[lo.id])}</dd><dd className="ind-kpi-sub"><Link to={areaPath(lo.id)}>{lo.name}</Link></dd></div>
        <div><dt>Areas with a figure</dt><dd>{iv.coverage.areas} of {data.areas.length}</dd><dd className="ind-kpi-sub">{(100 * iv.coverage.population_share).toFixed(1)}% of the population</dd></div>
      </dl>

      <div className="ind-split">
        <IndicatorMap geo={geo} data={data} def={def} values={iv.values} classes={classes} />
        <div className="ind-rank">
          <h2 className="ind-h3">Every area, highest first</h2>
          <div className="ind-rank-scroll">
            <table className="ind-table is-rank">
              <thead>
                <tr>
                  <th scope="col" className="is-num">#</th>
                  <th scope="col">Area</th>
                  <th scope="col" className="is-num">{def.short}</th>
                  {cv && <th scope="col" className="is-num" title="PSA’s coefficient of variation; above 20 the estimate is weak">CV</th>}
                </tr>
              </thead>
              <tbody>
                {ranked.map((a) => {
                  const v = iv.values[a.id]!;
                  const w = (Math.abs(v) / max) * 100;
                  const weak = cv && (cv[a.id] ?? 0) > 20;
                  return (
                    <tr key={a.id}>
                      <td className="is-num ind-muted">{rank.get(a.id)}</td>
                      <th scope="row"><Link to={areaPath(a.id)}>{a.name}</Link> <span className="ind-region">{a.region}</span></th>
                      <td className="is-num ind-barcell">
                        <span className="ind-bartrack" aria-hidden="true">
                          <span className={`ind-bar${def.scale === 'diverging' ? (v < 0 ? ' is-down' : ' is-up') : ''}`} style={{ width: `${w}%` }} />
                        </span>
                        <span className="ind-barval">{fmt(v)}</span>
                      </td>
                      {cv && <td className={`is-num${weak ? ' ind-weak' : ' ind-muted'}`}>{cv[a.id]?.toFixed(1) ?? '—'}{weak ? ' ⚠' : ''}</td>}
                    </tr>
                  );
                })}
                {missing.map((a) => (
                  <tr key={a.id} className="is-missing">
                    <td />
                    <th scope="row"><Link to={areaPath(a.id)}>{a.name}</Link> <span className="ind-region">{a.region}</span></th>
                    <td className="is-num ind-muted">No figure</td>
                    {cv && <td />}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cv && <p className="ind-footnote">⚠ CV above 20: PSA counts the estimate as weak.</p>}
        </div>
      </div>

      <section className="ind-section" aria-labelledby="compare-h">
        <div className="ind-section-head">
          <h2 id="compare-h">Beside another indicator</h2>
          <label className="ind-select">
            <span>Compare with</span>
            <select value={cmp.id} onChange={(e) => onCompare(e.target.value)}>
              {THEMES.map((t) => (
                <optgroup key={t.key} label={t.title}>
                  {INDICATORS.filter((d) => d.theme === t.key && d.id !== def.id).map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
        <IndicatorScatter data={data} x={cmp} y={def} />
        <p className="ind-note">
          Two figures moving together in one picture does not mean one causes the other. Many things differ
          between provinces at once: size, distance, how rural they are.
        </p>
      </section>

      {def.theme !== 'budget' && <RegionSection key={def.id} def={def} />}

      <section className="ind-section ind-about" aria-labelledby="about-h">
        <h2 id="about-h">How we got it</h2>
        <p>{def.how}</p>
        {def.caveats.length > 0 && (
          <>
            <h3 className="ind-h3">Keep in mind</h3>
            <ul>{def.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
          </>
        )}
        <h3 className="ind-h3">Sources</h3>
        <SourceList data={data} def={def} />
      </section>

      <nav className="ind-prevnext" aria-label="Other indicators">
        {prev ? <Link to={indicatorPath(prev.id)}>← {prev.title}</Link> : <span />}
        {next ? <Link to={indicatorPath(next.id)}>{next.title} →</Link> : <span />}
      </nav>
      <IndicatorsFooterNote data={data} />
    </>
  );
}

/** The indicator by region, beside the budget assigned to each region (its matching department first). */
function RegionSection({ def }: { def: IndicatorDef }) {
  const { data: rb } = useRegionBudget();
  const [over, setOver] = useState<Partial<CompareState>>({});
  if (!rb) return null;
  const s = defaultState(def, rb, over);
  return (
    <section className="ind-section" aria-labelledby="region-budget-h">
      <div className="ind-section-head">
        <h2 id="region-budget-h">Beside the budget, by region</h2>
        <p>{def.short} for each region, beside the budget assigned to it.</p>
      </div>
      <CompareControls rb={rb} def={def} s={s} onChange={(p) => setOver({ ...over, ...p })} />
      <RegionBudgetCompare rb={rb} def={def} s={s} compact />
    </section>
  );
}
