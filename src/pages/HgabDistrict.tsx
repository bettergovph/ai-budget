/**
 * `/hgab/2027/districts/:id` — one legislative district, read through the
 * office(s) that build there.
 *
 * The representative who holds the seat in the 20th Congress; then, per
 * district engineering office that serves the district: its tier and the
 * other districts it serves, the budget history as a table and a chart with
 * per-Congress enacted subtotals, the FY2027 House bill against the NEP for
 * its rows (KPIs and the six-group strip), and its largest FY2027 projects
 * read from the DPWH parquet in the browser. Figures are the office's,
 * undivided; nothing here attributes a project or an amount to the
 * representative.
 *
 * A sidebar lists every region and district (`HgabDistrictSidebar`, page
 * mode): this district is current and its region open, and every row links
 * straight to that district's page, so a reader can move between districts
 * without going back. The back link returns to the list at this region.
 *
 * Copy is plain first; office aliases, the published labels each year was
 * matched on, crosswalk ids and data scopes sit in "Details for analysts".
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { SectionHead } from '../components/shared';
import { KpiStrip } from '../components/Nep2027Bits';
import {
  BridgeStrip, DisclaimerNotice, HgabDetails, HgabError, HgabHeader, HgabHero, HgabLoading, StageAmounts, StatusChip,
} from '../components/HgabBits';
import { DeltaCell, PageLinks } from '../components/HgabProjects';
import {
  AttributionBadge, ChartKeyRow, CoServedLinks, CongressCaveat, HistoryChart, Portrait, PortraitCredit,
  RepresentativeBlock, TierBadge,
} from '../components/HgabDistrictBits';
import DistrictSidebar from '../components/HgabDistrictSidebar';
import { runQuery } from '../lib/duckdb';
import * as fmt from '../lib/format';
import {
  CONGRESS_TERMS, HGAB_ROOT, HGAB_SOURCE_REPO, PLAIN_TERMS, districtPath, formatPct, loadHgabDistricts, loadHgabOverview,
  pctChange, projectsParquetUrl, recordPath,
  type DistrictCard, type HgabDatasetMeta, type HgabDistrictIndex, type HgabDocument, type HgabOverview, type OfficeHistory,
  type ProjectRow,
} from '../lib/hgab';
import {
  ATTRIBUTION_LABELS, DEFAULT_DISTRICT_FILTERS, FISCAL_STAGE_LONG, FISCAL_STAGE_SHORT, cardOffices, cardRegionalGroups,
  coServedIds, districtListHref, districtRegionKey, dpwhOfficeName, filterDistricts, fiscalYearRange, findDistrict, gaaSubtotal,
  historySlots, officeKindText, officeParquetLabel, officeProjectsHref, officeTierText, regionAnchor, regionNames,
  browseFromParams, sidebarOfficeRegions, sidebarRegions, slotLabel,
  type DistrictBrowse,
} from '../lib/hgab-districts';
import { LIST_COLUMNS, coerceRow, parquetSource, sqlStr } from '../lib/hgab-query';
import { DEO_MEANING } from '../lib/hgab-leaderboard';
import '../hgab-districts.css';

const TOP_N = 15;

/** "insertion candidate" with the plain meaning of "candidate" as its tooltip. */
function Term({ children }: { children: string }) {
  return <span className="hgab-dx-term" title={PLAIN_TERMS.candidate.meaning}>{children}</span>;
}

