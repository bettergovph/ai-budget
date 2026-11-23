/**
 * `/senate/2027/districts/:id`: one legislative district in the Senate committee report, in the House bill district
 * page's design and layout (Jason, 2026-11-23: "Next is do the district, similar to HGAB's district pages"; "the
 * senate's design district is different, where are the cards??"): the sidebar of regions and districts, the
 * representative, whose budget it is, then each DPWH office that serves the district: what the report does with its
 * House bill projects (kept, renamed, raised, reduced, cut to ₱0), the House insertions it cuts and keeps, its largest
 * cuts, and its budget since 2020; then the projects placed in the district. An office that serves several districts is
 * shown whole, never split. The House district components read the Senate's addresses and figures through
 * `SenateDistrictsProvider` (src/components/SenateDistrictBits.tsx).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { SectionHead } from '../components/shared';
import { KpiStrip } from '../components/Nep2027Bits';
import { DeoBadges, DisclaimerNotice, SignedPhp } from '../components/HgabBits';
import {
  AttributionBadge, ChartKeyRow, CoServedLinks, CongressCaveat, HistoryChart, Portrait, PortraitCredit, RepresentativeBlock, TierBadge,
} from '../components/HgabDistrictBits';
import DistrictSidebar from '../components/HgabDistrictSidebar';
import { SenateError, SenateHeader, SenateHero, SenateLoading, SenateReviewBanner } from '../components/SenateBits';
import { SenateDistrictsProvider } from '../components/SenateDistrictBits';
import { HistoryTable } from './HgabDistrict';
import * as fmt from '../lib/format';
import { pageMeta } from '../lib/seo';
import { districtPath, formatPct, pctChange, type DistrictCard, type HgabDistrictIndex, type OfficeHistory } from '../lib/hgab';
import {
  ATTRIBUTION_LABELS, DEFAULT_DISTRICT_FILTERS, browseFromParams, cardOffices, cardRegionalGroups, coServedIds, districtAnchor, districtListHref,
  districtRegionKey, dpwhOfficeName, filterDistricts, findDistrict, officeKindText, regionAnchor, regionNames, sidebarOfficeRegions,
  sidebarRegions, type DistrictBrowse,
} from '../lib/hgab-districts';
import { DEO_MEANING } from '../lib/hgab-leaderboard';
import { senateListPath, senateRecordPath } from '../lib/senate';
import {
  SENATE_DISTRICTS_ROOT, SENATE_OFFICE_STATUSES, SENATE_STATUS_WORDS, districtOffices, loadSenateDistricts, senateDistrictsHref, sumOffices,
  type SenateDistrictsData, type SenateOffice,
} from '../lib/senate-districts';
import '../nep2027.css';
import '../hgab-dataset.css';
import '../hgab-districts.css';
import '../senate-districts.css';

const n = (v: number) => v.toLocaleString('en-US');
/** The label the House bill prints for an office in 2027 (the project list's office filter). */
const officeLabel = (o: OfficeHistory) => o.years.find((y) => y.fy === 2027 && y.stage === 'hgab3')?.matched_label ?? o.name;
const SOURCES = 'SOURCES: SENATE COMMITTEE REPORT ON HOUSE BILL 10858 (ANNEX A-4); HOUSE BILL 10858, THIRD READING; ENACTED BUDGETS (GAA) 2020–2026; DPWH OFFICE-TO-DISTRICT CROSSWALK (DEO2LEG)';

export default function SenateDistrict() {
  const { id = '' } = useParams();
  const [data, setData] = useState<SenateDistrictsData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadSenateDistricts().then((d) => live && setData(d)).catch((e) => live && setErr(String(e?.message || e)));
    return () => { live = false; };
  }, []);
  const card = data ? findDistrict(data.house, id) ?? null : null;
  useEffect(() => { document.title = card ? `${card.label} · Senate committee report · ${pageMeta(SENATE_DISTRICTS_ROOT).title.split(' · ').pop()}` : pageMeta(SENATE_DISTRICTS_ROOT).title; }, [card]);
  // Moving between districts from the sidebar keeps this page mounted; start each district at the top, as a new page would.
  const { hash } = useLocation();
  useEffect(() => { if (!hash) window.scrollTo(0, 0); }, [id, hash]);
  if (err) return <SenateError message={err} />;
  if (!data) return <SenateLoading what="this district" />;
  if (!card) return <SenateError message={`There is no legislative district “${id}”. See every district on the Districts page.`} />;
  return <SenateDistrictsProvider data={data}><District data={data} card={card} /></SenateDistrictsProvider>;
}

