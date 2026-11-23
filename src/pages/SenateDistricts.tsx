/**
 * `/senate/2027/districts`: the Senate committee report by DPWH office and legislative district, in the House bill
 * district pages' design (Jason, 2026-11-23: "Next is do the district, similar to HGAB's district pages"). Three
 * views, as the House bill's: the overview (`?view` absent), every district's offices (`?view=list`) and the projects
 * placed in each legislative district (`?view=list-legislative`).
 *
 * Data: the House district index and the Senate layer (src/lib/senate-districts.ts). An office's figure is the whole
 * office's: one that serves several districts is shown whole, never split.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { SectionHead } from '../components/shared';
import { KpiStrip } from '../components/Nep2027Bits';
import { SignedPhp } from '../components/HgabBits';
import { SenateDistrictsProvider } from '../components/SenateDistrictBits';
import { DistrictsCardsList } from './HgabDistricts';
import { SenateError, SenateHeader, SenateHero, SenateLoading, SenateReviewBanner } from '../components/SenateBits';
import * as fmt from '../lib/format';
import { pageMeta } from '../lib/seo';
import { REGION_ORDER, formatPct, pctChange, regionKeyOf, type RegionKey } from '../lib/hgab';
import { districtAnchor, regionNames } from '../lib/hgab-districts';
import { DEO_MEANING } from '../lib/hgab-leaderboard';
import {
  SENATE_DISTRICTS_ROOT, SENATE_DISTRICT_VIEWS, loadSenateDistricts, senateDistrictPath, senateDistrictsHref,
  type SenateDistrictView, type SenateDistrictsData, type SenateTally,
} from '../lib/senate-districts';
import '../nep2027.css';
import '../hgab-dataset.css';
import '../senate-districts.css';

const n = (v: number) => v.toLocaleString('en-US');

export default function SenateDistricts() {
  const [params] = useSearchParams();
  const view = (SENATE_DISTRICT_VIEWS.find((v) => v.key === params.get('view'))?.key ?? 'overview') as SenateDistrictView;
  const [data, setData] = useState<SenateDistrictsData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadSenateDistricts().then((d) => live && setData(d)).catch((e) => live && setErr(String(e?.message || e)));
    return () => { live = false; };
  }, []);
  useEffect(() => { document.title = pageMeta(SENATE_DISTRICTS_ROOT).title; }, []);
  if (err) return <SenateError message={err} />;
  if (!data) return <SenateLoading what="the Senate committee report by district" />;
  // The cards: the House bill's list, with the Senate's figures (Jason, 2026-11-23: "where are the cards??").
  if (view === 'list') return <SenateDistrictsProvider data={data}><DistrictsCardsList index={data.house} /></SenateDistrictsProvider>;
  const label = SENATE_DISTRICT_VIEWS.find((v) => v.key === view)!.label;
  return (
    <>
      <SenateHeader crumb="Districts" compiledMeta={`${n(data.house.districts.length)} districts · ${n(Object.keys(data.senate.offices).length)} DPWH offices`} />
      <SenateHero
        compact
        crumb={view === 'overview' ? 'Districts' : <><Link to={SENATE_DISTRICTS_ROOT}>Districts</Link><span className="hgab-crumb-sep" aria-hidden="true">·</span><span className="hgab-crumb-here">{label}</span></>}
        title={view === 'list-legislative' ? 'Projects placed in each legislative district' : 'Public works budget by DPWH office: the Senate committee report'}
        dek={view === 'list-legislative'
          ? 'Each district’s projects, placed by the place their titles name or the one district their office serves, in the House bill and the Senate committee report.'
          : `The DPWH budget the Senate committee report gives each DPWH office, beside the House bill and the legislative districts it serves. ${DEO_MEANING} An office that serves several districts is shown whole, not split.`}
      />
      <main className="nep-main sdx-main">
        <SenateReviewBanner compact />
        {view === 'overview' && <Overview data={data} />}
        {view === 'list-legislative' && <PlacedList data={data} />}
        <p className="sdx-note">
          Amounts belong to DPWH offices, not to people. The representative shown holds the district’s seat in the 20th Congress.
          The Senate committee report changes amounts; it does not say why, or who asked. The House bill and the report are versions of
          one budget: compare them, never add them.
        </p>
      </main>
      <SiteFooter source="SOURCES: SENATE COMMITTEE REPORT ON HOUSE BILL 10858 (ANNEX A-4); HOUSE BILL 10858, THIRD READING; DPWH OFFICE-TO-DISTRICT CROSSWALK (DEO2LEG)" />
    </>
  );
}

/** "−₱37.5B" with its percentage under it. */
function Change({ to, from }: { to: number; from: number }) {
  return (
    <td className="num sdx-change" title={fmt.php(to - from, { unit: 'full' })}>
      <SignedPhp value={to - from} />
      {from ? <small>{formatPct(pctChange(to, from))}</small> : null}
    </td>
  );
}
const Money = ({ v }: { v: number }) => <td className="num" title={fmt.php(v, { unit: 'full' })}>{fmt.php(v)}</td>;