export default function HgabDistrict() {
  const { id = '' } = useParams();
  const [index, setIndex] = useState<HgabDistrictIndex | null>(null);
  const [overview, setOverview] = useState<HgabOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadHgabDistricts()
      .then((ix) => { if (live) setIndex(ix); })
      .catch((e) => { if (live) setErr(String(e?.message || e)); });
    // The overview supplies the DPWH dataset meta and the document catalogue
    // that project rows cite; the page renders without it.
    loadHgabOverview().then((ov) => { if (live) setOverview(ov); }).catch(() => { /* optional */ });
    return () => { live = false; };
  }, []);

  const card = index ? findDistrict(index, id) : undefined;
  useEffect(() => {
    if (card) document.title = `${card.label} — public works budget by Congress and the 2027 House bill · BetterGov Budget`;
  }, [card]);

  // Moving between districts from the sidebar keeps this page mounted; start
  // each district at the top, as a new page would.
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0);
  }, [id, hash]);

  // The sidebar's own filter (this page has no list filters in its URL), and
  // its browse mode, which is: `?by=office` keeps the tree under the offices
  // as the reader moves from district to district.
  const [find, setFind] = useState('');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const by = browseFromParams(params);
  const setBy = (next: DistrictBrowse) =>
    navigate({ search: next === 'office' ? '?by=office' : '', hash: window.location.hash }, { replace: true });
  const tree = useMemo(() => {
    if (!index) return [];
    const cards = filterDistricts(index, { ...DEFAULT_DISTRICT_FILTERS, q: find });
    return by === 'office' ? sidebarOfficeRegions(cards, index) : sidebarRegions(cards);
  }, [index, find, by]);
  const regionSize = useMemo(() => {
    const m = new Map<ReturnType<typeof districtRegionKey>, number>();
    for (const d of index?.districts ?? []) m.set(districtRegionKey(d), (m.get(districtRegionKey(d)) ?? 0) + 1);
    return m;
  }, [index]);

  if (err) return <HgabError message={err} />;
  if (!index) return <HgabLoading what="the 2027 district index" />;
  if (!card) {
    return (
      <HgabError
        message={`There is no district with the id “${id}” among the ${index.districts.length.toLocaleString()} districts listed. A saved link may be older than the current office-to-district map. The Districts tab above lists every one.`}
      />
    );
  }

  const offices = cardOffices(card, index);
  const groups = cardRegionalGroups(card, index);
  const rep = card.representative;
  const ambiguous = rep?.status === 'ambiguous';
  const coServed = coServedIds(card, index);
  const dpwh = overview?.datasets.find((d) => d.key === 'dpwh') ?? null;
  const attribution = ATTRIBUTION_LABELS[card.attribution];
  const built = index.built_at ? new Date(index.built_at) : null;
  const regionKey = districtRegionKey(card);
  const region = regionNames(regionKey);
  const regionHref = districtListHref(regionAnchor(regionKey));
  const regionCount = index.districts.filter((d) => districtRegionKey(d) === regionKey).length;
  const one = offices.length === 1 ? offices[0] : null;

  return (
    <>
      <HgabHeader
        crumb={
          <>
            <Link to={districtPath()}>Districts</Link> › <Link to={regionHref}>{region.name}</Link> › {card.label}
          </>
        }
        compiledMeta={`${offices.length} DPWH ${offices.length === 1 ? 'office' : 'offices'} · ${attribution.label}`}
      />

      <HgabHero
        compact
        crumb={
          <>
            <Link to={districtPath()}>Districts</Link>
            <span className="hgab-crumb-sep" aria-hidden="true">·</span>
            <Link to={regionHref}>{region.name}</Link>
            <span className="hgab-crumb-sep" aria-hidden="true">·</span>
            <span className="hgab-crumb-here">{card.label}</span>
          </>
        }
        title={card.label}
        dek={
          <>
            {regionKey === 'other'
              ? <>The office-to-district map gives no region we recognise for this district ({card.region ?? 'none recorded'}).</>
              : <>A legislative district in {region.name} ({region.short}).</>}{' '}
            {offices.length === 0 && attribution.help}
            {one && (
              <>
                Its DPWH office is the {one.name}. {DEO_MEANING}{' '}
                {officeTierText(one.tier, Math.max(0, one.district_ids.length - 1))}.
              </>
            )}
            {offices.length > 1 && (
              <>It is served by {offices.length} DPWH offices: {offices.map((o) => o.name).join(' and ')}. {DEO_MEANING} Each office is shown on its own. {attribution.label}.</>
            )}
            {offices.length > 0 && (
              <>
                {' '}The page shows the enacted budget (GAA) for 2020 to 2026. For 2027 it compares the NEP with the
                House bill (third reading). The NEP is the budget the President submits to Congress each August.
              </>
            )}
          </>
        }
        note={
          <>
            This page follows the office, not the district. It shows which districts an office serves, never
            which district a project is in. Figures are the office’s, as each document publishes them.
          </>
        }
      >
        <p className="hgab-dd-backlink">
          <Link to={regionHref}>← All {regionCount.toLocaleString()} {regionCount === 1 ? 'district' : 'districts'} in {region.name}</Link>
        </p>
      </HgabHero>

      <main className="nep-main">
        <div className="hgab-dx-layout">
          <DistrictSidebar
            mode="page"
            regions={tree}
            regionSize={regionSize}
            query={find}
            onQuery={setFind}
            selectedId={card.id}
            focusRegion={regionKey}
            narrowed={find.trim() !== '' && tree.reduce((n, r) => n + r.districts.length, 0) <= 40}
            by={by}
            onBy={setBy}
          />
          <div className="hgab-dx-content hgab-dd-content">
            {/* ---- representative ---- */}
            <section className={`hgab-dd-rep ${ambiguous ? 'is-ambiguous' : ''}`.trim()} aria-labelledby="hgab-dd-rep-title">
              {!ambiguous && <Portrait rep={rep} large />}
              <div>
                <p className="hgab-dd-rep-eyebrow" id="hgab-dd-rep-title">Representative · 20th Congress</p>
                <RepresentativeBlock rep={rep} large showProfile />
                {!ambiguous && <PortraitCredit rep={rep} />}
                {ambiguous && rep?.candidates?.map((c) => <PortraitCredit key={c.name} rep={c} />)}
                <p className="hgab-dd-rep-source">The seat holder is from the House of Representatives’ member list for the 20th Congress.</p>
                <CongressCaveat />
              </div>
            </section>

            {/* ---- whose budget is this? ---- */}
            <section className="nep-section" aria-labelledby="hgab-dd-attr">
              <SectionHead
                eyebrow="Whose budget is this?"
                headline={<span id="hgab-dd-attr"><AttributionBadge attribution={card.attribution} /> {attribution.label}</span>}
                dek={attribution.help}
              />
              {coServed.length > 0 && (
                <p className="hgab-dd-coserved">
                  <strong>Other legislative districts {offices.length === 1 ? 'this DPWH office serves' : 'these DPWH offices serve'}:</strong>{' '}
                  <CoServedLinks ids={coServed} index={index} />. Their
                  cards show the same office figures. Do not add the cards together, or the money is counted twice.
                </p>
              )}
              {groups.map((g) => (
                <p className="hgab-dd-coserved" key={g.id}>
                  {g.name} is a regional grouping, not a DPWH district engineering office (DEO). Its money is not assigned to a district and
                  appears on no card.
                </p>
              ))}
              {offices.length === 0 && groups.length === 0 && (
                <p className="hgab-dd-coserved">{ATTRIBUTION_LABELS.none.help}</p>
              )}
            </section>

            {/* ---- one section per office ---- */}
            {offices.map((o, i) => (
              <OfficeSection
                key={o.id}
                office={o}
                card={card}
                index={index}
                dpwh={dpwh}
                docs={overview?.documents ?? null}
                position={offices.length > 1 ? { n: i + 1, of: offices.length } : null}
                first={i === 0}
              />
            ))}

            {/* ---- how to read ---- */}
            <aside className="hgab-dd-howto" aria-labelledby="hgab-dd-howto-title">
              <h2 id="hgab-dd-howto-title">How to read this page</h2>
              <ol>
                <li>
                  <strong>Every figure says whose it is.</strong> Tier A: the office serves only this district. Tier B:
                  it serves several, and its figure is shared, not split.
                </li>
                <li>
                  <strong>Shared money is never split.</strong> A shared office’s total is shown whole, with the other
                  districts named beside it. Splitting it by population or road length would invent a figure the data
                  cannot support.
                </li>
                <li>
                  <strong>Most DPWH money is on no district card.</strong> Money listed under the DPWH Central Office or
                  a regional office is not assigned to a district. <Link to={districtPath()}>The Districts overview</Link> shows
                  how much, every year.
                </li>
                <li>
                  <strong>2027 changes are leads, not findings.</strong> An <Term>insertion candidate</Term> is a House
                  bill project we could not find in the NEP. A <Term>deletion candidate</Term> is the reverse.
                  Uncertain matches are left out of the counts.
                </li>
                <li>
                  <strong>The two 2027 bars measure different things.</strong> The NEP bar is the whole office. The
                  House bill bar counts named projects only, so compare it with the thin line, not the bar.
                </li>
              </ol>
            </aside>

            <DisclaimerNotice compact offices />

            <p className="nep-provenance">
              Sources: the enacted budgets for 2020–2026, the NEP for 2027, House Bill 10858
              at third reading, the DEO2LEG office-to-district map, and bills.juris.ph for representatives.
              {' · '}<Link to={regionHref}>All districts in {region.name}</Link>
              {' · '}<Link to={`${HGAB_ROOT}/methodology`}>Methodology</Link>
              {' · '}<Link to={`${HGAB_ROOT}/sources`}>Sources</Link>
            </p>

            <HgabDetails>
              <ul>
                {built && <li>Index built {built.toLocaleString('en-PH')}.</li>}
                <li>
                  GAA FY2020–2026 from this portal’s operating-unit data; the DBM NEP FY2027 operating-unit listing;
                  House Bill 10858 third reading against the NEP from{' '}
                  <a href={HGAB_SOURCE_REPO} target="_blank" rel="noopener noreferrer">the extraction workbench</a>
                  {index.source_commit && <> at commit <code>{index.source_commit.slice(0, 7)}</code></>}.
                </li>
                <li>
                  DEO2LEG crosswalk v{index.crosswalk.schema_version} ({index.crosswalk.build_date}). District id{' '}
                  <code>{card.id}</code>; region label <code>{card.region ?? 'null'}</code>; attribution <code>{card.attribution}</code>.
                </li>
                <li>
                  Seat holder from the congress.gov.ph 20th Congress directory as captured by the crosswalk, joined to{' '}
                  <a href="https://bills.juris.ph" target="_blank" rel="noopener noreferrer">bills.juris.ph</a> on the member code
                  {rep?.member_code && <> (<code>{rep.member_code}</code>)</>}.
                </li>
                {index.scope_notes.map((n) => <li key={n}>{n}</li>)}
              </ul>
            </HgabDetails>
          </div>
        </div>
      </main>
      <SiteFooter source={`SOURCE: ENACTED BUDGETS (GAA) 2020–2026 · NEP 2027 · HOUSE BILL 10858, THIRD READING · DEO2LEG OFFICE-TO-DISTRICT MAP · ${card.label.toUpperCase()}`} />
    </>
  );
}