function District({ data, card }: { data: SenateDistrictsData; card: DistrictCard }) {
  const index = data.house;
  // The sidebar's own filter and browse mode, as on the House bill's page (`?by=office` keeps the tree under the offices).
  const [find, setFind] = useState('');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const by = browseFromParams(params);
  const setBy = (next: DistrictBrowse) => navigate({ search: next === 'office' ? '?by=office' : '', hash: window.location.hash }, { replace: true });
  const tree = useMemo(() => {
    const cards = filterDistricts(index, { ...DEFAULT_DISTRICT_FILTERS, q: find });
    return by === 'office' ? sidebarOfficeRegions(cards, index) : sidebarRegions(cards, index);
  }, [index, find, by]);
  const regionSize = useMemo(() => {
    const m = new Map<ReturnType<typeof districtRegionKey>, number>();
    for (const d of index.districts) m.set(districtRegionKey(d), (m.get(districtRegionKey(d)) ?? 0) + 1);
    return m;
  }, [index]);

  const offices = districtOffices(data, cardOffices(card, index).map((o) => o.id));
  const groups = cardRegionalGroups(card, index);
  const t = sumOffices(offices);
  const placed = data.senate.placed[card.id] ?? null;
  const rep = card.representative;
  const ambiguous = rep?.status === 'ambiguous';
  const coServed = coServedIds(card, index);
  const attribution = ATTRIBUTION_LABELS[card.attribution];
  const regionKey = districtRegionKey(card);
  const region = regionNames(regionKey);
  const regionHref = districtListHref(regionAnchor(regionKey), 'district', SENATE_DISTRICTS_ROOT);
  const regionCount = index.districts.filter((d) => districtRegionKey(d) === regionKey).length;
  const one = offices.length === 1 ? offices[0].house : null;
  return (
    <>
      <SenateHeader
        crumb={<><Link to={SENATE_DISTRICTS_ROOT}>Districts</Link> › <Link to={regionHref}>{region.name}</Link> › {card.label}</>}
        compiledMeta={`${offices.length} DPWH ${offices.length === 1 ? 'office' : 'offices'} · ${attribution.label}`}
      />
      <SenateHero
        compact
        crumb={
          <>
            <Link to={SENATE_DISTRICTS_ROOT}>Districts</Link>
            <span className="hgab-crumb-sep" aria-hidden="true">·</span>
            <Link to={regionHref}>{region.name}</Link>
            <span className="hgab-crumb-sep" aria-hidden="true">·</span>
            <span className="hgab-crumb-here">{card.label}</span>
          </>
        }
        title={<>{card.label}<DeoBadges offices={offices.map((o) => o.house.name)} jurisdiction={card.jurisdiction} /></>}
        dek={
          <>
            {regionKey === 'other' ? <>A legislative district ({card.region ?? 'no region recorded'}).</> : <>A legislative district in {region.name} ({region.short}).</>}{' '}
            {offices.length === 0 && attribution.help}
            {one && <>Its DPWH office is the {one.name}. </>}
            {offices.length > 1 && <>It is served by {offices.length} DPWH offices: {offices.map((o) => o.house.name).join(' and ')}. Each office is shown on its own. </>}
            {offices.length > 0 && <>The page compares the House bill (third reading) with the Senate committee report, project by project, and shows each office’s budget since 2020.</>}
          </>
        }
        note={<>This page follows the office, not the district: a shared office’s figures are the whole office’s, not this district’s share.{' '}{offices.length > 0 && DEO_MEANING}</>}
      >
        <p className="hgab-dd-backlink">
          <Link to={regionHref}>← All {n(regionCount)} {regionCount === 1 ? 'district' : 'districts'} in {region.name}</Link>
        </p>
      </SenateHero>

      <main className="nep-main sdx-main">
        <SenateReviewBanner compact />
        <div className="hgab-dx-layout">
          <DistrictSidebar
            mode="page"
            regions={tree}
            regionSize={regionSize}
            query={find}
            onQuery={setFind}
            selectedId={card.id}
            focusRegion={regionKey}
            narrowed={find.trim() !== '' && tree.reduce((a, r) => a + r.districts.length, 0) <= 40}
            by={by}
            onBy={setBy}
          />
          <div className="hgab-dx-content hgab-dd-content">
            {/* ---- representative ---- */}
            <section className={`hgab-dd-rep ${ambiguous ? 'is-ambiguous' : ''}`.trim()} aria-labelledby="sdx-d-rep">
              {/* As the House bill's page: a seat with more than one possible member shows each credit, no portrait. */}
              {!ambiguous && <Portrait rep={rep} large />}
              <div>
                <p className="hgab-dd-rep-eyebrow" id="sdx-d-rep">Representative · 20th Congress</p>
                <RepresentativeBlock rep={rep} large showProfile />
                {!ambiguous && <PortraitCredit rep={rep} />}
                {ambiguous && rep?.candidates?.map((c) => <PortraitCredit key={c.name} rep={c} />)}
                <p className="hgab-dd-rep-source">The seat holder is from the House of Representatives’ member list for the 20th Congress.</p>
                <CongressCaveat />
                <p className="hgab-dd-letter">
                  <Link to={districtPath(card.id)}>This district in the House bill →</Link>
                  <span>The NEP against the House bill, the office’s largest projects, and a letter to the representative.</span>
                </p>
              </div>
            </section>

            {/* ---- whose budget is this? ---- */}
            <section className="nep-section" aria-labelledby="sdx-d-attr">
              <SectionHead
                eyebrow="Whose budget is this?"
                headline={<span id="sdx-d-attr"><AttributionBadge attribution={card.attribution} /> {attribution.label}</span>}
                dek={attribution.help}
              />
              {coServed.length > 0 && (
                <p className="hgab-dd-coserved">
                  <strong>Other legislative districts {offices.length === 1 ? 'this DPWH office serves' : 'these DPWH offices serve'}:</strong>{' '}
                  <CoServedLinks ids={coServed} index={index} />. Their pages show the same office figures. Do not add them together, or the
                  budget is counted twice.
                </p>
              )}
              {groups.map((g) => (
                <p className="hgab-dd-coserved" key={g.id}>
                  {g.name} is a regional grouping, not a DPWH district engineering office (DEO). Its budget is not assigned to a district and
                  appears on no card.
                </p>
              ))}
            </section>

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

            {/* ---- one section per office ---- */}
            {offices.map((o, i) => (
              <OfficeSection
                key={o.id}
                index={index}
                card={card}
                office={o.house}
                senate={o.senate}
                position={offices.length > 1 ? { n: i + 1, of: offices.length } : null}
                first={i === 0}
              />
            ))}

            {placed && (
              <section className="nep-section" aria-labelledby="sdx-d-placed">
                <SectionHead
                  eyebrow="Projects placed in this district"
                  headline={<span id="sdx-d-placed">{n(placed.rows)} projects placed here: {fmt.php(placed.house_php)} in the House bill, {fmt.php(placed.senate_php)} in the Senate committee report</span>}
                  dek={`Placed by the place their titles name, or by their office when it serves only this district, so they include projects listed under the Central Office. The report cuts ${n(placed.cut_rows)} of them to ₱0 (${fmt.php(placed.cut_php)}). A placement is where the work is, not who asked for it.`}
                  right={<Link className="hgab-ds-seeall" to={`${senateDistrictsHref('list-legislative')}#${districtAnchor(card.id)}`}>Every district’s placed projects →</Link>}
                />
              </section>
            )}

            {/* ---- how to read ---- */}
            <aside className="hgab-dd-howto" aria-labelledby="sdx-d-howto">
              <h2 id="sdx-d-howto">How to read this page</h2>
              <ol>
                <li>
                  <strong>Every figure says whose it is.</strong> Lone: the office serves only this district. Shared: it serves several,
                  and its figure is shared, not split.
                </li>
                <li>
                  <strong>The report lists the projects it changes.</strong> A House bill project it does not list keeps its amount. One
                  it cuts to ₱0 is removed. It does not say why, or who asked.
                </li>
                <li>
                  <strong>Most DPWH budget is on no district card.</strong> Projects listed under the DPWH Central Office or a regional
                  office are not assigned to a district. <Link to={SENATE_DISTRICTS_ROOT}>The Districts overview</Link> shows how much.
                </li>
                <li>
                  <strong>The House bill and the report are versions of one budget.</strong> Compare them; never add them.
                </li>
              </ol>
            </aside>

            <DisclaimerNotice compact offices />
            <p className="nep-provenance">
              Sources: the Senate committee report on House Bill 10858 (Annex A-4), House Bill 10858 at third reading, the enacted
              budgets for 2020–2026, the DEO2LEG office-to-district map, and bills.juris.ph for representatives.
              {' · '}<Link to={regionHref}>All districts in {region.name}</Link>
            </p>
          </div>
        </div>
      </main>
      <SiteFooter source={SOURCES} />
    </>
  );
}