function Overview({ data }: { data: SenateDistrictsData }) {
  const { house, senate } = data;
  const all = house.districts;
  const lone = all.filter((d) => d.attribution === 'A').length;
  const shared = all.filter((d) => d.attribution === 'B' || d.attribution === 'mixed').length;
  const none = all.filter((d) => d.attribution === 'none').length;
  const offCard = { house: senate.total.house_php - senate.deo.house_php, senate: senate.total.senate_php - senate.deo.senate_php };
  const cutOnCards = Object.values(senate.offices).reduce((a, o) => ({ rows: a.rows + o.status.cut.rows, php: a.php + o.status.cut.house_php }), { rows: 0, php: 0 });
  const R = senate.residual;
  const rows: Array<{ key: string; label: string; sub: string; t: SenateTally; strong?: boolean }> = [
    { key: 'deo', label: 'On district cards', sub: 'the DPWH offices that serve legislative districts', t: senate.deo, strong: true },
    { key: 'central', label: 'Central Office', sub: 'listed under DPWH’s head office, no district office named', t: R.central_office },
    { key: 'regional', label: 'Regional offices', sub: 'listed under a DPWH regional office', t: R.regional_offices },
    { key: 'change', label: 'Lines that changed office', sub: 'a different office in the NEP and the House bill; held out of every district', t: R.office_change },
    { key: 'none', label: 'Lines with no office', sub: 'no office printed; held out of every district', t: R.no_office },
    ...(R.unmatched.rows ? [{ key: 'unmatched', label: 'Offices we could not place', sub: senate.unmatched_labels.join(', '), t: R.unmatched }] : []),
  ];
  return (
    <>
      <div className="hgab-dx-kpis">
        <KpiStrip items={[
          { label: 'Legislative districts', value: n(all.length), sub: `${n(Object.keys(senate.offices).length)} DPWH offices (DEOs)` },
          { label: 'Lone office', value: n(lone), sub: 'districts whose office serves only them, so its figure is the district’s' },
          { label: 'Shared or mixed', value: n(shared), sub: `the office is shared with other districts; the figure is not split${none ? ` · ${n(none)} have no office found` : ''}` },
          {
            label: 'On district cards · Senate committee report', value: fmt.php(senate.deo.senate_php), tone: 'down',
            sub: `${fmt.php(Math.abs(senate.deo.senate_php - senate.deo.house_php))} ${senate.deo.senate_php < senate.deo.house_php ? 'less' : 'more'} than the House bill’s ${fmt.php(senate.deo.house_php)}; ${n(cutOnCards.rows)} projects cut to ₱0 (${fmt.php(cutOnCards.php)})`,
          },
        ]} />
      </div>

      <section className="nep-section" aria-labelledby="sdx-where">
        <SectionHead
          eyebrow="Where the DPWH budget sits · House bill and Senate committee report"
          headline={<span id="sdx-where">{fmt.php(offCard.senate)} of {fmt.php(senate.total.senate_php)} in the Senate committee report appears on no district card</span>}
          dek={`That is ${fmt.pct(offCard.senate / senate.total.senate_php, 1)} of the report’s DPWH projects, against ${fmt.pct(offCard.house / senate.total.house_php, 1)} in the House bill. Most of it is listed under the Central Office.`}
        />
        <div className="nep-table-wrap">
          <table className="nep-table sdx-table">
            <thead><tr><th scope="col">Where it is listed</th><th scope="col" className="num">Projects</th><th scope="col" className="num">House bill</th><th scope="col" className="num">Senate committee report</th><th scope="col" className="num">Change</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={r.strong ? 'is-strong' : undefined}>
                  <th scope="row">{r.label}<small>{r.sub}</small></th>
                  <td className="num">{n(r.t.rows)}</td>
                  <Money v={r.t.house_php} />
                  <Money v={r.t.senate_php} />
                  <Change to={r.t.senate_php} from={r.t.house_php} />
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><th scope="row">DPWH projects</th><td className="num">{n(senate.total.rows)}</td><Money v={senate.total.house_php} /><Money v={senate.total.senate_php} /><Change to={senate.total.senate_php} from={senate.total.house_php} /></tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="nep-section" aria-labelledby="sdx-regions">
        <SectionHead
          eyebrow="By region · each office counted once"
          headline={<span id="sdx-regions">DPWH office budget in each region</span>}
          dek="Each row adds up the DEOs serving that region’s legislative districts. An office that serves several districts is counted once."
          right={<Link className="hgab-ds-seeall" to={senateDistrictsHref('list')}>Browse all {n(all.length)} districts →</Link>}
        />
        <RegionTable data={data} />
      </section>
    </>
  );
}

