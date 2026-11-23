/**
 * `/senate/2027/districts/:id`: one legislative district in the Senate committee report, in the House bill district
 * page's design (Jason, 2026-11-23: "Next is do the district, similar to HGAB's district pages"). The representative,
 * then each DPWH office that serves the district: what the report does with its House bill projects (kept, renamed,
 * raised, reduced, cut to ₱0), the House insertions it cuts and keeps, and its largest cuts; then the projects placed in
 * the district. An office that serves several districts is shown whole, never split.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { SectionHead } from '../components/shared';
import { KpiStrip } from '../components/Nep2027Bits';
import { SignedPhp } from '../components/HgabBits';
import { AttributionBadge, Portrait, PortraitCredit, RepresentativeBlock, TierBadge } from '../components/HgabDistrictBits';
import { SenateError, SenateHeader, SenateHero, SenateLoading, SenateReviewBanner } from '../components/SenateBits';
import * as fmt from '../lib/format';
import { pageMeta } from '../lib/seo';
import { districtPath, formatPct, pctChange, type DistrictCard, type OfficeHistory } from '../lib/hgab';
import { senateListPath, senateRecordPath } from '../lib/senate';
import {
  SENATE_DISTRICTS_ROOT, SENATE_OFFICE_STATUSES, SENATE_STATUS_WORDS, districtOffices, loadSenateDistricts, senateDistrictPath, sumOffices,
  type SenateDistrictsData, type SenateOffice,
} from '../lib/senate-districts';
import '../nep2027.css';
import '../hgab-dataset.css';
import '../senate-districts.css';

const n = (v: number) => v.toLocaleString('en-US');
/** The label the House bill prints for an office in 2027 (the project list's office filter). */
const officeLabel = (o: OfficeHistory) => o.years.find((y) => y.fy === 2027 && y.stage === 'hgab3')?.matched_label ?? o.name;

export default function SenateDistrict() {
  const { id = '' } = useParams();
  const [data, setData] = useState<SenateDistrictsData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadSenateDistricts().then((d) => live && setData(d)).catch((e) => live && setErr(String(e?.message || e)));
    return () => { live = false; };
  }, []);
  const card = data?.house.districts.find((d) => d.id === id) ?? null;
  useEffect(() => { document.title = card ? `${card.label} · Senate committee report · ${pageMeta(SENATE_DISTRICTS_ROOT).title.split(' · ').pop()}` : pageMeta(SENATE_DISTRICTS_ROOT).title; }, [card]);
  if (err) return <SenateError message={err} />;
  if (!data) return <SenateLoading what="this district" />;
  if (!card) return <SenateError message={`There is no legislative district “${id}”. See every district on the Districts page.`} />;
  return <District data={data} card={card} />;
}

function District({ data, card }: { data: SenateDistrictsData; card: DistrictCard }) {
  const offices = districtOffices(data, card.office_ids);
  const t = sumOffices(offices);
  const placed = data.senate.placed[card.id] ?? null;
  const shared = offices.some((o) => o.house.district_ids.length > 1);
  const ambiguous = card.representative?.status === 'ambiguous';
  return (
    <>
      <SenateHeader crumb={card.label} />
      <SenateHero
        compact
        crumb={<><Link to={SENATE_DISTRICTS_ROOT}>Districts</Link><span className="hgab-crumb-sep" aria-hidden="true">·</span><span className="hgab-crumb-here">{card.label}</span></>}
        title={card.label}
        dek={offices.length
          ? <>The DPWH {offices.length === 1 ? 'office' : 'offices'} that {offices.length === 1 ? 'serves' : 'serve'} this district, in the House bill and the Senate committee report.{shared ? ' A shared office’s figure is the whole office’s, not this district’s share.' : ''}</>
          : 'No DPWH office was found for this district, so it has no office figure.'}
      />
      <main className="nep-main sdx-main">
        <SenateReviewBanner compact />
        <div className="sdx-rep">
          {/* As the House bill's page: a seat with more than one possible member shows each credit, no portrait. */}
          {!ambiguous && <Portrait rep={card.representative} large />}
          <div>
            <RepresentativeBlock rep={card.representative} large showProfile />
            <AttributionBadge attribution={card.attribution} />
            {!ambiguous && <PortraitCredit rep={card.representative} />}
            {ambiguous && card.representative?.candidates?.map((c) => <PortraitCredit key={c.name} rep={c} />)}
          </div>
        </div>
        {offices.length > 0 && (
          <div className="hgab-dx-kpis">
            <KpiStrip items={[
              { label: offices.length === 1 ? 'Office · House bill' : `${offices.length} offices · House bill`, value: fmt.php(t.house_php), sub: `${n(t.rows)} projects` },
              { label: 'Senate committee report', value: fmt.php(t.senate_php), tone: t.senate_php < t.house_php ? 'down' : 'up', sub: <><SignedPhp value={t.senate_php - t.house_php} /> {formatPct(pctChange(t.senate_php, t.house_php))}</> },
              { label: 'Cut to ₱0', value: n(t.cut_rows), sub: `projects, ${fmt.php(t.cut_php)} in the House bill` },
              { label: 'Placed in this district', value: placed ? n(placed.rows) : '—', sub: placed ? `projects: ${fmt.php(placed.house_php)} → ${fmt.php(placed.senate_php)}` : 'no project placed here' },
            ]} />
          </div>
        )}
        {offices.map((o) => <OfficeSection key={o.id} data={data} card={card} office={o.house} senate={o.senate} />)}
        {placed && (
          <section className="nep-section" aria-labelledby="sdx-d-placed">
            <SectionHead
              eyebrow="Projects placed in this district"
              headline={<span id="sdx-d-placed">{n(placed.rows)} projects placed here: {fmt.php(placed.house_php)} in the House bill, {fmt.php(placed.senate_php)} in the Senate committee report</span>}
              dek={`Placed by the place their titles name, or by their office when it serves only this district, so they include projects listed under the Central Office. The report cuts ${n(placed.cut_rows)} of them to ₱0 (${fmt.php(placed.cut_php)}). A placement is where the work is, not who asked for it.`}
            />
          </section>
        )}
        <p className="sdx-note">
          <Link to={districtPath(card.id)}>This district in the House bill, with its budget history since 2020 →</Link>
        </p>
        <p className="sdx-note">
          Amounts belong to DPWH offices, not to people. The representative shown holds the district’s seat in the 20th Congress. The
          Senate committee report changes amounts; it does not say why, or who asked.
        </p>
      </main>
      <SiteFooter source="SOURCES: SENATE COMMITTEE REPORT ON HOUSE BILL 10858 (ANNEX A-4); HOUSE BILL 10858, THIRD READING; DPWH OFFICE-TO-DISTRICT CROSSWALK (DEO2LEG)" />
    </>
  );
}

