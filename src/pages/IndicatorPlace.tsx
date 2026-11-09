/**
 * `/indicators/places/:area`: one province or Metro Manila district, with every indicator beside the
 * Philippines and its rank among the areas.
 */
import { useMemo } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import SiteHeader from '../components/SiteHeader';
import SiteFooter from '../components/SiteFooter';
import IndicatorMap from '../components/IndicatorMap';
import { IndicatorsFooterNote, IndicatorsReviewNotice, IndicatorsStatus } from '../components/IndicatorsBits';
import { useIndicatorsData, useRegionBudget } from '../lib/use-indicators';
import { BUDGET_BY_REGION_ROOT } from '../lib/budget-regions';
import {
  INDICATORS, INDICATORS_ROOT, INDICATOR_BY_ID, THEMES, formatIndicator, formatSigned, indicatorPath, ranks,
} from '../lib/indicators';
import { ordinal } from '../lib/indicators-view';
import '../nep2027.css';
import '../indicators.css';

export default function IndicatorPlace() {
  const { area = '' } = useParams();
  const { data, geo, error } = useIndicatorsData();
  const { data: rb } = useRegionBudget();
  const a = data?.areas.find((x) => x.id === area);
  const rankOf = useMemo(() => new Map((data?.indicators ?? []).map((i) => [i.id, ranks(i.values)])), [data]);
  if (data && !a) return <Navigate to={INDICATORS_ROOT} replace />;
  const population = INDICATOR_BY_ID.get('population')!;
  const pop = a && data ? data.indicators.find((i) => i.id === 'population')!.values[a.id] : null;

  return (
    <div className="ind-page">
      <SiteHeader crumb={<><Link to={INDICATORS_ROOT}>Indicators</Link> · {a?.name ?? 'Area'}</>} />
      <main className="nep-main ind-main">
        <div className="page-headline">
          <p className="page-eyebrow">{a ? a.region : 'Indicators'}</p>
          <h1 className="page-title">{a?.name ?? 'Loading…'}</h1>
          {a && <p className="page-dek">{formatIndicator(pop, population)} people in 2024. Every indicator for this area, beside the Philippines, with its rank among the areas that have a figure.</p>}
        </div>
        <IndicatorsReviewNotice />
        {!data || !geo || !a ? <IndicatorsStatus error={error} /> : (
          <>
            {a.notes.length > 0 && <ul className="ind-area-notes">{a.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
            {rb && (() => {
              const reg = rb.regions.find((r) => r.areas.includes(a.id));
              if (!reg) return null;
              const by = rb.budget['2027'].all;
              const pp = (k: string) => (by[k] ?? 0) / rb.regions.find((r) => r.key === k)!.population_2024;
              const order = [...rb.regions].sort((x, y) => pp(y.key) - pp(x.key));
              const avg = rb.regions.reduce((s, r) => s + (by[r.key] ?? 0), 0) / rb.regions.reduce((s, r) => s + r.population_2024, 0);
              const peso = (v: number) => `₱${Math.round(v).toLocaleString('en-PH')}`;
              return (
                <p className="ind-place-region">
                  <strong>{reg.label} ({reg.plain})</strong>: {reg.poverty_2023.toFixed(1)}% of people poor in 2023. In the 2027 NEP,
                  {' '}{peso(pp(reg.key))} per person is assigned to the region’s offices ({ordinal(order.findIndex((r) => r.key === reg.key) + 1)} of 18 regions;
                  {' '}{peso(avg)} across all regions). <Link to={`${BUDGET_BY_REGION_ROOT}?sort=per`}>Budget and poverty by region →</Link>
                </p>
              );
            })()}
            <div className="ind-split is-place">
              <div>
                {THEMES.map((t) => (
                  <section key={t.key} className="ind-place-theme" aria-labelledby={`pl-${t.key}`}>
                    <h2 id={`pl-${t.key}`} className="ind-h3">{t.title}</h2>
                    <table className="ind-table is-place">
                      <thead>
                        <tr>
                          <th scope="col">Indicator</th>
                          <th scope="col" className="is-num">{a.name}</th>
                          <th scope="col" className="is-num">Philippines</th>
                          <th scope="col" className="is-num">Rank</th>
                        </tr>
                      </thead>
                      <tbody>
                        {INDICATORS.filter((d) => d.theme === t.key).map((d) => {
                          const iv = data.indicators.find((i) => i.id === d.id)!;
                          const f = (v: number | null | undefined) => (d.scale === 'diverging' ? formatSigned(v, d) : formatIndicator(v, d));
                          const r = rankOf.get(d.id)!.get(a.id);
                          return (
                            <tr key={d.id}>
                              <th scope="row"><Link to={indicatorPath(d.id)}>{d.title}</Link></th>
                              <td className="is-num ind-strong">{f(iv.values[a.id])}</td>
                              <td className="is-num ind-muted" title={iv.overall.label}>{f(iv.overall.value)}{iv.overall.label !== 'Philippines' ? '*' : ''}</td>
                              <td className="is-num ind-muted">{r ? `${ordinal(r)} of ${iv.coverage.areas}` : '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </section>
                ))}
                <p className="ind-footnote">Rank 1 is the highest value, whether that is good or bad. * Not a national figure: the total over the areas that have one.</p>
              </div>
              <aside className="ind-locator" aria-label="Where this area is">
                <IndicatorMap geo={geo} data={data} def={population} values={{}} classes={[]} highlight={a.id} compact />
              </aside>
            </div>
            <IndicatorsFooterNote data={data} />
          </>
        )}
      </main>
      <SiteFooter source="SOURCES: PHILIPPINE STATISTICS AUTHORITY (PSA OPENSTAT); DPWH; FY2027 NEP AND HOUSE BILL 10858" />
    </div>
  );
}