function RegionTable({ data }: { data: SenateDistrictsData }) {
  const rows = useMemo(() => Object.entries(data.senate.regions)
    .map(([raw, r]) => ({ raw, key: regionKeyOf(raw), ...r }))
    .sort((a, b) => (a.key ? REGION_ORDER.indexOf(a.key) : 99) - (b.key ? REGION_ORDER.indexOf(b.key) : 99)), [data]);
  const t = rows.reduce((a, r) => ({ offices: a.offices + r.offices, districts: a.districts + r.districts, house_php: a.house_php + r.house_php, senate_php: a.senate_php + r.senate_php, cut_rows: a.cut_rows + r.cut_rows, cut_php: a.cut_php + r.cut_php }),
    { offices: 0, districts: 0, house_php: 0, senate_php: 0, cut_rows: 0, cut_php: 0 });
  return (
    <div className="nep-table-wrap">
      <table className="nep-table hgab-dx-rt sdx-table">
        <thead>
          <tr>
            <th scope="col">Region</th><th scope="col" className="num">Districts</th><th scope="col" className="num">Offices</th>
            <th scope="col" className="num">2027 House bill</th><th scope="col" className="num">Senate committee report</th><th scope="col" className="num">Change</th>
            <th scope="col" className="num">Cut to ₱0</th><th scope="col"><span className="visually-hidden">Districts</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const names = r.key ? regionNames(r.key) : null;
            return (
              <tr key={r.raw}>
                <th scope="row">{names?.name ?? r.raw}<small>{names?.short ?? ''}</small></th>
                <td className="num">{n(r.districts)}</td>
                <td className="num">{n(r.offices)}</td>
                <Money v={r.house_php} />
                <Money v={r.senate_php} />
                <Change to={r.senate_php} from={r.house_php} />
                <td className="num" title={fmt.php(r.cut_php, { unit: 'full' })}>{n(r.cut_rows)}<small>{fmt.php(r.cut_php)}</small></td>
                <td><Link to={`${senateDistrictsHref('list')}&region=${encodeURIComponent(r.key ?? r.raw)}`}>See districts →</Link></td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">All regions</th><td className="num">{n(t.districts)}</td><td className="num">{n(t.offices)}</td>
            <Money v={t.house_php} /><Money v={t.senate_php} /><Change to={t.senate_php} from={t.house_php} />
            <td className="num">{n(t.cut_rows)}<small>{fmt.php(t.cut_php)}</small></td><td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Projects placed in each legislative district (where their titles or their one-district office put them). */
function PlacedList({ data }: { data: SenateDistrictsData }) {
  const rows = data.house.districts
    .map((d) => ({ d, key: regionKeyOf(d.region) as RegionKey | null, p: data.senate.placed[d.id] ?? null }))
    .sort((a, b) => ((a.key ? REGION_ORDER.indexOf(a.key) : 99) - (b.key ? REGION_ORDER.indexOf(b.key) : 99)) || a.d.label.localeCompare(b.d.label));
  const t = Object.values(data.senate.placed).reduce((a, p) => ({ rows: a.rows + p.rows, house_php: a.house_php + p.house_php, senate_php: a.senate_php + p.senate_php, cut_rows: a.cut_rows + p.cut_rows }), { rows: 0, house_php: 0, senate_php: 0, cut_rows: 0 });
  return (
    <section className="nep-section" aria-labelledby="sdx-placed">
      <SectionHead
        eyebrow="Projects placed in each district"
        headline={<span id="sdx-placed">{n(t.rows)} projects placed in a legislative district</span>}
        dek="A project is placed by the place its title names, or by its office when that office serves one district. A placement is where the work is, not who asked for it."
      />
      <div className="nep-table-wrap">
        <table className="nep-table sdx-table">
          <thead>
            <tr><th scope="col">District</th><th scope="col" className="num">Projects</th><th scope="col" className="num">House bill</th><th scope="col" className="num">Senate committee report</th><th scope="col" className="num">Change</th><th scope="col" className="num">Cut to ₱0</th></tr>
          </thead>
          <tbody>
            {rows.map(({ d, p }) => (
              <tr key={d.id} id={districtAnchor(d.id)}>
                <th scope="row"><Link to={senateDistrictPath(d.id)}>{d.label}</Link><small>{[d.representative?.name, d.region].filter(Boolean).join(' · ')}</small></th>
                {p ? <><td className="num">{n(p.rows)}</td><Money v={p.house_php} /><Money v={p.senate_php} /><Change to={p.senate_php} from={p.house_php} />
                  <td className="num" title={fmt.php(p.cut_php, { unit: 'full' })}>{n(p.cut_rows)}<small>{fmt.php(p.cut_php)}</small></td></>
                  : <td colSpan={5} className="hgab-ds-null">No project placed here</td>}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><th scope="row">Placed in a district</th><td className="num">{n(t.rows)}</td><Money v={t.house_php} /><Money v={t.senate_php} /><Change to={t.senate_php} from={t.house_php} /><td className="num">{n(t.cut_rows)}</td></tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