function OfficeSection({ data, card, office, senate }: { data: SenateDistrictsData; card: DistrictCard; office: OfficeHistory; senate: SenateOffice }) {
  const others = office.district_ids.filter((d) => d !== card.id);
  const label = officeLabel(office);
  const maxPhp = Math.max(1, ...SENATE_OFFICE_STATUSES.map((s) => senate.status[s].house_php));
  const ins = senate.inserted;
  return (
    <section className="nep-section sdx-office-section" aria-labelledby={`sdx-o-${office.id}`}>
      <SectionHead
        eyebrow={<>DPWH office · <TierBadge tier={office.tier} sharedWith={others.length} compact /></>}
        headline={<span id={`sdx-o-${office.id}`}>{office.name}: {fmt.php(senate.house_php)} in the House bill, {fmt.php(senate.senate_php)} in the Senate committee report</span>}
        dek={others.length
          ? <>Shared with {others.map((d, i) => {
            const c = data.house.districts.find((x) => x.id === d);
            return <span key={d}>{i > 0 && (i === others.length - 1 ? ' and ' : ', ')}<Link to={senateDistrictPath(d)}>{c?.label ?? d}</Link></span>;
          })}. These are the whole office’s figures, not split between the districts.</>
          : 'This office serves only this district, so its figures are the district’s.'}
      />
      <div className="nep-table-wrap">
        <table className="nep-table sdx-table">
          <thead>
            <tr><th scope="col">What the report does</th><th scope="col" className="num">Projects</th><th scope="col" className="num">House bill</th><th scope="col" className="num">Senate committee report</th><th scope="col" aria-label="Share of the House bill" /></tr>
          </thead>
          <tbody>
            {SENATE_OFFICE_STATUSES.filter((s) => senate.status[s].rows).map((s) => (
              <tr key={s} className={s === 'cut' ? 'is-cut' : undefined}>
                <th scope="row">{SENATE_STATUS_WORDS[s].label}<small>{SENATE_STATUS_WORDS[s].plain}</small></th>
                <td className="num">{n(senate.status[s].rows)}</td>
                <td className="num" title={fmt.php(senate.status[s].house_php, { unit: 'full' })}>{fmt.php(senate.status[s].house_php)}</td>
                <td className="num" title={fmt.php(senate.status[s].senate_php, { unit: 'full' })}>{fmt.php(senate.status[s].senate_php)}</td>
                <td className="sdx-bar"><i style={{ width: `${Math.max(0.8, (100 * senate.status[s].house_php) / maxPhp)}%` }} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><th scope="row">The office’s projects</th><td className="num">{n(senate.rows)}</td><td className="num">{fmt.php(senate.house_php)}</td><td className="num">{fmt.php(senate.senate_php)}</td><td className="num"><SignedPhp value={senate.senate_php - senate.house_php} /></td></tr>
          </tfoot>
        </table>
      </div>
      {ins.rows > 0 && (
        <p className="sdx-more">
          House insertions (no matching line in the NEP): {n(ins.rows)}, {fmt.php(ins.house_php)}. The report cuts {n(ins.cut_rows)} of them
          ({fmt.php(ins.cut_php)}) and keeps {n(ins.kept_rows)} ({fmt.php(ins.kept_php)}).
        </p>
      )}
      {senate.top_cut.length > 0 && (
        <>
          <h3 className="sdx-h3">Its largest projects cut to ₱0</h3>
          <ol className="sdx-cuts">
            {senate.top_cut.map(([hid, title, php]) => (
              <li key={hid}><Link to={senateRecordPath('dpwh', hid)}>{title}</Link> <span>{fmt.php(php)} in the House bill</span></li>
            ))}
          </ol>
        </>
      )}
      <p className="sdx-more"><Link to={senateListPath('dpwh', 'office', label)}>Every project of this office in the Senate committee report →</Link></p>
    </section>
  );
}