function OfficeSection({ index, card, office, senate, position, first }: {
  index: HgabDistrictIndex;
  card: DistrictCard;
  office: OfficeHistory;
  senate: SenateOffice;
  /** "1 of 2" when several offices serve the district. */
  position: { n: number; of: number } | null;
  /** The first office carries the page's one chart key. */
  first: boolean;
}) {
  const others = office.district_ids.filter((d) => d !== card.id);
  const sid = `sdx-o-${office.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const regionKey = districtRegionKey(office);
  const maxPhp = Math.max(1, ...SENATE_OFFICE_STATUSES.map((s) => senate.status[s].house_php));
  const ins = senate.inserted;
  const kept = senate.rows - senate.status.cut.rows;
  return (
    <section className="hgab-dd-office" aria-labelledby={sid}>
      <p className="hgab-dd-office-eyebrow">
        The DPWH office that serves this legislative district{position ? ` · ${position.n} of ${position.of}` : ''}
      </p>
      <div className="hgab-dd-office-head">
        <h2 id={sid}>{dpwhOfficeName(office.name)}</h2>
        {office.tier && <TierBadge tier={office.tier} sharedWith={others.length} />}
        <span className="hgab-dd-office-kind">
          {officeKindText(office)}{regionKey !== 'other' ? ` · ${regionNames(regionKey).name}` : office.region ? ` · ${office.region}` : ''}
        </span>
      </div>
      <p className="hgab-dd-coserved">
        {others.length === 0 ? (
          <>This DPWH office serves only one legislative district, {card.label}, so every figure below can be read as the district’s.</>
        ) : (
          <>
            <strong>Shared office total, not split.</strong> This office also serves <CoServedLinks ids={others} index={index} />. The
            figures below are the whole office’s, shared among the {others.length + 1} districts.
          </>
        )}
      </p>

      {/* ---- 2027: the Senate committee report against the House bill ---- */}
      <div className="hgab-dd-fy27">
        <SectionHead
          size="sm"
          eyebrow="2027 · the Senate committee report compared with the House bill"
          headline="What the Senate committee report changed for this office’s projects"
          dek="The office’s House bill projects, as the report leaves them: kept, renamed, raised, reduced or cut to ₱0."
        />
        <KpiStrip items={[
          { label: 'House bill, third reading', value: fmt.shortPhp(senate.house_php), sub: `${n(senate.rows)} projects` },
          {
            label: 'Senate committee report', value: fmt.shortPhp(senate.senate_php), tone: senate.senate_php < senate.house_php ? 'down' : senate.senate_php > senate.house_php ? 'up' : undefined,
            sub: <><SignedPhp value={senate.senate_php - senate.house_php} /> vs the House bill · {formatPct(pctChange(senate.senate_php, senate.house_php))}</>,
          },
          { label: 'Projects kept', value: `${n(kept)} of ${n(senate.rows)}`, sub: `${n(senate.status.cut.rows)} cut to ₱0 (${fmt.shortPhp(senate.status.cut.house_php)})` },
          { label: 'House insertions kept', value: `${n(ins.kept_rows)} of ${n(ins.rows)}`, sub: ins.rows ? `not in the NEP · ${fmt.shortPhp(ins.kept_php)} kept, ${fmt.shortPhp(ins.cut_php)} cut` : 'none in this office' },
        ]} />
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
        {(office.fy2027?.office_change?.rows ?? 0) > 0 && (
          <p className="hgab-dd-office-change">
            <strong>{n(office.fy2027!.office_change.rows)} {office.fy2027!.office_change.rows === 1 ? 'line' : 'lines'} changed office between the NEP and the House bill</strong>{' '}
            and {office.fy2027!.office_change.rows === 1 ? 'is' : 'are'} held out of every district, as on the House bill pages: not in the figures above.
          </p>
        )}
      </div>

      {senate.top_cut.length > 0 && (
        <div className="hgab-dd-projects">
          <SectionHead
            size="sm"
            eyebrow="Cut to ₱0"
            headline="The office’s largest projects the report cuts"
            dek="By House bill amount. Each links to its page in the Senate committee report."
            right={<Link className="hgab-ds-seeall" to={senateListPath('dpwh', 'office', officeLabel(office))}>See every project for this office →</Link>}
          />
          <ol className="sdx-cuts">
            {senate.top_cut.map(([hid, title, php]) => (
              <li key={hid}><Link to={senateRecordPath('dpwh', hid)}>{title}</Link> <span>{fmt.php(php)} in the House bill</span></li>
            ))}
          </ol>
        </div>
      )}
      {senate.top_cut.length === 0 && (
        <p className="sdx-more"><Link to={senateListPath('dpwh', 'office', officeLabel(office))}>Every project of this office in the Senate committee report →</Link></p>
      )}

      {/* ---- the office's budget since 2020, as on the House bill's page ---- */}
      <div className="hgab-dd-fy27">
        <SectionHead size="sm" eyebrow="Budget by year and Congress" headline="The office’s budget since 2020" dek="The enacted budgets for 2020 to 2026, the 2027 NEP and the House bill, as on the House bill’s page." />
        {first && <ChartKeyRow terms={index.terms?.length ? index.terms : undefined} />}
        <div className="hgab-dd-two">
          <div><HistoryTable office={office} /></div>
          <div><HistoryChart office={office} size="full" /></div>
        </div>
      </div>
    </section>
  );
}