// ---------------------------------------------------------------------------
// One office
// ---------------------------------------------------------------------------

function OfficeSection({ office, card, index, dpwh, docs, position, first }: {
  office: OfficeHistory;
  card: DistrictCard;
  index: HgabDistrictIndex;
  dpwh: HgabDatasetMeta | null;
  docs: readonly HgabDocument[] | null;
  /** "1 of 2" when several offices serve the district. */
  position: { n: number; of: number } | null;
  /** The first office carries the page's one chart key and the strip's one "What this means". */
  first: boolean;
}) {
  const others = office.district_ids.filter((d) => d !== card.id);
  const f = office.fy2027;
  const delta = f && f.hgab3_php != null && f.nep_php != null ? f.hgab3_php - f.nep_php : null;
  const label = officeParquetLabel(office);
  const sid = office.id.replace(/[^a-zA-Z0-9_-]/g, '-');
  const regionKey = districtRegionKey(office);
  const slots = historySlots(office);

  return (
    <section className="hgab-dd-office" aria-labelledby={`${sid}-title`}>
      <p className="hgab-dd-office-eyebrow">
        The DPWH office that serves this legislative district{position ? ` · ${position.n} of ${position.of}` : ''}
      </p>
      <div className="hgab-dd-office-head">
        <h2 id={`${sid}-title`}>{dpwhOfficeName(office.name)}</h2>
        <TierBadge tier={office.tier} sharedWith={others.length} />
        <span className="hgab-dd-office-kind">
          {officeKindText(office)}{regionKey !== 'other' ? ` · ${regionNames(regionKey).name}` : office.region ? ` · ${office.region}` : ''}
        </span>
      </div>
      <p className="hgab-dd-coserved">
        {office.tier === 'A' ? (
          <>This DPWH office serves only one legislative district, {card.label}, so every figure below can be read as the district’s.</>
        ) : (
          <>
            <strong>Shared office total, not split.</strong> This office also serves <CoServedLinks ids={others} index={index} />.
            The figures below are the whole office’s, shared among the {others.length + 1} districts.
          </>
        )}
      </p>

      {first && <ChartKeyRow terms={index.terms?.length ? index.terms : undefined} />}
      <div className="hgab-dd-two">
        <div>
          <p className="hgab-dd-sub">Budget by year and Congress</p>
          <HistoryTable office={office} />
        </div>
        <div>
          <p className="hgab-dd-sub">The same figures as a chart</p>
          <HistoryChart office={office} size="full" />
        </div>
      </div>

      {/* ---- FY2027 against the NEP, compared population ---- */}
      <div className="hgab-dd-fy27">
        <SectionHead
          size="sm"
          eyebrow="2027 · the House bill compared with the NEP"
          headline="What the House bill changed for this office’s projects"
          dek={
            <>
              Named projects listed under this office in the NEP and in the House bill. A project “in the House
              bill only” is an <Term>insertion candidate</Term>; “in the NEP only”, a <Term>deletion candidate</Term>. Both are leads to check, not findings.
            </>
          }
        />
        {f ? (
          <>
            <KpiStrip
              items={[
                { label: 'NEP', value: f.nep_php == null ? '—' : fmt.shortPhp(f.nep_php), sub: `${f.nep_records.toLocaleString()} named projects` },
                { label: 'House bill, second reading', value: f.hgab2_php == null ? '—' : fmt.shortPhp(f.hgab2_php), sub: 'the earlier House vote' },
                {
                  label: 'House bill, third reading',
                  value: f.hgab3_php == null ? '—' : fmt.shortPhp(f.hgab3_php),
                  tone: delta == null ? undefined : delta >= 0 ? 'up' : 'down',
                  sub: delta == null
                    ? `${f.hgab3_records.toLocaleString()} named projects`
                    : `${delta >= 0 ? '+' : '−'}${fmt.shortPhp(Math.abs(delta))} vs the NEP · ${formatPct(pctChange(f.hgab3_php, f.nep_php))} · ${f.hgab3_records.toLocaleString()} named projects`,
                },
                {
                  label: 'Projects in each',
                  value: `${f.nep_records.toLocaleString()} → ${f.hgab3_records.toLocaleString()}`,
                  sub: 'NEP → House bill · compared, not added',
                },
              ]}
            />
            {f.bridge
              ? <BridgeStrip bridge={f.bridge} dataset="dpwh" explain={first} />
              : <p className="nep-empty">No project comparison for this office.</p>}
            {(f.office_change?.rows ?? 0) > 0 && (
              <p className="hgab-dd-office-change">
                <strong>
                  Lines that changed office between the NEP and the House bill: {f.office_change.rows.toLocaleString()}{' '}
                  {f.office_change.rows === 1 ? 'line' : 'lines'}, held out of every district.
                </strong>{' '}
                {f.office_change.rows === 1
                  ? 'One document lists it under this office, the other under a different office or none. Its money'
                  : 'One document lists them under this office, the other under a different office or none. Their money'}{' '}
                (NEP <span title={fmt.php(f.office_change.nep_php, { unit: 'full' })}>{fmt.php(f.office_change.nep_php)}</span>, House bill{' '}
                <span title={fmt.php(f.office_change.hgab3_php, { unit: 'full' })}>{fmt.php(f.office_change.hgab3_php)}</span>) is in none of the
                figures above.
              </p>
            )}
          </>
        ) : (
          <p className="nep-empty">This office has no 2027 project comparison.</p>
        )}
      </div>

      {/* ---- top projects from the parquet ---- */}
      <div className="hgab-dd-projects">
        <SectionHead
          size="sm"
          eyebrow="Largest 2027 projects"
          headline="The office’s largest 2027 projects"
          dek={`The ${TOP_N} largest by House bill amount, then by NEP amount for projects the House bill drops. Each links to its own page and to the budget page it comes from.`}
          right={
            <Link className="hgab-ds-seeall" to={officeProjectsHref(office)}>
              See every project for this office →
            </Link>
          }
        />
        <OfficeProjects label={label} dpwh={dpwh} docs={docs} />
      </div>

      <HgabDetails title="Details for analysts: how this office was matched">
        <p>
          Projects link and table: rows whose House-side office reads exactly <code>{label}</code>. Both amounts of a
          paired row are booked to the office listed on the House side, as elsewhere in the House bill section. Crosswalk id{' '}
          <code>{office.id}</code>; kind <code>{office.kind}</code>; tier <code>{office.tier}</code>.
        </p>
        {office.aliases_used.length > 0 && (
          <p>
            Joined across years by these labels, as published:{' '}
            {office.aliases_used.map((a, i) => <span key={a}>{i > 0 && ', '}<code>{a}</code></span>)}.
          </p>
        )}
        <dl>
          {slots.map((s) => (
            <div key={`${s.fy}-${s.stage}`} style={{ display: 'contents' }}>
              <dt>{slotLabel(s)}</dt>
              <dd>{s.matched_label ? <>matched label <code>{s.matched_label}</code></> : 'not found in that year’s data'}</dd>
            </div>
          ))}
        </dl>
        {office.notes.length > 0 && office.notes.map((n) => <p key={n}>{n}</p>)}
      </HgabDetails>
    </section>
  );
}

