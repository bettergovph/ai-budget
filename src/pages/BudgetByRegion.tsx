/**
 * `/indicators/budget-by-region`: any indicator beside the budget assigned to each region, for the whole budget
 * or one department, in the 2027 NEP or the 2026 GAA. Poverty and DSWD first. State lives in the URL:
 * `?indicator=&dept=&budget=&per=&sort=`.
 *
 * Data: indicators/regions.json (scripts/build-indicators.ts; contract src/lib/budget-regions.ts).
 */
import { Link, useSearchParams } from 'react-router-dom';
import SiteHeader from '../components/SiteHeader';
import SiteFooter from '../components/SiteFooter';
import { IndicatorsReviewNotice, IndicatorsStatus } from '../components/IndicatorsBits';
import RegionBudgetCompare, { CompareControls } from '../components/RegionBudgetCompare';
import { useRegionBudget } from '../lib/use-indicators';
import { BUDGET_YEARS, shareOf, type BudgetYear } from '../lib/budget-regions';
import { INDICATORS_ROOT, INDICATOR_BY_ID, indicatorPath } from '../lib/indicators';
import { COMPARABLE, defaultState, type CompareState, type Per, type SortKey } from '../lib/region-compare';
import '../nep2027.css';
import '../indicators.css';

const big = (v: number) => (v >= 1e12 ? `₱${(v / 1e12).toFixed(2)} trillion` : `₱${(v / 1e9).toFixed(1)} billion`);
const pct = (v: number) => `${v.toFixed(1)}%`;

export default function BudgetByRegion() {
  const { data, error } = useRegionBudget();
  const [params, setParams] = useSearchParams();
  const def = COMPARABLE.find((d) => d.id === params.get('indicator')) ?? INDICATOR_BY_ID.get('poverty')!;
  const s: CompareState = defaultState(def, data, {
    year: BUDGET_YEARS.find((y) => y.key === params.get('budget'))?.key as BudgetYear | undefined,
    dept: params.get('dept') ?? undefined,
    per: (params.get('per') as Per | null) ?? undefined,
    sort: (['indicator', 'per', 'gap', 'budget'] as const).find((k) => k === params.get('sort')) as SortKey | undefined,
  });
  const update = (patch: Partial<CompareState> & { indicator?: string }) => {
    const p = new URLSearchParams(params);
    if (patch.indicator) {
      // A new indicator brings its own department and measure, unless the reader picks again.
      p.set('indicator', patch.indicator); p.delete('dept'); p.delete('per'); p.delete('sort');
    }
    if (patch.year) p.set('budget', patch.year);
    if (patch.dept) p.set('dept', patch.dept);
    if (patch.per) p.set('per', patch.per);
    if (patch.sort) p.set('sort', patch.sort);
    setParams(p, { replace: true });
  };

  return (
    <div className="ind-page">
      <SiteHeader crumb={<><Link to={INDICATORS_ROOT}>Indicators</Link> · Budget by region</>} />
      <main className="nep-main ind-main">
        <div className="page-headline">
          <p className="page-eyebrow"><Link to={INDICATORS_ROOT}>Indicators</Link> · 18 regions</p>
          <h1 className="page-title">Budget by region, beside {def.short.toLowerCase()}</h1>
          <p className="page-dek">
            Set any indicator beside the budget assigned to each region: poverty beside DSWD, children beside
            DepEd, births beside DOH, rice land beside DA, or anything beside the whole budget. Every choice can be
            changed.
          </p>
        </div>
        <IndicatorsReviewNotice />
        {!data ? <IndicatorsStatus error={error} /> : renderBody()}
      </main>
      <SiteFooter source="SOURCES: FY2027 NEP AND FY2026 GAA (DBM); PHILIPPINE STATISTICS AUTHORITY" />
    </div>
  );

  // A plain function, not a component, so a change of filter does not remount the controls.
  function renderBody() {
    if (!data) return null;
    const dept = data.departments.find((d) => d.id === s.dept)!;
    const all = data.departments.find((d) => d.id === 'all')!;
    const yl = BUDGET_YEARS.find((y) => y.key === s.year)!.label;
    return (
      <>
        <CompareControls rb={data} def={def} s={s} onChange={update} onIndicator={(id) => update({ indicator: id })} />
        <dl className="ind-kpis">
          <div><dt>Assigned to a region</dt><dd>{big(dept.regional[s.year])}</dd><dd className="ind-kpi-sub">{pct(shareOf(dept.regional[s.year], dept.total[s.year]))} of {dept.id === 'all' ? 'the whole budget' : `${dept.short}’s budget`}, {big(dept.total[s.year])}</dd></div>
          <div><dt>National offices coded to NCR</dt><dd>{big(dept.central[s.year])}</dd><dd className="ind-kpi-sub">Central offices, bureaus, national units</dd></div>
          <div><dt>Nationwide</dt><dd>{big(dept.nationwide[s.year])}</dd><dd className="ind-kpi-sub">{dept.id === 'all' ? 'NTA to local governments, debt service, other automatic items' : 'In no region'}</dd></div>
          <div><dt>The indicator</dt><dd className="ind-kpi-text">{def.title}</dd><dd className="ind-kpi-sub"><Link to={indicatorPath(def.id)}>Every province: map and ranking →</Link></dd></div>
        </dl>

        <section className="ind-section" aria-labelledby="bpr-fig-h">
          <div className="ind-section-head">
            <h2 id="bpr-fig-h">{def.need ? `Share of ${def.need.many}, share of the budget` : `${def.short} and budget per person`}</h2>
            <p>{dept.short} · {yl}</p>
          </div>
          <RegionBudgetCompare rb={data} def={def} s={s} />
        </section>

        <section className="ind-section ind-about" aria-labelledby="bpr-about-h">
          <h2 id="bpr-about-h">What counts as a region’s budget</h2>
          <ul>{data.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          <p>
            Of the whole {yl} ({big(all.total[s.year])}), {big(all.regional[s.year])} ({pct(shareOf(all.regional[s.year], all.total[s.year]))}) is
            assigned to a region this way. A central office’s budget can still be spent in the regions (school buildings,
            roads, medicines), so a region’s figure is the budget its own offices manage, not everything spent there.
          </p>
          <h3 className="ind-h3">Sources</h3>
          <ul className="ind-sources">
            <li><Link to="/2027">FY2027 NEP and FY2026 GAA budget lines</Link><span className="ind-sources-meta">Department of Budget and Management; the region code and operating unit of every line (the NEP browser’s data)</span></li>
            <li><Link to={indicatorPath(def.id)}>{def.title}</Link><span className="ind-sources-meta">By province, with its source; a region’s figure is added up from its provinces</span></li>
          </ul>
        </section>
      </>
    );
  }
}