// ---------------------------------------------------------------------------
// History table: nine slots, per-Congress enacted subtotal rows
// ---------------------------------------------------------------------------

function HistoryTable({ office }: { office: OfficeHistory }) {
  const slots = historySlots(office);
  return (
    <div className="nep-table-wrap">
      <table className="nep-table hgab-dd-history">
        <thead>
          <tr>
            <th>Year</th>
            <th>Document</th>
            <th>Congress</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {CONGRESS_TERMS.map((term) => {
            const own = slots.filter((s) => s.congress.congress === term.congress);
            const sub = gaaSubtotal(office, term.congress);
            return [
              ...own.map((s) => (
                <tr key={`${s.fy}-${s.stage}`} className={`${s.stage !== 'gaa' ? 'is-proposal' : ''} ${s.php == null ? 'is-null' : ''}`.trim()}>
                  <td>{s.fy}</td>
                  <td><span className={`hgab-dd-stage is-${s.stage}`} title={FISCAL_STAGE_LONG[s.stage]}>{FISCAL_STAGE_SHORT[s.stage]}</span></td>
                  <td className="nep-td-dim">{s.congress.label}</td>
                  <td className="num" title={s.php == null ? 'Not found in that year’s data, not a zero' : fmt.php(s.php, { unit: 'full' })}>
                    {s.php == null ? <span className="hgab-ds-null">—</span> : fmt.shortPhp(s.php)}
                  </td>
                </tr>
              )),
              <tr key={`sub-${term.congress}`} className="is-subtotal">
                <td colSpan={3}>
                  {term.label} · enacted total
                  <span className="nep-code">
                    {sub.years.length
                      ? `${fiscalYearRange(sub.years).replace('FY', '')} · ${sub.years.length} ${sub.years.length === 1 ? 'year' : 'years'}`
                      : 'no enacted figure found'}
                    {term.years.includes(2027) ? ' · the 2027 NEP and House bill are listed, not added' : ''}
                  </span>
                </td>
                <td className="num" title={sub.php == null ? undefined : fmt.php(sub.php, { unit: 'full' })}>
                  {sub.php == null ? <span className="hgab-ds-null">—</span> : fmt.shortPhp(sub.php)}
                </td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
      <p className="nep-hier-note">
        Hover a figure for the exact pesos. A dash means the office was not found in that year’s data, never
        zero. Totals add enacted budgets only; the 2027 figures are not yet law, so they are listed beside them.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top projects for the office, via DuckDB-Wasm
// ---------------------------------------------------------------------------

type Tagged<T> = { key: string } & T;

function OfficeProjects({ label, dpwh, docs }: { label: string; dpwh: HgabDatasetMeta | null; docs: readonly HgabDocument[] | null }) {
  const url = useMemo(() => projectsParquetUrl('dpwh'), []);
  const sql = useMemo(
    () => `SELECT ${LIST_COLUMNS.join(', ')}
FROM ${parquetSource(url)}
WHERE office = ?
ORDER BY hgab3_php DESC NULLS LAST, nep_php DESC NULLS LAST, title ASC, id ASC
LIMIT ${TOP_N}`,
    [url],
  );
  const [result, setResult] = useState<Tagged<{ rows: ProjectRow[]; ms: number }> | null>(null);
  const [error, setError] = useState<Tagged<{ message: string }> | null>(null);

  useEffect(() => {
    let live = true;
    const key = `${sql}|${label}`;
    (async () => {
      try {
        let res;
        try {
          res = await runQuery(sql, [label]);
        } catch {
          // Parameter binding is not available in every DuckDB-Wasm build; inline the literal.
          res = await runQuery(sql.replace('WHERE office = ?', `WHERE office = ${sqlStr(label)}`));
        }
        if (!live) return;
        setResult({ key, rows: res.rows.map((r) => coerceRow(r as Record<string, unknown>)), ms: Math.round(res.ms) });
        setError(null);
      } catch (e) {
        if (!live) return;
        setError({ key, message: String((e as Error)?.message || e) });
      }
    })();
    return () => { live = false; };
  }, [sql, label]);

  const key = `${sql}|${label}`;
  const fresh = result?.key === key ? result : null;
  const failed = error?.key === key ? error : null;
  const loading = !fresh && !failed;
  const rows = fresh?.rows ?? [];

  if (loading) {
    return (
      <p className="hgab-dd-projects-busy" role="status">
        <span className="busy-sweep" aria-hidden="true" />
        Loading this office’s projects… the first load fetches the project file
      </p>
    );
  }
  if (failed) {
    return (
      <div className="hgab-ds-parquet-err" role="alert">
        <p>Could not load this office’s projects. The budget history above is unaffected.</p>
        <HgabDetails>
          <p>Reading <code>hgab/2027/dpwh/projects.parquet</code> in the browser failed:</p>
          <pre>{failed.message}</pre>
        </HgabDetails>
      </div>
    );
  }
  if (!rows.length) {
    return (
      <p className="nep-empty">
        No 2027 project is listed under this office. Its enacted budget history above still stands.
      </p>
    );
  }
  return (
    <>
      <div className="nep-table-wrap">
        <table className="nep-table hgab-dd-projects-table">
          <thead>
            <tr>
              <th className="hgab-ds-rank">#</th>
              <th className="nep-th-name">Project</th>
              <th>What changed</th>
              <th>Amounts</th>
              <th className="num">Change from the NEP</th>
              <th>Source pages</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td className="hgab-ds-rank">{i + 1}</td>
                <td className="nep-td-name">
                  <Link to={recordPath('dpwh', r.id)}>{r.title}</Link>
                  <span className="nep-code">{[r.region, r.pap].filter(Boolean).join(' · ')}</span>
                </td>
                <td><StatusChip trace={r.trace} /></td>
                <td><StageAmounts row={r} /></td>
                <td className="num"><DeltaCell delta={r.delta_php} base={r.nep_php} /></td>
                <td>{dpwh ? <PageLinks row={r} dataset={dpwh} docs={docs} /> : <span className="hgab-ds-null">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="nep-hier-note" title={fresh ? `Read in ${fresh.ms} ms` : undefined}>
        {rows.length} {rows.length === 1 ? 'project' : 'projects'} listed under this office, largest House bill amount
        first. The amounts are compared, never added. A dash means that document does not list the project.
      </p>
    </>
  );
}
